# The sandbox: a machine of Amuse's own (Debian 13). It runs commands as the normal user `amuse`
# (uid 1000, as the Amuse server's `node`, so files in the shared workspace stay editable by both),
# which has passwordless sudo. The control daemon, the one process started here, is how Amuse
# works inside it. Built from the repository root: docker build -f sandbox/Dockerfile .
# Node comes from the same release as the Amuse server's image.

FROM node:24-trixie-slim AS node

FROM debian:trixie
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        build-essential ca-certificates conntrack curl git iptables jq less procps python3 python3-pip python3-venv ripgrep sudo unzip \
    && rm -rf /var/lib/apt/lists/*
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
    && ln -s ../lib/node_modules/corepack/dist/corepack.js /usr/local/bin/corepack

# herdr, the terminals Amuse and the user share (the daemon keeps its server running): pinned, and checked against the
# release's digest. Its config is the image's: no first-run setup, and no version checks (an update comes with the
# image, as the skill that goes with it does: pi/skills/herdr).
ARG TARGETARCH
ARG HERDR_VERSION=0.9.5
RUN set -eu; \
    case "$TARGETARCH" in \
        amd64) arch=x86_64; herdr=14d9e8bc8b4a9e0118d77c32266f76d461f09b40342eb23752960bd89f59929d ;; \
        arm64) arch=aarch64; herdr=17d7536f2da50859523680ef279dffcac8e4a235f4e46fe8da6c2ec44141897c ;; \
        *) echo "no herdr for $TARGETARCH" >&2; exit 1 ;; \
    esac; \
    curl -fsSL -o /usr/local/bin/herdr "https://github.com/herdrdev/herdr/releases/download/v${HERDR_VERSION}/herdr-linux-${arch}"; \
    echo "$herdr  /usr/local/bin/herdr" | sha256sum -c -; \
    chmod 0755 /usr/local/bin/herdr; \
    mkdir -p /etc/herdr; \
    printf '%s\n' 'onboarding = false' '' '[update]' 'version_check = false' > /etc/herdr/config.toml
# a shell started in a terminal gets the credentials the user gave for the sandbox as they are then (commands the
# daemon runs get them from it); the file is the user's alone, kept by the daemon
RUN printf '%s\n' '' \
        '# credentials the user gave for the sandbox, through Amuse' \
        'if [ -r "$HOME/.config/amuse/secrets.json" ]; then' \
        '  eval "$(jq -r '"'"'to_entries[] | select(.key | test("^[A-Z_][A-Z0-9_]*$")) | "export \(.key)=\(.value | @sh)"'"'"' "$HOME/.config/amuse/secrets.json" 2>/dev/null)"' \
        'fi' >> /etc/bash.bashrc

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
    HERDR_CONFIG_PATH=/etc/herdr/config.toml \
    AMUSE_SANDBOX_CONTAINER=1
EXPOSE 7070
CMD ["node", "/opt/amuse/sandbox/src/main.ts"]
