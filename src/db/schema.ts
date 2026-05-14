import {
  pgTable,
  uuid,
  varchar,
  text,
  jsonb,
  integer,
  timestamp,
  date,
  numeric,
  primaryKey,
  index,
  uniqueIndex,
  boolean,
  customType,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

const vector = customType<{ data: number[]; config: { dimensions: number } }>({
  dataType(config) {
    return `vector(${config?.dimensions || 384})`;
  },
});

// Users table
export const users = pgTable(
  "users",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    email: varchar("email", { length: 255 }).notNull().unique(),
    passwordHash: varchar("password_hash", { length: 255 }).notNull(),
    token: uuid("token")
      .notNull()
      .unique()
      .default(sql`gen_random_uuid()`), // for API auth
    name: varchar("name", { length: 100 }),
    isAdmin: boolean("is_admin").default(false),
    dataRetentionDays: integer("data_retention_days").default(365),
    emailDigestEnabled: boolean("email_digest_enabled").default(true),
    passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }),
    onboardingCompleted: boolean("onboarding_completed").default(false),
    onboardingStep: varchar("onboarding_step", { length: 50 }).default("welcome"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_users_email").on(table.email),
    index("idx_users_token").on(table.token),
  ]
);

// Allowed emails table (admin allowlist)
export const allowedEmails = pgTable("allowed_emails", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  email: varchar("email", { length: 255 }).notNull().unique(),
  addedBy: uuid("added_by").references(() => users.id, { onDelete: "set null" }),
  addedAt: timestamp("added_at", { withTimezone: true }).defaultNow(),
});

// Prompts table (main entity)
export const prompts = pgTable(
  "prompts",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    eventKey: varchar("event_key", { length: 255 }).notNull().unique(),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
    workingDirectory: varchar("working_directory", { length: 500 }),
    promptLength: integer("prompt_length").notNull(),
    promptText: text("prompt_text").notNull(),
    responseText: text("response_text"),
    responseLength: integer("response_length"),

    // Extracted metadata
    projectName: varchar("project_name", { length: 255 }),
    promptType: varchar("prompt_type", { length: 50 }),

    // Provenance (optional; populated by clients when available)
    source: varchar("source", { length: 50 }),
    sessionId: varchar("session_id", { length: 255 }),
    deviceName: varchar("device_name", { length: 255 }),

    userId: uuid("user_id").references(() => users.id),
    teamId: uuid("team_id").references(() => teams.id),
    tokenEstimate: integer("token_estimate"),
    wordCount: integer("word_count"),
    tokenEstimateResponse: integer("token_estimate_response"),
    wordCountResponse: integer("word_count_response"),
    syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),

    // Enrichment fields (Phase 3)
    qualityScore: integer("quality_score"),
    qualityClarity: integer("quality_clarity"),       // 0-100: Is the goal clear?
    qualitySpecificity: integer("quality_specificity"), // 0-100: Are requirements specific?
    qualityContext: integer("quality_context"),         // 0-100: Is background provided?
    qualityConstraints: integer("quality_constraints"), // 0-100: Are boundaries defined?
    qualityStructure: integer("quality_structure"),     // 0-100: Is it well-organized?
    qualityDetails: jsonb("quality_details"),           // Full breakdown with explanations
    topicTags: text("topic_tags").array(),
    enrichedAt: timestamp("enriched_at", { withTimezone: true }),

    searchVector: tsvector("search_vector"),
    embedding: vector("embedding", { dimensions: 384 }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    visibility: varchar("visibility", { length: 20 }).default("private"), // "private", "team", "public"
  },
  (table) => [
    index("idx_prompts_timestamp").on(table.timestamp),
    index("idx_prompts_project").on(table.projectName),
    index("idx_prompts_type").on(table.promptType),
    index("idx_prompts_event_key").on(table.eventKey),
    index("idx_prompts_user").on(table.userId),
    index("idx_prompts_session_id").on(table.sessionId),
    index("idx_prompts_search_vector").using("gin", table.searchVector),
    index("idx_prompts_text_trgm").using("gin", sql`LEFT(prompt_text, 500) gin_trgm_ops`),
    index("idx_prompts_embedding").using("ivfflat", table.embedding),
    index("idx_prompts_user_timestamp").on(table.userId, table.timestamp),
    index("idx_prompts_user_project").on(table.userId, table.projectName),
    index("idx_prompts_user_quality").on(table.userId, table.qualityScore),
    index("idx_prompts_user_session_ts").on(table.userId, table.sessionId, table.timestamp),
    index("idx_prompts_team").on(table.teamId),
    index("idx_prompts_team_timestamp").on(table.teamId, table.timestamp),
    index("idx_prompts_team_visibility").on(table.teamId, table.visibility),
  ]
);

