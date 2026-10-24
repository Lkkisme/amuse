# amuse: the API serves the web app, /rpc and /live. Browsers run in the auto-browser pool
# (compose.browsers.yaml). Secrets are mounted files, never baked in.

FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY protocol/package.json protocol/
COPY core/package.json core/
COPY db/package.json db/
COPY demo/package.json demo/
COPY pi/package.json pi/
COPY composio/package.json composio/
COPY browser/package.json browser/
COPY sandbox/package.json sandbox/
COPY api/package.json api/
COPY web/package.json web/
RUN npm ci --no-audit --no-fund

FROM deps AS web
COPY . .
RUN cd web && VITE_AMUSE_MODE=same-origin npx vite build --logLevel warn

FROM deps AS runtime-deps
RUN npm ci --omit=dev --workspace api --no-audit --no-fund

FROM node:24-bookworm-slim
WORKDIR /app
COPY --from=runtime-deps /app/node_modules node_modules
COPY --from=deps /app/package.json /app/tsconfig.base.json ./
COPY protocol protocol
COPY core core
COPY db db
COPY demo demo
COPY pi pi
COPY composio composio
COPY browser browser
COPY sandbox sandbox
COPY api api
COPY CHANGELOG.md CHANGELOG.md
COPY --from=web /app/web/dist web/dist
RUN mkdir -p /data && chown node:node /data \
 && printf '#!/bin/sh\nexec node /app/api/src/admin.ts "$@"\n' > /usr/local/bin/amuse-admin && chmod 755 /usr/local/bin/amuse-admin
USER node
ENV AMUSE_HOST=0.0.0.0 \
    AMUSE_PORT=8080 \
    AMUSE_WEB=/app/web/dist \
    AMUSE_DATA=/data \
    AMUSE_SECRETS_DIR=/secrets/amuse-store
EXPOSE 8080
VOLUME /data
CMD ["node", "api/src/main.ts"]
