const { openDb } = require("./db");

const DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_GAP_MS = 30 * 60 * 1000;
const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const VALID_GROUPS = new Set(["day", "week", "month", "project", "source", "hour", "weekday"]);

function pad2(value) {
  return String(value).padStart(2, "0");
}

function roundTo(value, digits = 1) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function toLocalDateKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function toMonthKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
}

function getIsoWeekKey(date) {
  const utcDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((utcDate - yearStart) / DAY_MS) + 1) / 7);
  return `${utcDate.getUTCFullYear()}-W${pad2(week)}`;
}

function parseAbsoluteDate(value, endOfDay) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    if (
      Number.isNaN(date.getTime()) ||
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day
    ) {
      return null;
    }
    if (endOfDay) {
      date.setHours(23, 59, 59, 999);
    } else {
      date.setHours(0, 0, 0, 0);
    }
    return date;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  if (endOfDay) {
    parsed.setHours(23, 59, 59, 999);
  }
  return parsed;
}

function parseFlexibleDate(value, { endOfDay = false, now = new Date() } = {}) {
  if (!value) return null;
  const relativeMatch = String(value).trim().match(/^(\d+)d$/i);
  if (relativeMatch) {
    const days = Number(relativeMatch[1]);
    if (!Number.isInteger(days) || days <= 0) return null;
    const date = new Date(now);
    date.setDate(date.getDate() - (days - 1));
    if (endOfDay) {
      date.setHours(23, 59, 59, 999);
    } else {
      date.setHours(0, 0, 0, 0);
    }
    return date;
  }

  return parseAbsoluteDate(String(value).trim(), endOfDay);
}

function normalizeDateRange(since, until) {
  const sinceDate = since ? parseFlexibleDate(since, { endOfDay: false }) : null;
  if (since && !sinceDate) {
    throw new Error("Invalid --since date. Use YYYY-MM-DD, ISO datetime, or Nd (for example 7d).");
  }

  const untilDate = until ? parseFlexibleDate(until, { endOfDay: true }) : null;
  if (until && !untilDate) {
    throw new Error("Invalid --until date. Use YYYY-MM-DD, ISO datetime, or Nd (for example 7d).");
  }

  if (sinceDate && untilDate && sinceDate.getTime() > untilDate.getTime()) {
    throw new Error("--since must be earlier than or equal to --until.");
  }

  return {
    since: sinceDate ? sinceDate.toISOString() : null,
    until: untilDate ? untilDate.toISOString() : null,
  };
}

function normalizeLimit(limit) {
  if (limit === undefined || limit === null || limit === "") return 10;
  const parsed = Number(limit);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("Invalid --limit value. Use a positive integer.");
  }
  return parsed;
}

function buildWhereClause(range) {
  const where = ["role = 'user'"];
  const params = [];

  if (range.since) {
    where.push("created_at >= ?");
    params.push(range.since);
  }
  if (range.until) {
    where.push("created_at <= ?");
    params.push(range.until);
  }

  return {
    whereClause: `WHERE ${where.join(" AND ")}`,
    params,
  };
}

function computeSessions(rows) {
  const sessions = [];

  for (const row of rows) {
    const timestamp = new Date(row.created_at);
    const last = sessions[sessions.length - 1];

    if (!last) {
      sessions.push({ start: timestamp, end: timestamp, promptCount: 1 });
      continue;
    }

    const gap = timestamp.getTime() - last.end.getTime();
    if (gap > SESSION_GAP_MS) {
      sessions.push({ start: timestamp, end: timestamp, promptCount: 1 });
    } else {
      last.end = timestamp;
      last.promptCount += 1;
    }
  }

  return sessions;
}

function computeLongestStreak(dateKeys) {
  if (!dateKeys.length) return 0;

  const sorted = [...new Set(dateKeys)].sort();
  let longest = 1;
  let current = 1;

  for (let i = 1; i < sorted.length; i += 1) {
    const prev = new Date(`${sorted[i - 1]}T00:00:00`);
    const next = new Date(`${sorted[i]}T00:00:00`);
    if (next.getTime() - prev.getTime() === DAY_MS) {
      current += 1;
    } else {
      current = 1;
    }
    if (current > longest) longest = current;
  }

  return longest;
}

function getGroupKey(date, row, groupBy) {
  switch (groupBy) {
    case "day":
      return { bucket: toLocalDateKey(date), sortKey: toLocalDateKey(date) };
    case "week":
      return { bucket: getIsoWeekKey(date), sortKey: getIsoWeekKey(date) };
    case "month":
      return { bucket: toMonthKey(date), sortKey: toMonthKey(date) };
    case "project":
      return { bucket: row.project || "(none)", sortKey: row.project || "(none)" };
    case "source":
      return { bucket: row.source || "(unknown)", sortKey: row.source || "(unknown)" };
    case "hour":
      return { bucket: `${pad2(date.getHours())}:00`, sortKey: date.getHours() };
    case "weekday":
      return { bucket: WEEKDAY_LABELS[date.getDay()], sortKey: WEEKDAY_ORDER.indexOf(date.getDay()) };
    default:
      return { bucket: toLocalDateKey(date), sortKey: toLocalDateKey(date) };
  }
}