// Tags table
export const tags = pgTable("tags", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 100 }).notNull().unique(),
  color: varchar("color", { length: 7 }).default("#6366f1"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// Prompt tags junction table
export const promptTags = pgTable(
  "prompt_tags",
  {
    promptId: uuid("prompt_id")
      .notNull()
      .references(() => prompts.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.promptId, table.tagId] })]
);

// Teams table
export const teams = pgTable(
  "teams",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    name: varchar("name", { length: 255 }).notNull(),
    slug: varchar("slug", { length: 255 }).notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_teams_slug").on(table.slug),
  ]
);

// Team members table
export const teamMembers = pgTable(
  "team_members",
  {
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 20 }).notNull().default("member"), // owner, admin, member
    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.teamId, table.userId] }),
    index("idx_team_members_team").on(table.teamId),
    index("idx_team_members_user").on(table.userId),
  ]
);

// Team invites table
export const teamInvites = pgTable(
  "team_invites",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    email: varchar("email", { length: 255 }).notNull(),
    token: varchar("token", { length: 64 }).notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_team_invites_team").on(table.teamId),
    index("idx_team_invites_token").on(table.token),
    index("idx_team_invites_email").on(table.email),
  ]
);

// Prompt-level access control
export const promptPermissions = pgTable(
  "prompt_permissions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    promptId: uuid("prompt_id").notNull().references(() => prompts.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    permission: varchar("permission", { length: 20 }).notNull(), // "view", "edit", "admin"
    grantedBy: uuid("granted_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_prompt_permissions_prompt").on(table.promptId),
    index("idx_prompt_permissions_user").on(table.userId),
    uniqueIndex("idx_prompt_permissions_prompt_user").on(table.promptId, table.userId),
  ]
);

// Team-level settings
export const teamSettings = pgTable(
  "team_settings",
  {
    teamId: uuid("team_id").primaryKey().references(() => teams.id, { onDelete: "cascade" }),
    inviteOnly: boolean("invite_only").default(false),
    defaultPromptVisibility: varchar("default_prompt_visibility", { length: 20 }).default("team"), // "private", "team", "public"
    allowMemberInvites: boolean("allow_member_invites").default(false),
    requireApprovalForJoin: boolean("require_approval_for_join").default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  }
);

// AI-generated insights cache
export const aiInsights = pgTable(
  "ai_insights",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    insightType: varchar("insight_type", { length: 100 }).notNull(),
    parameters: jsonb("parameters").notNull().default({}),
    dataHash: varchar("data_hash", { length: 64 }).notNull(),
    result: jsonb("result").notNull(),
    model: varchar("model", { length: 100 }),
    tokensUsed: integer("tokens_used"),
    generatedAt: timestamp("generated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("idx_ai_insights_user_type").on(table.userId, table.insightType),
    index("idx_ai_insights_expires").on(table.expiresAt),
  ]
);

// Prompt templates table
export const promptTemplates = pgTable(
  "prompt_templates",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description"),
    template: text("template").notNull(), // Template text with {{placeholders}}
    variables: jsonb("variables").default([]), // [{name, default, description}]
    category: varchar("category", { length: 100 }),
    usageCount: integer("usage_count").default(0),
    isPublic: boolean("is_public").default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_templates_user").on(table.userId),
    index("idx_templates_category").on(table.category),
  ]
);

// Shared prompts table
export const sharedPrompts = pgTable(
  "shared_prompts",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    promptId: uuid("prompt_id")
      .notNull()
      .references(() => prompts.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    shareToken: varchar("share_token", { length: 64 }).notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    viewCount: integer("view_count").default(0),
    isActive: boolean("is_active").default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_shared_user").on(table.userId),
    index("idx_shared_prompt").on(table.promptId),
  ]
);

