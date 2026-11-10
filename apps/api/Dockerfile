FROM node:22-alpine
WORKDIR /app
ENV PNPM_HOME=/root/.local/share/pnpm
ENV PATH="$PNPM_HOME:$PATH"
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
RUN corepack enable && pnpm install --frozen-lockfile
EXPOSE 3000
CMD ["pnpm", "--filter", "@stabsstod/api", "start"]
