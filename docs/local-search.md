# Local web search

Amuse can run `web_search` through a private SearXNG instance, without a
Composio key or another model. The adapter and metasearch service run on the
computer. Public web search still requires an internet connection: SearXNG
forwards the query to the enabled search engines. It is not an offline web
index. `web_read` and the user's browser visit rules continue to apply.

The official SearXNG image is pinned to manifest
`sha256:5ed0323b5f5f8701264ef65e239a2bd83cb57098f2b971fa30bf79c06eeae271`
(2026.10.19-81371861f). Its OCI labels identify
<https://github.com/searxng/searxng> as the source. The compressed amd64 image
is about 94 MiB. The container is limited to one CPU, 384 MiB RAM, no swap
and 128 processes, with no GPU device. It runs independently of the Amuse
sandbox and Qwen. The adapter permits at most two concurrent requests.

## Prepare and start

`Start-AmuseSearch.ps1` without `-Start` only creates persistent settings and
a candidate JSON file. Existing files are preserved. The default persistent
directory is `Amuse-services/search` beside the Amuse checkout, keeping data
outside release checkouts.

```powershell
.\Start-AmuseSearch.ps1 -StateDirectory D:\LocalAI\Amuse-services\search
# After verifying the Docker management API works:
.\Start-AmuseSearch.ps1 -StateDirectory D:\LocalAI\Amuse-services\search `
  -DockerExe D:\LocalAI\DockerDesktop\resources\bin\docker.exe -Start
```

Only the separate `amuse-search` project is started. This script does not
restart Docker, Amuse, Qwen or existing containers. `127.0.0.1:8889` is the
only published address; do not expose it through Tailscale or a public
proxy. The bot limiter is disabled because only trusted local processes can
reach this service. JSON is explicitly enabled in `search.formats`.

Check a real query before activating the candidate configuration:

```powershell
$answer = Invoke-RestMethod -Method Post http://127.0.0.1:8889/search `
  -Body @{ q = '千问 官方 文档'; format = 'json'; language = 'all' }
$answer.results | Select-Object -First 8 title, url, content
```

Engines can block automated requests or time out. Several independent engines
are enabled; SearXNG can return surviving results. The adapter reports an
outage if engines fail and no usable result remains, instead of inventing a
successful empty search. Search results remain untrusted data. No query or
result body is logged by the adapter; Docker logs rotate at two 2 MiB files.

## Application wiring

The owner configuration is normally `.local/local-search.json`:

```json
{
  "provider": "searxng",
  "url": "http://127.0.0.1:8889",
  "language": "all",
  "maxResults": 8,
  "timeoutMs": 20000
}
```

`loadLocalSearchConfig(path)` returns null for a missing file and rejects
invalid files. `createLocalSearch(config)` implements Amuse's existing
`Search` port. Pass this same function to chat, scheduled work and the
shared Codex MCP configuration. A configured local service never silently
falls back to a paid provider when unavailable. `localSearchDescription`
supplies a truthful `amuse_status` description. The main entry point owns
selection between this service and an explicitly configured Composio search.

The JSON adapter uses POST, rejects redirects, restricts its endpoint to
loopback, bounds response size and result count, drops unsupported result
URLs and duplicate fragments, and strips snippet markup. These choices do
not change model selection or its context window.

Official setup and API references:

- <https://docs.searxng.org/admin/installation-docker>
- <https://docs.searxng.org/dev/search_api.html>
- <https://docs.searxng.org/admin/settings/settings.html>
