# syntax=docker/dockerfile:1
# Stage 1: build the web app (Vite + React + Tailwind).
FROM node:22-alpine AS builder
WORKDIR /app
ENV PNPM_HOME=/root/.local/share/pnpm
ENV PATH="$PNPM_HOME:$PATH"
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web
RUN corepack enable && pnpm install --frozen-lockfile && pnpm --filter @stabsstod/web build

# Stage 2: Caddy serving the built web app and reverse-proxying the API.
FROM caddy:2 AS runner
WORKDIR /srv
COPY --from=builder /app/apps/web/dist /srv/web
COPY deploy/caddy/Caddyfile /etc/caddy/Caddyfile
EXPOSE 80 443
