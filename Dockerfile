# Railway builds this image with PostgreSQL, while local development keeps using
# the existing SQLite schema and database. The schema only differs by provider.
FROM node:20-bookworm-slim AS builder
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl chromium \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY . .
# Generate a PostgreSQL Prisma client inside the deployment image only.
RUN sed -i 's/provider = "sqlite"/provider = "postgresql"/' prisma/schema.prisma \
  && npx prisma generate \
  && npm run build

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV BROWSER_EXECUTABLE_PATH=/usr/bin/chromium

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl chromium \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/src ./src

EXPOSE 3000
# Creates/updates the empty Railway database and its public catalogue before
# the web app starts. The seed is idempotent and never creates user accounts.
CMD ["sh", "-c", "npx prisma db push --schema prisma/schema.prisma --skip-generate --accept-data-loss && npm run db:seed && npm run start"]
