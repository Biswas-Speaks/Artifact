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

| Variable | Description |
|---|---|
| `DATABASE_URL` | Neon PostgreSQL connection string |
| `JWT_SECRET` | Random 32+ char secret (`openssl rand -hex 32`) |
| `GMAIL_USER` | Gmail address for sending emails |
| `GMAIL_APP_PASSWORD` | Gmail App Password (16 chars) |
| `R2_ACCOUNT_ID` | Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | R2 API token access key |
| `R2_SECRET_ACCESS_KEY` | R2 API token secret |
| `R2_BUCKET` | R2 bucket name |
| `R2_PUBLIC_URL` | Optional permanent public URL for R2 |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary cloud name |
| `CLOUDINARY_API_KEY` | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | Cloudinary API secret |

## Features

| Feature | Details |
|---|---|
| **Auth** | Login, logout, password reset via Gmail |
| **Artifact Studio** | HTML/CSS/JS editor with live preview, multipage, publish to subdomain |
| **Publishing** | One-click subdomain publishing (`ups.biswa.io`), optional password protection |
| **File Storage** | Cloudflare R2 — drag-and-drop, presigned uploads, shareable links |
| **Image CDN** | Cloudinary — upload, rename, copy optimised URL |
| **Admin** | User management, invite users, activate/deactivate |

## Project Structure

```
Biswa-Artifact/
├── public/          # Static SPA (served by Express)
│   ├── index.html   # Shell — loads app.css + app.js
│   ├── app.css      # Design system (tokens, layout, components)
│   ├── app.js       # Full SPA — auth, studio, files, images, admin
│   └── assets/      # Marketing front page (built React bundle)
├── server/
│   ├── index.js     # Entry point — validates env, seeds DB, starts server
│   ├── app.js       # Express app factory — routing order
│   ├── api.js       # REST API router (/api/*)
│   ├── db.js        # PostgreSQL pool + schema init
│   ├── sites.js     # Subdomain middleware for published artifacts
│   ├── config.js    # Centralised config from environment variables
│   ├── mail.js      # Gmail SMTP via Nodemailer
│   └── templates.js # Default HTML/CSS/JS for new artifacts
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

The app runs on port 3000. Put Caddy or Nginx in front for TLS and subdomain routing.
