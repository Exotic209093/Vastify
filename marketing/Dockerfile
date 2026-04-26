# --- build stage ---
FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json ./
COPY bun.lockb* ./
COPY bun.lock* ./
RUN bun install --frozen-lockfile || bun install
COPY . .
ARG PUBLIC_DASHBOARD_URL
ARG PUBLIC_REPO_URL
ARG PUBLIC_CONTACT_EMAIL
ENV PUBLIC_DASHBOARD_URL=$PUBLIC_DASHBOARD_URL
ENV PUBLIC_REPO_URL=$PUBLIC_REPO_URL
ENV PUBLIC_CONTACT_EMAIL=$PUBLIC_CONTACT_EMAIL
RUN bun run build

# --- runtime stage ---
FROM caddy:2-alpine
COPY --from=build /app/dist /srv
COPY Caddyfile /etc/caddy/Caddyfile
EXPOSE 8080
ENV PORT=8080
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
