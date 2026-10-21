# remuse

A Muse-style personal assistant: chat with an agent that browses the web in a real Chrome you
can watch and take over (from a phone, too), and works with your apps. One instance per person,
run with Docker Compose.

<p>
  <img src="docs/screenshots/chat-phone.png" width="260" alt="Muse asks before visiting a site">
  <img src="docs/screenshots/browser-phone.png" width="260" alt="The browser Muse works in, live on a phone">
</p>

## Start

```sh
git clone git@github.com:Microwave-WYB/remuse.git && cd remuse
docker compose up -d --build  # the first build takes a while: the browser images include Chromium
```

Open `http://localhost:8080`, set a password, and add an API key for a model provider in
Settings › Models (any provider [Pi](https://github.com/earendil-works/pi) supports). From there,
Muse walks you through the rest, such as connecting your apps.

Run remuse where only you can reach it (your machine, your tailnet), and set the password right
away: the first visit sets it.

## Other devices

remuse listens on `127.0.0.1:8080` only. To reach it from your phone over
[Tailscale](https://tailscale.com), either:

- listen on your Tailscale IP: in `.env`, `REMUSE_PUBLISH_HOST=100.x.y.z` and
  `REMUSE_PUBLIC_URL=http://100.x.y.z:8080` (plain http; Tailscale encrypts the link), or
- serve it over https: `tailscale serve --bg 8080`, and `REMUSE_PUBLIC_URL=https://my-pc.my-tailnet.ts.net`.
  Pasting from the phone's clipboard into the browser you take over needs https.

Then `docker compose up -d`.

## Good to know

- Your conversation, the password, your keys and saved browser logins live in Docker volumes;
  they survive restarts and updates. `docker compose down -v` deletes them.
- Update: `git pull && docker compose up -d --build`.
- Change the password, or lock a device: Settings › General. Changing it signs every other device out.
- Forgot the password: `docker compose exec remuse rm /data/access.json && docker compose restart remuse`,
  then set a new one on the next visit. Your chats and keys stay.
- Use another port: `REMUSE_PUBLISH_PORT=9000` in `.env` (and `REMUSE_PUBLIC_URL=http://localhost:9000`).

Development: [docs/development.md](docs/development.md).
