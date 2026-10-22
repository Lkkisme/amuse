# Sandbox for a Windows-hosted Amuse server

`compose.sandbox.windows.yaml` runs only the Linux sandbox and its network owner;
it does not launch or replace the Windows Amuse/Paseo/Codex server, model service,
browser, or any other Docker project. It needs Docker Desktop's Linux engine.

From the repository root, set an explicit absolute workspace path and create its
mount points before starting. For a first verification use an independent folder:

```powershell
$env:AMUSE_WORKSPACE = (Join-Path (Get-Location) '.local/verification/sandbox-workspace').Replace('\', '/')
New-Item -ItemType Directory -Force -Path $env:AMUSE_WORKSPACE | Out-Null
foreach ($folder in @('memory', 'user', 'skills')) {
    New-Item -ItemType Directory -Force -Path (Join-Path $env:AMUSE_WORKSPACE $folder) | Out-Null
}
docker compose -f compose.sandbox.windows.yaml up -d --build
```

The default project is `amuse-qwen`. The daemon is published **only** at
`http://127.0.0.1:7088`. An already-running Windows server can use
`AMUSE_SANDBOX_URL=http://127.0.0.1:7088` and
`AMUSE_SANDBOX_SUBNET=10.231.249.0/24` when it next starts naturally. This compose
file does not change the server's process, environment, model, or active tasks.

Only the selected workspace is shared. `memory/` and `user/` are overmounted
read-only; `skills/` is writable and also mounted at `/home/amuse/.agents/skills`.
The user's home persists in a project-scoped Docker volume. No host home, model
folder, credentials, environment file, Docker socket or whole Windows drive is
mounted. The init container only creates and owns these workspace mount points.

The upstream isolation remains in place: the sandbox has no `NET_ADMIN`, uses a
separate network namespace owned by `sandbox-net`, and starts nothing until the
network owner's read-only ready mark matches its network. Only the network owner
can install its public-internet-only egress rules. Host, LAN, VPN, Docker-private,
metadata and other private addresses are refused, including from `sudo` commands.
The network owner is read-only and has `no-new-privileges`; the sandbox keeps only
the upstream capabilities needed for its user, sudo, cleanup and package installs.

Defaults can be overridden explicitly before starting:

| Variable | Default |
| --- | --- |
| `AMUSE_SANDBOX_IMAGE` | `amuse-sandbox-local:20261021` |
| `AMUSE_SANDBOX_PORT` | `7088`, bound to loopback only |
| `AMUSE_SANDBOX_SUBNET` | `10.231.249.0/24` |
| `AMUSE_SANDBOX_CPUS` | `1` |
| `AMUSE_SANDBOX_MEMORY` | `768m`, with no additional swap |
| `AMUSE_SANDBOX_PIDS` | `256` |

Check existing Docker networks before changing the subnet; it must not overlap
another network. IPv6 egress stays refused unless the upstream
`AMUSE_SANDBOX_IPV6` option is explicitly enabled. No WSL or model settings are
modified by this configuration.

```powershell
docker compose -f compose.sandbox.windows.yaml ps
Invoke-RestMethod http://127.0.0.1:7088/health
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:7088/run `
    -ContentType application/json -Body '{"command":"id && pwd","timeout":10}'
```

The daemon's HTTP and terminal WebSocket control endpoints deliberately refuse
browser `Origin` requests. The Amuse server proxies authenticated terminal access;
never expose port 7088 on a LAN/Tailscale/public listener to bypass that server.
Preview routes are limited to loopback services inside the sandbox; they cannot
target the control port.

When recreating the network owner, recreate the sandbox with it:

```powershell
docker compose -f compose.sandbox.windows.yaml up -d --force-recreate sandbox-net sandbox
```

Use the same explicit `AMUSE_WORKSPACE` value for all commands. Stopping this
project with `docker compose -f compose.sandbox.windows.yaml down` preserves its
home volume. Do not add `--volumes` when keeping home and installed tools.
