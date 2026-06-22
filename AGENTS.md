# i-max-pos (pyi-taw-tar-backend)

**Language rule:** Always reply in Myanmar (Burmese), regardless of what language the user asks in.
**Plans:** Always explain plans in detail — no skimming.

Express v5 + Mongoose v9 REST API for a Myanmar POS system (warehouse + supplier + storefront + ecommerce).

## Quick start

```bash
npm install        # install deps
npm run dev        # nodemon on port 5000 (NODE_ENV=development)
npm start          # node src/server.js (for PM2/production)
node createAdmin.js  # seed owner account (name=owner, pw=123456)
```

- No build step, no tests, no lint, no typecheck.
- ES Modules everywhere (`"type": "module"`). `import`/`export` only; no `require()`.

## Architecture

- **Entrypoints:** `src/server.js` (main), `src/app.js` (Express setup + route mounting), `api/index.js` (Vercel serverless wrapper with cached DB connection).
- **All routes** mounted under `/api/v1` in `app.js:55-78`.
- **MVC pattern** — `models/` (Mongoose schemas), `controllers/` (request handlers), `routes/` (router definitions), `services/` (business logic), `middlewares/`, `utils/`, `configs/`, `constants/`.
- **Auth:** JWT Bearer token. Two middleware layers: `protect` (admin/staff) and `customerProtect` (customers). Roles: `owner`, `admin`, `cashier`.

## Key quirks

- **Express v5** (`^5.1.0`) — async error handling is native in v5, but the project uses a hand-rolled `asyncErrorHandler` wrapper anyway.
- **Mongoose v9** (`^9.0.0`) — breaking changes from v8 (e.g. `connect()` signature).
- **Rate limit:** 60 req/min per IP (`app.js:48`). Adjustable via `apiRateLimiter(windowMs, max)`.
- **CORS:** Currently allows all origins (`cors.config.js:6`), despite commented-out specific origins.
- **Timezone middleware** (`mmTimeZoneMiddleware`) converts GET response dates to Asia/Yangon (MMT). All dates stored in UTC.
- **Order numbers** use `ORD-YYYY-MM-DD-NNNNNN` format with retry logic (up to 3 tries, exponential backoff) for race conditions — see `ORDER_NUMBER_REVIEW.md`.
- **Partial GRN support:** On startup, `db.config.js:15-42` drops the unique index on `purchasingId` in the `goodsrecievednotes` collection so multiple GRNs per PO are allowed.
- **Stock changes** are audit-logged via `stockAuditLog.service.js` (before/after quantities). User actions logged via `activityLog.service.js`.
- **AI chatbot** uses OpenRouter (`google/gemini-2.5-flash`) with 5 function-calling tools (sales report, stock check, PO report, expense report, product sales). Answers in Burmese. Session: last 10 messages per admin.

## Environment

`.env` is committed with live secrets (MongoDB URI, JWT secret, R2 keys, OpenRouter key). Key vars: `MONGODB_URI`, `JWT_SECRET`, `JWT_EXPIRES_IN` (default `30d`), `PORT` (default 5000), `R2_*` (Cloudflare R2), `OPENROUTER_API_KEY`, `ECOMMERCE_STOREFRONT_ID`.

## Deployment

- **Vercel:** `vercel.json` routes all traffic to `api/index.js`. Set env vars in Vercel dashboard.
- **DigitalOcean Droplet:** Manual PM2 + Nginx + Let's Encrypt per `deployment-guide.txt`.
- Storage: Cloudflare R2 (S3-compatible, primary). Legacy DO Spaces support still present.

## What's missing

No CI/CD, no Docker, no tests, no lint/format tooling.
