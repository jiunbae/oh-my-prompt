const http = require("http");
const https = require("https");
const { createSyncLog, finishSyncLog, updateSyncState, getDeviceId, withDatabaseOperation } = require("./sync-log");
const { postprocessUploadRecord } = require("./upload-postprocess");

// The server upload schema rejects records with more than 1000 tool
// invocations (tools: z.array(...).max(1000) in /api/sync/upload). Long
// agentic sessions can exceed this; cap at upload time so one oversized
// record doesn't 400 the whole chunk. The local DB keeps the full list.
const MAX_TOOLS_PER_RECORD = 1000;

function fetchRows(db, since, lastId) {
  if (!since) {
    return db
      .prepare("SELECT * FROM prompts ORDER BY created_at ASC, id ASC")
      .all();
  }

  const iso = new Date(since).toISOString();
  // Fetch new rows OR rows updated after last sync (e.g. response added later)
  if (lastId) {
    return db
      .prepare(
        `SELECT * FROM prompts
         WHERE (created_at > ? OR (created_at = ? AND id > ?))
            OR (updated_at > ? AND response_text IS NOT NULL AND created_at <= ?)
         ORDER BY created_at ASC, id ASC`
      )
      .all(iso, iso, lastId, iso, iso);
  }
  return db
    .prepare(
      `SELECT * FROM prompts
       WHERE created_at > ?
          OR (updated_at > ? AND response_text IS NOT NULL AND created_at <= ?)
       ORDER BY created_at ASC, id ASC`
    )
    .all(iso, iso, iso);
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
          resolve({ status: res.statusCode, body: json });
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
          resolve({ status: res.statusCode, body: json });
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

async function getJson(url, headers, retryOpts = {}) {
  const maxRetries = retryOpts.retries ?? 3;
  const baseDelay = retryOpts.retryBaseDelay ?? 1000;

  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await getJsonOnce(url, headers);

      if (NO_RETRY_STATUSES.includes(response.status)) {
        return response;
      }

      if (isTransientStatus(response.status) && attempt < maxRetries) {
        const delay = computeBackoffDelay(attempt, baseDelay);
        process.stderr.write(
          `[omp] Retry ${attempt + 1}/${maxRetries} after ${response.status} response (backoff ${delay}ms)\n`
        );
        await sleep(delay);
        lastError = new Error(`Server error (${response.status})`);
        continue;
      }

      return response;
    } catch (err) {
      lastError = err;

      if (isTransientError(err) && attempt < maxRetries) {
        const delay = computeBackoffDelay(attempt, baseDelay);
        process.stderr.write(
          `[omp] Retry ${attempt + 1}/${maxRetries} after ${err.code || err.message} (backoff ${delay}ms)\n`
        );
        await sleep(delay);
        continue;
      }

      throw err;
    }
  }

  throw lastError;
}

async function postJson(url, headers, body, method = "POST", retryOpts = {}) {
  const maxRetries = retryOpts.retries ?? 3;
  const baseDelay = retryOpts.retryBaseDelay ?? 1000;

  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await postJsonOnce(url, headers, body, method);

      // Don't retry permanent failure statuses
      if (NO_RETRY_STATUSES.includes(response.status)) {
        return response;
      }

      // Retry on transient HTTP statuses (5xx)
      if (isTransientStatus(response.status) && attempt < maxRetries) {
        const delay = computeBackoffDelay(attempt, baseDelay);
        process.stderr.write(
          `[omp] Retry ${attempt + 1}/${maxRetries} after ${response.status} response (backoff ${delay}ms)\n`
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
        process.stderr.write(
          `[omp] Retry ${attempt + 1}/${maxRetries} after ${err.code || err.message} (backoff ${delay}ms)\n`
        );
        await sleep(delay);
        continue;
      }

      throw err;
    }
  }

  // All retries exhausted
  throw lastError;
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

  const snapshot = await withDatabaseOperation(config, (db) => {
    const deviceId = getDeviceId(config);
    const stateRow = db
      .prepare("SELECT last_synced_at, last_synced_id FROM sync_state WHERE device_id = ?")
      .get(deviceId);
    const state = stateRow
      ? { lastSyncedAt: stateRow.last_synced_at, lastSyncedId: stateRow.last_synced_id }
      : { lastSyncedAt: null, lastSyncedId: null };
    const since = options.since || state.lastSyncedAt || null;
    const rows = fetchRows(db, since, state.lastSyncedId);
    const toolsByPrompt = fetchToolsForPrompts(
      db,
      rows.map((row) => row.id),
    );
    return { since, rows, toolsByPrompt };
  });
  const { since, rows, toolsByPrompt } = snapshot;

  if (rows.length === 0) {
    return { uploaded: 0, chunks: 0, duplicates: 0, since };
  }

  const chunkSize = options.chunkSize || 200;
  let totalAccepted = 0;
  let totalDuplicates = 0;
  let totalRejected = 0;
  let totalSkipped = 0;
  let chunks = 0;
  const errors = [];

  const maxRetries = config.sync?.retries ?? 3;
  const retryBaseDelay = config.sync?.retryBaseDelay ?? 1000;
  const retryOpts = { retries: maxRetries, retryBaseDelay };

  const logId = await createSyncLog(config, since, "server");
  const uploadUrl = `${serverUrl.replace(/\/$/, "")}/api/sync/upload`;
  const headers = { "X-User-Token": serverToken };

  try {
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      let records = chunk.map((r) => rowToUploadRecord(r, toolsByPrompt.get(r.id)));
      records = records.map((r) => postprocessUploadRecord(r, config));
      records = records.filter((r) => r.prompt_text && r.prompt_text.trim().length > 0);

      if (records.length === 0) {
        totalSkipped += chunk.length;
        chunks++;
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
        // Auto-reduce chunk size and retry this chunk
        const smallerChunk = Math.max(10, Math.floor(records.length / 4));
        process.stderr.write(
          `[omp] Request too large (${records.length} records). Splitting into chunks of ${smallerChunk}...\n`
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
            throw new Error(`Server error (${subResp.status}): ${JSON.stringify(subResp.body)}`);
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
        continue;
      }

      if (response.status >= 400) {
        throw new Error(`Server error (${response.status}): ${JSON.stringify(response.body)}`);
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

      if (options.onProgress) {
        options.onProgress({ uploaded: totalAccepted, duplicates: totalDuplicates, chunks, totalRows: rows.length, sent: Math.min(i + chunkSize, rows.length) });
      }
    }

    // Only advance sync state if the server actually accepted records
    // This prevents permanently skipping records when the server is temporarily down
    const lastRow = rows[rows.length - 1];
    if (!options.dryRun && lastRow?.created_at && (totalAccepted > 0 || totalDuplicates > 0 || totalSkipped > 0)) {
      await updateSyncState(config, lastRow.created_at, lastRow.id);
    }

    await finishSyncLog(config, logId, "success", null, chunks, totalAccepted);
    return {
      uploaded: totalAccepted,
      duplicates: totalDuplicates,
      rejected: totalRejected,
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
