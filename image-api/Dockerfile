FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runner

WORKDIR /app

RUN addgroup --system --gid 1001 appuser \
    && adduser --system --uid 1001 --ingroup appuser appuser

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts \
    && npm cache clean --force

# Install CLI tools needed for migration and seeding
RUN npm install -g prisma tsx

# Install smbclient for SMB connection testing and browsing
# Install postgresql-client for pg_dump backup
# Install ffmpeg for clip export (stream copy, no re-encode)
RUN apk add --no-cache samba-client postgresql16-client ffmpeg

COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY docker-entrypoint.sh /app/docker-entrypoint.sh

RUN mkdir -p /app/incident-attachments /app/backups /data/images \
    && chmod +x /app/docker-entrypoint.sh \
    && chown -R appuser:appuser /app /data/images

USER appuser

EXPOSE 3001

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3001

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3001/api/v1/health/live || exit 1

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["start"]
