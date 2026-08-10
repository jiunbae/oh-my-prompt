const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { openDb, nowIso, hashContent } = require("./db");
const { enqueuePayload, getQueueStats } = require("./queue");
const { updateState } = require("./state");
const { redactText, redactValue } = require("./redact");
const { touchTrigger } = require("./auto-sync");
const { acquireSyncLock, releaseSyncLock } = require("./sync-lock");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// sql.js persists by rewriting the whole DB file on every save. Two `omp ingest`
// processes (hooks fire one per turn) can therefore clobber each other's writes:
// both read the same file, mutate in memory, and the slower writer wins,
// dropping the faster writer's rows. Serialize the read-modify-write with an
// advisory file lock. If it cannot be acquired, queue the event instead of
// proceeding with an unlocked last-writer-wins update.
const INGEST_LOCK = { name: "database-operation.lock", ttlMs: 60 * 1000 };

// A hook has to hand control back to the editor, so it waits briefly and then
// queues the payload for later. User-initiated commands have no such deadline
// and should wait instead of failing: one `omp ingest` legitimately holds the
// lock for minutes on a large database (sql.js rewrites the whole file on every
// save), so a 10s ceiling makes `omp backfill` / `omp sync` report OMP_DB_BUSY
// when the only problem is that capture is busy doing its job.
const SHORT_LOCK_WAIT_MS = 10 * 1000;
const LONG_LOCK_WAIT_MS = 15 * 60 * 1000;

// Each flush rewrites the whole database, so batch the replay. Small enough
// that a crash costs at most this many queue files' worth of re-work.
const REPLAY_FLUSH_EVERY_FILES = 100;

async function acquireIngestLock(options = {}) {
  const waitMs = options.waitMs ?? SHORT_LOCK_WAIT_MS;
  const deadline = Date.now() + waitMs;
  let notified = false;
  for (;;) {
    const lock = acquireSyncLock({ name: INGEST_LOCK.name, ttlMs: INGEST_LOCK.ttlMs });
    if (lock.ok) return lock;
    if (Date.now() >= deadline) return lock;
    if (options.onWait && !notified) {
      notified = true;
      options.onWait(lock.lockInfo);
    }
    await sleep(40 + Math.floor(Math.random() * 60));
  }
}

// Waiting silently for minutes looks like a hang, so say who we are waiting on.
function reportLockWait(label) {
  return (lockInfo) => {
    if (!process.stderr.isTTY) return;
    const owner = lockInfo?.pid ? ` (held by pid ${lockInfo.pid})` : "";
    process.stderr.write(`${label}: waiting for the local database${owner}...\n`);
  };
}

function parsePayload(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function getWordCount(text) {
  if (!text) return 0;
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

// Rough char-to-token ratio (~4 chars per token for English text)
const TOKEN_CHAR_RATIO = 4;

function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / TOKEN_CHAR_RATIO);
}

function safeTimestamp(value) {
  // `new Date("garbage").toISOString()` throws RangeError. Guard it so an
  // unparseable timestamp falls back to now() instead of crashing ingest
  // (which used to throw before the queue safety-net could catch it).
  if (!value) return nowIso();
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return nowIso();
  return d.toISOString();
}

