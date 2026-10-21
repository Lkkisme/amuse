# The sandbox: a machine of Amuse's own (Debian 13). It runs commands as the normal user `amuse`
# (uid 1000, as the Amuse server's `node`, so files in the shared workspace stay editable by both),
# which has passwordless sudo. The control daemon, the one process started here, is how Amuse
# works inside it. Built from the repository root: docker build -f sandbox/Dockerfile .
# Node comes from the same release as the Amuse server's image.

FROM node:24-trixie-slim AS node

FROM debian:trixie
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        build-essential ca-certificates curl git jq less procps python3 python3-pip python3-venv ripgrep sudo unzip \
    && rm -rf /var/lib/apt/lists/*
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
    && ln -s ../lib/node_modules/corepack/dist/corepack.js /usr/local/bin/corepack

RUN groupadd --gid 1000 amuse \
    && useradd --uid 1000 --gid 1000 --create-home --shell /bin/bash amuse \
    && printf '%s\n' 'amuse ALL=(ALL) NOPASSWD:ALL' 'Defaults env_keep += "DEBIAN_FRONTEND"' > /etc/sudoers.d/amuse \
    && chmod 0440 /etc/sudoers.d/amuse

# the daemon, with its one dependency (npm ci for this workspace alone, from the repository's lockfile)
WORKDIR /opt/amuse
COPY package.json package-lock.json ./
COPY sandbox/package.json sandbox/
RUN npm ci --omit=dev --workspace sandbox --no-audit --no-fund
COPY sandbox sandbox

# the daemon runs as root, to be able to stop and clean up after what it starts; every command it runs is the
# user's (amuse, uid 1000), with this environment. User-level installs land in the home folder (a volume of its
# own), where they stay; pip's system-wide refusal (PEP 668) is for machines that matter, and this one is Amuse's.
ENV PATH=/home/amuse/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    NPM_CONFIG_PREFIX=/home/amuse/.local \
    PIP_BREAK_SYSTEM_PACKAGES=1 \
    DEBIAN_FRONTEND=noninteractive \
    AMUSE_SANDBOX_CONTAINER=1
EXPOSE 7070
CMD ["node", "/opt/amuse/sandbox/src/main.ts"]
