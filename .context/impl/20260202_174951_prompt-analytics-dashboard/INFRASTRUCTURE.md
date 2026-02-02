# Prompt Analytics Dashboard - Self-Hosted Infrastructure

## Overview

Self-hosted deployment using Docker Compose on a VPS or home server. Designed for personal use with minimal resource requirements.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Reverse Proxy (Caddy)                     │
│                 prompts.example.com (HTTPS)                     │
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────┼────────────────────────────────────┐
│                Docker Compose Network                        │
│  ┌──────────────────┐  │  ┌──────────────────────────────┐  │
│  │                  │  │  │                              │  │
│  │   Next.js App    │◄─┴─►│       PostgreSQL 16          │  │
│  │    (Node.js)     │     │    + pg_trgm extension       │  │
│  │                  │     │                              │  │
│  └──────────────────┘     └──────────────────────────────┘  │
│           │                                                  │
│           │               ┌──────────────────────────────┐  │
│           │               │                              │  │
│           └──────────────►│      Redis (optional)        │  │
│                           │        (cache)               │  │
│                           │                              │  │
│                           └──────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
                         │
                         ▼
            ┌──────────────────────────┐
            │   MinIO (minio.example.com) │
            │      (existing)          │
            └──────────────────────────┘
```

---

## Docker Compose

```yaml
# docker-compose.yml
version: '3.8'

services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: prompt-dashboard
    restart: unless-stopped
    ports:
      - "3100:3000"
    environment:
      - DATABASE_URL=postgresql://prompt:${DB_PASSWORD}@db:5432/prompts
      - MINIO_ENDPOINT=minio.example.com
      - MINIO_ACCESS_KEY=${MINIO_ACCESS_KEY}
      - MINIO_SECRET_KEY=${MINIO_SECRET_KEY}
      - MINIO_BUCKET=claude-prompts
      - AUTH_SECRET=${AUTH_SECRET}
      - AUTH_PASSWORD=${AUTH_PASSWORD}
      - NODE_ENV=production
    depends_on:
      db:
        condition: service_healthy
    networks:
      - prompt-network

  db:
    image: postgres:16-alpine
    container_name: prompt-db
    restart: unless-stopped
    environment:
      - POSTGRES_USER=prompt
      - POSTGRES_PASSWORD=${DB_PASSWORD}
      - POSTGRES_DB=prompts
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./init.sql:/docker-entrypoint-initdb.d/init.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U prompt -d prompts"]
      interval: 5s
      timeout: 5s
      retries: 5
    networks:
      - prompt-network

  # Optional: Redis for caching (Phase 2)
  # redis:
  #   image: redis:7-alpine
  #   container_name: prompt-redis
  #   restart: unless-stopped
  #   volumes:
  #     - redis_data:/data
  #   networks:
  #     - prompt-network

volumes:
  postgres_data:
  # redis_data:

networks:
  prompt-network:
    driver: bridge
```

---

## Dockerfile

```dockerfile
# Dockerfile
FROM node:20-alpine AS base

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN corepack enable pnpm && pnpm install --frozen-lockfile

# Build the application
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable pnpm && pnpm run build

# Production image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
```

---

## Environment Variables

```bash
# .env.production
# Database
DB_PASSWORD=your_secure_password_here

# MinIO
MINIO_ACCESS_KEY=admin
MINIO_SECRET_KEY=your_minio_password

# Auth
AUTH_SECRET=generate_with_openssl_rand_base64_32
AUTH_PASSWORD=your_dashboard_password

# Optional
# REDIS_URL=redis://redis:6379
```

---

## Caddy Configuration

```caddyfile
# /etc/caddy/Caddyfile

prompts.example.com {
    reverse_proxy localhost:3100

    encode gzip

    header {
        X-Content-Type-Options nosniff
        X-Frame-Options DENY
        Referrer-Policy strict-origin-when-cross-origin
    }

    log {
        output file /var/log/caddy/prompts.log
    }
}
```

---

## Database Initialization

```sql
-- init.sql
-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create prompts table (see DATA_SCHEMA.md for full schema)
-- This will be handled by Drizzle migrations in the app
```

---

## Deployment Commands

### Initial Setup
```bash
# Clone repository
git clone https://github.com/your-username/prompt-dashboard.git
cd prompt-dashboard

# Create environment file
cp .env.example .env.production
# Edit .env.production with your values

# Start services
docker compose up -d

# Run database migrations
docker compose exec app pnpm db:migrate

# Initial sync from MinIO
docker compose exec app pnpm sync:full
```

### Updates
```bash
# Pull latest changes
git pull origin main

# Rebuild and restart
docker compose build app
docker compose up -d app

# Run any new migrations
docker compose exec app pnpm db:migrate
```

### Backup
```bash
# Database backup
docker compose exec db pg_dump -U prompt prompts > backup_$(date +%Y%m%d).sql

# Restore
cat backup_20260202.sql | docker compose exec -T db psql -U prompt prompts
```

---

## Resource Requirements

### Minimum
- CPU: 1 vCPU
- RAM: 1 GB
- Storage: 5 GB

### Recommended
- CPU: 2 vCPU
- RAM: 2 GB
- Storage: 10 GB

---

## Monitoring (Optional)

### Health Check Endpoint
```typescript
// app/api/health/route.ts
export async function GET() {
  try {
    // Check database connection
    await db.execute(sql`SELECT 1`);

    return Response.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version
    });
  } catch (error) {
    return Response.json(
      { status: 'unhealthy', error: String(error) },
      { status: 503 }
    );
  }
}
```

### Docker Health Check
```yaml
# In docker-compose.yml
app:
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:3000/api/health"]
    interval: 30s
    timeout: 10s
    retries: 3
    start_period: 40s
```

---

## Security Checklist

- [ ] Strong passwords in `.env.production`
- [ ] `.env.production` not in git (use `.gitignore`)
- [ ] Firewall: only expose ports 80/443
- [ ] Regular backups configured
- [ ] Caddy auto-HTTPS enabled
- [ ] Rate limiting in Next.js middleware
