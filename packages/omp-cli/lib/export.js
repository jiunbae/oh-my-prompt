const fs = require("fs");
const { openDb } = require("./db");

function exportData(config, options = {}) {
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

  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = db.prepare(`SELECT * FROM prompts ${whereClause} ORDER BY created_at ASC`).all(...params);
  db.close();

  const format = options.format || "jsonl";
  if (format === "csv") {
    if (rows.length === 0) {
      if (options.out) {
        fs.writeFileSync(options.out, "");
        return { count: 0, output: options.out };
      }
      return { count: 0, output: "" };
    }
    const headers = Object.keys(rows[0]);
    const lines = [headers.join(",")];
    for (const row of rows) {
      const values = headers.map((key) => JSON.stringify(row[key] ?? ""));
      lines.push(values.join(","));
    }
    const csv = lines.join("\n");
    if (options.out) {
      fs.writeFileSync(options.out, csv);
      return { count: rows.length, output: options.out };
    }
    return { count: rows.length, output: csv };
  }

  const jsonl = rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : "");
  if (options.out) {
    fs.writeFileSync(options.out, jsonl);
    return { count: rows.length, output: options.out };
  }
  return { count: rows.length, output: jsonl };
}

module.exports = {
  exportData,
};
