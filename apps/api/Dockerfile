FROM node:22-alpine AS base
RUN npm install -g pnpm@11
WORKDIR /app

# Install dependencies from the monorepo root so workspace hoisting works.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json ./apps/api/package.json
COPY packages/ ./packages/
RUN pnpm install --frozen-lockfile --filter @echonotes/api...

# Copy source and generate Prisma client.
COPY apps/api/ ./apps/api/
RUN pnpm --filter @echonotes/api db:generate

WORKDIR /app/apps/api
ENV NODE_ENV=production
EXPOSE 3000

# tsx is used in production for simplicity in the thesis MVP.
# For a production build, replace with: pnpm run build && node dist/server.js
CMD ["node", "--import", "tsx/esm", "src/server.ts"]
