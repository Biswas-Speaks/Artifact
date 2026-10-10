# Architecture — Biswa Artifacts

## Overview

Biswa Artifacts is a single-process Node.js application.  
A vanilla-JS SPA is served as static files; all data flows through a JSON REST API.

```
Browser
  │
  ├── GET /          → index.html  (SPA shell)
  ├── GET /app.js    → SPA logic   (vanilla JS, no framework)
  ├── GET /app.css   → Design system
  ├── GET /assets/*  → Marketing front page (React/TanStack build)
  │
  ├── /api/*         → Express REST API  (JSON)
  │     ├── /auth/*        Authentication
  │     ├── /artifacts/*   Artifact CRUD + publish
  │     ├── /files/*       R2 presigned-URL flow
  │     ├── /images/*      Cloudinary upload/rename/delete
  │     ├── /settings/*    Profile + password
  │     └── /admin/*       User management (admin only)
  │
  └── <sub>.biswa.io → Subdomain middleware → serves published artifact HTML
```

## Request Lifecycle

1. `server/index.js` — validates env vars, runs `db.init()`, seeds admin, starts Express
2. `server/app.js`   — Express factory: cookie-parser → subdomain sites → API → static → SPA fallback
3. `server/sites.js` — Intercepts requests where `req.hostname` ends with `.biswa.io`; serves artifact pages with optional password gate
4. `server/api.js`   — All `/api/*` routes; exports an Express Router

## Authentication

- Sessions use **HttpOnly cookies** containing a signed JWT (`jsonwebtoken`)
- JWT payload: `{ uid: <uuid> }`
- Cookie name: `sid`, 7-day expiry, `sameSite: lax`, `secure: true` in production
- Rate limiting on auth endpoints via `express-rate-limit` (40 req / 15 min per IP)
- Password reset uses a 32-byte random token, SHA-256 hashed before DB storage, expires in 30 min

## Database (Neon PostgreSQL)

Tables: `users`, `reset_tokens`, `artifacts`, `files`, `images`

`db.init()` runs on every startup and is safe to re-run:
- Uses `CREATE TABLE IF NOT EXISTS`
- Detects incompatible legacy schemas (missing `username` column) and drops/recreates
- Adds new columns to existing tables via `ALTER TABLE … ADD COLUMN IF NOT EXISTS`

## File Storage — Cloudflare R2

Upload flow (browser → R2 direct, never through Node):
1. Browser sends file metadata to `POST /api/files/presign`
2. Server creates a DB record and returns a **signed PUT URL** (15 min expiry)
3. Browser PUTs the file directly to R2 using the signed URL
4. Download links: permanent public URL (if `R2_PUBLIC_URL` is set) or 7-day signed GET URL

## Image CDN — Cloudinary

- Server receives the image via `multipart/form-data` (`multer`, memory storage, 10 MB limit)
- Uploads to Cloudinary using `upload_stream` (no temp files)
- Stores `public_id` + `secure_url` in the DB
- Rename uses `cloudinary.uploader.rename` (server-side, atomic)

## Published Artifacts

- Each artifact can be assigned a unique subdomain (e.g. `ups.biswa.io`)
- `server/sites.js` intercepts subdomain requests and serves pages from the DB
- Optional password protection: bcrypt-hashed, verified on POST `/__unlock`, session via a separate `ap` cookie (12 h)
- Artifact pages can reference `/style.css` and `/script.js` which serve the artifact's global CSS/JS

## SPA Architecture

`public/app.js` is a self-contained vanilla JS SPA (~1200 lines):

- **State**: single `state` object (user, config, artifacts, files, images, adminUsers, editor state)
- **Routing**: `navigateTo(view)` switches between views by re-rendering `#main`
- **API**: thin `api(path, opts)` wrapper over `fetch` with same-origin credentials
- **Views**: dashboard, artifacts, editor, files, images, admin, settings
- **Editor**: split-pane — textarea (HTML/CSS/JS tabs) + live `srcdoc` iframe preview
- **No build step** — loaded directly as `<script src="/app.js">`

## Environment Variables

All config is centralised in `server/config.js`.  
No code reads `process.env` directly except `config.js` and the `dotenv` call in `index.js`.
