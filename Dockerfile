# Stage 1: build the React dashboard
FROM oven/bun:1-alpine AS dashboard-builder
WORKDIR /app/dashboard
COPY dashboard/package.json dashboard/bun.lock ./
RUN bun install --frozen-lockfile
COPY dashboard/ ./
# outDir is '../api/public' → builds to /app/api/public
RUN bun run build

# Stage 2: API runtime
FROM oven/bun:1-alpine
WORKDIR /app/api
COPY api/package.json api/bun.lock ./
RUN bun install --frozen-lockfile --production
COPY api/src ./src
COPY api/tsconfig.json ./
COPY --from=dashboard-builder /app/api/public ./public
EXPOSE 3000
CMD ["bun", "src/server.ts"]