function sortGroupedRows(grouped, groupBy) {
  const temporalGroups = new Set(["day", "week", "month", "hour", "weekday"]);
  if (temporalGroups.has(groupBy)) {
    return grouped.sort((a, b) => {
      if (a.sortKey < b.sortKey) return -1;
      if (a.sortKey > b.sortKey) return 1;
      return 0;
    });
  }

  return grouped.sort((a, b) => {
    if (b.total_prompts !== a.total_prompts) return b.total_prompts - a.total_prompts;
    if (b.total_combined_tokens !== a.total_combined_tokens) {
      return b.total_combined_tokens - a.total_combined_tokens;
    }
    return String(a.bucket).localeCompare(String(b.bucket));
  });
}

function aggregateRows(rows, groupBy) {
  const aggregates = new Map();

  for (const row of rows) {
    const createdAt = new Date(row.created_at);
    const { bucket, sortKey } = getGroupKey(createdAt, row, groupBy);
    const key = `${groupBy}:${bucket}`;
    const current = aggregates.get(key) || {
      bucket,
      sortKey,
      total_prompts: 0,
      total_tokens: 0,
      total_response_tokens: 0,
      total_combined_tokens: 0,
      total_length: 0,
      response_count: 0,
    };

    const promptTokens = Number(row.token_estimate || 0);
    const responseTokens = Number(row.token_estimate_response || 0);

    current.total_prompts += 1;
    current.total_tokens += promptTokens;
    current.total_response_tokens += responseTokens;
    current.total_combined_tokens += promptTokens + responseTokens;
    current.total_length += Number(row.prompt_length || 0);
    if (row.response_length !== null && row.response_length !== undefined) {
      current.response_count += 1;
    }

    aggregates.set(key, current);
  }

  const grouped = Array.from(aggregates.values()).map((entry) => ({
    bucket: entry.bucket,
    sortKey: entry.sortKey,
    total_prompts: entry.total_prompts,
    total_tokens: entry.total_tokens,
    total_response_tokens: entry.total_response_tokens,
    total_combined_tokens: entry.total_combined_tokens,
    avg_length: roundTo(entry.total_length / entry.total_prompts, 1),
    response_count: entry.response_count,
    response_rate: entry.total_prompts
      ? Math.round((entry.response_count / entry.total_prompts) * 100)
      : 0,
  }));

  return sortGroupedRows(grouped, groupBy);
}

// Common aggregate columns reused across GROUP BY queries.
const AGG_COLUMNS = `
  COUNT(*) as total_prompts,
  COALESCE(SUM(token_estimate), 0) as total_tokens,
  COALESCE(SUM(token_estimate_response), 0) as total_response_tokens,
  COALESCE(SUM(token_estimate), 0) + COALESCE(SUM(token_estimate_response), 0) as total_combined_tokens,
  ROUND(COALESCE(SUM(prompt_length), 0) * 1.0 / NULLIF(COUNT(*), 0), 1) as avg_length,
  SUM(CASE WHEN response_length IS NOT NULL THEN 1 ELSE 0 END) as response_count
`;

function withResponseRate(row) {
  return {
    ...row,
    avg_length: row.avg_length ?? 0,
    response_rate: row.total_prompts
      ? Math.round((row.response_count / row.total_prompts) * 100)
      : 0,
  };
}

function fetchOverall(db, whereClause, params) {
  const sql = `
    SELECT
      COUNT(*) as total_prompts,
      COALESCE(SUM(token_estimate), 0) as total_tokens,
      COALESCE(SUM(token_estimate_response), 0) as total_response_tokens,
      COALESCE(SUM(prompt_length), 0) as total_length,
      COALESCE(SUM(CASE WHEN response_length IS NOT NULL THEN response_length ELSE 0 END), 0) as total_response_length,
      SUM(CASE WHEN response_length IS NOT NULL THEN 1 ELSE 0 END) as response_count,
      COUNT(DISTINCT NULLIF(project, '')) as project_count,
      COUNT(DISTINCT source) as source_count,
      COUNT(DISTINCT date(created_at, 'localtime')) as active_days,
      MIN(created_at) as first_prompt,
      MAX(created_at) as last_prompt
    FROM prompts
    ${whereClause}
  `;
  return db.prepare(sql).get(...params) || {};
}

