const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");
const { ingestPayload } = require("./ingest");
const { hashContent } = require("./db");

// ---------------------------------------------------------------------------
// ZIP extraction
// ---------------------------------------------------------------------------

function extractZip(zipPath, outDir) {
  const result = spawnSync("unzip", ["-q", "-o", zipPath, "-d", outDir], {
    encoding: "utf-8",
    timeout: 30000,
  });
  if (result.status !== 0) {
    throw new Error(`Failed to extract ZIP: ${result.stderr || result.error?.message || "unknown error"}`);
  }
}

function resolveConversationsJson(inputPath) {
  const ext = path.extname(inputPath).toLowerCase();
  if (ext === ".json") {
    return inputPath;
  }
  if (ext === ".zip") {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "omp-chatgpt-"));
    try {
      extractZip(inputPath, tmpDir);
    } catch (err) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      throw err;
    }
    // ChatGPT exports contain conversations.json at the root of the ZIP
    const jsonPath = path.join(tmpDir, "conversations.json");
    if (fs.existsSync(jsonPath)) {
      return jsonPath;
    }
    // Some exports nest it; search one level deep
    const entries = fs.readdirSync(tmpDir);
    for (const entry of entries) {
      const nested = path.join(tmpDir, entry, "conversations.json");
      if (fs.existsSync(nested)) {
        return nested;
      }
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
    throw new Error("conversations.json not found in ZIP archive");
  }
  throw new Error(`Unsupported file type: ${ext}. Expected .zip or .json`);
}

// ---------------------------------------------------------------------------
// ChatGPT export parsing
// ---------------------------------------------------------------------------

