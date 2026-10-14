# Biswa Artifacts ✦

**Create · Publish · Share · Inspire**

An all-in-one developer workspace for creating, managing, publishing, and sharing digital artifacts — interactive websites, documents, presentations, code snippets, files, and images.

## Quick Start

```bash
npm install
cp .env.example .env   # fill in your secrets
npm start
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

### BYOK AI Code Generator (required)

| Variable | Default | Description |
|---|---|---|
| `KEY_ENCRYPTION_SECRET` | — | **Required.** AES-256-GCM master key. Generate: `openssl rand -base64 32` |
| `AI_RATE_WINDOW_MIN` | `10` | Rolling window in minutes for AI rate limit |
| `AI_RATE_LIMIT` | `15` | Max AI generation requests per user per window |
| `AI_RATE_LIMIT_DAY` | `150` | Max AI generation requests per user per day |

> **⚠ Warning:** If you lose or rotate `KEY_ENCRYPTION_SECRET`, all stored user AI keys become permanently unreadable. Users will need to re-enter their own API keys. Keep a secure backup.

### Quotas

| Variable | Default | Description |
|---|---|---|
| `MAX_PUBLISHED_PER_USER` | `3` | Published artifact quota per user |
| `MAX_ARTIFACTS_PER_USER` | `20` | Total artifact quota per user |
| `MAX_ARTIFACT_BYTES` | `512000` | Max size of one artifact (bytes) |
| `MAX_IMAGE_STORAGE_MB` | `10` | Total Cloudinary image storage per user (MB) |
| `MAX_FILE_STORAGE_MB` | `20` | Total Cloudflare R2 file storage per user (MB) |
| `MAX_IMAGES_PER_USER` | `50` | Cloudinary image count limit per user |
| `MAX_IMAGE_BYTES` | `10485760` | Max single image upload size (bytes) |

### Optional

| Variable | Default | Description |
|---|---|---|
| `ADMIN_EMAIL` | — | Email auto-promoted to admin on login |
| `APPROVAL_MODE` | `auto` | `auto` or `manual` — see First-publish approval |
| `TURNSTILE_SITE_KEY` | — | Cloudflare Turnstile public key |
| `TURNSTILE_SECRET` | — | Cloudflare Turnstile secret key |
| `IP_SALT` | falls back to `JWT_SECRET` | HMAC salt for hashing reporter IPs |

## Features

| Feature | Details |
|---|---|
| **Auth** | Email verification, login, password reset via Gmail |
| **Artifact Studio** | HTML/CSS/JS editor with CodeMirror, live preview, multipage |
| **Draft / Live copy** | Autosave only touches the draft; "Publish update" pushes to live |
| **Version history** | Up to 30 snapshots with source badges (Manual / AI / Rollback) |
| **Publishing** | One-click subdomain publishing (`name.biswa.io`), optional password |
| **File Storage** | Cloudflare R2 — presigned uploads, two-phase confirm (HeadObject), quota |
| **Image CDN** | Cloudinary — with per-user byte quota enforcement |
| **Usage meters** | Real-time quota bars in the Studio sidebar |
| **Social links** | YouTube + Instagram in Nav and Footer |
| **BYOK AI** | Google Gemini & OpenAI code generation; keys encrypted AES-256-GCM |
| **AI chat panel** | Collapsible drawer in editor; example prompts; Undo last AI change |
| **Abuse reports** | Turnstile-protected; auto-suspend after 3 reports |
| **Admin panel** | Pending approvals, Reports, All Artifacts, Users |

## Generating KEY_ENCRYPTION_SECRET

```bash
openssl rand -base64 32
```

Copy the output into `.env`:

```dotenv
KEY_ENCRYPTION_SECRET=<paste here>
```

The value must decode to exactly 32 bytes. The server checks this at startup and exits with a clear error if it is wrong.

## How to make yourself admin

Set `ADMIN_EMAIL` in `.env` to your email address, then restart. The next login with that email is automatically promoted.

## Project Structure

```
Biswa-Artifact/
├── public/dist/        # Built React SPA (served by Express)
├── server/
│   ├── index.js        # Entry point — validates env, seeds DB, starts server
│   ├── app.js          # Express app factory
│   ├── api.js          # REST API router (/api/*)
│   ├── db.js           # PostgreSQL pool + idempotent schema migrations
│   ├── sites.js        # Subdomain middleware — serves live copy only
│   ├── config.js       # Centralised config from environment variables
│   ├── mail.js         # Gmail SMTP via Nodemailer
│   ├── names.js        # Subdomain validation + reserved list
│   ├── profanity.js    # Basic profanity blocklist
│   ├── templates.js    # Default HTML/CSS/JS for new artifacts
│   └── ai/
│       ├── systemPrompt.js  # Internal AI system prompt (server-only)
│       ├── encrypt.js       # AES-256-GCM key encryption helpers
│       └── providers.js     # Gemini + OpenAI verification & generation
├── frontend/           # React + TanStack Router + Vite source
├── deploy/
│   ├── Caddyfile       # Reverse proxy + wildcard TLS config
│   ├── setup.sh        # Server provisioning script
│   └── r2-cors.json    # Cloudflare R2 CORS policy
├── .env.example        # Environment variable template
├── Dockerfile
└── docker-compose.yml
```

## Upgrading an Existing Deployment

```bash
# 1. Pull latest code
git pull

# 2. Add new variables from .env.example to your live .env
#    Required new variable:
#      KEY_ENCRYPTION_SECRET=<openssl rand -base64 32>
#    Optional new variables:
#      MAX_IMAGE_STORAGE_MB=10
#      MAX_FILE_STORAGE_MB=20
#      AI_RATE_LIMIT=15
#      AI_RATE_WINDOW_MIN=10
#      AI_RATE_LIMIT_DAY=150
nano .env

# 3. Rebuild the frontend
cd frontend && npm install && npm run build && cd ..

# 4. Restart — db.js runs idempotent migrations automatically
sudo systemctl restart biswa-artifacts
```

The migrations in `server/db.js init()` are fully idempotent. On upgrade they will:
- Add `bytes` column to `images` (Part 1 — image byte quota)
- Add `status` column to `files` (Part 1 — pending/ready flow)
- Add `source`, `prompt`, `size_bytes`, `created_at` columns to `artifact_versions` (Part 3)
- Create `user_ai_settings` table (Part 3 — BYOK encrypted keys)
- Create `ai_messages` table (Part 3 — chat history)
- All existing data is preserved

## Deploy

See `deploy/` for Caddyfile and server setup script. The app runs on port 3000. Caddy handles TLS and wildcard subdomain routing.