function fetchTopByColumn(db, whereClause, params, column, limit, excludeNoneBucket) {
  // COALESCE empty/null to a bucket label so they're aggregated together.
  const noneLabel = column === "project" ? "(none)" : "(unknown)";
  const bucketExpr = `COALESCE(NULLIF(${column}, ''), '${noneLabel}')`;
  const extraFilter = excludeNoneBucket ? `AND ${column} IS NOT NULL AND ${column} != ''` : "";
  const sql = `
    SELECT ${bucketExpr} as bucket, ${AGG_COLUMNS}
    FROM prompts
    ${whereClause} ${extraFilter}
    GROUP BY bucket
    ORDER BY total_prompts DESC, total_combined_tokens DESC, bucket ASC
    LIMIT ?
  `;
  return db.prepare(sql).all(...params, limit).map(withResponseRate);
}

function fetchHourly(db, whereClause, params) {
  const sql = `
    SELECT CAST(strftime('%H', created_at, 'localtime') AS INTEGER) as hour, ${AGG_COLUMNS}
    FROM prompts
    ${whereClause}
    GROUP BY hour
  `;
  const byHour = new Map(
    db.prepare(sql).all(...params).map((r) => [r.hour, withResponseRate(r)])
  );
  return Array.from({ length: 24 }, (_, h) => {
    const row = byHour.get(h);
    if (row) {
      const { hour: _h, ...rest } = row;
      return { bucket: `${pad2(h)}:00`, ...rest };
    }
    return {
      bucket: `${pad2(h)}:00`,
      total_prompts: 0,
      total_tokens: 0,
      total_response_tokens: 0,
      total_combined_tokens: 0,
      avg_length: 0,
      response_count: 0,
      response_rate: 0,
    };
  });
}

function fetchWeekday(db, whereClause, params) {
  const sql = `
    SELECT CAST(strftime('%w', created_at, 'localtime') AS INTEGER) as wday, ${AGG_COLUMNS}
    FROM prompts
    ${whereClause}
    GROUP BY wday
  `;
  const byWday = new Map(
    db.prepare(sql).all(...params).map((r) => [r.wday, withResponseRate(r)])
  );
  return WEEKDAY_ORDER.map((day) => {
    const row = byWday.get(day);
    const label = WEEKDAY_LABELS[day];
    if (row) {
      const { wday: _w, ...rest } = row;
      return { bucket: label, ...rest };
    }
    return {
      bucket: label,
      total_prompts: 0,
      total_tokens: 0,
      total_response_tokens: 0,
      total_combined_tokens: 0,
      avg_length: 0,
      response_count: 0,
      response_rate: 0,
    };
  });
}

function fetchGroupedSql(db, whereClause, params, groupBy) {
  // ISO week numbering doesn't match SQLite's %W; fall back to JS for that one.
  if (groupBy === "week") return null;
  const exprs = {
    day: "date(created_at, 'localtime')",
    month: "strftime('%Y-%m', created_at, 'localtime')",
    project: "COALESCE(NULLIF(project, ''), '(none)')",
    source: "COALESCE(NULLIF(source, ''), '(unknown)')",
    hour: "strftime('%H', created_at, 'localtime') || ':00'",
    weekday: "CAST(strftime('%w', created_at, 'localtime') AS INTEGER)",
  };
  const expr = exprs[groupBy];
  if (!expr) return null;

  const sql = `
    SELECT ${expr} as bucket, ${AGG_COLUMNS}
    FROM prompts
    ${whereClause}
    GROUP BY bucket
  `;
  let rows = db.prepare(sql).all(...params).map(withResponseRate);

  if (groupBy === "weekday") {
    rows = rows.map((r) => ({
      ...r,
      bucket: WEEKDAY_LABELS[r.bucket],
      sortKey: WEEKDAY_ORDER.indexOf(r.bucket),
    }));
  } else if (["day", "month"].includes(groupBy)) {
    rows = rows.map((r) => ({ ...r, sortKey: r.bucket }));
  } else if (groupBy === "hour") {
    rows = rows.map((r) => ({ ...r, sortKey: parseInt(r.bucket, 10) }));
  } else {
    rows = rows.map((r) => ({ ...r, sortKey: r.bucket }));
  }

  return sortGroupedRows(rows, groupBy).map(({ sortKey, ...entry }) => entry);
}