function parseCreateTime(value) {
  if (!value) return null;
  if (typeof value === "number") {
    // Unix timestamp — could be seconds or milliseconds
    const ms = value > 1e11 ? value : value * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

function extractTextParts(content) {
  if (!content) return "";
  const parts = content.parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object") {
        // Images, file references, etc.
        if (part.type === "image" || part.type === "image_url") {
          return `[Image: ${part.source?.media_type || part.image_url?.url || "attached image"}]`;
        }
        return part.text || "";
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function extractAttachments(message) {
  const attachments = message.metadata?.attachments;
  if (!Array.isArray(attachments)) return [];
  return attachments.map((a) => ({
    name: a.file_name || a.name || "attachment",
    size: a.file_size || null,
    type: a.mime_type || a.type || null,
  }));
}

function extractModelFromMessage(message) {
  const meta = message.metadata || {};
  // model_slug is the canonical field
  if (meta.model_slug) return meta.model_slug;
  // Fallback: model derived from other metadata
  if (meta.model) return meta.model;
  if (meta.default_model_slug) return meta.default_model_slug;
  return null;
}

function extractSystemPrompts(mapping) {
  const prompts = [];
  for (const key of Object.keys(mapping)) {
    const node = mapping[key];
    if (!node || !node.message) continue;
    if (node.message.author?.role === "system") {
      const text = extractTextParts(node.message.content);
      if (text) prompts.push(text);
    }
  }
  return prompts;
}

function buildMessageOrder(mapping) {
  // Build adjacency list
  const nodes = new Map();
  let rootId = null;

  for (const [id, node] of Object.entries(mapping)) {
    if (!node || !node.message) continue;
    nodes.set(id, {
      id,
      message: node.message,
      parent: node.parent,
      children: Array.isArray(node.children) ? node.children : [],
    });
    if (node.parent === null || node.parent === undefined) {
      rootId = id;
    }
  }

  // DFS from root to get chronological order
  const ordered = [];
  const visited = new Set();

  function visit(id) {
    if (visited.has(id)) return;
    visited.add(id);
    const node = nodes.get(id);
    if (!node) return;
    ordered.push(node);
    for (const childId of node.children) {
      visit(childId);
    }
  }

  // If no clear root, start from nodes without parents
  if (rootId) {
    visit(rootId);
  } else {
    for (const [id, node] of nodes) {
      if (node.parent === null || node.parent === undefined) {
        visit(id);
      }
    }
  }

  // Handle any orphaned nodes (shouldn't happen in valid exports)
  for (const [id, node] of nodes) {
    if (!visited.has(id)) {
      ordered.push(node);
    }
  }

  return ordered;
}

function parseConversation(conversation) {
  const mapping = conversation.mapping || {};
  const ordered = buildMessageOrder(mapping);

  const systemPrompts = extractSystemPrompts(mapping);
  const sessionId = conversation.id || conversation.conversation_id || crypto.randomUUID();
  const conversationTitle = conversation.title || "Untitled";

  // Extract turns (user -> assistant pairs)
  const turns = [];
  let currentUser = null;
  let currentModel = null;
  let currentSystemPrompt = null;

  for (const node of ordered) {
    const msg = node.message;
    if (!msg) continue;

    const role = msg.author?.role;
    const text = extractTextParts(msg.content);
    const timestamp = parseCreateTime(msg.create_time || conversation.create_time);

    if (role === "system") {
      if (text) currentSystemPrompt = text;
      continue;
    }

    if (role === "user") {
      if (currentUser) {
        // Previous turn had no assistant response; finalize it
        turns.push(currentUser);
      }
      currentUser = {
        userText: text,
        responseText: null,
        timestamp,
        model: null,
        systemPrompt: currentSystemPrompt,
        attachments: extractAttachments(msg),
      };
      currentModel = null;
    } else if (role === "assistant" && currentUser) {
      if (!currentUser.responseText) {
        currentUser.responseText = text;
      } else {
        currentUser.responseText += "\n\n" + text;
      }
      const msgModel = extractModelFromMessage(msg);
      if (msgModel && !currentModel) {
        currentModel = msgModel;
        currentUser.model = msgModel;
      }
      // Continue in case there are multiple assistant messages (rare)
    } else if (role === "tool") {
      // Tool results — append to current user or assistant as context
      if (currentUser && !currentUser.responseText) {
        currentUser.userText += "\n\n[Tool result]\n" + text;
      } else if (currentUser) {
        currentUser.responseText += "\n\n[Tool result]\n" + text;
      }
    }
  }

  if (currentUser) {
    turns.push(currentUser);
  }

  return {
    sessionId,
    title: conversationTitle,
    systemPrompts,
    turns,
  };
}

function buildPayload(turn, sessionId, title, systemPrompts, turnIndex) {
  const eventId = hashContent(
    JSON.stringify({
      source: "chatgpt",
      session_id: sessionId,
      role: "user",
      prompt_text: turn.userText,
      timestamp: turn.timestamp || "",
      turn_index: turnIndex,
    })
  );

  const meta = {
    turn_index: turnIndex,
    conversation_title: title,
    attachments: turn.attachments && turn.attachments.length ? turn.attachments : undefined,
    system_prompt: turn.systemPrompt || (systemPrompts.length > 0 ? systemPrompts[systemPrompts.length - 1] : undefined),
  };

  // Clean undefined values from meta
  const cleanMeta = Object.fromEntries(Object.entries(meta).filter(([, v]) => v !== undefined));

  return {
    timestamp: turn.timestamp || new Date().toISOString(),
    source: "chatgpt",
    session_id: sessionId,
    role: "user",
    text: turn.userText,
    response_text: turn.responseText,
    model: turn.model,
    cli_name: "chatgpt",
    capture_response: !!turn.responseText,
    event_id: eventId,
    meta: cleanMeta,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

async function importChatGPT(config, options = {}) {
  const inputPath = options.path;
  if (!inputPath) {
    return { imported: 0, skipped: 0, errors: 1, conversations: 0, error: "No input path provided" };
  }
  if (!fs.existsSync(inputPath)) {
    return { imported: 0, skipped: 0, errors: 1, conversations: 0, error: `File not found: ${inputPath}` };
  }

  let jsonPath;
  try {
    jsonPath = resolveConversationsJson(inputPath);
  } catch (err) {
    return { imported: 0, skipped: 0, errors: 1, conversations: 0, error: err.message };
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
  } catch (err) {
    return { imported: 0, skipped: 0, errors: 1, conversations: 0, error: `Failed to parse JSON: ${err.message}` };
  }

  const conversations = Array.isArray(data.conversations) ? data.conversations : [];
  if (!conversations.length) {
    return { imported: 0, skipped: 0, errors: 0, conversations: 0, error: "No conversations found in export" };
  }

  // --since filter
  const sinceDate = options.since ? new Date(options.since) : null;
  if (sinceDate && Number.isNaN(sinceDate.getTime())) {
    return { imported: 0, skipped: 0, errors: 1, conversations: 0, error: `Invalid --since date: ${options.since}` };
  }

  let imported = 0;
  let skipped = 0;
  let errors = 0;
  const db = options.dryRun ? null : await require("./db").openDb(config.storage.sqlite.path);
  if (db) db.setBatchMode(true);

  const onProgress = options.onProgress;
  const isTTY = !options.json && process.stderr.isTTY;

  try {
    for (let ci = 0; ci < conversations.length; ci++) {
      const conv = conversations[ci];
      const parsed = parseConversation(conv);

      // Apply --since filter on conversation create_time
      if (sinceDate) {
        const convTime = parseCreateTime(conv.create_time);
        if (convTime && new Date(convTime) < sinceDate) {
          skipped += parsed.turns.length;
          if (onProgress) {
            onProgress({
              current: ci + 1,
              total: conversations.length,
              skipped: true,
              title: parsed.title,
            });
          }
          continue;
        }
      }

      for (let ti = 0; ti < parsed.turns.length; ti++) {
        const turn = parsed.turns[ti];
        if (!turn.userText.trim()) {
          skipped++;
          continue;
        }

        const payload = buildPayload(turn, parsed.sessionId, parsed.title, parsed.systemPrompts, ti);

        if (options.dryRun) {
          imported++;
          continue;
        }

        try {
          const result = await ingestPayload(payload, config, { db });
          if (result.ok) {
            imported++;
          } else {
            skipped++;
          }
        } catch (err) {
          errors++;
        }
      }

      if (db) db.flush();

      if (onProgress) {
        onProgress({
          current: ci + 1,
          total: conversations.length,
          imported,
          skipped,
          errors,
          title: parsed.title,
        });
      } else if (isTTY) {
        process.stderr.write(`\r[ChatGPT] ${ci + 1}/${conversations.length} conversations processed (${imported} imported, ${skipped} skipped, ${errors} errors)    `);
      }
    }

    if (isTTY) process.stderr.write("\n");

    return {
      imported,
      skipped,
      errors,
      conversations: conversations.length,
    };
  } finally {
    if (db) db.close();
    // Cleanup temp directory if we extracted a ZIP
    if (jsonPath && jsonPath !== inputPath) {
      try {
        const tmpDir = path.dirname(jsonPath);
        if (tmpDir.startsWith(os.tmpdir())) {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      } catch { /* ignore cleanup errors */ }
    }
  }
}

module.exports = {
  importChatGPT,
  parseConversation,
  buildPayload,
  extractTextParts,
  extractModelFromMessage,
};
