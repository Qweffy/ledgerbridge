# Production image for the LedgerBridge API (Fastify + sync worker + reconciler).
# The API runs the workspace TypeScript directly with tsx: `node dist/` can't resolve
# @ledgerbridge/shared (consumed as raw TS), and tsx needs no separate build step.
FROM node:22-slim
WORKDIR /app

# Install with the workspace manifests first (layer cache). All manifests must be
# present so npm's workspace resolution is satisfied.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm install

# App source (node_modules / .next / .env excluded by .dockerignore).
COPY . .

ENV NODE_ENV=production
EXPOSE 3001
# Apply migrations (idempotent) then start the API + worker + reconciler. PORT is
# injected by the host; the server binds 0.0.0.0 and shuts down gracefully on SIGTERM.
CMD ["sh", "-c", "npm run db:migrate -w @ledgerbridge/api && npm run start -w @ledgerbridge/api"]
