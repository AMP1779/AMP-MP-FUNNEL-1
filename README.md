# AMP Producer Registration Funnel (Phase 1)

Producer-facing registration funnel with PostgreSQL persistence.

## Run locally
```
npm install
DATABASE_URL=postgres://... npm start
```
Server runs on `http://localhost:3000`. Without `DATABASE_URL` set, the server starts but all `/api/*` routes return 503 — there is no local-file fallback anymore.

## Schema
One `applications` table holds registration fields plus `producer_dna`, `portfolio`, and `interview` as JSONB columns, a `status` (`draft` → `submitted`), and a unique constraint on the lowercased email. Migration runs automatically on server start (`CREATE TABLE IF NOT EXISTS`).

## API
- `POST /api/register` — creates an application. If the email already has a draft, returns that draft's id as a resume (`resumed: true`) instead of erroring. Returns 409 if that email already submitted.
- `PATCH /api/applications/:id` — saves partial progress (producer DNA, portfolio, interview metadata, contact fields). Only works while status is `draft`.
- `GET /api/applications/:id` — retrieves current state (resume).
- `POST /api/applications/:id/submit` — idempotent final submission; re-submitting an already-submitted id returns success without side effects.
- `GET /api/health` — returns 503 if `DATABASE_URL` is unset or the database is unreachable, 200 with `database: "connected"` otherwise.

## Known gaps (not built in this pass)
- No actual file/media upload endpoint yet — `interview`/`portfolio` JSONB columns exist to hold metadata once an upload path (presigned URL to object storage) is implemented.
- No voice/interview recording pipeline — frontend concern, unimplemented.
- No rate limiting yet.

## Required environment variable
`DATABASE_URL` — must be set to a reachable Postgres instance for `/api/*` to work. Nothing here provisions or points at Postgres automatically; that has to be done in Railway (or wherever the app runs) and the variable set on the service.
