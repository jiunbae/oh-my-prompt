// Minimal dark-theme HTML templates for the local SQLite dashboard.
// No framework, no build step — just template literals.

function fmtNum(n) {
  if (n === null || n === undefined) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function timeAgo(iso) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function escapeHtml(str) {
  if (!str) return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function truncate(str, len = 120) {
  if (!str) return "";
  return str.length > len ? str.slice(0, len) + "..." : str;
}

const CSS = `
:root { --bg: #0a0a0a; --surface: #141414; --border: #262626; --text: #e5e5e5; --dim: #737373; --accent: #6366f1; --accent2: #818cf8; --badge-bg: #1e1b4b; --badge-text: #a5b4fc; --green: #22c55e; }
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; line-height: 1.5; }
a { color: var(--accent2); text-decoration: none; } a:hover { text-decoration: underline; }
.wrap { max-width: 1100px; margin: 0 auto; padding: 24px 20px; }
nav { background: var(--surface); border-bottom: 1px solid var(--border); padding: 12px 20px; display: flex; align-items: center; gap: 24px; }
nav .logo { font-weight: 700; color: var(--accent2); font-size: 15px; }
nav a { color: var(--dim); font-size: 14px; } nav a:hover, nav a.active { color: var(--text); text-decoration: none; }
h1 { font-size: 22px; font-weight: 600; margin-bottom: 4px; }
.subtitle { color: var(--dim); font-size: 14px; margin-bottom: 24px; }
.grid { display: grid; gap: 16px; }
.grid-4 { grid-template-columns: repeat(4, 1fr); }
.grid-3 { grid-template-columns: repeat(3, 1fr); }
.grid-2 { grid-template-columns: repeat(2, 1fr); }
@media (max-width: 768px) { .grid-4, .grid-3 { grid-template-columns: repeat(2, 1fr); } }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 20px; }
.card h3 { font-size: 13px; color: var(--dim); font-weight: 500; margin-bottom: 4px; }
.card .value { font-size: 28px; font-weight: 700; }
.card .detail { font-size: 12px; color: var(--dim); margin-top: 2px; }
.badge { display: inline-block; background: var(--badge-bg); color: var(--badge-text); padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 500; }
.badge-source { background: #1a2332; color: #60a5fa; }
table { width: 100%; border-collapse: collapse; }
th { text-align: left; font-size: 12px; font-weight: 500; color: var(--dim); padding: 10px 12px; border-bottom: 1px solid var(--border); }
td { padding: 12px; border-bottom: 1px solid var(--border); font-size: 14px; vertical-align: top; }
tr:hover { background: #111; }
.prompt-text { max-width: 500px; }
.meta { color: var(--dim); font-size: 12px; margin-top: 2px; }
.empty { text-align: center; padding: 60px 20px; color: var(--dim); }
.bar-container { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.bar-label { font-size: 13px; min-width: 100px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bar { height: 8px; background: var(--accent); border-radius: 4px; transition: width 0.3s; }
.bar-value { font-size: 12px; color: var(--dim); min-width: 30px; text-align: right; }
.search-form { display: flex; gap: 8px; margin-bottom: 24px; }
.search-form input { flex: 1; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 10px 14px; color: var(--text); font-size: 14px; outline: none; }
.search-form input:focus { border-color: var(--accent); }
.search-form button { background: var(--accent); color: white; border: none; border-radius: 8px; padding: 10px 20px; font-size: 14px; cursor: pointer; }
.pagination { display: flex; justify-content: center; gap: 8px; margin-top: 24px; }
.pagination a, .pagination span { padding: 6px 14px; border-radius: 6px; font-size: 13px; border: 1px solid var(--border); color: var(--dim); }
.pagination a:hover { background: var(--surface); color: var(--text); text-decoration: none; }
.pagination .current { background: var(--accent); color: white; border-color: var(--accent); }
.detail-block { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 20px; margin-bottom: 16px; white-space: pre-wrap; word-break: break-word; font-size: 14px; line-height: 1.7; }
.detail-label { font-size: 12px; font-weight: 600; color: var(--dim); text-transform: uppercase; margin-bottom: 8px; }
.footer { text-align: center; padding: 40px 0 20px; color: var(--dim); font-size: 12px; }
`;

function layout(title, body, activePage = "") {
  const navLinks = [
    { href: "/", label: "Dashboard", key: "dashboard" },
    { href: "/prompts", label: "Prompts", key: "prompts" },
    { href: "/sessions", label: "Sessions", key: "sessions" },
    { href: "/search", label: "Search", key: "search" },
  ];
  const navHtml = navLinks
    .map((l) => `<a href="${l.href}" class="${activePage === l.key ? "active" : ""}">${l.label}</a>`)
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — Oh My Prompt</title>
<style>${CSS}</style></head>
<body>
<nav><span class="logo">&gt; Oh My Prompt</span>${navHtml}</nav>
<div class="wrap">${body}</div>
<div class="footer">Oh My Prompt · Local Mode (SQLite)</div>
</body></html>`;
}

function paginationHtml(basePath, page, totalPages) {
  if (totalPages <= 1) return "";
  const links = [];
  if (page > 1) links.push(`<a href="${basePath}?page=${page - 1}">&laquo; Prev</a>`);
  const start = Math.max(1, page - 2);
  const end = Math.min(totalPages, page + 2);
  for (let i = start; i <= end; i++) {
    links.push(i === page ? `<span class="current">${i}</span>` : `<a href="${basePath}?page=${i}">${i}</a>`);
  }
  if (page < totalPages) links.push(`<a href="${basePath}?page=${page + 1}">Next &raquo;</a>`);
  return `<div class="pagination">${links.join("")}</div>`;
}

function barChart(items, maxVal) {
  if (!maxVal) maxVal = Math.max(...items.map((i) => i.value), 1);
  return items
    .map(
      (i) =>
        `<div class="bar-container"><span class="bar-label">${escapeHtml(i.label)}</span><div style="flex:1"><div class="bar" style="width:${Math.round((i.value / maxVal) * 100)}%"></div></div><span class="bar-value">${fmtNum(i.value)}</span></div>`
    )
    .join("");
}

// === Page renderers ===

function dashboardPage(stats) {
  const o = stats.overall;
  const s = stats.sessions;
  const topProjects = (stats.topProjects || []).slice(0, 5);
  const maxProjectPrompts = topProjects.length ? topProjects[0].total_prompts : 1;

  return layout(
    "Dashboard",
    `
    <h1>Dashboard</h1>
    <p class="subtitle">Your prompt activity overview</p>

    <div class="grid grid-4" style="margin-bottom:20px">
      <div class="card"><h3>Total Prompts</h3><div class="value">${fmtNum(o.total_prompts)}</div><div class="detail">${o.active_days} active days</div></div>
      <div class="card"><h3>Total Tokens</h3><div class="value">${fmtNum(o.total_combined_tokens)}</div><div class="detail">${fmtNum(o.total_tokens)} in · ${fmtNum(o.total_response_tokens)} out</div></div>
      <div class="card"><h3>Sessions</h3><div class="value">${fmtNum(s.total_sessions)}</div><div class="detail">~${s.avg_prompts_per_session} prompts/session</div></div>
      <div class="card"><h3>Projects</h3><div class="value">${o.project_count}</div><div class="detail">${o.source_count} sources</div></div>
    </div>

    <div class="grid grid-2">
      <div class="card">
        <h3>Top Projects</h3>
        <div style="margin-top:12px">${topProjects.length ? barChart(topProjects.map((p) => ({ label: p.bucket, value: p.total_prompts })), maxProjectPrompts) : '<span style="color:var(--dim)">No projects yet</span>'}</div>
      </div>
      <div class="card">
        <h3>Patterns</h3>
        <div style="margin-top:12px; font-size:14px">
          ${stats.patterns.peak_hour ? `<div style="margin-bottom:8px">Peak hour: <strong>${stats.patterns.peak_hour.bucket}</strong> (${stats.patterns.peak_hour.count} prompts)</div>` : ""}
          ${stats.patterns.busiest_weekday ? `<div style="margin-bottom:8px">Busiest day: <strong>${stats.patterns.busiest_weekday.bucket}</strong> (${stats.patterns.busiest_weekday.count} prompts)</div>` : ""}
          <div style="margin-bottom:8px">Longest streak: <strong>${stats.patterns.longest_active_streak}</strong> days</div>
          <div>Response rate: <strong>${o.response_rate}%</strong></div>
        </div>
      </div>
    </div>
  `,
    "dashboard"
  );
}

function promptListPage(prompts, page, totalPages) {
  const rows = prompts
    .map(
      (p) => `<tr>
      <td style="white-space:nowrap">${fmtDate(p.created_at)}</td>
      <td>${p.project ? `<span class="badge">${escapeHtml(p.project)}</span>` : ""} <span class="badge badge-source">${escapeHtml(p.source)}</span></td>
      <td class="prompt-text"><a href="/prompts/${encodeURIComponent(p.id)}">${escapeHtml(truncate(p.prompt_text, 100))}</a><div class="meta">${fmtNum(p.token_estimate || 0)} tokens${p.response_text ? " · has response" : ""}</div></td>
    </tr>`
    )
    .join("");

  return layout(
    "Prompts",
    `<h1>Prompts</h1><p class="subtitle">Browse your captured prompts</p>
    ${prompts.length ? `<table><thead><tr><th>Date</th><th>Source</th><th>Prompt</th></tr></thead><tbody>${rows}</tbody></table>${paginationHtml("/prompts", page, totalPages)}` : '<div class="empty">No prompts yet. Run <code>omp backfill</code> to import existing sessions.</div>'}`,
    "prompts"
  );
}

function promptDetailPage(prompt) {
  if (!prompt) {
    return layout("Not Found", '<div class="empty">Prompt not found.</div>');
  }
  return layout(
    "Prompt Detail",
    `<div style="margin-bottom:16px"><a href="/prompts">&larr; Back to prompts</a></div>
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:16px">
      ${prompt.project ? `<span class="badge">${escapeHtml(prompt.project)}</span>` : ""}
      <span class="badge badge-source">${escapeHtml(prompt.source)}</span>
      <span style="color:var(--dim);font-size:13px">${fmtDate(prompt.created_at)}</span>
      ${prompt.session_id ? `<a href="/sessions/${encodeURIComponent(prompt.session_id)}" style="font-size:13px">View session</a>` : ""}
    </div>
    <div class="grid grid-4" style="margin-bottom:20px">
      <div class="card"><h3>Prompt Tokens</h3><div class="value">${fmtNum(prompt.token_estimate || 0)}</div></div>
      <div class="card"><h3>Response Tokens</h3><div class="value">${fmtNum(prompt.token_estimate_response || 0)}</div></div>
      <div class="card"><h3>Prompt Length</h3><div class="value">${fmtNum(prompt.prompt_length)}</div></div>
      <div class="card"><h3>Response Length</h3><div class="value">${fmtNum(prompt.response_length || 0)}</div></div>
    </div>
    <div class="detail-label">Prompt</div>
    <div class="detail-block">${escapeHtml(prompt.prompt_text)}</div>
    ${prompt.response_text ? `<div class="detail-label">Response</div><div class="detail-block">${escapeHtml(prompt.response_text)}</div>` : ""}`,
    "prompts"
  );
}

function sessionListPage(sessions, page, totalPages) {
  const rows = sessions
    .map(
      (s) => `<tr>
      <td><a href="/sessions/${encodeURIComponent(s.session_id)}">${escapeHtml(truncate(s.first_prompt || s.session_id, 90))}</a><div class="meta">${fmtDate(s.first_at)} · ${s.prompt_count} prompts · ${fmtNum(s.total_tokens)} tokens</div></td>
      <td>${s.project ? `<span class="badge">${escapeHtml(s.project)}</span>` : ""}</td>
      <td><span class="badge badge-source">${escapeHtml(s.source || "")}</span></td>
    </tr>`
    )
    .join("");

  return layout(
    "Sessions",
    `<h1>Sessions</h1><p class="subtitle">Browse your coding sessions</p>
    ${sessions.length ? `<table><thead><tr><th>Session</th><th>Project</th><th>Source</th></tr></thead><tbody>${rows}</tbody></table>${paginationHtml("/sessions", page, totalPages)}` : '<div class="empty">No sessions yet.</div>'}`,
    "sessions"
  );
}

function sessionDetailPage(sessionId, prompts) {
  if (!prompts || !prompts.length) {
    return layout("Session", '<div class="empty">Session not found.</div>');
  }
  const items = prompts
    .map(
      (p) => `<div class="card" style="margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;margin-bottom:8px">
        <span style="font-size:12px;color:var(--dim)">${fmtDate(p.created_at)}</span>
        <span style="font-size:12px;color:var(--dim)">${fmtNum(p.token_estimate || 0)} tokens</span>
      </div>
      <div style="font-size:14px;margin-bottom:8px">${escapeHtml(truncate(p.prompt_text, 300))}</div>
      ${p.response_text ? `<div style="font-size:13px;color:var(--dim);border-top:1px solid var(--border);padding-top:8px;margin-top:8px">${escapeHtml(truncate(p.response_text, 200))}</div>` : ""}
    </div>`
    )
    .join("");

  const first = prompts[0];
  return layout(
    "Session Detail",
    `<div style="margin-bottom:16px"><a href="/sessions">&larr; Back to sessions</a></div>
    <h1 style="font-size:18px">${escapeHtml(truncate(first.prompt_text, 80))}</h1>
    <p class="subtitle">${prompts.length} prompts · ${first.project ? escapeHtml(first.project) : "no project"} · ${escapeHtml(first.source)}</p>
    ${items}`,
    "sessions"
  );
}

function searchPage(query, results) {
  const resultHtml = results
    .map(
      (p) => `<tr>
      <td style="white-space:nowrap">${fmtDate(p.created_at)}</td>
      <td>${p.project ? `<span class="badge">${escapeHtml(p.project)}</span>` : ""}</td>
      <td class="prompt-text"><a href="/prompts/${encodeURIComponent(p.id)}">${escapeHtml(truncate(p.prompt_text, 100))}</a></td>
    </tr>`
    )
    .join("");

  return layout(
    "Search",
    `<h1>Search</h1><p class="subtitle">Full-text search across all prompts</p>
    <form class="search-form" method="get" action="/search">
      <input type="text" name="q" placeholder="Search prompts..." value="${escapeHtml(query || "")}" autofocus />
      <button type="submit">Search</button>
    </form>
    ${query ? (results.length ? `<table><thead><tr><th>Date</th><th>Project</th><th>Prompt</th></tr></thead><tbody>${resultHtml}</tbody></table>` : '<div class="empty">No results found.</div>') : '<div class="empty">Enter a search query to find prompts.</div>'}`,
    "search"
  );
}

function errorPage(status, message) {
  return layout("Error", `<div class="empty"><h1>${status}</h1><p>${escapeHtml(message)}</p></div>`);
}

module.exports = {
  dashboardPage,
  promptListPage,
  promptDetailPage,
  sessionListPage,
  sessionDetailPage,
  searchPage,
  errorPage,
};
