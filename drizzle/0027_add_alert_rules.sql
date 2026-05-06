-- Alert rules table
CREATE TABLE IF NOT EXISTS "alert_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "team_id" uuid REFERENCES "teams"("id") ON DELETE CASCADE,
  "name" varchar(255) NOT NULL,
  "description" text,
  "metric" varchar(50) NOT NULL,
  "condition" varchar(20) NOT NULL,
  "threshold" numeric(10, 2) NOT NULL,
  "comparison_period" varchar(20) DEFAULT '1_day',
  "notification_channels" text[] NOT NULL DEFAULT ARRAY['in_app'],
  "is_active" boolean DEFAULT true,
  "last_triggered_at" timestamp with time zone,
  "cooldown_minutes" integer DEFAULT 60,
  "created_at" timestamp with time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_alert_rules_user" ON "alert_rules"("user_id");
CREATE INDEX IF NOT EXISTS "idx_alert_rules_team" ON "alert_rules"("team_id");
CREATE INDEX IF NOT EXISTS "idx_alert_rules_active" ON "alert_rules"("is_active");

-- Alert notifications table
CREATE TABLE IF NOT EXISTS "alert_notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "alert_rule_id" uuid NOT NULL REFERENCES "alert_rules"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "triggered_at" timestamp with time zone DEFAULT now(),
  "metric_value" numeric(10, 2),
  "threshold" numeric(10, 2),
  "message" text,
  "channels_sent" text[],
  "acknowledged_at" timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "idx_alert_notifications_rule" ON "alert_notifications"("alert_rule_id");
CREATE INDEX IF NOT EXISTS "idx_alert_notifications_user" ON "alert_notifications"("user_id");
CREATE INDEX IF NOT EXISTS "idx_alert_notifications_ack" ON "alert_notifications"("acknowledged_at");
CREATE INDEX IF NOT EXISTS "idx_alert_notifications_triggered" ON "alert_notifications"("triggered_at");
