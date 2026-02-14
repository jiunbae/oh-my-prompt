#!/bin/sh
set -e

echo "Waiting for database to be ready..."
until node -e "
  const pg = require('postgres');
  const sql = pg(process.env.DATABASE_URL);
  sql\`SELECT 1\`.then(() => { sql.end(); process.exit(0); }).catch(() => process.exit(1));
" 2>/dev/null; do
  echo "Database not ready, retrying in 2s..."
  sleep 2
done

echo "Applying database migrations..."
node /app/migrate.js

# Seed admin email into allowlist if OMP_ADMIN_EMAIL is set
if [ -n "$OMP_ADMIN_EMAIL" ]; then
  echo "Seeding admin allowlist..."
  node -e "
    const pg = require('postgres');
    const sql = pg(process.env.DATABASE_URL);
    (async () => {
      const email = process.env.OMP_ADMIN_EMAIL.toLowerCase();
      await sql\`INSERT INTO allowed_emails (email) VALUES (\${email}) ON CONFLICT (email) DO NOTHING\`;
      const [row] = await sql\`SELECT id FROM users WHERE email = \${email}\`;
      if (row) {
        await sql\`UPDATE users SET is_admin = true WHERE email = \${email} AND is_admin = false\`;
      }
      await sql.end();
      console.log('  Admin allowlist seeded: ' + email);
    })().catch(e => { console.error('  Seed warning: ' + e.message); process.exit(0); });
  "
fi

echo "Starting application..."
exec node server.js
