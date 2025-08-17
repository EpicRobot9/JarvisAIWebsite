# Production deployment (Hostinger VPS + Cloudflare)

This guide shows how to deploy on a Hostinger VPS with Docker without interrupting any existing containers and serve the site at your Cloudflare domain.

- Domain: techexplore.us
- OS: Ubuntu 24.04

There are two safe patterns. Pick one:
- Option A (recommended – zero conflicts): Cloudflare Tunnel terminates HTTPS at Cloudflare and forwards to the `frontend` container over an outbound tunnel. No host ports; other apps keep running.
- Option B: Use an existing reverse proxy (Nginx/Traefik) that already owns ports 80/443 and add a new vhost for techexplore.us.

## 0) Prereqs

- Docker Engine and Docker Compose plugin on the VPS.
- A Cloudflare account with the `techexplore.us` zone. Cloudflare proxy enabled (orange cloud).
- Strong secrets prepared (see `docs/ENV.md`).

## 1) Clone and configure

SSH to the VPS and set up the project directory (example: `/opt/jarvis`):

```
sudo mkdir -p /opt/jarvis
sudo chown $USER:$USER /opt/jarvis
cd /opt/jarvis
# clone your repo here
```

Create the production `.env` at the repo root:

```
DATABASE_URL=postgresql://postgres:postgres@db:5432/jarvis
SESSION_SECRET=change-me-very-strong
BACKEND_PORT=8080
FRONTEND_ORIGIN=https://techexplore.us
OPENAI_API_KEY=
ELEVENLABS_API_KEY=
REQUIRE_ADMIN_APPROVAL=false
LOCK_NEW_ACCOUNTS=false
ADMIN_EMAILS=admin@example.com
SEED_DB=true
VITE_WEBHOOK_URL=
VITE_WEBHOOK_TEST_URL=
VITE_CALLBACK_URL=/api/jarvis/callback
VITE_SOURCE_NAME=jarvis-portal
INTEGRATION_PUSH_TOKEN=generate-a-long-random-token
```

Notes
- Set `FRONTEND_ORIGIN` to your final HTTPS origin so cookies/CORS line up.
- After the first bootstrapped admin login, set `SEED_DB=false`.

## 2) Start the app without binding host ports

To avoid conflicts with existing apps, use the production override which clears host port bindings for Postgres and the frontend:

```
docker compose -p techexplore \
  -f docker-compose.yml \
  -f docker-compose.prod.yml \
  up -d --build
```

- The stack runs on an internal Docker network only. No host port usage.

Shortcut (one-liner) installer

If you prefer an Interstellar‑style single command that does most of the work for you, you can run the installer script directly from GitHub. It will clone the repo (to `/opt/jarvis` by default) and run the deploy script while preserving your existing `.env` (or creating a minimal one if missing). It only changes `FRONTEND_ORIGIN` when you pass `--domain`.

```
bash <(curl -fsSL https://raw.githubusercontent.com/EpicRobot9/JarvisAIWebsite/main/scripts/install.sh) \
  --domain techexplore.us \
  --token eyJhIjoiZDAxM2JiODRiMTZiMGZiNWIyNTY5YTk5ZDUwNmFlMzUiLCJ0IjoiYmIyZTg5NjItOTI3Zi00MjVmLTg4NDYtMmVmMjM4Yzg1OGE3IiwicyI6Ik56TXpZelkzWlRZdE1UbGtaUzAwTmpBeExXRXhNR0V0TW1FME1qVTBZVEEwWm1NeSJ9
```