// Prompt shares table (P6-2: shareable prompt links with read/clone access)
export const promptShares = pgTable(
  "prompt_shares",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    promptId: uuid("prompt_id")
      .notNull()
      .references(() => prompts.id, { onDelete: "cascade" }),
    token: varchar("token", { length: 32 }).notNull().unique(),
    access: varchar("access", { length: 20 }).notNull().default("read"), // 'read' or 'clone'
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    viewCount: integer("view_count").default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_prompt_shares_token").on(table.token),
    index("idx_prompt_shares_prompt").on(table.promptId),
  ]
);

// Per-user custom labels for captured sessions
export const sessionDisplayNames = pgTable(
  "session_display_names",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionId: varchar("session_id", { length: 255 }).notNull(),
    displayName: varchar("display_name", { length: 120 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_session_display_names_user_session").on(table.userId, table.sessionId),
    index("idx_session_display_names_user_updated").on(table.userId, table.updatedAt),
  ]
);

// Shared sessions table (read-only session sharing)
// Note: sessionId has no FK because sessions are logical groupings inferred from
// prompts.session_id — there is no dedicated sessions table. Ownership is validated
// at share-creation time by checking prompts with matching (sessionId, userId).
export const sharedSessions = pgTable(
  "shared_sessions",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    sessionId: varchar("session_id", { length: 255 }).notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    shareToken: varchar("share_token", { length: 64 }).notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    viewCount: integer("view_count").default(0),
    isActive: boolean("is_active").default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_shared_sessions_user").on(table.userId),
    index("idx_shared_sessions_session").on(table.sessionId),
    index("idx_shared_sessions_token").on(table.shareToken),
  ]
);

// Daily aggregations table
export const analyticsDaily = pgTable("analytics_daily", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().references(() => users.id),
  date: date("date").notNull(),
  promptCount: integer("prompt_count").default(0),
  totalChars: integer("total_chars").default(0),
  totalTokensEst: integer("total_tokens_est").default(0),
  totalResponseTokens: integer("total_response_tokens").default(0),
  uniqueProjects: integer("unique_projects").default(0),
  avgPromptLength: numeric("avg_prompt_length", { precision: 10, scale: 2 }).default("0"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  uniqueIndex("idx_analytics_daily_user_date").on(table.userId, table.date),
]);

// Template versions table
export const templateVersions = pgTable("template_versions", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  templateId: uuid("template_id").notNull().references(() => promptTemplates.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  content: text("content").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  index("idx_template_versions_template").on(table.templateId),
  index("idx_template_versions_template_version").on(table.templateId, table.version),
]);

// Template marketplace table
export const templateMarketplace = pgTable("template_marketplace", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  templateId: uuid("template_id").notNull().references(() => promptTemplates.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  category: varchar("category", { length: 50 }).notNull(),
  tags: text("tags").array(),
  rating: numeric("rating", { precision: 3, scale: 2 }).default("0"),
  ratingCount: integer("rating_count").default(0),
  forkCount: integer("fork_count").default(0),
  isPublic: boolean("is_public").default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  index("idx_marketplace_template").on(table.templateId),
  index("idx_marketplace_user").on(table.userId),
  index("idx_marketplace_category").on(table.category),
  index("idx_marketplace_public").on(table.isPublic),
]);

// Template ratings table
export const templateRatings = pgTable("template_ratings", {
  templateId: uuid("template_id").notNull().references(() => promptTemplates.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  rating: integer("rating").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.templateId, table.userId] }),
  index("idx_template_ratings_template").on(table.templateId),
]);

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  prompts: many(prompts),
  allowedEmails: many(allowedEmails),
  promptTemplates: many(promptTemplates),
  sharedPrompts: many(sharedPrompts),
  sharedSessions: many(sharedSessions),
  favoriteSessions: many(favoriteSessions),
  favoritePrompts: many(favoritePrompts),
  sessionNotes: many(sessionNotes),
  teamMembers: many(teamMembers),
  outgoingIntegrations: many(outgoingIntegrations),
  marketplaceTemplates: many(templateMarketplace),
  templateRatings: many(templateRatings),
  alertRules: many(alertRules),
  alertNotifications: many(alertNotifications),
  promptExperiments: many(promptExperiments),
}));

export const allowedEmailsRelations = relations(allowedEmails, ({ one }) => ({
  addedByUser: one(users, {
    fields: [allowedEmails.addedBy],
    references: [users.id],
  }),
}));

