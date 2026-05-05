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

export const teamsRelations = relations(teams, ({ many }) => ({
  members: many(teamMembers),
  invites: many(teamInvites),
  prompts: many(prompts),
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

export const promptTemplatesRelations = relations(promptTemplates, ({ one }) => ({
  user: one(users, {
    fields: [promptTemplates.userId],
    references: [users.id],
  }),
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