async function getStats(config, options = {}) {
  const groupBy = options.groupBy || null;
  if (groupBy && !VALID_GROUPS.has(groupBy)) {
    throw new Error(`Invalid --group-by value "${groupBy}". Use one of: ${Array.from(VALID_GROUPS).join(", ")}.`);
  }

  const limit = normalizeLimit(options.limit);
  const range = normalizeDateRange(options.since, options.until);
  const db = await openDb(config.storage.sqlite.path);

  try {
    const { whereClause, params } = buildWhereClause(range);

    const o = fetchOverall(db, whereClause, params);
    const topProjects = fetchTopByColumn(db, whereClause, params, "project", limit, true);
    const topSources = fetchTopByColumn(db, whereClause, params, "source", limit, false);
    const hourly = fetchHourly(db, whereClause, params);
    const weekday = fetchWeekday(db, whereClause, params);

    // Sessions and streak need an ordered timestamp sequence; nothing else from the row.
    const tsRows = db
      .prepare(`SELECT created_at FROM prompts ${whereClause} ORDER BY created_at ASC`)
      .all(...params);
    const sessionsRaw = computeSessions(tsRows);
    const activeDateKeys = tsRows.map((r) => toLocalDateKey(new Date(r.created_at)));

    let grouped = null;
    if (groupBy) {
      grouped = fetchGroupedSql(db, whereClause, params, groupBy);
      if (grouped === null) {
        // ISO week or other JS-only grouping: fetch lightweight rows and aggregate in JS.
        const groupRows = db
          .prepare(
            `SELECT created_at, project, source, prompt_length, response_length,
                    token_estimate, token_estimate_response
             FROM prompts
             ${whereClause}
             ORDER BY created_at ASC`
          )
          .all(...params);
        grouped = aggregateRows(groupRows, groupBy).map(({ sortKey, ...entry }) => entry);
      }
    }

    const totalPrompts = o.total_prompts || 0;
    const totalSessionMinutes = sessionsRaw.reduce(
      (sum, session) => sum + ((session.end.getTime() - session.start.getTime()) / 60000),
      0
    );
    const longestSession = sessionsRaw.reduce(
      (best, session) => {
        const minutes = roundTo((session.end.getTime() - session.start.getTime()) / 60000, 1);
        if (!best || minutes > best.minutes) {
          return {
            minutes,
            promptCount: session.promptCount,
            started_at: session.start.toISOString(),
          };
        }
        return best;
      },
      null
    );

    const peakHour = [...hourly]
      .map((h, i) => ({ ...h, sortKey: i }))
      .sort((a, b) => b.total_prompts - a.total_prompts || a.sortKey - b.sortKey)[0] || null;
    const busiestWeekday = [...weekday]
      .map((w, i) => ({ ...w, sortKey: i }))
      .sort((a, b) => b.total_prompts - a.total_prompts || a.sortKey - b.sortKey)[0] || null;

    const overall = {
      total_prompts: totalPrompts,
      total_tokens: o.total_tokens || 0,
      total_response_tokens: o.total_response_tokens || 0,
      total_combined_tokens: (o.total_tokens || 0) + (o.total_response_tokens || 0),
      avg_length: totalPrompts ? roundTo((o.total_length || 0) / totalPrompts, 1) : 0,
      avg_response_length: o.response_count
        ? roundTo((o.total_response_length || 0) / o.response_count, 1)
        : 0,
      project_count: o.project_count || 0,
      source_count: o.source_count || 0,
      response_count: o.response_count || 0,
      response_rate: totalPrompts ? Math.round((o.response_count / totalPrompts) * 100) : 0,
      active_days: o.active_days || 0,
      avg_prompts_per_active_day: o.active_days ? roundTo(totalPrompts / o.active_days, 1) : 0,
      first_prompt: o.first_prompt || null,
      last_prompt: o.last_prompt || null,
    };

    const sessions = {
      total_sessions: sessionsRaw.length,
      avg_prompts_per_session: sessionsRaw.length ? roundTo(totalPrompts / sessionsRaw.length, 1) : 0,
      avg_session_minutes: sessionsRaw.length ? roundTo(totalSessionMinutes / sessionsRaw.length, 1) : 0,
      longest_session_minutes: longestSession ? longestSession.minutes : 0,
      longest_session_prompts: longestSession ? longestSession.promptCount : 0,
      longest_session_started_at: longestSession ? longestSession.started_at : null,
    };

    const patterns = {
      peak_hour: peakHour && peakHour.total_prompts > 0
        ? { bucket: peakHour.bucket, count: peakHour.total_prompts }
        : null,
      busiest_weekday: busiestWeekday && busiestWeekday.total_prompts > 0
        ? { bucket: busiestWeekday.bucket, count: busiestWeekday.total_prompts }
        : null,
      longest_active_streak: computeLongestStreak(activeDateKeys),
    };

    return {
      range,
      overall,
      sessions,
      patterns,
      topProjects,
      topSources,
      breakdowns: { hourly, weekday },
      grouped,
    };
  } finally {
    db.close();
  }
}

module.exports = {
  getStats,
  parseFlexibleDate,
};