export const promptsRelations = relations(prompts, ({ one, many }) => ({
  promptTags: many(promptTags),
  sharedPrompts: many(sharedPrompts),
  promptShares: many(promptShares),
  favoritePrompts: many(favoritePrompts),
  promptVersions: many(promptVersions),
  promptPermissions: many(promptPermissions),
  promptExperiments: many(promptExperiments),
  toolInvocations: many(toolInvocations),
  user: one(users, {
    fields: [prompts.userId],
    references: [users.id],
  }),
  team: one(teams, {
    fields: [prompts.teamId],
    references: [teams.id],
  }),
}));

export const tagsRelations = relations(tags, ({ many }) => ({
  promptTags: many(promptTags),
}));

export const promptTagsRelations = relations(promptTags, ({ one }) => ({
  prompt: one(prompts, {
    fields: [promptTags.promptId],
    references: [prompts.id],
  }),
  tag: one(tags, {
    fields: [promptTags.tagId],
    references: [tags.id],
  }),
}));

export const teamsRelations = relations(teams, ({ many, one }) => ({
  members: many(teamMembers),
  invites: many(teamInvites),
  prompts: many(prompts),
  outgoingIntegrations: many(outgoingIntegrations),
  settings: one(teamSettings, {
    fields: [teams.id],
    references: [teamSettings.teamId],
  }),
}));

export const teamMembersRelations = relations(teamMembers, ({ one }) => ({
  team: one(teams, {
    fields: [teamMembers.teamId],
    references: [teams.id],
  }),
  user: one(users, {
    fields: [teamMembers.userId],
    references: [users.id],
  }),
}));

export const teamInvitesRelations = relations(teamInvites, ({ one }) => ({
  team: one(teams, {
    fields: [teamInvites.teamId],
    references: [teams.id],
  }),
}));

export const promptPermissionsRelations = relations(promptPermissions, ({ one }) => ({
  prompt: one(prompts, {
    fields: [promptPermissions.promptId],
    references: [prompts.id],
  }),
  user: one(users, {
    fields: [promptPermissions.userId],
    references: [users.id],
  }),
  grantedByUser: one(users, {
    fields: [promptPermissions.grantedBy],
    references: [users.id],
  }),
}));

export const teamSettingsRelations = relations(teamSettings, ({ one }) => ({
  team: one(teams, {
    fields: [teamSettings.teamId],
    references: [teams.id],
  }),
}));

// Webhooks table
export const webhooks = pgTable("webhooks", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  url: varchar("url", { length: 2048 }).notNull(),
  secret: varchar("secret", { length: 255 }),  // HMAC signing secret
  events: text("events").array().notNull().default(sql`ARRAY['prompt.created']`),
  // Events: prompt.created, prompt.enriched, prompt.scored, session.completed, sync.completed
  isActive: boolean("is_active").default(true),
  lastTriggeredAt: timestamp("last_triggered_at", { withTimezone: true }),
  lastStatus: integer("last_status"),  // Last HTTP status code
  failCount: integer("fail_count").default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  index("idx_webhooks_user").on(table.userId),
]);

// Webhook delivery logs table
export const webhookLogs = pgTable("webhook_logs", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  webhookId: uuid("webhook_id").notNull().references(() => webhooks.id, { onDelete: "cascade" }),
  event: varchar("event", { length: 100 }).notNull(),
  payload: jsonb("payload"),
  statusCode: integer("status_code"),
  responseBody: text("response_body"),
  duration: integer("duration"),  // ms
  attempt: integer("attempt").default(1),  // 1 = original, 2+ = retry attempts
  retryOf: uuid("retry_of"),  // references the original failed log entry
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  index("idx_webhook_logs_webhook_created").on(table.webhookId, table.createdAt),
  index("idx_webhook_logs_retry_of").on(table.retryOf),
]);

// Webhook relations
export const webhooksRelations = relations(webhooks, ({ one, many }) => ({
  user: one(users, {
    fields: [webhooks.userId],
    references: [users.id],
  }),
  logs: many(webhookLogs),
}));

export const webhookLogsRelations = relations(webhookLogs, ({ one }) => ({
  webhook: one(webhooks, {
    fields: [webhookLogs.webhookId],
    references: [webhooks.id],
  }),
}));