function normalizePayload(payload, config) {
  const timestamp = safeTimestamp(payload.timestamp);
  const turnIndex =
    payload.turn_index != null && Number.isFinite(Number(payload.turn_index))
      ? Number(payload.turn_index)
      : null;
  const promptText = payload.text || payload.prompt_text || payload.prompt || "";
  const responseText = payload.response_text || null;
  const captureResponse =
    typeof payload.capture_response === "boolean"
      ? payload.capture_response
      : config.capture.response;

  const rawPromptText = promptText;
  const rawResponseText = responseText;

  let storedPromptText = rawPromptText;
  let storedResponseText = captureResponse ? rawResponseText : null;
  const meta =
    payload.meta && typeof payload.meta === "object" ? { ...payload.meta } : undefined;

  if (config.capture?.redact?.enabled) {
    const promptRedaction = redactText(rawPromptText, config.capture.redact);
    storedPromptText = promptRedaction.text;

    let responseRedaction = { text: storedResponseText || "", count: 0 };
    if (captureResponse && storedResponseText) {
      responseRedaction = redactText(storedResponseText, config.capture.redact);
      storedResponseText = responseRedaction.text;
    }

    if (meta) {
      meta.redactions = {
        prompt: promptRedaction.count,
        response: responseRedaction.count,
      };
    }
  }

  const baseRecord = {
    id: payload.id || crypto.randomUUID(),
    created_at: timestamp,
    updated_at: timestamp,
    source: payload.source || "unknown",
    session_id: payload.session_id || null,
    role: payload.role || "user",
    prompt_text: storedPromptText,
    response_text: captureResponse ? storedResponseText : null,
    prompt_length: storedPromptText.length,
    response_length: captureResponse && storedResponseText ? storedResponseText.length : null,
    project: payload.project || (payload.cwd ? require("path").basename(payload.cwd) : null),
    cwd: payload.cwd || null,
    model: payload.model || null,
    cli_name: payload.cli_name || payload.cli || payload.source || "unknown",
    cli_version: payload.cli_version || null,
    hook_version: payload.hook_version || null,
    token_estimate: payload.token_estimate || estimateTokens(storedPromptText),
    token_estimate_response:
      captureResponse && storedResponseText
        ? payload.token_estimate_response || estimateTokens(storedResponseText)
        : null,
    word_count: payload.word_count || getWordCount(storedPromptText),
    word_count_response:
      captureResponse && storedResponseText
        ? payload.word_count_response || getWordCount(storedResponseText)
        : null,
    capture_response: captureResponse ? 1 : 0,
    content_hash: payload.content_hash || hashContent(rawPromptText),
    turn_index: turnIndex,
    extra_json: meta ? JSON.stringify(meta) : null,
  };

  const eventBase = payload.event_id
    ? payload.event_id
    : hashContent(
        JSON.stringify({
          source: baseRecord.source,
          session_id: baseRecord.session_id,
          role: baseRecord.role,
          prompt_text: rawPromptText,
          response_text: rawResponseText || "",
          // Fold turn_index into the derived event_id so two identical prompts
          // in the same session get distinct identities instead of colliding
          // on ON CONFLICT(event_id). Omitted when null to keep event_ids
          // stable for producers that don't supply a turn index.
          ...(turnIndex != null ? { turn_index: turnIndex } : {}),
        })
      );

  return { ...baseRecord, event_id: eventBase };
}

