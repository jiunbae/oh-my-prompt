const http = require("http");
const https = require("https");
const { createSyncLog, finishSyncLog, updateSyncState, getDeviceId, withDatabaseOperation } = require("./sync-log");
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

function fetchRows(db, since, lastId, limit) {
  if (!since) {
    return db
      .prepare("SELECT * FROM prompts ORDER BY created_at ASC, id ASC LIMIT ?")
      .all(limit);
  }

  const iso = new Date(since).toISOString();
  // Fetch new rows OR rows updated after last sync (e.g. response added later)
  if (lastId) {
    return db
      .prepare(
        `SELECT * FROM prompts
         WHERE (created_at > ? OR (created_at = ? AND id > ?))
            OR (updated_at > ? AND response_text IS NOT NULL AND created_at <= ?)
         ORDER BY created_at ASC, id ASC
         LIMIT ?`
      )
      .all(iso, iso, lastId, iso, iso, limit);
  }
  return db
    .prepare(
      `SELECT * FROM prompts
       WHERE created_at > ?
          OR (updated_at > ? AND response_text IS NOT NULL AND created_at <= ?)
       ORDER BY created_at ASC, id ASC
       LIMIT ?`
    )
    .all(iso, iso, iso, limit);
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
        `[omp] Record ${rec.event_id} has ${tools.length} tool invocations; uploading first ${MAX_TOOLS_PER_RECORD} (server limit)\n`
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
       FROM tool_invocations
       WHERE prompt_id IN (${placeholders})
       ORDER BY prompt_id, sequence`
    )
    .all(...promptIds);
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
      "  omp config set server.token YOUR_TOKEN"
    );
  }

  const pageRows = options.maxRowsPerPage || SYNC_PAGE_ROWS;

  async function fetchPage() {
    return withDatabaseOperation(config, (db) => {
      const deviceId = getDeviceId(config);
      const stateRow = db
        .prepare("SELECT last_synced_at, last_synced_id FROM sync_state WHERE device_id = ?")
        .get(deviceId);
      const state = stateRow
        ? { lastSyncedAt: stateRow.last_synced_at, lastSyncedId: stateRow.last_synced_id }
        : { lastSyncedAt: null, lastSyncedId: null };
      const since = options.since || state.lastSyncedAt || null;
      const rows = fetchRows(db, since, state.lastSyncedId, pageRows);
      const toolsByPrompt = fetchToolsForPrompts(
        db,
        rows.map((row) => row.id),
      );
      return { since, rows, toolsByPrompt, state };
    });
  }

  let page = await fetchPage();
  const since = page.since;

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

  const logId = await createSyncLog(config, since, "server");
  const uploadUrl = `${serverUrl.replace(/\/$/, "")}/api/sync/upload`;
  const headers = { "X-User-Token": serverToken };

  // Advance the checkpoint after every chunk the server has fully accepted.
  // A large backlog can outlive one run (throttling, a dropped connection); a
  // single end-of-run commit would throw that progress away and make the next
  // run replay every record from the same starting point.
  //
  // Only ever move forward. fetchRows also returns backfilled rows — created
  // before the checkpoint but updated after it, e.g. a response attached by a
  // later Stop hook — and orders them ahead of new rows because they sort by
  // created_at. Committing a chunk verbatim would drag the checkpoint backwards
  // and make every later run re-fetch from the older point.
  let checkpointAt = page.state.lastSyncedAt;
  let checkpointId = page.state.lastSyncedId;

  function isAhead(row) {
    if (!checkpointAt) return true;
    if (row.created_at !== checkpointAt) return row.created_at > checkpointAt;
    return !checkpointId || String(row.id) > String(checkpointId);
  }

  async function commitCheckpoint(row) {
    if (options.dryRun || !row?.created_at) return;
    if (!isAhead(row)) return;
    checkpointAt = row.created_at;
    checkpointId = row.id;
    await updateSyncState(config, checkpointAt, checkpointId);
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
    const pageStartedAt = checkpointAt;
    const pageStartedId = checkpointId;
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
        await commitCheckpoint(lastRowOfChunk);
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
        await commitCheckpoint(lastRowOfChunk);
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
      await commitCheckpoint(lastRowOfChunk);

      if (options.onProgress) {
        options.onProgress({ uploaded: totalAccepted, duplicates: totalDuplicates, chunks, totalRows: rows.length, sent: i });
      }
    }

      // A short page means the backlog is drained. A dry run never commits a
      // checkpoint, so it would otherwise re-fetch the same page forever.
      if (rows.length < pageRows || options.dryRun) break;
      // Rows can be returned without moving the checkpoint — backfilled rows
      // created before it are legitimately re-sent but never advance it. If a
      // whole page failed to move the cursor, the next fetch returns the same
      // rows, so stop instead of looping on them.
      if (checkpointAt === pageStartedAt && checkpointId === pageStartedId) break;
      page = await fetchPage();
      if (page.rows.length === 0) break;
    }

    await finishSyncLog(config, logId, "success", null, chunks, totalAccepted);
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
    await finishSyncLog(config, logId, "failed", error.message || "unknown", chunks, totalAccepted);
    throw error;
  }
}

module.exports = {
  syncToServer,
  postJson,
  getJson,
};