export const promptTemplatesRelations = relations(promptTemplates, ({ one, many }) => ({
  user: one(users, {
    fields: [promptTemplates.userId],
    references: [users.id],
  }),
  versions: many(templateVersions),
  marketplaceEntry: one(templateMarketplace, {
    fields: [promptTemplates.id],
    references: [templateMarketplace.templateId],
  }),
  ratings: many(templateRatings),
}));

export const sharedPromptsRelations = relations(sharedPrompts, ({ one }) => ({
  prompt: one(prompts, {
    fields: [sharedPrompts.promptId],
    references: [prompts.id],
  }),
  user: one(users, {
    fields: [sharedPrompts.userId],
    references: [users.id],
  }),
}));

export const sharedSessionsRelations = relations(sharedSessions, ({ one }) => ({
  user: one(users, {
    fields: [sharedSessions.userId],
    references: [users.id],
  }),
}));

export const promptSharesRelations = relations(promptShares, ({ one }) => ({
  prompt: one(prompts, {
    fields: [promptShares.promptId],
    references: [prompts.id],
  }),
}));

// Favorite sessions table
export const favoriteSessions = pgTable(
  "favorite_sessions",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionId: varchar("session_id", { length: 255 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_favorite_sessions_user_session").on(table.userId, table.sessionId),
    index("idx_favorite_sessions_user").on(table.userId),
  ]
);

// Session notes table
export const sessionNotes = pgTable(
  "session_notes",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionId: varchar("session_id", { length: 255 }).notNull(),
    content: text("content").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_session_notes_user_session").on(table.userId, table.sessionId),
    index("idx_session_notes_user").on(table.userId),
  ]
);

// Password reset tokens table
export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 255 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_password_reset_tokens_user").on(table.userId),
    index("idx_password_reset_tokens_expires").on(table.expiresAt),
  ]
);

export const passwordResetTokensRelations = relations(passwordResetTokens, ({ one }) => ({
  user: one(users, {
    fields: [passwordResetTokens.userId],
    references: [users.id],
  }),
}));

export const favoriteSessionsRelations = relations(favoriteSessions, ({ one }) => ({
  user: one(users, {
    fields: [favoriteSessions.userId],
    references: [users.id],
  }),
}));

