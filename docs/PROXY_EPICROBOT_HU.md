# epicrobot.zapto.org -> Holy‑Unblocker reverse proxy

This repo doesn’t ship a host-level reverse proxy. In your environment, Traefik runs as a Docker container (Docker provider enabled) and owns ports 80/443. The correct integration for epicrobot.zapto.org is via Docker labels on the Holy‑Unblocker container—no host Nginx or Traefik file provider is required.

Files added
- `ops/proxy/nginx/epicrobot.zapto.org.conf` — Nginx server block with HTTP→HTTPS redirect (ACME path exempt) and an HTTPS block (commented) proxying to `http://127.0.0.1:8082`, websocket headers, timeouts, HSTS disabled by default.
Files focus
- Use Docker labels on the HU container so Traefik discovers the route and issues TLS automatically via ACME.

How to apply (Traefik via Docker labels)
1) Ensure Traefik is started with:
    - `--providers.docker=true`
    - `--providers.docker.exposedbydefault=false`
    - `--entrypoints.web.address=:80` and redirect to websecure
    - `--entrypoints.websecure.address=:443`
    - ACME resolver `mytlschallenge` using TLS-ALPN-01 with storage `/letsencrypt/acme.json`

2) Recreate Holy‑Unblocker with labels and attach to Traefik’s Docker network (keep any existing env/volume flags you use):

```
TRAEFIK_NAME=$(docker ps --format '{{.Names}}' | awk 'tolower($0) ~ /traefik/ {print $1; exit}'); \
TRAEFIK_NET=$(docker inspect "$TRAEFIK_NAME" --format '{{range $k,$v := .NetworkSettings.Networks}}{{printf "%s" $k}}{{end}}'); \
docker rm -f holy-unblocker >/dev/null 2>&1 || true; \
docker pull quiteafancyemerald/holy-unblocker:latest; \
docker run -d --name holy-unblocker --restart unless-stopped \
   --network "$TRAEFIK_NET" \
   -p 8082:8080 \
   --label 'traefik.enable=true' \
   --label 'traefik.http.routers.epicrobot.rule=Host(epicrobot.zapto.org)' \
   --label 'traefik.http.routers.epicrobot.entrypoints=websecure' \
   --label 'traefik.http.routers.epicrobot.tls=true' \
   --label 'traefik.http.routers.epicrobot.tls.certresolver=mytlschallenge' \
   --label 'traefik.http.services.epicrobot.loadbalancer.server.port=8080' \
   quiteafancyemerald/holy-unblocker:latest
```

3) Verify ACME issuance and routing:
```
docker logs -f "$TRAEFIK_NAME" | grep -iE 'epicrobot|acme|certificate'
curl -I http://epicrobot.zapto.org   # expect 308/301 to HTTPS
curl -I https://epicrobot.zapto.org  # expect 200/301/302 with valid LE cert
openssl s_client -servername epicrobot.zapto.org -connect epicrobot.zapto.org:443 </dev/null 2>/dev/null | openssl x509 -noout -issuer -subject -dates
```
1) Copy file to host and enable:
   - Ubuntu/Debian:
     - Copy to `/etc/nginx/sites-available/epicrobot.zapto.org.conf`
     - `sudo ln -s /etc/nginx/sites-available/epicrobot.zapto.org.conf /etc/nginx/sites-enabled/`
2) Validate and reload:
   - `sudo nginx -t`
   - `sudo systemctl reload nginx` (or `sudo nginx -s reload`)
3) Enable HTTPS:
   - `sudo certbot --nginx -d epicrobot.zapto.org`
   - Ensure HTTP-01 via port 80 works externally; otherwise use DNS-01 or skip TLS.
4) Test (from host):
   - `./scripts/test-epicrobot.sh`

Alternatives (if you use another proxy)
- Traefik (file provider): router Host(`epicrobot.zapto.org`), entryPoint websecure, service -> `http://127.0.0.1:8082`, tls.certResolver accordingly. See `ops/proxy/traefik/dynamic/epicrobot-hu.yml`.
- Caddy (Caddyfile): `epicrobot.zapto.org { reverse_proxy 127.0.0.1:8082; encode zstd gzip; tls admin@epicrobot.zapto.org }` (see `ops/proxy/caddy/epicrobot.zapto.org.Caddyfile`).
- Nginx Proxy Manager: Proxy Host Domain `epicrobot.zapto.org`, Forward `127.0.0.1:8082`, Websockets ON, SSL: request LE cert, Force SSL.

Notes
- This does not change any Jarvis compose files or ports. No regressions to existing routes.
- If HU runs elsewhere, adjust `proxy_pass` in the vhost accordingly.

---

## Fix self‑signed cert on epicrobot.zapto.org (Traefik Docker provider)

Context
- Domain: `epicrobot.zapto.org`
- Upstream: `http://127.0.0.1:8082` (Holy‑Unblocker healthy)
- Current issue: HTTPS is serving a self‑signed certificate → browsers/curl fail
- Goal: Issue a valid Let’s Encrypt certificate, keep other routes untouched, enable auto‑renew

