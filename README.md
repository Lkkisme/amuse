# Amuse

An open-source Muse: a personal assistant you chat with, that browses the web in a real Chrome
you can watch and take over (from a phone, too), and works with your apps. One instance per
person, run with Docker Compose.

<p>
  <img src="docs/screenshots/chat-phone.png" width="260" alt="Amuse asks before visiting a site">
  <img src="docs/screenshots/browser-phone.png" width="260" alt="The browser Amuse works in, live on a phone">
</p>
<img src="docs/screenshots/browser-desktop.png" width="720" alt="Amuse working in the browser beside the chat, on a desktop">

## Start

```sh
git clone git@github.com:Microwave-WYB/amuse.git && cd amuse
docker compose up -d --build  # the first build takes a while: the browser images include Chromium
```

Open `http://localhost:8080`, set a password, and add an API key for a model provider in
Settings › Models (any provider [Pi](https://github.com/earendil-works/pi) supports). From there,
Amuse walks you through the rest, such as connecting your apps.

Run amuse where only you can reach it (your machine, your tailnet), and set the password right
away: the first visit sets it.

## Other devices

amuse listens on `127.0.0.1:8080` only. To reach it from your phone over
[Tailscale](https://tailscale.com), either:

- listen on your Tailscale IP: in `.env`, `AMUSE_PUBLISH_HOST=100.x.y.z` and
  `AMUSE_PUBLIC_URL=http://100.x.y.z:8080` (plain http; Tailscale encrypts the link), or
- serve it over https: `tailscale serve --bg 8080`, and `AMUSE_PUBLIC_URL=https://my-pc.my-tailnet.ts.net`.
  Pasting from the phone's clipboard into the browser you take over, and the mic, need https.

Then `docker compose up -d`.

## Voice

The mic turns what you say into text with OpenAI, Groq or Fireworks (your key), or a speech
server you run yourself (any OpenAI-style `/v1/audio/transcriptions`, e.g. faster-whisper-server):
Settings › Models › Voice. Run it in Docker beside Amuse and give its service name as the address;
on the host outside Docker it is `host.docker.internal`, which a host firewall (ufw) may block for
containers. The mic needs https (see above).

## Sandbox

Amuse has a computer of its own: a Debian 13 container where it runs commands, installs software
(`sudo apt install …`, pip, npm) and runs programs and servers. It works there as a normal user
with passwordless `sudo`, on files it shares with you: your workspace (what you see in Files) is
mounted in it. Commands are not approved one by one, because the container is the boundary; what
leaves it, and deleting or overwriting the files you sent, still needs your word.

- It reaches the internet, and nothing of yours: no keys or password, no Docker socket, not
  privileged, and only the workspace of Amuse's data. The Amuse server turns away every request from
  the sandbox's network, and the browsers cannot reach it.
- Limits: 2 CPUs, 4 GB of memory and 1024 processes; change them in `.env` with
  `AMUSE_SANDBOX_CPUS`, `AMUSE_SANDBOX_MEMORY` and `AMUSE_SANDBOX_PIDS`. There is no disk limit
  (Docker has none on most setups): watch `docker system df`.
- Its home folder (what it installs for itself, its settings and caches) is a volume of its own, and
  stays across restarts. Packages installed with `apt` live in the container instead: they stay across
  restarts, and go when the container is recreated, which an update can do.
- Reset: Settings › Sandbox › Reset stops what runs there and wipes its home folder; your workspace
  is kept. For a fresh machine altogether (the image too), `docker compose up -d --force-recreate sandbox`
  (the server has no Docker socket to do it for you), then Reset.
- Turn it off: `AMUSE_SANDBOX_URL=` (empty) in `.env`, then `docker compose up -d`. Amuse then has no
  sandbox; to drop the container too, remove the `sandbox` and `sandbox-init` services, and amuse's
  `depends_on` on them, from `compose.yaml`.

## Good to know

- Your conversation, the password, your keys, saved browser logins and the sandbox's home folder live in Docker volumes;
  they survive restarts and updates. `docker compose down -v` deletes them.
- Update: `git pull && docker compose up -d --build`.
- Change the password, or lock a device: Settings › General. Changing it signs every other device out.
- Forgot the password: `docker compose exec amuse rm /data/access.json && docker compose restart amuse`,
  then set a new one on the next visit. Your chats and keys stay.
- Use another port: `AMUSE_PUBLISH_PORT=9000` in `.env` (and `AMUSE_PUBLIC_URL=http://localhost:9000`).

Development: [docs/development.md](docs/development.md).

## License

[MIT](LICENSE). Amuse is an independent project, not affiliated with Meta or its Muse.
