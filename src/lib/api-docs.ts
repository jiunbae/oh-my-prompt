export interface ApiEndpoint {
  category: string;
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  path: string;
  description: string;
  auth: boolean;
  adminOnly?: boolean;
  query?: Record<string, string>;
  body?: Record<string, string>;
  response?: Record<string, string>;
}

export const apiEndpoints: ApiEndpoint[] = [
  // Auth
  {
    category: "Auth",
    method: "POST",
    path: "/api/auth/register",
    description: "Register a new user account",
    auth: false,
    body: { email: "string", password: "string" },
    response: { user: "{ id, email, token }" },
  },
  {
    category: "Auth",
    method: "POST",
    path: "/api/auth/login",
    description: "Log in and get session cookie",
    auth: false,
    body: { email: "string", password: "string" },
    response: { user: "{ id, email, name }" },
  },
  {
    category: "Auth",
    method: "POST",
    path: "/api/auth/logout",
    description: "Log out and clear session",
    auth: true,
  },
  {
    category: "Auth",
    method: "GET",
    path: "/api/auth/me",
    description: "Get current authenticated user",
    auth: true,
    response: { user: "{ id, email, name, isAdmin }" },
  },
  {
    category: "Auth",
    method: "POST",
    path: "/api/auth/regenerate-token",
    description: "Generate a new API token",
    auth: true,
    response: { token: "string" },
  },

  // Prompts
  {
    category: "Prompts",
    method: "GET",
    path: "/api/prompts/:id",
    description: "Get a single prompt by ID",
    auth: true,
    response: { prompt: "Prompt object with tags" },
  },
  {
    category: "Prompts",
    method: "DELETE",
    path: "/api/prompts/:id",
    description: "Soft-delete a prompt (sets deletedAt)",
    auth: true,
  },
  {
    category: "Prompts",
    method: "POST",
    path: "/api/prompts/:id/favorite",
    description: "Toggle favorite status for a prompt",
    auth: true,
    response: { favorited: "boolean" },
  },
  {
    category: "Prompts",
    method: "POST",
    path: "/api/prompts/bulk",
    description: "Bulk delete or tag prompts",
    auth: true,
    body: { action: '"delete" | "tag"', ids: "string[]", tag: "string (for tag action)" },
    response: { affected: "number" },
  },
  {
    category: "Prompts",
    method: "GET",
    path: "/api/prompts/favorites",
    description: "List favorited prompts",
    auth: true,
    response: { prompts: "FavoritePromptItem[]" },
  },

  // Sessions
  {
    category: "Sessions",
    method: "GET",
    path: "/api/sessions",
    description: "List sessions with pagination",
    auth: true,
    query: { page: "number", pageSize: "number", project: "string?", source: "string?" },
    response: { sessions: "Session[]", total: "number" },
  },
  {
    category: "Sessions",
    method: "GET",
    path: "/api/sessions/:sessionId",
    description: "Get prompts in a session",
    auth: true,
    response: { prompts: "Prompt[]", displayName: "string?" },
  },
  {
    category: "Sessions",
    method: "POST",
    path: "/api/sessions/:sessionId/favorite",
    description: "Toggle session favorite status",
    auth: true,
  },
  {
    category: "Sessions",
    method: "POST",
    path: "/api/sessions/:sessionId/notes",
    description: "Create or update session note",
    auth: true,
    body: { content: "string" },
  },
  {
    category: "Sessions",
    method: "GET",
    path: "/api/sessions/:sessionId/notes",
    description: "Get session note",
    auth: true,
  },
  {
    category: "Sessions",
    method: "DELETE",
    path: "/api/sessions/:sessionId/notes",
    description: "Delete session note",
    auth: true,
  },

  // Search
  {
    category: "Search",
    method: "GET",
    path: "/api/search",
    description: "Full-text search prompts",
    auth: true,
    query: { q: "string", page: "number", project: "string?", source: "string?", from: "date?", to: "date?" },
    response: { results: "Prompt[]", total: "number", page: "number", pageSize: "number" },
  },
  {
    category: "Search",
    method: "GET",
    path: "/api/search/filters",
    description: "Get available filter values",
    auth: true,
    response: { projects: "string[]", sources: "string[]" },
  },

  // Analytics
  {
    category: "Analytics",
    method: "GET",
    path: "/api/analytics/overview",
    description: "Get analytics overview for a date range",
    auth: true,
    query: { from: "date", to: "date", project: "string?" },
    response: { summary: "AnalyticsSummary", daily: "DailyStat[]" },
  },

  // Sync
  {
    category: "Sync",
    method: "POST",
    path: "/api/sync/upload",
    description: "Upload prompts from CLI",
    auth: true,
    body: { records: "PromptRecord[]" },
    response: { inserted: "number", updated: "number" },
  },
  {
    category: "Sync",
    method: "POST",
    path: "/api/sync/flush",
    description: "Delete all server-side records (destructive)",
    auth: true,
  },

  // Templates
  {
    category: "Templates",
    method: "GET",
    path: "/api/templates",
    description: "List prompt templates",
    auth: true,
    query: { category: "string?" },
    response: { templates: "Template[]" },
  },
  {
    category: "Templates",
    method: "POST",
    path: "/api/templates",
    description: "Create a new template",
    auth: true,
    body: { title: "string", template: "string", category: "string?", description: "string?", variables: "Variable[]?", isPublic: "boolean?" },
  },
  {
    category: "Templates",
    method: "POST",
    path: "/api/templates/:id/render",
    description: "Render a template with variable values",
    auth: true,
    body: { values: "Record<string, string>" },
    response: { rendered: "string" },
  },

  // Webhooks
  {
    category: "Webhooks",
    method: "GET",
    path: "/api/webhooks",
    description: "List user webhooks",
    auth: true,
    response: { webhooks: "Webhook[]" },
  },
  {
    category: "Webhooks",
    method: "POST",
    path: "/api/webhooks",
    description: "Create a webhook",
    auth: true,
    body: { name: "string", url: "string", secret: "string?", events: "string[]" },
  },
  {
    category: "Webhooks",
    method: "POST",
    path: "/api/webhooks/:id/retry",
    description: "Manually retry a failed delivery",
    auth: true,
    body: { logId: "string" },
  },

  // Admin
  {
    category: "Admin",
    method: "GET",
    path: "/api/admin/users",
    description: "List all users (admin only)",
    auth: true,
    adminOnly: true,
    response: { users: "User[]" },
  },
  {
    category: "Admin",
    method: "GET",
    path: "/api/admin/monitoring/system",
    description: "Get system health status",
    auth: true,
    adminOnly: true,
    response: { database: "string", redis: "string", uptime: "number" },
  },
  {
    category: "Admin",
    method: "POST",
    path: "/api/admin/purge-deleted",
    description: "Permanently delete soft-deleted prompts older than 30 days",
    auth: true,
    adminOnly: true,
  },
  {
    category: "Admin",
    method: "POST",
    path: "/api/admin/retention/cleanup",
    description: "Trigger data retention cleanup",
    auth: true,
    adminOnly: true,
  },
];

export const apiCategories = Array.from(new Set(apiEndpoints.map((e) => e.category)));
