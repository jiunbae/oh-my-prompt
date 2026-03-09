// Zero-dependency local dashboard server using Node's built-in http module.
// Serves the SQLite-backed dashboard for users without Docker.

const http = require("http");
const { getStats } = require("./stats");
const queries = require("./serve-local-queries");
const views = require("./serve-local-views");
const { c } = require("./ui");

function parseQuery(req) {
  const parsed = new URL(req.url, "http://localhost");
  const query = {};
  for (const [k, v] of parsed.searchParams) query[k] = v;
  return { pathname: parsed.pathname, query };
}

function send(res, status, html) {
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-cache",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(html);
}

function startLocalServer(config, port = 3000) {
  const db = queries.getDb(config);

  const server = http.createServer((req, res) => {
    const { pathname, query } = parseQuery(req);
    const page = Math.max(1, parseInt(query.page, 10) || 1);

    try {
      // Dashboard
      if (pathname === "/" || pathname === "/dashboard") {
        const stats = getStats(config, { since: null, until: null });
        return send(res, 200, views.dashboardPage(stats));
      }

      // Prompt list
      if (pathname === "/prompts") {
        const result = queries.listPrompts(db, { page });
        return send(res, 200, views.promptListPage(result.rows, result.page, result.totalPages));
      }

      // Prompt detail
      const promptMatch = pathname.match(/^\/prompts\/(.+)$/);
      if (promptMatch) {
        const prompt = queries.getPrompt(db, decodeURIComponent(promptMatch[1]));
        return send(res, prompt ? 200 : 404, views.promptDetailPage(prompt));
      }

      // Session list
      if (pathname === "/sessions") {
        const result = queries.listSessions(db, { page });
        return send(res, 200, views.sessionListPage(result.rows, result.page, result.totalPages));
      }

      // Session detail
      const sessionMatch = pathname.match(/^\/sessions\/(.+)$/);
      if (sessionMatch) {
        const sessionId = decodeURIComponent(sessionMatch[1]);
        const prompts = queries.getSession(db, sessionId);
        return send(res, prompts.length ? 200 : 404, views.sessionDetailPage(sessionId, prompts));
      }

      // Search
      if (pathname === "/search") {
        const q = query.q || "";
        const results = queries.searchPrompts(db, q);
        return send(res, 200, views.searchPage(q, results));
      }

      // Favicon
      if (pathname === "/favicon.ico") {
        res.writeHead(204);
        return res.end();
      }

      // 404
      send(res, 404, views.errorPage(404, "Page not found"));
    } catch (err) {
      console.error("Server error:", err);
      send(res, 500, views.errorPage(500, "Internal server error"));
    }
  });

  return new Promise((resolve, reject) => {
    server.listen(port, "127.0.0.1", () => {
      const addr = `http://localhost:${port}`;
      console.log(`\nDashboard running at ${c.cyan(c.bold(addr))}`);
      console.log(c.dim("Local mode — SQLite, no Docker required"));
      console.log(c.dim(`Database: ${config.storage.sqlite.path}`));
      console.log(c.dim("\nPress Ctrl+C to stop.\n"));
      resolve({ url: addr, server });
    });

    server.on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        console.error(`\nPort ${port} is already in use.`);
        console.error(`Try a different port: omp serve --local --port ${port + 1}`);
      } else {
        console.error("Server error:", err.message);
      }
      reject(err);
    });
  });
}

module.exports = { startLocalServer };