Note:
- Replace `<CLOUDFLARE_TUNNEL_TOKEN>` with your real token and remove the angle brackets. Quotes are recommended in case the token contains special characters.
- Do not paste the triple backticks (```) into your terminal—they’re only for formatting in this document.

Example (with a fake token shown):

```
bash <(curl -fsSL https://raw.githubusercontent.com/EpicRobot9/JarvisAIWebsite/main/scripts/install.sh) \
  --domain techexplore.us \
  --token 'eyJhIjoi...long-token...'
```

You can also use the local deploy helper after cloning:

```
./scripts/deploy.sh --domain techexplore.us --token <CLOUDFLARE_TUNNEL_TOKEN>
```

## 3A) Publish with Cloudflare Tunnel (recommended)

This method does not expose any ports on the VPS and won’t affect other containers.

1) In Cloudflare Dashboard → Zero Trust → Tunnels, create a Named Tunnel (e.g., `techexplore`). Copy the token.
2) Add a Public Hostname inside that tunnel:
   - Hostname: `techexplore.us`
   - Service Type: HTTP
   - URL: `http://frontend:80`
   - Save. Cloudflare will also create a proxied DNS record automatically.

On the VPS, add the token to `.env`:

```
CLOUDFLARE_TUNNEL_TOKEN=eyJhIjoiZDAxM2JiODRiMTZiMGZiNWIyNTY5YTk5ZDUwNmFlMzUiLCJ0IjoiYmIyZTg5NjItOTI3Zi00MjVmLTg4NDYtMmVmMjM4Yzg1OGE3IiwicyI6Ik56TXpZelkzWlRZdE1UbGtaUzAwTmpBeExXRXhNR0V0TW1FME1qVTBZVEEwWm1NeSJ9
```

Start the tunnel container alongside the app:

```
docker compose -p techexplore \
  -f docker-compose.yml \
  -f docker-compose.prod.yml \
  -f docker-compose.tunnel.yml \
  up -d --build
```

What this does
- `cloudflared` makes an outbound connection to Cloudflare.
- Cloudflare serves HTTPS for `techexplore.us` and forwards traffic to `http://frontend:80` over the tunnel.

Note on cloudflared image tag:
- The compose file defaults to `cloudflare/cloudflared:latest` via the `CLOUDFLARED_IMAGE` env var.
- If you see “manifest for cloudflare/cloudflared:<tag> not found”, set a known-good tag explicitly, e.g.:

  CLOUDFLARED_IMAGE=cloudflare/cloudflared:2024.11.0

  Put this in `.env` on the server before running the deploy/update script, or export it in your shell.
- No host-level port 80/443 usage, so no conflicts with other apps.

## 3B) Publish behind an existing reverse proxy

If you already have Nginx/Traefik on the host:
- Keep the app running with `docker-compose.prod.yml` (no host ports).
- Add a new site in your proxy for `techexplore.us` that proxies to the `frontend` container on port 80.

Nginx (host-level) minimal example:

# Production deployment (Hostinger VPS + Cloudflare)

Follow these steps in order to deploy on a Hostinger VPS with Docker—without interrupting existing containers—and serve the site at your Cloudflare domain techexplore.us.

## 1) Prerequisites

- A Hostinger VPS (Ubuntu 24.04) with Docker Engine and Docker Compose plugin installed.
- A Cloudflare account with the `techexplore.us` zone added and proxy enabled (orange cloud).
- Strong secrets prepared (see `docs/ENV.md`).

## 2) Get a Cloudflare Tunnel token (recommended path)

Using Cloudflare Dashboard:
1. Go to Zero Trust → Networks → Tunnels → Create tunnel.
2. Choose Connector: Docker (Cloudflared). A command appears like:
   `docker run cloudflare/cloudflared:latest tunnel --no-autoupdate run --token <VERY_LONG_TOKEN>`
3. Copy the string after `--token`. That is your `CLOUDFLARE_TUNNEL_TOKEN`.

You’ll add the Public Hostname in step 6.

## 3) Deploy the app (single command)

The easiest path runs everything for you and keeps your `.env` intact (it only sets `FRONTEND_ORIGIN` if you pass `--domain`). On your VPS:

```
bash <(curl -fsSL https://raw.githubusercontent.com/EpicRobot9/JarvisAIWebsite/main/scripts/install.sh) \
  --domain techexplore.us \
  --token <CLOUDFLARE_TUNNEL_TOKEN>
```

What it does:
- Clones (or updates) the repo to `/opt/jarvis`.
- Brings up the stack with `docker-compose.prod.yml` so no host ports are used.
- Adds the `cloudflared` sidecar when you pass the token.

Prefer manual steps? See the Manual path at the end.

## 4) Confirm containers are healthy

Run:
```
docker compose -p techexplore ps
```
You should see `db`, `backend`, `frontend` (and `cloudflared` if token provided) in `Up` state.

## 5) Ensure env is correct (no changes except domain)

- The installer/deploy script preserves your `.env` as-is.
- If you provided `--domain techexplore.us`, it updates only `FRONTEND_ORIGIN=https://techexplore.us`.

## 6) Add the Public Hostname in Cloudflare Tunnel

In the same Tunnel you created earlier:
1. Add Public Hostname
   - Hostname: `techexplore.us`
   - Service: HTTP
   - URL: `http://frontend:80`
2. Save. Cloudflare will create the proxied DNS record automatically.

## 7) Verify the site

- Visit: https://techexplore.us
- Sign up/sign in. If approvals are required, approve the user in the admin tools.
- In DevTools → Network, requests should target `https://techexplore.us/api/...`.

## 8) Updates and maintenance

Rebuild without touching other stacks:
```
docker compose -p techexplore -f docker-compose.yml -f docker-compose.prod.yml up -d --build
# add -f docker-compose.tunnel.yml if you use the tunnel
```

From-scratch rebuild (no cache; optionally wipe DB)

If you need a truly clean rebuild (helpful when credentials or seed state is confusing):

```
# Stop and remove containers; also remove volumes (ERASES DB) and images for this stack
docker compose -p techexplore -f docker-compose.yml -f docker-compose.prod.yml down --volumes --rmi all --remove-orphans
# If using the tunnel, include its compose file in the same down command (optional)

# Prune build cache globally (optional but thorough)
docker builder prune -a -f

# Rebuild all images without cache and pull fresh bases
docker compose -p techexplore -f docker-compose.yml -f docker-compose.prod.yml build --no-cache --pull

# Start the stack
docker compose -p techexplore -f docker-compose.yml -f docker-compose.prod.yml up -d

# One-time: set a known admin password and print summary
./scripts/update.sh --admin-user admin --admin-password 'Admin123!' --admin-reset once
```

The update script prints the admin username(s) and, when in reset mode, the exact password you can use to sign in.

Logs:
```
docker compose -p techexplore logs -f backend
docker compose -p techexplore logs -f cloudflared
```

Backups:
- `db_data` is a Docker volume. Periodically run `pg_dump` or snapshot the volume.

## 9) Security hardening

- Use strong `SESSION_SECRET` and `INTEGRATION_PUSH_TOKEN`.
- Set `SEED_DB=false` after first run.
- Do not expose Postgres on the host in production.
- Prefer Cloudflare WAF and HTTPS-only.

---

### Manual path (advanced)

1) SSH and clone:
```
sudo mkdir -p /opt/jarvis && sudo chown $USER:$USER /opt/jarvis
cd /opt/jarvis
# git clone your repo here
```

2) Create `.env` (minimal example):
```
DATABASE_URL=postgresql://postgres:postgres@db:5432/jarvis
SESSION_SECRET=change-me-very-strong
BACKEND_PORT=8080
FRONTEND_ORIGIN=https://techexplore.us
OPENAI_API_KEY=
ELEVENLABS_API_KEY=
REQUIRE_ADMIN_APPROVAL=false
LOCK_NEW_ACCOUNTS=false
ADMIN_EMAILS=admin@example.com
SEED_DB=true
VITE_WEBHOOK_URL=
VITE_WEBHOOK_TEST_URL=
VITE_CALLBACK_URL=/api/jarvis/callback
VITE_SOURCE_NAME=jarvis-portal
INTEGRATION_PUSH_TOKEN=generate-a-long-random-token
```

3) Start internal-only services:
```
docker compose -p techexplore -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

4) If using Tunnel, add the token to `.env`:
```
echo "CLOUDFLARE_TUNNEL_TOKEN=<token>" >> .env
docker compose -p techexplore -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.tunnel.yml up -d --build
```

5) Alternatively (no Tunnel), publish behind an existing reverse proxy:
```
server {
  listen 80;
  server_name techexplore.us;
  location / {
    proxy_pass http://frontend:80;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```
Then enable HTTPS (Let’s Encrypt) and set Cloudflare SSL/TLS to Full (strict), with a proxied DNS A record for the VPS.

6) Verify as in step 7 above.

If you need Traefik/Caddy equivalents, open an issue and we’ll add them.