Detected stack: Traefik running as a Docker container with the Docker provider. Use container labels to define the router/service and ACME resolver `mytlschallenge`. No host Nginx or file provider is needed.

1) Recreate Holy‑Unblocker with the labels shown in the “How to apply” section above. Traefik’s Docker provider will discover it and request a certificate via `mytlschallenge`.

2) Verify runtime and TLS chain:
```bash
curl -I http://epicrobot.zapto.org
curl -I https://epicrobot.zapto.org
openssl s_client -servername epicrobot.zapto.org -connect epicrobot.zapto.org:443 </dev/null 2>/dev/null | openssl x509 -noout -issuer -subject -dates
```

The file includes:
- HTTP: serves `/.well-known/acme-challenge/` for HTTP‑01; all other requests redirect to HTTPS.
- HTTPS block is present but commented. After cert issuance it will proxy to `127.0.0.1:8082` with WebSocket headers and long timeouts.

Acceptance
- HTTP returns 308/301 to HTTPS (common global redirect)
- HTTPS succeeds with a valid Let’s Encrypt chain
- Browser loads https://epicrobot.zapto.org and proxies to Holy‑Unblocker on port 8080 inside the container
- Other domains/routes remain unchanged

3) Issue a Let’s Encrypt certificate (HTTP‑01)
```bash
sudo certbot --nginx -d epicrobot.zapto.org
```
Notes:
- Ensure DNS A record points to this host and port 80 is reachable from the internet.
- If you are behind Cloudflare orange cloud and HTTP‑01 fails, temporarily turn off proxy or switch to DNS‑01.

4) Enable/confirm HTTPS proxy block with WebSockets + timeouts

If certbot injected SSL into this same vhost, ensure the HTTPS server/location includes these directives (adjust where certbot placed the block):

```
location / {
   proxy_pass http://127.0.0.1:8082;
   proxy_http_version 1.1;
   proxy_set_header Host $host;
   proxy_set_header X-Real-IP $remote_addr;
   proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
   proxy_set_header X-Forwarded-Proto $scheme;
   proxy_set_header Upgrade $http_upgrade;
   proxy_set_header Connection $connection_upgrade;
   proxy_read_timeout 3600s;
   proxy_send_timeout 3600s;
}
```

If you prefer, uncomment the provided HTTPS block in `epicrobot.zapto.org.conf` and set the cert paths that certbot created:

```
ssl_certificate /etc/letsencrypt/live/epicrobot.zapto.org/fullchain.pem;
ssl_certificate_key /etc/letsencrypt/live/epicrobot.zapto.org/privkey.pem;
```

HSTS is intentionally disabled by default. You can enable later with:
```
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
```

5) Verify and ensure auto‑renewal

Verification:
```bash
curl -I http://epicrobot.zapto.org
curl -I https://epicrobot.zapto.org
openssl s_client -servername epicrobot.zapto.org -connect epicrobot.zapto.org:443 </dev/null 2>/dev/null | openssl x509 -noout -issuer -subject -dates
```

Cert presence and renew timer:
```bash
sudo certbot certificates
sudo systemctl list-timers | grep -i certbot || true
```

Acceptance
- HTTP returns 200/301/302
- HTTPS succeeds with a valid chain (Let’s Encrypt)
- Browser loads https://epicrobot.zapto.org and proxies to Holy‑Unblocker on 127.0.0.1:8082
- Other domains/routes remain unchanged

If you are using Traefik/Caddy/NPM instead of host Nginx, see the earlier sections for their equivalents. For DNS‑01, configure the appropriate ACME DNS provider in your proxy, then issue the certificate for `epicrobot.zapto.org`.

---

## Traefik: replace default self‑signed cert with Let’s Encrypt

Symptoms
- `curl -I https://epicrobot.zapto.org` fails with `SSL certificate problem: self-signed certificate`
- `openssl s_client ... | openssl x509 -noout -issuer` shows `TRAEFIK DEFAULT CERT`

Fix
1) Create a dynamic file with a router/service for the domain.
    - Example (see `ops/proxy/traefik/dynamic/epicrobot-hu.yml`):
```
http:
   routers:
      epicrobot-hu:
         rule: Host(`epicrobot.zapto.org`)
         entryPoints: ["websecure"]
         service: hu-svc
         tls:
            certResolver: letsencrypt  # set to your resolver name in traefik.yml
   services:
      hu-svc:
         loadBalancer:
            passHostHeader: true
            serversTransport: long-timeouts
            servers:
               - url: "http://127.0.0.1:8082"

serversTransports:
   long-timeouts:
      forwardingTimeouts:
         dialTimeout: 10s
         responseHeaderTimeout: 3600s
```

2) Ensure your static Traefik config (e.g., `/etc/traefik/traefik.yml`) declares:
```
entryPoints:
   web:
      address: ":80"
   websecure:
      address: ":443"

certificatesResolvers:
   letsencrypt:
      acme:
         email: admin@epicrobot.zapto.org
         storage: /var/lib/traefik/acme.json
         httpChallenge:
            entryPoint: web
```

