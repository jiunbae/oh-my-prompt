const { openDb } = require("./db");
const { analyzePrompt, summarizePromptReviews } = require("./insights");

function getReport(config, options = {}) {
  const db = openDb(config.storage.sqlite.path);
  const where = [];
  const params = [];

  if (options.since) {
    where.push("created_at >= ?");
    params.push(new Date(options.since).toISOString());
  }
  if (options.until) {
    const untilDate = new Date(options.until);
    untilDate.setHours(23, 59, 59, 999);
    where.push("created_at <= ?");
    params.push(untilDate.toISOString());
  }

  where.push("role = 'user'");
  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const prompts = db
    .prepare(`SELECT prompt_text FROM prompts ${whereClause} ORDER BY created_at DESC LIMIT 200`)
    .all(...params);

  const reviews = prompts.map((row) => analyzePrompt(row.prompt_text));
  const summary = summarizePromptReviews(reviews);
  db.close();

  return summary;
}

function formatReportText(summary) {
  if (!summary.total) {
    return "No prompts available for the selected range.";
  }

  const lines = [];
  lines.push(`Prompts analyzed: ${summary.total}`);
  lines.push(`Average score: ${summary.averageScore}`);
  lines.push("Top gaps:");
  summary.topGaps.forEach((gap) => {
    lines.push(`- ${gap.label}: ${gap.percent}% coverage`);
  });
  lines.push("Signal coverage:");
  summary.signalStats.forEach((stat) => {
    lines.push(`- ${stat.label}: ${stat.percent}%`);
  });
  lines.push(`Average words: ${summary.length.averageWords}`);
  lines.push(`Short prompts (<20 words): ${summary.length.shortCount}`);
  lines.push(`Long prompts (>400 words): ${summary.length.longCount}`);
  return lines.join("\n");
}

module.exports = {
  getReport,
  formatReportText,
};
