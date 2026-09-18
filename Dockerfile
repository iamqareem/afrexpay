FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY src ./src
COPY migrations ./migrations
# Static bundles the server serves at runtime: dashboard, marketing pages,
# and every storefront theme (compiled css only — node_modules excluded
# via .dockerignore). Without these the image boots an API with no UI.
COPY admin ./admin
COPY public ./public
COPY themes ./themes

RUN mkdir -p /app/data/media

COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

EXPOSE 3000
CMD ["./docker-entrypoint.sh"]
