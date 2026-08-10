const http = require("http");
const https = require("https");
const {
  createSyncRun,
  persistSyncRun,
  getDeviceId,
  withDatabaseOperation,
} = require("./sync-log");
const { postprocessUploadRecord } = require("./upload-postprocess");

// The server upload schema rejects records with more than 1000 tool
// invocations (tools: z.array(...).max(1000) in /api/sync/upload). Long
// agentic sessions can exceed this; cap at upload time so one oversized
// record doesn't 400 the whole chunk. The local DB keeps the full list.
const MAX_TOOLS_PER_RECORD = 1000;

// A run with no checkpoint (a fresh device, or a cursor reset after backfill)
// used to select the entire prompts table in one `.all()` — every row with its
// full prompt and response text, plus every tool invocation for those rows, all
// resident at once while holding the database lock. On a large history that is
// gigabytes of JS objects for a job that only ever uploads 200 records at a
// time. Page it instead: bounded memory, and the lock is released between pages
// so capture is not starved for the length of the whole backlog.
const SYNC_PAGE_ROWS = 2000;
const SYNC_AT_SQL =
  "CASE WHEN response_text IS NOT NULL AND updated_at > created_at " +
  "THEN updated_at ELSE created_at END";

function fetchRows(db, since, lastId, limit, after = null) {
  const clauses = [];
  const params = [];

  if (since) {
    const iso = new Date(since).toISOString();
    // Fetch new rows OR rows updated after last sync (e.g. response added later).
    if (lastId) {
      clauses.push(
        `((created_at > ? OR (created_at = ? AND id > ?))
          OR (response_text IS NOT NULL
              AND (updated_at > ? OR (updated_at = ? AND id > ?))))`
      );
      params.push(iso, iso, lastId, iso, iso, lastId);
    } else {
      clauses.push(
        `(created_at > ?
          OR (response_text IS NOT NULL AND updated_at > ?))`
      );
      params.push(iso, iso);
    }
  }

  // This keyset cursor is local to one sync run and deliberately independent
  // from the durable checkpoint. The run keeps its starting predicate stable
  // while the checkpoint advances after accepted chunks; without a separate
  // scan cursor, every page fetch would return the same first page.
  if (after?.syncAt && after?.id) {
    clauses.push(`(${SYNC_AT_SQL} > ? OR (${SYNC_AT_SQL} = ? AND id > ?))`);
    params.push(after.syncAt, after.syncAt, after.id);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  return db
    .prepare(
      `SELECT *, ${SYNC_AT_SQL} AS sync_at FROM prompts
       ${where}
       ORDER BY sync_at ASC, id ASC
       LIMIT ?`
    )
    .all(...params, limit);
}

function rowToUploadRecord(row, tools) {
  const rec = {
    event_id: row.event_id || row.id.toString(),
    created_at: row.created_at,
    prompt_text: row.prompt_text,
    response_text: row.response_text ?? null,
    prompt_length: row.prompt_length ?? (row.prompt_text ? row.prompt_text.length : 0),
    response_length: row.response_length ?? null,
    project: row.project || (row.cwd ? require("path").basename(row.cwd) : null),
    cwd: row.cwd ?? null,
    source: row.source || "omp-cli",
    session_id: row.session_id ?? null,
    role: row.role || "user",
    model: row.model ?? null,
    cli_name: row.cli_name ?? null,
    cli_version: row.cli_version ?? null,
    token_estimate: row.token_estimate ?? null,
    token_estimate_response: row.token_estimate_response ?? null,
    word_count: row.word_count ?? null,
    word_count_response: row.word_count_response ?? null,
    content_hash: row.content_hash ?? null,
  };
  if (Array.isArray(tools) && tools.length > 0) {
    if (tools.length > MAX_TOOLS_PER_RECORD) {
      process.stderr.write(
        `[omp] Record ${rec.event_id} has more than ${MAX_TOOLS_PER_RECORD} tool invocations; uploading the first ${MAX_TOOLS_PER_RECORD} (server limit)\n`
      );
      rec.tools = tools.slice(0, MAX_TOOLS_PER_RECORD);
    } else {
      rec.tools = tools;
    }
  }
  return rec;
}

function fetchToolsForPrompts(db, promptIds) {
  if (!Array.isArray(promptIds) || promptIds.length === 0) return new Map();
  const placeholders = promptIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT prompt_id, tool_use_id, tool_name, sequence, input_json, program, cwd, created_at
       FROM (
         SELECT prompt_id, tool_use_id, tool_name, sequence, input_json, program, cwd,
                created_at, rowid AS invocation_rowid,
                ROW_NUMBER() OVER (
                  PARTITION BY prompt_id
                  ORDER BY sequence ASC, rowid ASC
                ) AS invocation_rank
         FROM tool_invocations
         WHERE prompt_id IN (${placeholders})
       )
       WHERE invocation_rank <= ?
       ORDER BY prompt_id, sequence, invocation_rowid`
    )
    // Fetch one extra row so rowToUploadRecord can report truncation without
    // materialising every invocation for an oversized prompt.
    .all(...promptIds, MAX_TOOLS_PER_RECORD + 1);
  const grouped = new Map();
  for (const r of rows) {
    if (!grouped.has(r.prompt_id)) grouped.set(r.prompt_id, []);
    let input = null;
    if (r.input_json) {
      try { input = JSON.parse(r.input_json); } catch { input = null; }
    }
    grouped.get(r.prompt_id).push({
      tool_use_id: r.tool_use_id,
      tool_name: r.tool_name,
      sequence: r.sequence ?? 0,
      input,
      program: r.program ?? null,
      cwd: r.cwd ?? null,
      created_at: r.created_at,
    });
  }
  return grouped;
}

// Error codes that indicate transient network failures worth retrying
const TRANSIENT_CODES = ["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EPIPE", "EAI_AGAIN"];

// HTTP status codes that should NOT be retried (permanent failures)
const NO_RETRY_STATUSES = [401, 403, 413];

// The server applies a per-user sliding window of 100 requests/minute
// (rateLimiters.api in /api/sync/upload). Pace client requests just under it so
// a large backlog never rate-limits itself, and retry rather than abort when we
// do get throttled (e.g. by a concurrent auto-sync daemon).
const DEFAULT_MAX_REQUESTS_PER_MINUTE = 90;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const DEFAULT_RATE_LIMIT_RETRIES = 5;
const MAX_RETRY_AFTER_MS = 120 * 1000;
const FALLBACK_RETRY_AFTER_MS = 15 * 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Client-side sliding-window throttle. Blocks before a request would exceed
 * `maxPerMinute`, so the run stays inside the server's budget instead of
 * discovering the limit via 429s.
 */
function createRequestPacer(maxPerMinute) {
  const limit = Number(maxPerMinute);
  if (!Number.isFinite(limit) || limit <= 0) return async () => {};

  const sent = [];
  return async function pace() {
    for (;;) {
      const now = Date.now();
      const cutoff = now - RATE_LIMIT_WINDOW_MS;
      while (sent.length > 0 && sent[0] <= cutoff) sent.shift();
      if (sent.length < limit) {
        sent.push(now);
        return;
      }
      await sleep(Math.max(50, sent[0] + RATE_LIMIT_WINDOW_MS - now));
    }
  };
}

/** Parse a `Retry-After` header (delta-seconds or HTTP-date) into milliseconds. */
function parseRetryAfterMs(headers) {
  const raw = headers && (headers["retry-after"] ?? headers["Retry-After"]);
  if (raw === undefined || raw === null || raw === "") return null;

  const seconds = Number(raw);
  if (Number.isFinite(seconds)) {
    if (seconds < 0) return null;
    return Math.min(MAX_RETRY_AFTER_MS, Math.round(seconds * 1000));
  }

  const at = Date.parse(String(raw));
  if (Number.isNaN(at)) return null;
  return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, at - Date.now()));
}

function computeBackoffDelay(attempt, baseDelay) {
  const exponential = baseDelay * Math.pow(2, attempt);
  // Add jitter: 0.5x to 1.5x of the exponential delay
  const jitter = exponential * (0.5 + Math.random());
  return Math.round(jitter);
}

function isTransientError(err) {
  return TRANSIENT_CODES.includes(err.code) || err.message === "Request timed out";
}

function isTransientStatus(status) {
  return status >= 500 && !NO_RETRY_STATUSES.includes(status);
}

function assertUploadResultAccepted(result, status) {
  const rejected = Number(result?.rejected || 0);
  if (rejected === 0 && result?.success !== false) return;

  const details = Array.isArray(result?.errors)
    ? result.errors.filter((message) => typeof message === "string").slice(0, 3).join("; ")
    : "";
  throw new Error(
    `Server rejected ${rejected || "one or more"} record(s) (status ${status})` +
      (details ? `: ${details}` : ". Sync checkpoint was not advanced.")
  );
}

function postJsonOnce(url, headers, body, method) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === "https:" ? https : http;

    const payload = JSON.stringify(body);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        ...headers,
      },
      timeout: 30000,
      family: 4,
    };

    const req = transport.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          const json = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, body: json, headers: res.headers });
        } catch {
          reject(new Error(`Failed to parse JSON response (status: ${res.statusCode}): ${data.slice(0, 200)}`));
        }
      });
    });

    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

function getJsonOnce(url, headers) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === "https:" ? https : http;

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      timeout: 30000,
      family: 4,
    };

    const req = transport.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          const json = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, body: json, headers: res.headers });
        } catch {
          reject(new Error(`Failed to parse JSON response (status: ${res.statusCode}): ${data.slice(0, 200)}`));
        }
      });
    });

    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });
    req.on("error", reject);
    req.end();
  });
}

/**
 * Shared retry loop for a single HTTP request.
 *
 * 429 is throttling, not failure: it gets its own retry budget and waits for the
 * server-supplied `Retry-After` instead of consuming the transient-error budget.
 * Previously 429 fell through to the generic `status >= 400` check, so a backlog
 * big enough to exhaust the per-user window aborted the whole run — and the next
 * run replayed the same requests into the same wall.
 */
async function requestWithRetry(perform, retryOpts = {}) {
  const maxRetries = retryOpts.retries ?? 3;
  const baseDelay = retryOpts.retryBaseDelay ?? 1000;
  const maxRateLimitRetries = retryOpts.rateLimitRetries ?? DEFAULT_RATE_LIMIT_RETRIES;
  const pace = retryOpts.pace;

  let lastError;
  let attempt = 0;
  let rateLimitAttempt = 0;

  for (;;) {
    try {
      if (pace) await pace();
      const response = await perform();

      if (response.status === 429) {
        if (rateLimitAttempt >= maxRateLimitRetries) return response;
        const delay =
          parseRetryAfterMs(response.headers) ??
          Math.min(
            MAX_RETRY_AFTER_MS,
            computeBackoffDelay(rateLimitAttempt, FALLBACK_RETRY_AFTER_MS)
          );
        rateLimitAttempt++;
        process.stderr.write(
          `[omp] Rate limited by server; waiting ${Math.round(delay / 1000)}s before ` +
            `retry ${rateLimitAttempt}/${maxRateLimitRetries}\n`
        );
        await sleep(delay);
        lastError = new Error("Server error (429)");
        continue;
      }

      // Don't retry permanent failure statuses
      if (NO_RETRY_STATUSES.includes(response.status)) {
        return response;
      }

      // Retry on transient HTTP statuses (5xx)
      if (isTransientStatus(response.status) && attempt < maxRetries) {
        const delay = computeBackoffDelay(attempt, baseDelay);
        attempt++;
        process.stderr.write(
          `[omp] Retry ${attempt}/${maxRetries} after ${response.status} response (backoff ${delay}ms)\n`
        );
        await sleep(delay);
        lastError = new Error(`Server error (${response.status})`);
        continue;
      }

      return response;
    } catch (err) {
      lastError = err;

      // Only retry transient network errors
      if (isTransientError(err) && attempt < maxRetries) {
        const delay = computeBackoffDelay(attempt, baseDelay);
        attempt++;
        process.stderr.write(
          `[omp] Retry ${attempt}/${maxRetries} after ${err.code || err.message} (backoff ${delay}ms)\n`
        );
        await sleep(delay);
        continue;
      }

      throw lastError;
    }
  }
}

async function getJson(url, headers, retryOpts = {}) {
  return requestWithRetry(() => getJsonOnce(url, headers), retryOpts);
}

async function postJson(url, headers, body, method = "POST", retryOpts = {}) {
  return requestWithRetry(() => postJsonOnce(url, headers, body, method), retryOpts);
}

async function syncToServer(config, options = {}) {
  const serverUrl = config.server?.url;
  const serverToken = config.server?.token;

  if (!serverUrl || !serverToken) {
    throw new Error(
      "Server not configured. Set server.url and server.token:\n" +
      "  omp config set server.url https://prompt.jiun.dev\n" +
      "  printf '%s' \"$OMP_TOKEN\" | omp config set server.token --stdin"
    );
  }

  const requestedPageRows = Number(options.maxRowsPerPage ?? SYNC_PAGE_ROWS);
  const pageRows = Number.isFinite(requestedPageRows)
    ? Math.max(1, Math.floor(requestedPageRows))
    : SYNC_PAGE_ROWS;

  async function fetchPage(after = null, stableCursor = null) {
    return withDatabaseOperation(config, (db) => {
      const deviceId = getDeviceId(config);
      const stateRow = db
        .prepare("SELECT last_synced_at, last_synced_id FROM sync_state WHERE device_id = ?")
        .get(deviceId);
      const state = stateRow
        ? { lastSyncedAt: stateRow.last_synced_at, lastSyncedId: stateRow.last_synced_id }
        : { lastSyncedAt: null, lastSyncedId: null };
      // Test for the cursor object, not for a truthy `since`. A run that starts
      // with no lower bound — a fresh device, or the cursor reset after a
      // backfill — has a legitimately null `since`, and `??` would fall through
      // to the checkpoint this run just persisted. Later pages would then apply
      // a filter the first page did not have and the run would stop early,
      // uploading only the first page.
      const since = stableCursor
        ? stableCursor.since
        : options.since ?? state.lastSyncedAt ?? null;
      // An explicit --since starts a new range and must not inherit the id from
      // an unrelated persisted checkpoint at the same timestamp.
      const lastId = stableCursor
        ? stableCursor.lastId
        : options.since
          ? null
          : state.lastSyncedId;
      const rows = fetchRows(db, since, lastId, pageRows, after);
      const toolsByPrompt = fetchToolsForPrompts(
        db,
        rows.map((row) => row.id),
      );
      return { since, lastId, rows, toolsByPrompt, state };
    });
  }

  let page = await fetchPage();
  const since = page.since;
  const stableCursor = { since: page.since, lastId: page.lastId };

  if (page.rows.length === 0) {
    return { uploaded: 0, chunks: 0, duplicates: 0, since };
  }

  let currentChunkSize = options.chunkSize || 200;
  let totalAccepted = 0;
  let totalDuplicates = 0;
  let totalRejected = 0;
  let totalSkipped = 0;
  let chunks = 0;
  const errors = [];

  const maxRetries = config.sync?.retries ?? 3;
  const retryBaseDelay = config.sync?.retryBaseDelay ?? 1000;
  const retryOpts = {
    retries: maxRetries,
    retryBaseDelay,
    rateLimitRetries: config.sync?.rateLimitRetries ?? DEFAULT_RATE_LIMIT_RETRIES,
    pace: createRequestPacer(
      config.sync?.maxRequestsPerMinute ?? DEFAULT_MAX_REQUESTS_PER_MINUTE
    ),
  };

  const syncRun = createSyncRun(config, since, "server");
  const uploadUrl = `${serverUrl.replace(/\/$/, "")}/api/sync/upload`;
  const headers = { "X-User-Token": serverToken };

  // Stage the checkpoint after every accepted chunk, then persist intermediate
  // pages once each. The final checkpoint and sync-log result share one SQL
  // transaction, so the common one-page sync rewrites the sql.js database once
  // instead of three times. A retry may resend at most one in-flight page,
  // which is safe because the server deduplicates event ids.
  //
  // Only ever move forward. The cursor follows each row's effective mutation
  // time (`sync_at`): created_at for a new prompt, or the later updated_at when
  // a response was attached by a Stop hook. Ordering and checkpointing on the
  // same value prevents both backwards movement and repeated historical updates.
  let checkpointAt = page.state.lastSyncedAt;
  let checkpointId = page.state.lastSyncedId;
  let persistedCheckpointAt = checkpointAt;
  let persistedCheckpointId = checkpointId;

  function isAhead(row) {
    const rowSyncAt = row.sync_at || row.created_at;
    if (!checkpointAt) return true;
    if (rowSyncAt !== checkpointAt) return rowSyncAt > checkpointAt;
    return !checkpointId || String(row.id) > String(checkpointId);
  }

  function stageCheckpoint(row) {
    const rowSyncAt = row?.sync_at || row?.created_at;
    if (options.dryRun || !rowSyncAt) return;
    if (!isAhead(row)) return;
    checkpointAt = rowSyncAt;
    checkpointId = row.id;
  }

  async function persistRun(status, errorMessage = null) {
    if (options.dryRun) return;
    const persistCheckpoint = Boolean(checkpointAt) && (
      checkpointAt !== persistedCheckpointAt || checkpointId !== persistedCheckpointId
    );
    await persistSyncRun(config, syncRun, {
      status,
      errorMessage,
      filesUploaded: chunks,
      recordsUploaded: totalAccepted,
      persistCheckpoint,
      lastSyncedAt: checkpointAt,
      lastSyncedId: checkpointId,
    });
    if (persistCheckpoint) {
      persistedCheckpointAt = checkpointAt;
      persistedCheckpointId = checkpointId;
    }
  }

  function failFromStatus(status, body) {
    if (status === 429) {
      return new Error(
        "Rate limited by server (429) after exhausting retries. Records synced so far " +
          "are checkpointed — rerun `omp sync` to continue, or lower sync.maxRequestsPerMinute."
      );
    }
    return new Error(`Server error (${status}): ${JSON.stringify(body)}`);
  }

  try {
    for (;;) {
      const { rows, toolsByPrompt } = page;
      let i = 0;
      while (i < rows.length) {
        const chunk = rows.slice(i, i + currentChunkSize);
        i += chunk.length;
        const lastRowOfChunk = chunk[chunk.length - 1];

        let records = chunk.map((r) => rowToUploadRecord(r, toolsByPrompt.get(r.id)));
        records = records.map((r) => postprocessUploadRecord(r, config));
        records = records.filter((r) => r.prompt_text && r.prompt_text.trim().length > 0);

        if (records.length === 0) {
          totalSkipped += chunk.length;
          chunks++;
          stageCheckpoint(lastRowOfChunk);
          continue;
        }

        if (options.dryRun) {
          totalAccepted += records.length;
          chunks++;
          continue;
        }

        const response = await postJson(uploadUrl, headers, {
          records,
          deviceId: getDeviceId(config),
        }, "POST", retryOpts);

        if (response.status === 401) {
          throw new Error("Authentication failed. Check server.token.");
        }

        if (response.status === 413) {
          // Auto-reduce chunk size and retry this chunk. Keep the smaller size for
          // the rest of the run: re-discovering the limit on every chunk burns an
          // extra request each time, which is what drains the rate-limit window.
          const smallerChunk = Math.max(10, Math.floor(records.length / 4));
          currentChunkSize = Math.min(currentChunkSize, smallerChunk);
          process.stderr.write(
            `[omp] Request too large (${records.length} records). Using chunks of ${smallerChunk} from here on...\n`
          );
          for (let j = 0; j < records.length; j += smallerChunk) {
            const subChunk = records.slice(j, j + smallerChunk);
            const subResp = await postJson(uploadUrl, headers, {
              records: subChunk,
              deviceId: getDeviceId(config),
            }, "POST", retryOpts);
            if (subResp.status === 413) {
              throw new Error(`Request too large even with ${subChunk.length} records. Try reducing chunk size further.`);
            }
            if (subResp.status >= 400) {
              throw failFromStatus(subResp.status, subResp.body);
            }
            const subResult = subResp.body;
            totalAccepted += subResult.accepted || 0;
            totalDuplicates += subResult.duplicates || 0;
            totalRejected += subResult.rejected || 0;
            if (subResult.errors?.length) errors.push(...subResult.errors);
            // A 207 response is transport-level success but still means one or
            // more records were not persisted. Fail the run before advancing the
            // checkpoint; already accepted rows are safe to retry as duplicates.
            assertUploadResultAccepted(subResult, subResp.status);
          }
          chunks++;
          stageCheckpoint(lastRowOfChunk);
          if (options.onProgress) {
            options.onProgress({ uploaded: totalAccepted, duplicates: totalDuplicates, chunks, totalRows: rows.length, sent: i });
          }
          continue;
        }

        if (response.status >= 400) {
          throw failFromStatus(response.status, response.body);
        }

        const result = response.body;
        totalAccepted += result.accepted || 0;
        totalDuplicates += result.duplicates || 0;
        totalRejected += result.rejected || 0;
        if (result.errors?.length) {
          errors.push(...result.errors);
        }
        assertUploadResultAccepted(result, response.status);
        chunks++;
        stageCheckpoint(lastRowOfChunk);

        if (options.onProgress) {
          options.onProgress({ uploaded: totalAccepted, duplicates: totalDuplicates, chunks, totalRows: rows.length, sent: i });
        }
      }

      if (rows.length < pageRows) break;
      const lastScanned = rows[rows.length - 1];
      const nextPage = await fetchPage(
        { syncAt: lastScanned.sync_at, id: lastScanned.id },
        stableCursor
      );
      if (nextPage.rows.length === 0) break;
      // Intermediate pages preserve durable progress. The final page is
      // committed together with the completed log below, so a one-page sync
      // needs exactly one full-database rewrite.
      await persistRun("running");
      page = nextPage;
    }

    await persistRun("success");
    return {
      uploaded: totalAccepted,
      duplicates: totalDuplicates,
      rejected: totalRejected,
      skipped: totalSkipped,
      chunks,
      since,
      retries: maxRetries,
      errors: errors.slice(0, 10),
    };
  } catch (error) {
    let finalError = error;
    try {
      await persistRun("failed", error.message || "unknown");
    } catch (persistError) {
      finalError = new Error(
        `${error.message || "Sync failed"}; additionally failed to persist sync progress: ` +
          `${persistError.message || "unknown error"}`
      );
    }
    throw finalError;
  }
}

module.exports = {
  syncToServer,
  postJson,
  getJson,
};
