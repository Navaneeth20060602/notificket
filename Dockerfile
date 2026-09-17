# Railway builds this image with PostgreSQL, while local development keeps using
# the existing SQLite schema and database. The schema only differs by provider.
FROM node:20-bookworm-slim AS builder
WORKDIR /app

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

COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/src ./src

EXPOSE 3000
# Creates/updates the empty Railway database before the web app starts.
CMD ["sh", "-c", "npx prisma db push --schema prisma/schema.prisma --skip-generate && npm run start"]
