# Oh My Prompt

A self-hosted prompt journal and insight dashboard that helps you see how you prompt agents and continuously improve. Currently integrates with Claude Code logs stored in MinIO.

## Features

- Prompt journal with search, filters, tags, and detail views
- Prompt review signals (goal, context, constraints, output format, examples)
- Insight dashboards with activity, token usage, and prompt quality trends
- Clear improvement suggestions based on your recent prompts
- Filter by project, prompt type, and date range
- Multi-user support with email/password authentication
- Admin-managed user allowlist
- Per-user data isolation in MinIO storage
- Real-time sync from MinIO storage

## Tech Stack

- **Frontend**: Next.js 16 (App Router), React, Tailwind CSS
- **Backend**: Next.js API Routes, tRPC
- **Database**: PostgreSQL with Drizzle ORM
- **Storage**: MinIO (S3-compatible object storage)
- **Auth**: Email/password with bcrypt, session cookies

## Quick Start

### Prerequisites

- Node.js 22+
- pnpm
- Docker (for local PostgreSQL)
- MinIO instance (or S3-compatible storage)

### Local Development

1. Clone the repository:
```bash
git clone https://github.com/your-username/oh-my-prompt.git
cd oh-my-prompt
```

2. Install dependencies:
```bash
pnpm install
```

3. Set up environment variables:
```bash
cp .env.example .env.local
# Edit .env.local with your configuration
```

4. Start PostgreSQL:
```bash
docker-compose up -d
```

5. Run database migrations:
```bash
pnpm db:push
```

6. Create initial admin user:
```bash
ADMIN_EMAIL=admin@example.com ADMIN_NAME="Admin" npx tsx scripts/migrate-to-multiuser.ts
```

7. Start the development server:
```bash
pnpm dev
```

8. Open http://localhost:3000

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_URL` | PostgreSQL connection string | Yes |
| `MINIO_ENDPOINT` | MinIO server endpoint (without protocol) | Yes |
| `MINIO_ACCESS_KEY` | MinIO access key | Yes |
| `MINIO_SECRET_KEY` | MinIO secret key | Yes |
| `MINIO_BUCKET` | MinIO bucket name | Yes |
| `MINIO_USE_SSL` | Use SSL for MinIO connection | No (default: true) |

## Project Structure

```
src/
├── app/                    # Next.js App Router pages
│   ├── (dashboard)/       # Protected dashboard routes
│   │   ├── admin/         # Admin panel (allowlist)
│   │   ├── analytics/     # Insights page
│   │   ├── prompts/       # Prompts list and detail
│   │   └── settings/      # Settings page
│   ├── api/               # API routes
│   │   ├── admin/         # Admin API (allowlist management)
│   │   ├── auth/          # Auth API (login, register, logout)
│   │   └── sync/          # MinIO sync API
│   ├── login/             # Login page
│   └── register/          # Registration page
├── components/            # React components
├── contexts/              # React contexts (user state)
├── db/                    # Database schema
├── lib/                   # Utility libraries
├── services/              # Business logic (sync, etc.)
└── middleware.ts          # Auth middleware
```

## Multi-User System

### User Flow

1. **Admin adds email to allowlist** via Admin Panel (`/admin/allowlist`)
2. **User registers** at `/register` with their allowed email
3. **User logs in** at `/login`
4. **User sees only their own data** (prompts, analytics)

### Data Isolation

Each user has a unique token that prefixes their MinIO path:
```
bucket/
  {user_token}/
    2024/
      01/
        15/
          {hash}.json
```

### Syncing Prompts

Users can sync their Claude Code prompts (current supported source) using the backup script:
```bash
USER_TOKEN=your-user-token node scripts/backup-claude-sessions.mjs
```

Or trigger sync via API:
```bash
curl -X POST https://your-domain/api/sync \
  -H "X-User-Token: your-user-token" \
  -H "Content-Type: application/json" \
  -d '{"type": "full"}'
```

## Deployment

### Docker

```bash
# Build
docker build -t oh-my-prompt:latest .

# Run
docker run -p 3000:3000 \
  -e DATABASE_URL=postgresql://user:pass@host:5432/db \
  -e MINIO_ENDPOINT=minio.example.com \
  -e MINIO_ACCESS_KEY=your-key \
  -e MINIO_SECRET_KEY=your-secret \
  -e MINIO_BUCKET=oh-my-prompt \
  oh-my-prompt:latest
```

### Kubernetes

Example manifests are provided in `k8s/`. Update the placeholder values:
- `k8s/deployment.yaml` - Container image
- `k8s/configmap.yaml` - MinIO endpoint
- `k8s/ingress.yaml` - Your domain

Create secrets for sensitive values:
```bash
kubectl create secret generic oh-my-prompt-secrets \
  --from-literal=DATABASE_URL=postgresql://... \
  --from-literal=MINIO_ACCESS_KEY=... \
  --from-literal=MINIO_SECRET_KEY=...
```

## API Endpoints

### Authentication

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth/register` | POST | Register new user (requires allowlisted email) |
| `/api/auth/login` | POST | Login with email/password |
| `/api/auth/logout` | POST | Logout (clear session) |
| `/api/auth/me` | GET | Get current user info |

### Admin

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/admin/allowlist` | GET | List allowed emails |
| `/api/admin/allowlist` | POST | Add email to allowlist |
| `/api/admin/allowlist` | DELETE | Remove email from allowlist |

### Sync

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/sync` | POST | Trigger MinIO sync (supports `X-User-Token` header) |

## Security Notes

- Passwords hashed with bcrypt (12 rounds)
- Session cookies: `httpOnly`, `secure` (production), `sameSite: lax`
- Database queries use parameterized statements (Drizzle ORM)
- User data isolated by user_id in all queries
- Container runs as non-root user
- Admin routes protected by isAdmin flag

## License

MIT
