const { openDb } = require("./db");

function buildDateRange(where, params, since, until) {
  if (since) {
    where.push("created_at >= ?");
    params.push(new Date(since).toISOString());
  }
  if (until) {
    const untilDate = new Date(until);
    untilDate.setHours(23, 59, 59, 999);
    where.push("created_at <= ?");
    params.push(untilDate.toISOString());
  }
}

function getStats(config, options = {}) {
  const db = openDb(config.storage.sqlite.path);
  const where = [];
  const params = [];
  buildDateRange(where, params, options.since, options.until);

  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const overall = db
    .prepare(
      `SELECT
        COUNT(*) as total_prompts,
        SUM(token_estimate) as total_tokens,
        AVG(prompt_length) as avg_length,
        COUNT(DISTINCT project) as project_count
      FROM prompts ${whereClause}`
    )
    .get(...params);

  if (!options.groupBy) {
    db.close();
    return { overall };
  }

  const groupExpr =
    options.groupBy === "week"
      ? "strftime('%Y-%W', created_at)"
      : options.groupBy === "month"
        ? "strftime('%Y-%m', created_at)"
        : "strftime('%Y-%m-%d', created_at)";

  const grouped = db
    .prepare(
      `SELECT
        ${groupExpr} as bucket,
        COUNT(*) as total_prompts,
        SUM(token_estimate) as total_tokens
      FROM prompts
      ${whereClause}
      GROUP BY bucket
      ORDER BY bucket ASC`
    )
    .all(...params);

  db.close();
  return { overall, grouped };
}

module.exports = {
  getStats,
};
