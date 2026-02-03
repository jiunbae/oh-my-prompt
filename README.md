# Prompt Analytics Dashboard

A dashboard for viewing and analyzing Claude Code prompts stored in MinIO.

## Features

- Browse and search Claude Code prompts
- Analytics with daily activity charts, token counts, and project breakdowns
- Filter by project, prompt type, and date range
- Password-protected access
- Real-time sync from MinIO storage

## Tech Stack

- **Frontend**: Next.js 16 (App Router), React, Tailwind CSS
- **Database**: PostgreSQL with Drizzle ORM
- **Storage**: MinIO (S3-compatible object storage)
- **Deployment**: Kubernetes, ArgoCD (GitOps)

## Quick Start

### Prerequisites

- Node.js 22+
- pnpm
- Docker (for local PostgreSQL)

### Local Development

1. Clone the repository:
```bash
git clone https://github.com/your-username/prompt-analyzer.git
cd prompt-analyzer
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
docker-compose up -d postgres
```

5. Run database migrations:
```bash
pnpm db:push
```

6. Start the development server:
```bash
pnpm dev
```

7. Open http://localhost:3000

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_URL` | PostgreSQL connection string | Yes |
| `MINIO_ENDPOINT` | MinIO server endpoint | Yes |
| `MINIO_ACCESS_KEY` | MinIO access key | Yes |
| `MINIO_SECRET_KEY` | MinIO secret key | Yes |
| `MINIO_BUCKET` | MinIO bucket name | Yes |
| `MINIO_USE_SSL` | Use SSL for MinIO connection | No (default: true) |
| `AUTH_PASSWORD` | Dashboard access password | Yes |

## Project Structure

```
src/
├── app/                    # Next.js App Router pages
│   ├── (dashboard)/       # Protected dashboard routes
│   │   ├── analytics/     # Analytics page
│   │   ├── prompts/       # Prompts list and detail
│   │   └── settings/      # Settings page
│   ├── api/               # API routes
│   └── login/             # Login page
├── components/            # React components
├── db/                    # Database schema
├── lib/                   # Utility libraries
└── services/             # Business logic (sync, etc.)
```

## Deployment

### Kubernetes (GitOps)

The app is deployed via ArgoCD. Configuration is managed in the IaC repository.

1. Build and push Docker image:
```bash
docker build -t registry.example.com/prompt-analyzer:latest .
docker push registry.example.com/prompt-analyzer:latest
```

2. Update image tag in IaC repo:
```bash
cd ~/workspace/IaC/kubernetes/apps/prompt-analyzer
# Update newTag in kustomization.yaml
git commit -am "chore: update image tag"
git push
```

3. ArgoCD will automatically sync the deployment.

### Manual Deployment

```bash
# Build
pnpm build

# Start
NODE_ENV=production node .next/standalone/server.js
```

## Security Notes

- All routes except `/login` require authentication
- Cookies are set with `httpOnly`, `secure` (production), and `sameSite: lax`
- Database queries use parameterized statements (Drizzle ORM)
- Container runs as non-root user
- Secrets are managed via Kubernetes Secrets (not in git)

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth/login` | POST | Authenticate with password |
| `/api/sync` | POST | Trigger MinIO sync |

## License

Private - Internal use only
