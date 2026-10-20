# remuse: the API serves the web app, /rpc and /live. Browsers run in the auto-browser pool
# (compose.browsers.yaml). Secrets are mounted files, never baked in.

FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY protocol/package.json protocol/
COPY core/package.json core/
COPY demo/package.json demo/
COPY pi/package.json pi/
COPY composio/package.json composio/
COPY browser/package.json browser/
COPY api/package.json api/
COPY web/package.json web/
RUN npm ci --no-audit --no-fund

FROM deps AS web
COPY . .
RUN cd web && VITE_REMUSE_MODE=same-origin npx vite build --logLevel warn

FROM deps AS runtime-deps
RUN npm ci --omit=dev --workspace api --no-audit --no-fund

FROM node:24-bookworm-slim
WORKDIR /app
COPY --from=runtime-deps /app/node_modules node_modules
COPY --from=deps /app/package.json /app/tsconfig.base.json ./
COPY protocol protocol
COPY core core
COPY demo demo
COPY pi pi
COPY composio composio
COPY browser browser
COPY api api
COPY --from=web /app/web/dist web/dist
RUN mkdir -p /data && chown node:node /data
USER node
ENV REMUSE_HOST=0.0.0.0 \
    REMUSE_PORT=8080 \
    REMUSE_WEB=/app/web/dist \
    REMUSE_JOURNAL=/data/events.jsonl
EXPOSE 8080
VOLUME /data
CMD ["node", "api/src/main.ts"]
