const { postJson, getJson } = require("./sync");
const { c, label, fail } = require("./ui");

// ---------------------------------------------------------------------------
// Server helpers
// ---------------------------------------------------------------------------

function serverUrl(config) {
  const base = config.server?.url;
  if (!base) return null;
  return base.replace(/\/$/, "");
}

function authHeaders(config) {
  return { "X-User-Token": config.server?.token || "" };
}

function requireServer(config) {
  if (!config.server?.url || !config.server?.token) {
    throw new Error(
      "Server not configured. Set server.url and server.token:\n" +
        "  omp config set server.url https://prompt.jiun.dev\n" +
        "  omp config set server.token YOUR_TOKEN"
    );
  }
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

async function listTemplates(config, options = {}) {
  requireServer(config);
  const base = serverUrl(config);
  const headers = authHeaders(config);

  let url = `${base}/api/templates`;
  if (options.category) {
    url += `?category=${encodeURIComponent(options.category)}`;
  }

  const response = await getJson(url, headers);
  if (response.status === 401) {
    throw new Error("Authentication failed. Check server.token.");
  }
  if (response.status >= 400) {
    throw new Error(`Server error (${response.status}): ${JSON.stringify(response.body)}`);
  }

  return response.body.templates || [];
}

async function showTemplate(config, id) {
  requireServer(config);
  const base = serverUrl(config);
  const headers = authHeaders(config);

  const response = await getJson(`${base}/api/templates/${encodeURIComponent(id)}`, headers);
  if (response.status === 401) {
    throw new Error("Authentication failed. Check server.token.");
  }
  if (response.status === 404) {
    throw new Error(`Template not found: ${id}`);
  }
  if (response.status >= 400) {
    throw new Error(`Server error (${response.status}): ${JSON.stringify(response.body)}`);
  }

  return response.body.template;
}

async function renderTemplate(config, id, vars = {}) {
  requireServer(config);
  const base = serverUrl(config);
  const headers = authHeaders(config);

  const response = await postJson(
    `${base}/api/templates/${encodeURIComponent(id)}/render`,
    headers,
    { values: vars }
  );

  if (response.status === 401) {
    throw new Error("Authentication failed. Check server.token.");
  }
  if (response.status === 404) {
    throw new Error(`Template not found: ${id}`);
  }
  if (response.status >= 400) {
    throw new Error(`Server error (${response.status}): ${JSON.stringify(response.body)}`);
  }

  return response.body.rendered;
}

async function createTemplate(config, { title, template, category, description, variables, isPublic }) {
  requireServer(config);
  const base = serverUrl(config);
  const headers = authHeaders(config);

  const body = { title, template };
  if (category) body.category = category;
  if (description) body.description = description;
  if (variables) body.variables = variables;
  if (isPublic !== undefined) body.isPublic = isPublic;

  const response = await postJson(`${base}/api/templates`, headers, body);

  if (response.status === 401) {
    throw new Error("Authentication failed. Check server.token.");
  }
  if (response.status === 400) {
    const details = response.body.details;
    const msg = details ? JSON.stringify(details, null, 2) : response.body.error;
    throw new Error(`Validation error:\n${msg}`);
  }
  if (response.status >= 400) {
    throw new Error(`Server error (${response.status}): ${JSON.stringify(response.body)}`);
  }

  return response.body.template;
}

async function deleteTemplate(config, id) {
  requireServer(config);
  const base = serverUrl(config);
  const headers = authHeaders(config);

  const response = await postJson(
    `${base}/api/templates/${encodeURIComponent(id)}`,
    headers,
    {},
    "DELETE"
  );

  if (response.status === 401) {
    throw new Error("Authentication failed. Check server.token.");
  }
  if (response.status === 404) {
    throw new Error(`Template not found or not owned by you: ${id}`);
  }
  if (response.status >= 400) {
    throw new Error(`Server error (${response.status}): ${JSON.stringify(response.body)}`);
  }

  return response.body;
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

function formatTable(templates) {
  if (!templates.length) return;

  const idWidth = 10;
  const titleWidth = Math.min(30, Math.max(8, ...templates.map((t) => (t.title || "").length)));
  const catWidth = Math.max(6, ...templates.map((t) => (t.category || "-").length));

  const header =
    c.dim("ID".padEnd(idWidth)) +
    "  " +
    c.dim("Title".padEnd(titleWidth)) +
    "  " +
    c.dim("Category".padEnd(catWidth)) +
    "  " +
    c.dim("Uses".padStart(5)) +
    "  " +
    c.dim("Visibility");

  console.log("");
  console.log(`  ${header}`);
  console.log(`  ${"─".repeat(header.length)}`);

  for (const t of templates) {
    const id = String(t.id || "").slice(0, 8);
    const title = t.title || "(untitled)";
    const category = t.category || "-";
    const uses = String(t.usageCount ?? 0);
    const visibility = t.isPublic ? c.green("public") : c.dim("private");

    console.log(
      `  ${c.cyan(id.padEnd(idWidth))}  ${title.padEnd(titleWidth)}  ${category.padEnd(catWidth)}  ${uses.padStart(5)}  ${visibility}`
    );
  }
  console.log("");
}

function showTemplateDetails(tmpl) {
  console.log("");
  console.log(`  ${c.bold(c.cyan(tmpl.title || "(untitled)"))}`);
  if (tmpl.description) {
    console.log(`  ${c.dim(tmpl.description)}`);
  }
  console.log("");
  console.log(label("  ID", c.cyan(String(tmpl.id))));
  console.log(label("  Category", tmpl.category || "-"));
  console.log(label("  Visibility", tmpl.isPublic ? c.green("public") : c.dim("private")));
  console.log(label("  Uses", String(tmpl.usageCount ?? 0)));
  console.log(label("  Created", tmpl.createdAt || "-"));
  console.log(label("  Updated", tmpl.updatedAt || "-"));

  if (tmpl.variables && tmpl.variables.length) {
    console.log("");
    console.log(`  ${c.yellow("Variables:")}`);
    for (const v of tmpl.variables) {
      const def = v.default ? c.dim(` (default: "${v.default}")`) : "";
      const desc = v.description ? c.dim(` — ${v.description}`) : "";
      console.log(`    ${c.cyan(`{{${v.name}}}`)}${def}${desc}`);
    }
  }

  console.log("");
  console.log(`  ${c.yellow("Template:")}`);
  console.log("");
  const lines = (tmpl.template || "").split("\n");
  for (const line of lines) {
    console.log(`    ${line}`);
  }
  console.log("");
}

module.exports = {
  listTemplates,
  showTemplate,
  renderTemplate,
  createTemplate,
  deleteTemplate,
  formatTable,
  showTemplateDetails,
};