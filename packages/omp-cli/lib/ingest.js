const fs = require("fs");
const crypto = require("crypto");
const { openDb, nowIso, hashContent } = require("./db");
const { analyzePrompt } = require("./insights");
const { enqueuePayload, getQueueStats } = require("./queue");
const { updateState } = require("./state");
const { redactText } = require("./redact");

function parsePayload(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

function getWordCount(text) {
  if (!text) return 0;
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

function normalizePayload(payload, config) {
  const timestamp = payload.timestamp ? new Date(payload.timestamp).toISOString() : nowIso();
  const promptText = payload.text || payload.prompt_text || "";
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
    project: payload.project || null,
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
          created_at: baseRecord.created_at,
        })
      );

  return { ...baseRecord, event_id: eventBase };
}

function insertPrompt(db, record) {
  const stmt = db.prepare(`
    INSERT INTO prompts (
      event_id,
      id, created_at, updated_at, source, session_id, role,
      prompt_text, response_text, prompt_length, response_length,
      project, cwd, model, cli_name, cli_version, hook_version,
      token_estimate, token_estimate_response, word_count, word_count_response,
      capture_response, content_hash, extra_json
    ) VALUES (
      @event_id,
      @id, @created_at, @updated_at, @source, @session_id, @role,
      @prompt_text, @response_text, @prompt_length, @response_length,
      @project, @cwd, @model, @cli_name, @cli_version, @hook_version,
      @token_estimate, @token_estimate_response, @word_count, @word_count_response,
      @capture_response, @content_hash, @extra_json
    )
    ON CONFLICT(event_id) DO NOTHING
  `);
  return stmt.run(record);
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
}

function upsertReview(db, promptId, promptText) {
  const review = analyzePrompt(promptText);
  const stmt = db.prepare(`
    INSERT INTO prompt_reviews (prompt_id, score, signals_json, suggestions_json, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(prompt_id) DO UPDATE SET
      score = excluded.score,
      signals_json = excluded.signals_json,
      suggestions_json = excluded.suggestions_json,
      created_at = excluded.created_at
  `);
  stmt.run(
    promptId,
    review.score,
    JSON.stringify(review.signals),
    JSON.stringify(review.suggestions),
    nowIso()
  );
  return review;
}

function ingestPayload(rawPayload, config) {
  const payload = typeof rawPayload === "string" ? parsePayload(rawPayload) : rawPayload;
  if (!payload) {
    return { ok: false, error: "Invalid JSON payload" };
  }

  const record = normalizePayload(payload, config);
  const db = openDb(config.storage.sqlite.path);

  try {
    if (record.role === "assistant" && record.session_id) {
      const row = db
        .prepare(
          `SELECT id, prompt_text FROM prompts
           WHERE session_id = ? AND role = 'user' AND response_text IS NULL
           ORDER BY created_at DESC LIMIT 1`
        )
        .get(record.session_id);

      if (row && record.capture_response === 1 && record.prompt_text) {
        updatePromptWithResponse(
          db,
          row.id,
          record.prompt_text,
          record.token_estimate,
          record.word_count
        );
        updateState({ lastCapture: record.created_at });
        return { ok: true, id: row.id, updated: true };
      }
    }

    const insertResult = insertPrompt(db, record);
    if (insertResult.changes === 0) {
      const existing = db
        .prepare("SELECT id FROM prompts WHERE event_id = ? LIMIT 1")
        .get(record.event_id);
      return { ok: true, id: existing?.id || record.id, updated: false, deduped: true };
    }
    if (record.role === "user") {
      upsertReview(db, record.id, record.prompt_text);
    }
    updateState({ lastCapture: record.created_at });
    return { ok: true, id: record.id, updated: false };
  } catch (error) {
    const raw = typeof rawPayload === "string" ? rawPayload : JSON.stringify(payload);
    enqueuePayload(raw, config.queue?.maxBytes);
    updateState({ lastError: error.message || "Failed to ingest" });
    return { ok: false, error: error.message || "Failed to ingest" };
  } finally {
    db.close();
  }
}

function replayQueue(config) {
  const queueDir = require("./paths").getQueueDir();
  if (!fs.existsSync(queueDir)) {
    return { processed: 0, failed: 0 };
  }

  const files = fs.readdirSync(queueDir).filter((f) => f.endsWith(".jsonl"));
  let processed = 0;
  let failed = 0;

  for (const file of files) {
    const filepath = path.join(queueDir, file);
    const lines = fs.readFileSync(filepath, "utf-8").split("\n").filter(Boolean);
    let fileFailed = false;

    for (const line of lines) {
      const result = ingestPayload(line, config);
      if (result.ok) {
        processed += 1;
      } else {
        failed += 1;
        fileFailed = true;
      }
    }

    if (!fileFailed) {
      fs.unlinkSync(filepath);
    }
  }

  const queueStats = getQueueStats();
  updateState({
    queueCount: queueStats.count,
    queueBytes: queueStats.bytes,
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
};