// Prompt versions table (tracks evolution of a prompt)
export const promptVersions = pgTable(
  "prompt_versions",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    promptId: uuid("prompt_id")
      .notNull()
      .references(() => prompts.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    promptText: text("prompt_text").notNull(),
    responseText: text("response_text"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    reason: varchar("reason", { length: 100 }).default("user_edit"),
  },
  (table) => [
    index("idx_prompt_versions_prompt").on(table.promptId),
    index("idx_prompt_versions_prompt_version").on(table.promptId, table.version),
  ]
);

export const promptVersionsRelations = relations(promptVersions, ({ one }) => ({
  prompt: one(prompts, {
    fields: [promptVersions.promptId],
    references: [prompts.id],
  }),
}));

export const toolInvocations = pgTable(
  "tool_invocations",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    promptId: uuid("prompt_id").references(() => prompts.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    teamId: uuid("team_id").references(() => teams.id, { onDelete: "cascade" }),
    sessionId: varchar("session_id", { length: 255 }).notNull(),
    sequence: integer("sequence").notNull().default(0),
    source: varchar("source", { length: 50 }),
    toolName: varchar("tool_name", { length: 100 }).notNull(),
    toolUseId: varchar("tool_use_id", { length: 255 }).notNull(),
    inputJson: jsonb("input_json"),
    program: varchar("program", { length: 100 }),
    cwd: text("cwd"),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
    syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    uniqueIndex("tool_invocations_session_tool_use_unique").on(
      table.sessionId,
      table.toolUseId
    ),
    index("idx_tool_invocations_prompt").on(table.promptId),
    index("idx_tool_invocations_session").on(table.sessionId, table.sequence),
    index("idx_tool_invocations_user_ts").on(table.userId, table.timestamp),
    index("idx_tool_invocations_team_ts").on(table.teamId, table.timestamp),
    index("idx_tool_invocations_tool").on(table.toolName),
    index("idx_tool_invocations_program").on(table.program),
  ]
);

export const toolInvocationsRelations = relations(toolInvocations, ({ one }) => ({
  prompt: one(prompts, {
    fields: [toolInvocations.promptId],
    references: [prompts.id],
  }),
  user: one(users, {
    fields: [toolInvocations.userId],
    references: [users.id],
  }),
  team: one(teams, {
    fields: [toolInvocations.teamId],
    references: [teams.id],
  }),
}));

// Prompt experiments table (A/B testing)
export const promptExperiments = pgTable(
  "prompt_experiments",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    promptId: uuid("prompt_id")
      .notNull()
      .references(() => prompts.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    status: varchar("status", { length: 20 }).default("draft"),
    baselineVersion: integer("baseline_version").notNull(),
    challengerVersion: integer("challenger_version").notNull(),
    winMetric: varchar("win_metric", { length: 50 }).default("quality_score"),
    minSamples: integer("min_samples").default(10),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    winnerVersion: integer("winner_version"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_prompt_experiments_prompt").on(table.promptId),
    index("idx_prompt_experiments_user").on(table.userId),
    index("idx_prompt_experiments_status").on(table.status),
  ]
);

export const experimentResults = pgTable(
  "experiment_results",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    experimentId: uuid("experiment_id")
      .notNull()
      .references(() => promptExperiments.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    metricValue: numeric("metric_value", { precision: 5, scale: 2 }),
    sampleSize: integer("sample_size").default(0),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_experiment_results_experiment").on(table.experimentId),
    index("idx_experiment_results_experiment_version").on(table.experimentId, table.version),
  ]
);

export const promptExperimentsRelations = relations(promptExperiments, ({ one, many }) => ({
  prompt: one(prompts, {
    fields: [promptExperiments.promptId],
    references: [prompts.id],
  }),
  user: one(users, {
    fields: [promptExperiments.userId],
    references: [users.id],
  }),
  results: many(experimentResults),
}));

export const experimentResultsRelations = relations(experimentResults, ({ one }) => ({
  experiment: one(promptExperiments, {
    fields: [experimentResults.experimentId],
    references: [promptExperiments.id],
  }),
}));

// Favorite prompts table
export const favoritePrompts = pgTable(
  "favorite_prompts",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    promptId: uuid("prompt_id")
      .notNull()
      .references(() => prompts.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_favorite_prompts_user_prompt").on(table.userId, table.promptId),
    index("idx_favorite_prompts_user").on(table.userId),
  ]
);

export const favoritePromptsRelations = relations(favoritePrompts, ({ one }) => ({
  user: one(users, {
    fields: [favoritePrompts.userId],
    references: [users.id],
  }),
  prompt: one(prompts, {
    fields: [favoritePrompts.promptId],
    references: [prompts.id],
  }),
}));

export const sessionNotesRelations = relations(sessionNotes, ({ one }) => ({
  user: one(users, {
    fields: [sessionNotes.userId],
    references: [users.id],
  }),
}));

// Alert rules table
export const alertRules = pgTable(
  "alert_rules",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    teamId: uuid("team_id").references(() => teams.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    metric: varchar("metric", { length: 50 }).notNull(),
    condition: varchar("condition", { length: 20 }).notNull(),
    threshold: numeric("threshold", { precision: 10, scale: 2 }).notNull(),
    comparisonPeriod: varchar("comparison_period", { length: 20 }).default("1_day"),
    notificationChannels: text("notification_channels").array().notNull().default(sql`ARRAY['in_app']`),
    isActive: boolean("is_active").default(true),
    lastTriggeredAt: timestamp("last_triggered_at", { withTimezone: true }),
    cooldownMinutes: integer("cooldown_minutes").default(60),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_alert_rules_user").on(table.userId),
    index("idx_alert_rules_team").on(table.teamId),
    index("idx_alert_rules_active").on(table.isActive),
  ]
);

// Alert notifications table
export const alertNotifications = pgTable(
  "alert_notifications",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    alertRuleId: uuid("alert_rule_id").notNull().references(() => alertRules.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    triggeredAt: timestamp("triggered_at", { withTimezone: true }).defaultNow(),
    metricValue: numeric("metric_value", { precision: 10, scale: 2 }),
    threshold: numeric("threshold", { precision: 10, scale: 2 }),
    message: text("message"),
    channelsSent: text("channels_sent").array(),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_alert_notifications_rule").on(table.alertRuleId),
    index("idx_alert_notifications_user").on(table.userId),
    index("idx_alert_notifications_ack").on(table.acknowledgedAt),
    index("idx_alert_notifications_triggered").on(table.triggeredAt),
  ]
);

// Slack webhooks table
export const slackWebhooks = pgTable(
  "slack_webhooks",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    teamId: uuid("team_id").references(() => teams.id, { onDelete: "cascade" }),
    webhookUrl: text("webhook_url").notNull(),
    channel: varchar("channel", { length: 100 }),
    events: varchar("events", { length: 100 }).array().notNull().default(sql`ARRAY['daily_summary']`),
    isActive: boolean("is_active").default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_slack_webhooks_user").on(table.userId),
    index("idx_slack_webhooks_team").on(table.teamId),
  ]
);

// Outgoing integrations table (Zapier / Make.com / Custom webhooks)
export const outgoingIntegrations = pgTable(
  "outgoing_integrations",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    teamId: uuid("team_id").references(() => teams.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    provider: varchar("provider", { length: 50 }).notNull(), // "zapier", "make", "custom"
    webhookUrl: text("webhook_url").notNull(),
    secret: text("secret"), // HMAC signing secret
    events: text("events").array().notNull(), // ["prompt.created", "prompt.favorited", "prompt.deleted"]
    isActive: boolean("is_active").default(true),
    lastTriggeredAt: timestamp("last_triggered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_outgoing_integrations_user").on(table.userId),
    index("idx_outgoing_integrations_team").on(table.teamId),
    index("idx_outgoing_integrations_provider").on(table.provider),
  ]
);

// Integration delivery logs table
export const integrationDeliveryLogs = pgTable(
  "integration_delivery_logs",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    integrationId: uuid("integration_id")
      .notNull()
      .references(() => outgoingIntegrations.id, { onDelete: "cascade" }),
    eventType: varchar("event_type", { length: 50 }).notNull(),
    payload: jsonb("payload"),
    responseStatus: integer("response_status"),
    responseBody: text("response_body"),
    errorMessage: text("error_message"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_integration_logs_integration").on(table.integrationId),
    index("idx_integration_logs_delivered").on(table.deliveredAt),
  ]
);

// Outgoing integrations relations
export const outgoingIntegrationsRelations = relations(
  outgoingIntegrations,
  ({ one, many }) => ({
    user: one(users, {
      fields: [outgoingIntegrations.userId],
      references: [users.id],
    }),
    team: one(teams, {
      fields: [outgoingIntegrations.teamId],
      references: [teams.id],
    }),
    logs: many(integrationDeliveryLogs),
  })
);

export const integrationDeliveryLogsRelations = relations(
  integrationDeliveryLogs,
  ({ one }) => ({
    integration: one(outgoingIntegrations, {
      fields: [integrationDeliveryLogs.integrationId],
      references: [outgoingIntegrations.id],
    }),
  })
);

// Template marketplace relations
export const templateVersionsRelations = relations(templateVersions, ({ one }) => ({
  template: one(promptTemplates, {
    fields: [templateVersions.templateId],
    references: [promptTemplates.id],
  }),
}));

export const templateMarketplaceRelations = relations(templateMarketplace, ({ one, many }) => ({
  template: one(promptTemplates, {
    fields: [templateMarketplace.templateId],
    references: [promptTemplates.id],
  }),
  user: one(users, {
    fields: [templateMarketplace.userId],
    references: [users.id],
  }),
  ratings: many(templateRatings),
}));

export const templateRatingsRelations = relations(templateRatings, ({ one }) => ({
  template: one(promptTemplates, {
    fields: [templateRatings.templateId],
    references: [promptTemplates.id],
  }),
  user: one(users, {
    fields: [templateRatings.userId],
    references: [users.id],
  }),
}));

// Slack webhook relations
export const slackWebhooksRelations = relations(slackWebhooks, ({ one }) => ({
  user: one(users, {
    fields: [slackWebhooks.userId],
    references: [users.id],
  }),
  team: one(teams, {
    fields: [slackWebhooks.teamId],
    references: [teams.id],
  }),
}));

// Alert rules relations
export const alertRulesRelations = relations(alertRules, ({ one, many }) => ({
  user: one(users, {
    fields: [alertRules.userId],
    references: [users.id],
  }),
  team: one(teams, {
    fields: [alertRules.teamId],
    references: [teams.id],
  }),
  notifications: many(alertNotifications),
}));

// Alert notifications relations
export const alertNotificationsRelations = relations(alertNotifications, ({ one }) => ({
  rule: one(alertRules, {
    fields: [alertNotifications.alertRuleId],
    references: [alertRules.id],
  }),
  user: one(users, {
    fields: [alertNotifications.userId],
    references: [users.id],
  }),
}));

// Type exports
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type AllowedEmail = typeof allowedEmails.$inferSelect;
export type NewAllowedEmail = typeof allowedEmails.$inferInsert;
export type Prompt = typeof prompts.$inferSelect;
export type NewPrompt = typeof prompts.$inferInsert;
export type Tag = typeof tags.$inferSelect;
export type NewTag = typeof tags.$inferInsert;
export type PromptTag = typeof promptTags.$inferSelect;
export type AnalyticsDaily = typeof analyticsDaily.$inferSelect;
export type AiInsight = typeof aiInsights.$inferSelect;
export type NewAiInsight = typeof aiInsights.$inferInsert;
export type Webhook = typeof webhooks.$inferSelect;
export type NewWebhook = typeof webhooks.$inferInsert;
export type WebhookLog = typeof webhookLogs.$inferSelect;
export type PromptTemplate = typeof promptTemplates.$inferSelect;
export type NewPromptTemplate = typeof promptTemplates.$inferInsert;
export type SharedPrompt = typeof sharedPrompts.$inferSelect;
export type NewSharedPrompt = typeof sharedPrompts.$inferInsert;
export type SharedSession = typeof sharedSessions.$inferSelect;
export type NewSharedSession = typeof sharedSessions.$inferInsert;
export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;
export type NewPasswordResetToken = typeof passwordResetTokens.$inferInsert;
export type FavoriteSession = typeof favoriteSessions.$inferSelect;
export type NewFavoriteSession = typeof favoriteSessions.$inferInsert;
export type SessionNote = typeof sessionNotes.$inferSelect;
export type NewSessionNote = typeof sessionNotes.$inferInsert;
export type FavoritePrompt = typeof favoritePrompts.$inferSelect;
export type NewFavoritePrompt = typeof favoritePrompts.$inferInsert;
export type PromptVersion = typeof promptVersions.$inferSelect;
export type NewPromptVersion = typeof promptVersions.$inferInsert;
export type SlackWebhook = typeof slackWebhooks.$inferSelect;
export type NewSlackWebhook = typeof slackWebhooks.$inferInsert;
export type PromptShare = typeof promptShares.$inferSelect;
export type NewPromptShare = typeof promptShares.$inferInsert;
export type OutgoingIntegration = typeof outgoingIntegrations.$inferSelect;
export type NewOutgoingIntegration = typeof outgoingIntegrations.$inferInsert;
export type IntegrationDeliveryLog = typeof integrationDeliveryLogs.$inferSelect;
export type NewIntegrationDeliveryLog = typeof integrationDeliveryLogs.$inferInsert;
export type TemplateVersion = typeof templateVersions.$inferSelect;
export type NewTemplateVersion = typeof templateVersions.$inferInsert;
export type TemplateMarketplace = typeof templateMarketplace.$inferSelect;
export type NewTemplateMarketplace = typeof templateMarketplace.$inferInsert;
export type TemplateRating = typeof templateRatings.$inferSelect;
export type NewTemplateRating = typeof templateRatings.$inferInsert;
export type AlertRule = typeof alertRules.$inferSelect;
export type NewAlertRule = typeof alertRules.$inferInsert;
export type AlertNotification = typeof alertNotifications.$inferSelect;
export type NewAlertNotification = typeof alertNotifications.$inferInsert;
export type PromptPermission = typeof promptPermissions.$inferSelect;
export type NewPromptPermission = typeof promptPermissions.$inferInsert;
export type TeamSetting = typeof teamSettings.$inferSelect;
export type NewTeamSetting = typeof teamSettings.$inferInsert;
export type PromptExperiment = typeof promptExperiments.$inferSelect;
export type NewPromptExperiment = typeof promptExperiments.$inferInsert;
export type ExperimentResult = typeof experimentResults.$inferSelect;
export type NewExperimentResult = typeof experimentResults.$inferInsert;
