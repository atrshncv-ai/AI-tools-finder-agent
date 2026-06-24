FROM node:20-alpine AS builder

WORKDIR /app

COPY app/package*.json ./
RUN npm ci

COPY app/ ./
RUN npm run check && npm run lint -- --quiet && npm run build

FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/db ./db
COPY --from=builder /app/drizzle.config.ts ./

EXPOSE 3000

CMD ["sh", "-c", "npx drizzle-kit migrate && npm start"]
