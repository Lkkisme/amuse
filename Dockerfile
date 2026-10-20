# remuse: one container — the API serves the web app, /rpc and /live, and runs
# headless Chromium for browser tasks. Secrets are mounted files, never baked in.

FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY protocol/package.json protocol/
COPY core/package.json core/
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
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
COPY --from=runtime-deps /app/node_modules node_modules
# headless only: the shell build, not full Chromium
RUN npx playwright-core install --with-deps --only-shell chromium && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/package.json /app/tsconfig.base.json ./
COPY protocol protocol
COPY core core
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
    REMUSE_JOURNAL=/data/events.jsonl \
    REMUSE_BROWSER_STATE=/data/browser-state.json \
    REMUSE_BROWSER=chromium
EXPOSE 8080
VOLUME /data
CMD ["node", "api/src/main.ts"]
