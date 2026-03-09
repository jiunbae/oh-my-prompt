// SQLite query functions for the local dashboard.
// Reuses openDb() from db.js to access the same database the CLI uses.

const { openDb } = require("./db");

const PAGE_SIZE = 30;

function getDb(config) {
  return openDb(config.storage.sqlite.path);
}

function listPrompts(db, { page = 1 } = {}) {
  const offset = (page - 1) * PAGE_SIZE;
  const total = db.prepare("SELECT COUNT(*) as cnt FROM prompts WHERE role = 'user'").get().cnt;
  const rows = db
    .prepare(
      `SELECT id, created_at, source, session_id, prompt_text, response_text,
              prompt_length, response_length, project, token_estimate, token_estimate_response
       FROM prompts WHERE role = 'user'
       ORDER BY created_at DESC LIMIT ? OFFSET ?`
    )
    .all(PAGE_SIZE, offset);

  return { rows, total, page, totalPages: Math.ceil(total / PAGE_SIZE) };
}

function getPrompt(db, id) {
  return db
    .prepare(
      `SELECT id, created_at, updated_at, source, session_id, role,
              prompt_text, response_text, prompt_length, response_length,
              project, cwd, model, cli_name, cli_version,
              token_estimate, token_estimate_response, word_count, word_count_response
       FROM prompts WHERE id = ?`
    )
    .get(id);
}

function listSessions(db, { page = 1 } = {}) {
  const offset = (page - 1) * PAGE_SIZE;

  const total = db
    .prepare(
      `SELECT COUNT(DISTINCT session_id) as cnt FROM prompts
       WHERE role = 'user' AND session_id IS NOT NULL`
    )
    .get().cnt;

  const rows = db
    .prepare(
      `SELECT
         session_id,
         MIN(created_at) as first_at,
         MAX(created_at) as last_at,
         COUNT(*) as prompt_count,
         SUM(COALESCE(token_estimate, 0) + COALESCE(token_estimate_response, 0)) as total_tokens,
         MIN(prompt_text) as first_prompt,
         MAX(project) as project,
         MAX(source) as source
       FROM prompts
       WHERE role = 'user' AND session_id IS NOT NULL
       GROUP BY session_id
       ORDER BY first_at DESC
       LIMIT ? OFFSET ?`
    )
    .all(PAGE_SIZE, offset);

  return { rows, total, page, totalPages: Math.ceil(total / PAGE_SIZE) };
}

function getSession(db, sessionId) {
  return db
    .prepare(
      `SELECT id, created_at, source, prompt_text, response_text,
              prompt_length, response_length, project, token_estimate, token_estimate_response
       FROM prompts
       WHERE session_id = ?
       ORDER BY created_at ASC`
    )
    .all(sessionId);
}

function searchPrompts(db, query, limit = 50) {
  if (!query || !query.trim()) return [];
  // Sanitize FTS5 query: escape special chars
  const sanitized = query.replace(/['"]/g, "").trim();
  if (!sanitized) return [];

  try {
    return db
      .prepare(
        `SELECT p.id, p.created_at, p.source, p.prompt_text, p.project, p.token_estimate
         FROM prompts p
         WHERE p.role = 'user' AND p.rowid IN (
           SELECT rowid FROM prompts_fts WHERE prompts_fts MATCH ?
         )
         ORDER BY p.created_at DESC
         LIMIT ?`
      )
      .all(sanitized, limit);
  } catch {
    // FTS query syntax error — fall back to LIKE
    return db
      .prepare(
        `SELECT id, created_at, source, prompt_text, project, token_estimate
         FROM prompts
         WHERE role = 'user' AND prompt_text LIKE ?
         ORDER BY created_at DESC LIMIT ?`
      )
      .all(`%${sanitized}%`, limit);
  }
}

module.exports = { getDb, listPrompts, getPrompt, listSessions, getSession, searchPrompts };
