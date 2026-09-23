FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY LICENSE ./LICENSE
COPY src ./src
COPY migrations ./migrations
# Static bundles the server serves at runtime: dashboard, marketing pages,
# and every storefront theme (compiled css only — node_modules excluded
# via .dockerignore). Without these the image boots an API with no UI.
COPY admin ./admin
COPY public ./public
COPY themes ./themes

RUN mkdir -p /app/data/media && adduser -D -u 1001 appuser && chown -R appuser:root /app
USER appuser

COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://localhost:3000/api/health || exit 1

EXPOSE 3000
CMD ["./docker-entrypoint.sh"]
