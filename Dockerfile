# Build stage
FROM registry.jiun.dev/library/node:22-alpine AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY . .

# Build the application (skip env validation - env vars are runtime only)
ENV SKIP_ENV_VALIDATION=true
RUN pnpm build

# Bundle the BullMQ worker into a single self-contained file (dist/worker.cjs).
RUN pnpm build:worker

# Stage the migration driver's pnpm-versioned path at a stable location for
# the production image. This avoids hard-coding a package-store version.
RUN mkdir -p /tmp/migration-node-modules && \
    cp -R node_modules/.pnpm/postgres@*/node_modules/postgres /tmp/migration-node-modules/postgres

# Production stage
FROM registry.jiun.dev/library/node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy built files
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Copy migration files, migrate script, and entrypoint
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/scripts/migrate.js ./migrate.js
COPY --from=builder /app/scripts/docker-entrypoint.sh ./docker-entrypoint.sh

# Copy the self-contained worker bundle. The same image runs either the web
# server (default entrypoint) or the worker (entrypoint overridden to
# `node dist/worker.cjs` in compose / k8s).
COPY --from=builder /app/dist ./dist

# Copy postgres driver from builder (needed for migration script)
COPY --from=builder /tmp/migration-node-modules/postgres ./node_modules/postgres

RUN chmod +x ./docker-entrypoint.sh && \
    chown -R nextjs:nodejs /app

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

ENTRYPOINT ["./docker-entrypoint.sh"]
