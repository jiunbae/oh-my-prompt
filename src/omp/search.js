const { openDb } = require("./db");
const { loadConfig } = require("./config");
const { c } = require("./ui");

/**
 * Highlight occurrences of `query` in `text` using picocolors.
 * Works for both FTS and exact modes.
 */
function highlightText(text, query) {
  if (!query || !text) return text;
  // Strip FTS operators to get raw search terms
  const terms = query
    .replace(/\b(AND|OR|NOT)\b/g, "")
    .replace(/[*"()]/g, "")
    .split(/\s+/)
    .filter((t) => t.length > 0);
  if (!terms.length) return text;

  const pattern = new RegExp(
    `(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
    "gi"
  );
  return text.replace(pattern, (match) => c.bold(c.red(match)));
}

/**
 * Truncate text to `maxLen` characters, appending ellipsis if needed.
 */
function truncate(text, maxLen) {
  if (!text) return "";
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "...";
}

/**
 * Build WHERE clauses and params from filter options.
 */
function buildFilters(options) {
  const where = [];
  const params = [];

  if (options.since) {
    where.push("p.created_at >= ?");
    params.push(options.since);
  }
  if (options.until) {
    where.push("p.created_at <= ?");
    params.push(options.until);
  }
  if (options.project) {
    where.push("p.project = ?");
    params.push(options.project);
  }
  if (options.source) {
    where.push("p.source = ?");
    params.push(options.source);
  }

  return { where, params };
}

/**
 * Search prompts using FTS5 MATCH query.
 */
function searchFts(db, query, options) {
  const limit = parseInt(options.limit, 10) || 10;
  const { where, params } = buildFilters(options);

  const ftsCondition = "prompts_fts MATCH ?";
  const allConditions = [ftsCondition, ...where];
  const whereClause = `WHERE ${allConditions.join(" AND ")}`;

  const sql = `
    SELECT p.*, rank
    FROM prompts p
    JOIN prompts_fts ON prompts_fts.rowid = p.rowid
    ${whereClause}
    ORDER BY rank
    LIMIT ?
  `;

  return db.prepare(sql).all(query, ...params, limit);
}

/**
 * Search prompts using exact substring match (LIKE).
 */
function searchExact(db, query, options) {
  const limit = parseInt(options.limit, 10) || 10;
  const { where, params } = buildFilters(options);

  const likeCondition = "(p.prompt_text LIKE ? OR p.response_text LIKE ?)";
  const allConditions = [likeCondition, ...where];
  const whereClause = `WHERE ${allConditions.join(" AND ")}`;

  const pattern = `%${query}%`;

  const sql = `
    SELECT p.*
    FROM prompts p
    ${whereClause}
    ORDER BY p.created_at DESC
    LIMIT ?
  `;

  return db.prepare(sql).all(pattern, pattern, ...params, limit);
}

/**
 * Get FTS index health statistics.
 */
function getSearchStats(db) {
  const totalIndexed = db
    .prepare("SELECT COUNT(*) as count FROM prompts_fts")
    .get();

  const totalPrompts = db
    .prepare("SELECT COUNT(*) as count FROM prompts")
    .get();

  const lastUpdated = db
    .prepare("SELECT MAX(created_at) as last FROM prompts")
    .get();

  return {
    total_indexed: totalIndexed.count,
    total_prompts: totalPrompts.count,
    in_sync: totalIndexed.count === totalPrompts.count,
    last_updated: lastUpdated.last || null,
  };
}

/**
 * Format a single result row for text output.
 */
function formatResult(row, query, index) {
  const ts = row.created_at || "";
  const project = row.project || "(none)";
  const source = row.source || "";
  const sessionId = row.session_id
    ? row.session_id.length > 16
      ? row.session_id.slice(0, 16) + "..."
      : row.session_id
    : "(none)";

  const promptText = truncate(
    (row.prompt_text || "").replace(/[\n\r]+/g, " "),
    200
  );
  const highlighted = highlightText(promptText, query);

  const lines = [];
  lines.push(
    `  ${c.dim(`[${index + 1}]`)} ${c.cyan(ts)}  ${c.yellow(project)}  ${c.dim(source)}`
  );
  lines.push(`      ${highlighted}`);
  lines.push(`      ${c.dim("session:")} ${c.dim(sessionId)}`);

  return lines.join("\n");
}

/**
 * Run the search command.
 */
function runSearch(query, options) {
  const config = loadConfig();
  const db = openDb(config.storage.sqlite.path);

  try {
    // --stats mode: show FTS index health
    if (options.stats) {
      const stats = getSearchStats(db);
      if (options.json) {
        return stats;
      }
      console.log("");
      console.log(`  ${c.bold(c.cyan("FTS Index Health"))}`);
      console.log("");
      console.log(`  ${c.dim("Total indexed:")}  ${c.bold(String(stats.total_indexed))}`);
      console.log(`  ${c.dim("Total prompts:")}  ${c.bold(String(stats.total_prompts))}`);
      console.log(
        `  ${c.dim("In sync:")}       ${stats.in_sync ? c.green("yes") : c.red("no (rebuild with: omp db migrate)")}`
      );
      console.log(`  ${c.dim("Last updated:")}  ${c.bold(stats.last_updated || "never")}`);
      console.log("");
      return stats;
    }

    // Query is required for non-stats mode
    if (!query) {
      console.error('Usage: omp search <query> [options]');
      console.error('       omp search --stats');
      process.exitCode = 2;
      return null;
    }

    const results = options.exact
      ? searchExact(db, query, options)
      : searchFts(db, query, options);

    if (options.json) {
      const output = results.map((row) => {
        const { rank, ...rest } = row;
        return rest;
      });
      return output;
    }

    // Text output
    if (results.length === 0) {
      console.log("");
      console.log(`  ${c.yellow("No results found")} for ${c.bold(`"${query}"`)}`);
      console.log("");
      return [];
    }

    console.log("");
    results.forEach((row, i) => {
      console.log(formatResult(row, query, i));
      if (i < results.length - 1) console.log("");
    });
    console.log("");
    console.log(
      `  ${c.dim(`${results.length} result(s) found`)}${options.exact ? c.dim(" (exact match)") : ""}`
    );
    console.log("");

    return results;
  } finally {
    db.close();
  }
}

module.exports = {
  runSearch,
  searchFts,
  searchExact,
  getSearchStats,
  highlightText,
};
