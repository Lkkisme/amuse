# remuse

A Muse-style personal assistant: chat with an agent that browses the web in a real Chrome you
can watch and take over (from a phone, too), and works with your apps. One instance per person,
run with Docker Compose.

<p>
  <img src="docs/screenshots/chat-phone.png" width="240" alt="Chat on a phone">
  <img src="docs/screenshots/browser-phone.png" width="240" alt="Taking over the browser on a phone">
</p>
<img src="docs/screenshots/chat-desktop.png" width="720" alt="Chat on a desktop">

## Start

```sh
git clone git@github.com:Microwave-WYB/remuse.git && cd remuse
cp .env.example .env          # then put your model and its API key in .env (below)
docker compose up -d --build  # the first build takes a while: the browser images include Chromium
docker compose logs remuse    # shows the link to open
```

The logs end with a line like:

```
remuse is ready. Open this link once on each device: http://localhost:8080/#token=3f9c…
```

Open that link. The device remembers it (the token leaves the address bar), so after that plain
`http://localhost:8080` is enough. On another device, open the same link once. The token is
made on first start and kept in the `remuse-data` volume; anyone with the link can use your
instance, so keep it to yourself.

## Model

In `.env`, pick a model as `provider/model-id` and give that provider's API key under its standard
name. Any provider [Pi](https://github.com/earendil-works/pi) supports works: OpenRouter, Anthropic,
OpenAI, Google Gemini, DeepSeek, xAI, Mistral, Groq, Moonshot (Kimi), Z.ai, and more.

```sh
REMUSE_PI_MODEL=openrouter/z-ai/glm-5.3-flash
OPENROUTER_API_KEY=sk-or-…
```

The browser agent uses the same model unless you set `REMUSE_PI_BROWSER_MODEL` (it may come from
another provider; add that provider's key too). The model must support tool calls. With no model
set, remuse runs a scripted demo.

Optional: `REMUSE_COMPOSIO_KEY` (a [Composio](https://composio.dev) API key) lets the agent connect
apps such as Gmail or Google Sheets.

After changing `.env`: `docker compose up -d`.

## Other devices

remuse listens on `127.0.0.1:8080` only. To reach it from your phone over
[Tailscale](https://tailscale.com), either:

- listen on your Tailscale IP: in `.env`, `REMUSE_PUBLISH_HOST=100.x.y.z` and
  `REMUSE_PUBLIC_URL=http://100.x.y.z:8080` (plain http; Tailscale encrypts the link), or
- serve it over https: `tailscale serve --bg 8080`, and `REMUSE_PUBLIC_URL=https://my-pc.my-tailnet.ts.net`.
  Pasting from the phone's clipboard into the browser you take over needs https.

Then `docker compose up -d`; the link in the logs uses that address.

## Good to know

- Your conversation, the access token, and saved browser logins live in Docker volumes; they
  survive restarts and updates. `docker compose down -v` deletes them.
- Update: `git pull && docker compose up -d --build`.
- New token (signs every device out): `docker compose exec remuse rm /data/token`, then
  `docker compose restart remuse` and open the new link from the logs.
- Use another port: `REMUSE_PUBLISH_PORT=9000` in `.env` (and `REMUSE_PUBLIC_URL=http://localhost:9000`).

Development: [docs/development.md](docs/development.md).
