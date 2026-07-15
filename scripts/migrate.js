const fs = require("fs");
const path = require("path");
const postgres = require("postgres");

// When adopting this runner on a database that was previously managed by
// `drizzle-kit push`/`migrate`, historical DDL can already exist without tags
// in our public tracking table. Reconcile only well-understood duplicate or
// removed-object errors, one statement per savepoint, then record the tag.
const RECONCILABLE_SCHEMA_CODES = new Set([
  "42P01", // undefined_table (historical object was already removed)
  "42P06", // duplicate_schema
  "42P07", // duplicate_table / relation / index
  "42701", // duplicate_column
  "42703", // undefined_column (historical column was already renamed/removed)
  "42710", // duplicate_object (constraint/extension/type)
  "42723", // duplicate_function
]);

async function migrate() {
  const sql = postgres(process.env.DATABASE_URL);

  // This runner is the single source of truth for local, CI, and container
  // deployments. drizzle-kit remains responsible for generating SQL only.
  await sql`
    CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      id SERIAL PRIMARY KEY,
      tag VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  const drizzleDir = path.join(process.cwd(), "drizzle");
  if (!fs.existsSync(drizzleDir)) {
    console.log("  No migrations directory found, skipping.");
    await sql.end();
    return;
  }

  const files = fs.readdirSync(drizzleDir)
    .filter(f => /^\d+.*\.sql$/.test(f))
    .sort();

  let reconcileExistingSchema;

  for (const file of files) {
    const tag = file.replace(".sql", "");

    const content = fs.readFileSync(path.join(drizzleDir, file), "utf8");
    const statements = content
      .split("--> statement-breakpoint")
      .map(s => s.trim())
      .filter(Boolean);

    // Run the whole migration file inside a single transaction and only record
    // the tag if it commits. Any error (other than a benign "already exists"
    // on the FIRST statement, meaning the migration was already applied
    // out-of-band) aborts the deploy loudly so a failed migration is NEVER
    // recorded as applied.
    try {
      const applied = await sql.begin(async (tx) => {
        // Multiple pods can start together. Serialize migration decisions and
        // re-check the tag while holding a transaction-scoped advisory lock.
        await tx`SELECT pg_advisory_xact_lock(hashtext('oh-my-prompt:migrations'))`;
        const [existing] = await tx`
          SELECT 1 FROM __drizzle_migrations WHERE tag = ${tag}
        `;
        if (existing) return false;

        if (reconcileExistingSchema === undefined) {
          const [state] = await tx`
            SELECT
              EXISTS(SELECT 1 FROM __drizzle_migrations) AS has_history,
              to_regclass('public.prompts') IS NOT NULL AS has_existing_schema
          `;
          reconcileExistingSchema = !state.has_history && state.has_existing_schema;
          if (reconcileExistingSchema) {
            console.log("  Reconciling migration history with an existing schema...");
          }
        }

        for (const stmt of statements) {
          if (!reconcileExistingSchema) {
            await tx.unsafe(stmt);
            continue;
          }

          try {
            await tx.savepoint((sp) => sp.unsafe(stmt));
          } catch (error) {
            if (!RECONCILABLE_SCHEMA_CODES.has(error.code)) throw error;
            console.log(`    Existing schema object reconciled (${error.code})`);
          }
        }
        await tx`INSERT INTO __drizzle_migrations (tag) VALUES (${tag})`;
        return true;
      });
      if (!applied) {
        console.log(`  Skipping ${file} (already applied)`);
        continue;
      }
    } catch (e) {
      const msg = e.message || String(e);
      throw new Error(`Migration ${file} failed and was NOT recorded: ${msg.slice(0, 300)}`);
    }
    console.log(`  Applied ${file}`);
  }

  const [schemaState] = await sql`
    SELECT
      to_regclass('public.users') IS NOT NULL AS has_users,
      to_regclass('public.prompts') IS NOT NULL AS has_prompts,
      to_regclass('public.team_members') IS NOT NULL AS has_team_members,
      to_regclass('public.prompt_permissions') IS NOT NULL AS has_prompt_permissions,
      to_regclass('public.outgoing_integrations') IS NOT NULL AS has_integrations,
      to_regclass('public.tool_invocations') IS NOT NULL AS has_tool_invocations,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'prompts' AND column_name = 'event_key'
      ) AS has_event_key,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'prompts' AND column_name = 'visibility'
      ) AS has_visibility,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'prompts' AND column_name = 'deleted_at'
      ) AS has_soft_delete,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'prompts' AND column_name = 'embedding'
      ) AS has_embedding,
      EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AS has_vector_extension
  `;
  const missing = Object.entries(schemaState)
    .filter(([, present]) => !present)
    .map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(`Migration history completed but schema invariants are missing: ${missing.join(', ')}`);
  }

  await sql.end();
  console.log("  Migrations complete.");
}

migrate().catch(err => {
  console.error("Migration failed:", err.message);
  process.exit(1);
});
