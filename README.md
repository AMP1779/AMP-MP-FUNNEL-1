# AMP Producer Registration Funnel (Phase 1A)

Producer-facing registration funnel: hero, value proposition, and a validated registration form backed by an Express API.

## Run locally
```
npm install
npm start
```
Server runs on `http://localhost:3000`.

## API
- `POST /api/register` — validates fullName, email, role, consent; rejects duplicate emails; stores the record.
- `GET /api/registrations/count` — total registrations.
- `GET /api/health` — health check.

## Known limitation (P1, post-launch)
Registrations are currently persisted to a JSON file on the running container (`data/registrations.json`), not a managed database. This is durable across requests but **not** durable across a redeploy on Railway (no attached volume yet). Swapping in Postgres (`DATABASE_URL`) is the next hardening step and does not require any frontend changes.
