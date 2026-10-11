# Biswa Artifacts ✦

**Create · Publish · Share · Inspire**

An all-in-one developer workspace for creating, managing, publishing, and sharing digital artifacts — interactive websites, documents, presentations, code snippets, files, and images.

## Quick Start

```bash
npm install
cp .env.example .env   # fill in your secrets
npm start
```

Or with Docker:

```bash
docker compose up -d
```

## Environment Variables

Copy `.env.example` to `.env` and fill in every value before starting.

### Core

| Variable | Description |
|---|---|
| `DATABASE_URL` | Neon PostgreSQL connection string |
| `JWT_SECRET` | Random 32+ char secret (`openssl rand -hex 32`) |
| `SITE_URL` | Full public URL, e.g. `https://biswa.io` |
| `BASE_DOMAIN` | Root domain without protocol, e.g. `biswa.io` |
| `GMAIL_USER` | Gmail address for sending emails |
| `GMAIL_APP_PASSWORD` | Gmail App Password (16 chars, no spaces) |
| `R2_ACCOUNT_ID` | Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | R2 API token access key |
| `R2_SECRET_ACCESS_KEY` | R2 API token secret |
| `R2_BUCKET` | R2 bucket name |
| `R2_PUBLIC_URL` | Optional permanent public URL for R2 |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary cloud name |
| `CLOUDINARY_API_KEY` | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | Cloudinary API secret |

### New in this version

| Variable | Default | Description |
|---|---|---|
| `ADMIN_EMAIL` | — | Email that is auto-promoted to admin on login |
| `APPROVAL_MODE` | `auto` | `auto` or `manual` — see First-publish approval below |
| `TURNSTILE_SITE_KEY` | — | Cloudflare Turnstile public key (report form) |
| `TURNSTILE_SECRET` | — | Cloudflare Turnstile secret key (server-side only) |
| `IP_SALT` | falls back to `JWT_SECRET` | HMAC salt for hashing reporter IPs |
| `MAX_PUBLISHED_PER_USER` | `3` | Published artifact quota per user |
| `MAX_ARTIFACTS_PER_USER` | `20` | Total artifact quota per user |
| `MAX_ARTIFACT_BYTES` | `512000` | Max size of one artifact (bytes) |
| `MAX_STORAGE_PER_USER_MB` | `100` | R2 storage quota per user (MB) |
| `MAX_IMAGES_PER_USER` | `50` | Cloudinary image quota per user |
| `MAX_IMAGE_BYTES` | `10485760` | Max single image upload size (bytes) |

## Features

| Feature | Details |
|---|---|
| **Auth** | Public signup with email verification; login, logout, password reset via Gmail |
| **Artifact Studio** | HTML/CSS/JS editor, live preview, multipage |
| **Draft / Live copy** | Autosave only touches the draft; "Publish update" pushes draft → live |
| **Version history** | Last 5 live snapshots; restore any version into the draft |
| **Publishing** | One-click subdomain publishing (`name.biswa.io`), optional password protection |
| **File Storage** | Cloudflare R2 — drag-and-drop, presigned uploads, shareable links |
| **Image CDN** | Cloudinary — upload, rename, copy optimised URL |
| **Abuse reports** | Unobtrusive "Report this page" link on every published artifact; Turnstile protection |
| **Admin panel** | Pending approvals, Reports, All Artifacts, Users tabs |
| **Quotas** | All configurable via `.env`; shown as a usage meter in Studio |
| **Security headers** | `X-Content-Type-Options`, `Referrer-Policy`, `CSP` on all responses |

## How to make yourself admin

Set `ADMIN_EMAIL` in `.env` to your email address before (or after) creating your account:

```dotenv
ADMIN_EMAIL=you@example.com
```

Then restart the server. The next time you log in with that email, your account is automatically promoted to admin. You can also set it while the server is running — the promotion happens on every login.

The hardcoded bootstrap admin (`biswas` / `Biswas@2026`) is always seeded on first run as a fallback. Change the password after first login.

## Cloudflare Turnstile setup

Turnstile protects the "Report this page" form from bots. It is optional — without it, the form falls back to IP-rate-limiting (5 reports per IP per hour).

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) → **Turnstile** → **Add widget**.
2. Widget type: **Managed** (invisible for legitimate users).
3. Add your domain (e.g. `biswa.io`) to the allowed list.
4. Copy the **Site Key** into `TURNSTILE_SITE_KEY` and the **Secret Key** into `TURNSTILE_SECRET`.
5. Restart the server.

## First-publish approval

Set `APPROVAL_MODE=manual` to hold every user's **first** publish for admin review:

- The artifact is **not** served at its subdomain until approved (a "under review" page is shown).
- It does **not** appear in the public gallery.
- You will receive an email and see the artifact in **Admin → Pending approvals**.
- After you approve, the user is marked **trusted** and all future publishes go live immediately.
- `APPROVAL_MODE=auto` (the default) skips approval entirely.

## Project Structure

```
Biswa-Artifact/
├── public/dist/     # Built React SPA (served by Express)
├── server/
│   ├── index.js     # Entry point — validates env, seeds DB, starts server
│   ├── app.js       # Express app factory — routing order + /verify route
│   ├── api.js       # REST API router (/api/*)
│   ├── db.js        # PostgreSQL pool + idempotent schema migrations
│   ├── sites.js     # Subdomain middleware — serves live copy only
│   ├── config.js    # Centralised config from environment variables
│   ├── mail.js      # Gmail SMTP via Nodemailer
│   ├── names.js     # Subdomain validation + reserved list
│   ├── profanity.js # Basic profanity blocklist
│   └── templates.js # Default HTML/CSS/JS for new artifacts
├── frontend/        # React + TanStack Router + Vite source
├── deploy/
│   ├── Caddyfile    # Reverse proxy + wildcard TLS config
│   ├── setup.sh     # Server provisioning script
│   └── r2-cors.json # Cloudflare R2 CORS policy
├── .env.example     # Environment variable template
├── Dockerfile
└── docker-compose.yml
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for a deeper technical overview.

## Deploy

See `deploy/` for Caddyfile and server setup script.

The app runs on port 3000. Put Caddy in front for TLS and wildcard subdomain routing.

## Upgrading an existing deployment

If you are updating from a version before the draft/live copy feature:

```bash
# 1. Pull the latest code
git pull

# 2. Copy any new variables from .env.example into your live .env
#    (ADMIN_EMAIL, APPROVAL_MODE, TURNSTILE_*, IP_SALT, quotas)
nano .env

# 3. Rebuild the frontend (if you changed any frontend files)
cd frontend && npm install && npm run build && cd ..

# 4. Restart the server — db.js runs idempotent migrations automatically
sudo systemctl restart biswa-artifacts
```

The migrations in `server/db.js init()` are fully idempotent (`ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`). They will:
- Add `email_verified`, `trusted`, `banned`, `is_admin` columns to `users`
- Add `review_status`, `live_pages`, `live_css`, `live_js`, `draft_hash`, `live_hash`, `published_at` columns to `artifacts`
- Create `email_tokens`, `artifact_versions`, `reports` tables
- Backfill `live_pages/css/js` from current `pages/css/js` for all already-published artifacts
- Set `review_status = 'approved'` for all existing published artifacts

No data is deleted.