function deriveProgram(toolName, input) {
  if (toolName !== "Bash") return null;
  if (!input || typeof input !== "object") return null;
  let cmd = typeof input.command === "string" ? input.command.trim() : "";
  if (!cmd) return null;
  cmd = cmd.replace(/^`+/, "").replace(/`+$/, "");
  let safety = 8;
  while (safety-- > 0) {
    if (cmd.startsWith("sudo ")) { cmd = cmd.slice(5).trimStart(); continue; }
    if (cmd.startsWith("env ")) { cmd = cmd.slice(4).trimStart(); continue; }
    const assign = cmd.match(/^[A-Za-z_][A-Za-z0-9_]*=\S*\s+/);
    if (assign) { cmd = cmd.slice(assign[0].length); continue; }
    const flag = cmd.match(/^-{1,2}[A-Za-z0-9][\w-]*(?:=\S*)?\s+/);
    if (flag) { cmd = cmd.slice(flag[0].length); continue; }
    break;
  }
  const wrapper = cmd.match(/^(?:bash|sh|zsh)\s+-[lic]+\s+["']([^"']+)["']/);
  if (wrapper) cmd = wrapper[1].trim();
  const first = (cmd.split(/\s+/)[0] || "").replace(/^[;&|<>()`'"]+|[;&|<>()`'"]+$/g, "");
  if (!first || first.startsWith("-")) return null;
  const base = first.split("/").pop() || first;
  return base.toLowerCase().slice(0, 100);
}

function insertToolInvocations(db, tools, promptId, record, redactOptions) {
  if (!Array.isArray(tools) || tools.length === 0) return;
  if (!record.session_id) return;
  const stmt = db.prepare(`
    INSERT INTO tool_invocations (
      id, prompt_id, session_id, sequence, source, tool_name, tool_use_id,
      input_json, program, cwd, created_at
    ) VALUES (
      @id, @prompt_id, @session_id, @sequence, @source, @tool_name, @tool_use_id,
      @input_json, @program, @cwd, @created_at
    )
    ON CONFLICT(session_id, tool_use_id) DO UPDATE SET
      prompt_id = COALESCE(tool_invocations.prompt_id, excluded.prompt_id),
      sequence = excluded.sequence,
      input_json = excluded.input_json,
      program = excluded.program,
      cwd = excluded.cwd
    -- Skip the update when it would write back identical values. DO UPDATE
    -- always counts as a modified row, which marks the transaction dirty and
    -- costs a full-database rewrite — and re-ingesting the same tool-bearing
    -- turn is the common case (a Stop hook resending its tools, replay,
    -- backfill). IS NOT rather than <> so NULL columns compare correctly.
    WHERE tool_invocations.prompt_id IS NOT COALESCE(tool_invocations.prompt_id, excluded.prompt_id)
       OR tool_invocations.sequence IS NOT excluded.sequence
       OR tool_invocations.input_json IS NOT excluded.input_json
       OR tool_invocations.program IS NOT excluded.program
       OR tool_invocations.cwd IS NOT excluded.cwd
  `);
  for (const t of tools) {
    if (!t || !t.tool_use_id || !t.tool_name) continue;
    const input = t.input != null ? t.input : null;
    // Redact secrets inside tool inputs (Bash commands, Edit contents, WebFetch
    // bodies, …) before storing when capture redaction is enabled. Program is
    // derived from the original input — the command name itself is not secret
    // and redaction could otherwise obscure it.
    const storedInput =
      redactOptions && input != null ? redactValue(input, redactOptions) : input;
    stmt.run({
      id: crypto.randomUUID(),
      prompt_id: promptId || null,
      session_id: record.session_id,
      sequence: typeof t.sequence === "number" ? t.sequence : 0,
      source: record.source || null,
      tool_name: String(t.tool_name).slice(0, 100),
      tool_use_id: String(t.tool_use_id).slice(0, 255),
      input_json: storedInput != null ? JSON.stringify(storedInput) : null,
      program: deriveProgram(t.tool_name, input),
      cwd: t.cwd || record.cwd || null,
      created_at: record.created_at || nowIso(),
    });
  }
}

function ftsInsert(db, rowid, promptText, responseText) {
  try {
    db.prepare(
      "INSERT INTO prompts_fts (rowid, prompt_text, response_text) VALUES (?, ?, ?)"
    ).run(rowid, promptText || "", responseText || "");
  } catch {
    // FTS table missing or unsupported — search falls back to LIKE.
  }
}

function ftsUpdateResponse(db, promptId, responseText) {
  try {
    db.prepare(
      "UPDATE prompts_fts SET response_text = ? WHERE rowid = (SELECT rowid FROM prompts WHERE id = ?)"
    ).run(responseText || "", promptId);
  } catch {}
}


function insertPrompt(db, record) {
  const stmt = db.prepare(`
    INSERT INTO prompts (
      event_id,
      id, created_at, updated_at, source, session_id, role,
      prompt_text, response_text, prompt_length, response_length,
      project, cwd, model, cli_name, cli_version, hook_version,
      token_estimate, token_estimate_response, word_count, word_count_response,
      capture_response, content_hash, turn_index, extra_json
    ) VALUES (
      @event_id,
      @id, @created_at, @updated_at, @source, @session_id, @role,
      @prompt_text, @response_text, @prompt_length, @response_length,
      @project, @cwd, @model, @cli_name, @cli_version, @hook_version,
      @token_estimate, @token_estimate_response, @word_count, @word_count_response,
      @capture_response, @content_hash, @turn_index, @extra_json
    )
    ON CONFLICT(event_id) DO NOTHING
  `);
  const result = stmt.run(record);
  if (result.changes > 0) {
    const row = db.prepare("SELECT rowid FROM prompts WHERE id = ?").get(record.id);
    if (row) ftsInsert(db, row.rowid, record.prompt_text, record.response_text);
  }
  return result;
}

function updatePromptWithResponse(db, promptId, responseText, tokenEstimate, wordCount) {
  const stmt = db.prepare(`
    UPDATE prompts
    SET response_text = ?, response_length = ?, token_estimate_response = ?, word_count_response = ?, updated_at = ?
    WHERE id = ?
  `);
  stmt.run(
    responseText,
    responseText ? responseText.length : null,
    tokenEstimate,
    wordCount,
    nowIso(),
    promptId
  );
  ftsUpdateResponse(db, promptId, responseText);
}

// Keep every mutation for one captured turn in one SQL transaction. Besides
// making the prompt, FTS mirror, response, and tool rows atomic, this is also
// the persistence boundary for sql.js: DatabaseWrapper saves once after the
// outer transaction instead of serialising the full database once per helper.
function persistPayload(db, payload, record, toolRedact) {
  if (record.role === "assistant" && record.session_id) {
    let row = null;

    // Precise match: use user_prompt_text content hash when available.
    if (payload.user_prompt_text) {
      const hash = hashContent(payload.user_prompt_text);
      row = db
        .prepare(
          `SELECT id, prompt_text FROM prompts
           WHERE session_id = ? AND role = 'user' AND content_hash = ?
           LIMIT 1`
        )
        .get(record.session_id, hash);
    }

    // Fallback: match oldest unmatched user prompt in the session.
    if (!row) {
      row = db
        .prepare(
          `SELECT id, prompt_text FROM prompts
           WHERE session_id = ? AND role = 'user' AND response_text IS NULL
           ORDER BY created_at ASC LIMIT 1`
        )
        .get(record.session_id);
    }

    if (row) {
      const hasTools = Array.isArray(payload.tools) && payload.tools.length > 0;
      if (record.capture_response === 1 && record.prompt_text) {
        updatePromptWithResponse(
          db,
          row.id,
          record.prompt_text,
          record.token_estimate,
          record.word_count
        );
      }
      if (hasTools) {
        insertToolInvocations(db, payload.tools, row.id, record, toolRedact);
      }
      if (record.prompt_text || hasTools) {
        return {
          result: { ok: true, id: row.id, updated: true },
          lastCapture: record.prompt_text ? record.created_at : null,
          touch: true,
        };
      }
    }
  }

  // Content-based dedup: catch duplicates from different sources (hooks vs
  // backfill) that have different event_ids but identical content within the
  // same session. turn_index keeps genuinely repeated turns distinct.
  if (record.session_id && record.content_hash) {
    const contentDup = db
      .prepare(
        `SELECT id, response_text FROM prompts
         WHERE session_id = ? AND role = ? AND content_hash = ?
           AND (turn_index IS ? OR turn_index IS NULL OR ? IS NULL)
         LIMIT 1`
      )
      .get(record.session_id, record.role, record.content_hash, record.turn_index, record.turn_index);
    if (contentDup) {
      insertToolInvocations(db, payload.tools, contentDup.id, record, toolRedact);
      if (!contentDup.response_text && record.response_text && record.capture_response === 1) {
        updatePromptWithResponse(
          db,
          contentDup.id,
          record.response_text,
          record.token_estimate_response,
          record.word_count_response
        );
        return {
          result: { ok: true, id: contentDup.id, updated: true, deduped: true },
          touch: true,
        };
      }
      return {
        result: { ok: true, id: contentDup.id, updated: false, deduped: true },
      };
    }
  }

  const insertResult = insertPrompt(db, record);
  if (insertResult.changes === 0) {
    const existing = db
      .prepare("SELECT id, response_text FROM prompts WHERE event_id = ? LIMIT 1")
      .get(record.event_id);
    // FK is ON DELETE CASCADE; pass null prompt_id if there is no real row to
    // point at, otherwise this would violate the foreign key.
    const existingId = existing?.id || record.id;
    insertToolInvocations(db, payload.tools, existing?.id || null, record, toolRedact);
    if (existing && !existing.response_text && record.response_text && record.capture_response === 1) {
      updatePromptWithResponse(
        db,
        existing.id,
        record.response_text,
        record.token_estimate_response,
        record.word_count_response
      );
      return {
        result: { ok: true, id: existing.id, updated: true, deduped: true },
        touch: true,
      };
    }
    return {
      result: { ok: true, id: existingId, updated: false, deduped: true },
    };
  }

  insertToolInvocations(db, payload.tools, record.id, record, toolRedact);
  return {
    result: { ok: true, id: record.id, updated: false },
    lastCapture: record.created_at,
    touch: true,
  };
}

async function ingestPayload(rawPayload, config, options = {}) {
  const payload = typeof rawPayload === "string" ? parsePayload(rawPayload) : rawPayload;
  if (!payload) {
    return { ok: false, error: "Invalid JSON payload" };
  }

  // Redaction options for tool inputs when capture redaction is enabled.
  const toolRedact = config.capture?.redact?.enabled ? config.capture.redact : null;

  const externalDb = options.db;
  const queueOnFailure = options.queueOnFailure !== false;
  // Serialize concurrent ingest processes around the whole read-modify-write.
  // The caller owns the lifecycle when it passes its own db handle, so skip
  // locking (and DB open/close) in that case.
  const lock = externalDb ? null : await acquireIngestLock();
  if (!externalDb && (!lock || !lock.ok)) {
    const queuedPayload =
      config.capture?.redact?.enabled
        ? redactValue(payload, config.capture.redact)
        : payload;
    if (queueOnFailure) {
      enqueuePayload(JSON.stringify(queuedPayload), config.queue?.maxBytes);
    }
    const error = "Local database is busy; payload queued for retry";
    updateState({ lastError: error });
    return { ok: false, queued: queueOnFailure, error };
  }
  let db = externalDb;

  try {
    db = db || await openDb(config.storage.sqlite.path);
    const record = normalizePayload(payload, config);
    const outcome = db.transaction(() =>
      persistPayload(db, payload, record, toolRedact)
    )();
    if (outcome.lastCapture) updateState({ lastCapture: outcome.lastCapture });
    if (outcome.touch) touchTrigger();
    return outcome.result;
  } catch (error) {
    const queuedPayload =
      config.capture?.redact?.enabled
        ? redactValue(payload, config.capture.redact)
        : payload;
    if (queueOnFailure) {
      enqueuePayload(JSON.stringify(queuedPayload), config.queue?.maxBytes);
    }
    updateState({ lastError: error.message || "Failed to ingest" });
    return { ok: false, error: error.message || "Failed to ingest" };
  } finally {
    if (!externalDb) {
      try {
        if (db) db.close();
      } finally {
        if (lock && lock.ok) releaseSyncLock(lock.lockPath);
      }
    }
  }
}

async function replayQueue(config) {
  const queueDir = require("./paths").getQueueDir();
  if (!fs.existsSync(queueDir)) {
    return { processed: 0, failed: 0 };
  }

  const files = fs.readdirSync(queueDir).filter((f) => f.endsWith(".jsonl"));
  let processed = 0;
  let failed = 0;

  if (files.length === 0) {
    return { processed, failed };
  }

  // Replaying used to hand each payload to ingestPayload without a handle, so
  // every queued item reopened the database, took the lock, and rewrote the
  // whole file. A backlog of a few thousand items therefore took hours and
  // starved backfill/sync of the lock the entire time. Take the lock once, keep
  // one handle in batch mode, and persist in batches instead.
  const lock = await acquireIngestLock({
    waitMs: LONG_LOCK_WAIT_MS,
    onWait: reportLockWait("replay"),
  });
  if (!lock.ok) {
    return { processed, failed, error: "Local database is busy" };
  }

  let db;
  try {
    db = await openDb(config.storage.sqlite.path);
  } catch (error) {
    // Unusable database: nothing can be replayed, so leave every queue file in
    // place and report the payloads as failed, exactly as the per-payload path
    // used to when each open threw on its own.
    releaseSyncLock(lock.lockPath);
    for (const file of files) {
      try {
        failed += fs
          .readFileSync(path.join(queueDir, file), "utf-8")
          .split("\n")
          .filter(Boolean).length;
      } catch {
        // Vanished between the listing and now — nothing to count.
      }
    }
    updateState({ lastError: error.message || "Failed to open database" });
    return { processed, failed, error: error.message || "Failed to open database" };
  }
  db.setBatchMode(true);

  // A queue file may only be deleted once its rows are durable on disk —
  // otherwise a crash between the in-memory write and the flush loses them.
  let pendingDeletes = [];
  const persistAndDrop = () => {
    if (pendingDeletes.length === 0) return;
    db.flush();
    for (const p of pendingDeletes) {
      try {
        fs.unlinkSync(p);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    pendingDeletes = [];
  };

  try {
    for (const file of files) {
      const filepath = path.join(queueDir, file);
      let lines;
      try {
        lines = fs.readFileSync(filepath, "utf-8").split("\n").filter(Boolean);
      } catch (error) {
        if (error.code === "ENOENT") continue;
        throw error;
      }
      let fileFailed = false;

      for (const line of lines) {
        // The source queue file remains in place on failure; do not create a
        // second copy of the same payload on every replay attempt.
        const result = await ingestPayload(line, config, {
          queueOnFailure: false,
          db,
        });
        if (result.ok) {
          processed += 1;
        } else {
          failed += 1;
          fileFailed = true;
        }
      }

      if (!fileFailed) {
        pendingDeletes.push(filepath);
        if (pendingDeletes.length >= REPLAY_FLUSH_EVERY_FILES) persistAndDrop();
      }
    }
    persistAndDrop();
  } finally {
    try {
      db.close();
    } finally {
      releaseSyncLock(lock.lockPath);
    }
  }

  const queueStats = getQueueStats();
  updateState({
    queueCount: queueStats.count,
    queueBytes: queueStats.bytes,
    // A successful drain resolves the previous OMP_DB_BUSY condition; keeping
    // that stale error makes `omp status` claim capture is still unhealthy.
    ...(failed === 0 ? { lastError: null } : {}),
    lastReplay: {
      processed,
      failed,
      at: nowIso(),
    },
  });
  return { processed, failed };
}

module.exports = {
  ingestPayload,
  replayQueue,
  acquireIngestLock,
  reportLockWait,
  SHORT_LOCK_WAIT_MS,
  LONG_LOCK_WAIT_MS,
};