3) Reload Traefik and verify issuance (watch logs for ACME).

Verification
```bash
curl -I http://epicrobot.zapto.org
curl -I https://epicrobot.zapto.org
openssl s_client -servername epicrobot.zapto.org -connect epicrobot.zapto.org:443 </dev/null 2>/dev/null | openssl x509 -noout -issuer -subject -dates
```

Notes
- If behind Cloudflare orange cloud and HTTP‑01 fails, either disable proxy during issuance or switch to DNS‑01 in the `certificatesResolvers` config.
- Keep the upstream at `127.0.0.1:8082`. The router only changes TLS termination and routing.

## Add other websites/domains (general patterns)

You can add additional sites or subdomains that proxy to any internal app (Docker container or host service). Below are quick templates per proxy stack. Replace placeholders as noted.

Prereqs for any domain
- DNS: Create an A/AAAA record for `YOUR_DOMAIN` pointing to your proxy host (or set up Cloudflare Tunnel public hostname if using a tunnel).
- Upstream: Know where the target app is listening (e.g., `http://127.0.0.1:PORT` or `http://container-name:PORT`).
- TLS: Ensure your proxy can issue/renew certificates (HTTP-01 on :80 reachable from internet, or DNS-01 configured).

### Nginx (host-level) template

Create `/etc/nginx/sites-available/YOUR_DOMAIN.conf` with:

```
map $http_upgrade $connection_upgrade {
   default upgrade;
   ''      close;
}

server {
   listen 80;
   listen [::]:80;
   server_name YOUR_DOMAIN;

   # ACME HTTP-01
   location ^~ /.well-known/acme-challenge/ {
      default_type text/plain;
      root /var/www/html;
   }

   # Redirect HTTP -> HTTPS (ACME exempt)
   location / { return 301 https://$host$request_uri; }
}

# Enable after cert issuance (paths injected by certbot --nginx)
# server {
#   listen 443 ssl http2;
#   listen [::]:443 ssl http2;
#   server_name YOUR_DOMAIN;
#   ssl_certificate /etc/letsencrypt/live/YOUR_DOMAIN/fullchain.pem;
#   ssl_certificate_key /etc/letsencrypt/live/YOUR_DOMAIN/privkey.pem;
#   include /etc/letsencrypt/options-ssl-nginx.conf;
#   # add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always; # optional
#   location / {
#     proxy_pass http://127.0.0.1:YOUR_PORT; # or http://container-name:PORT
#     proxy_http_version 1.1;
#     proxy_set_header Host $host;
#     proxy_set_header X-Real-IP $remote_addr;
#     proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
#     proxy_set_header X-Forwarded-Proto $scheme;
#     proxy_set_header Upgrade $http_upgrade;
#     proxy_set_header Connection $connection_upgrade;
#     proxy_read_timeout 75s;
#     proxy_send_timeout 75s;
#   }
# }
```

Enable and issue TLS:

```
sudo ln -s /etc/nginx/sites-available/YOUR_DOMAIN.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d YOUR_DOMAIN
```

### Traefik (file provider) template

Create `/etc/traefik/dynamic/YOUR_DOMAIN.yml` with:

```
http:
   routers:
      your-domain:
         rule: Host(`YOUR_DOMAIN`)
         entryPoints: ["websecure"]
         service: your-svc
         tls:
            certResolver: letsencrypt # set to your resolver
   services:
      your-svc:
         loadBalancer:
            servers:
               - url: "http://127.0.0.1:YOUR_PORT"
```

Reload Traefik or let it auto-reload dynamic files.

### Caddy template

Append to your Caddyfile:

```
YOUR_DOMAIN {
   reverse_proxy 127.0.0.1:YOUR_PORT
   encode zstd gzip
   tls you@example.com
}
```

Reload Caddy.

### Nginx Proxy Manager (NPM)

- Proxy Host → Add
   - Domain Names: `YOUR_DOMAIN`
   - Scheme: `http`, Forward Hostname/IP: `127.0.0.1`, Forward Port: `YOUR_PORT`
   - Websockets Support: ON
   - SSL: Request a new certificate (Let’s Encrypt), Force SSL, HTTP/2, HSTS optional

### Cloudflare Tunnel (if you use it)

In the same tunnel, add a new Public Hostname:
- Hostname: `YOUR_DOMAIN`
- Service: HTTP
- URL: `http://your-container:PORT` (reachable inside the tunnel’s network)

### Testing pattern

- Direct upstream:
   - `curl -I http://127.0.0.1:YOUR_PORT/`
- Through the proxy (host header on :80):
   - `curl -I -H "Host: YOUR_DOMAIN" http://127.0.0.1/`
- HTTPS (after certs):
   - `curl -I https://YOUR_DOMAIN`

Tip: our helper script accepts a domain argument:

```
./scripts/test-epicrobot.sh YOUR_DOMAIN
```

