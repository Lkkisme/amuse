# remuse

A Muse-style personal assistant: chat with an agent that browses the web in a real Chrome you
can watch and take over (from a phone, too), and works with your apps.

<p>
  <img src="docs/screenshots/chat-phone.png" width="240" alt="Chat on a phone">
  <img src="docs/screenshots/browser-phone.png" width="240" alt="Taking over the browser on a phone">
</p>
<img src="docs/screenshots/chat-desktop.png" width="720" alt="Chat on a desktop">

## Run

```sh
git clone git@github.com:Microwave-WYB/remuse.git && cd remuse
cp .env.example .env    # set REMUSE_TOKEN (openssl rand -hex 24), and a model and its API key
docker compose up -d --build
```

Open `http://localhost:8080/#token=<REMUSE_TOKEN>` once per device. Without a model key it runs a
scripted demo. The first build takes a while (the browser images include Chromium).
To reach it from other devices, put `tailscale serve` or a reverse proxy in front of port 8080.

Development: [docs/development.md](docs/development.md).
