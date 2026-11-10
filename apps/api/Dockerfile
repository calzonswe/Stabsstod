FROM node:22-alpine
WORKDIR /app
ENV PNPM_HOME=/root/.local/share/pnpm
ENV PATH="$PNPM_HOME:$PATH"
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json drizzle.config.ts ./
COPY drizzle ./drizzle
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
RUN corepack enable && pnpm install --frozen-lockfile
EXPOSE 3000
CMD ["sh", "-c", "cd /app/apps/api && pnpm exec tsx src/migrate.ts && pnpm start"]
