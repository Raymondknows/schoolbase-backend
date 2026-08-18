# Subscription Guard — How it works

This document describes the subscription guard implemented for SchoolBase backend, how it behaves, and what to do next.

## Purpose

- Provide a centralized middleware to block or allow requests based on a school's subscription state.
- Make subscription state available to the frontend via `/api/auth/verify` so UI can gate features.

## Where the code lives

- Middleware: [backend/src/middleware/subscriptionGuard.ts](backend/src/middleware/subscriptionGuard.ts#L1)
- Router wiring: [backend/src/routes/admin.ts](backend/src/routes/admin.ts#L1)
- Verify endpoint: [backend/src/routes/auth.ts](backend/src/routes/auth.ts#L1)

## How it works (high level)

1. The middleware expects the request to be associated with a `schoolId` (resolved via session token, signed slug cookie, or explicit request data). The existing resolver in `admin.ts` (`resolveSchoolId(req)`) is used.
2. Platform administrators bypass the guard.
3. The middleware queries the `school` row (via Prisma) and checks `plan`, `status`, and `trialEndsAt` / `subscriptionExpiresAt` where applicable.
4. Allowed states:
   - `ACTIVE`: full access
   - `TRIAL`: allowed while `trialEndsAt` is in the future
5. Blocked/limited states return a JSON error with a short `code` value and an HTTP status:
   - `PENDING` => `SUBSCRIPTION_PENDING` (403)
   - `SUSPENDED` => `SUBSCRIPTION_INACTIVE` (403)
   - `CANCELLED` => `SUBSCRIPTION_INACTIVE` (403)
   - expired `TRIAL` => `TRIAL_EXPIRED` (403)

The middleware exposes both a default `requireSubscription` (Express middleware) and helper checks (e.g., `checkSubscription(schoolId)`) for programmatic use.

## Router wiring and allowlist

- The admin router applies the middleware at router-level with a small allowlist for public endpoints (settings, payment verification, assets, upload hooks). This avoids accidentally blocking endpoints used for subscription activation, downloads, or uploads.
- If you need stricter control, prefer applying `requireSubscription` on specific sensitive routes rather than router-level.

## `/api/auth/verify` changes

- The `verify` endpoint now returns a `school` object in the response when a `schoolId` is present in the session token. It contains at minimum:
  - `id`
  - `plan`
  - `status`
  - `trialEndsAt`
  - `subscriptionExpiresAt`

Frontend clients should use this `school` payload to show/hide or disable premium UI features and to show upgrade CTA's when needed.

## Error codes and handling

- Responses from the guard are JSON with `error` and `code` fields. Example:

```json
{ "error": "Subscription inactive", "code": "SUBSCRIPTION_INACTIVE" }
```

Frontend should display a clear modal or toast explaining why the action is blocked and provide a link to the school's billing/settings page.

## Recommended next steps (short-term)

1. Fix the remaining backend diagnostic: resolve duplicate `PrismaClient` identifier in `backend/src/routes/auth.ts`.
2. Centralize a single Prisma client instance (suggested path: `backend/src/lib/prisma.ts`) and import it in modules to avoid duplicate instantiation across modules.
3. Re-run diagnostics and start the backend locally; confirm `/api/auth/verify` returns the `school` payload.
4. Implement frontend gating: update client session code to read `school` and disable/hide features for blocked statuses. Prefer per-component gating with a clear CTA.
5. Add tests for the middleware (unit tests mocking Prisma and integration tests hitting endpoints under different school states).

## Long-term suggestions

- Add feature flags per premium feature so the guard can block only certain capabilities instead of whole routes.
- Add audit logs when a request is blocked for observability.
- Consider a maintenance-mode or grace period for recently cancelled subscriptions.

---

If you want, I can implement items 1–3 now (fix diagnostics, centralize Prisma, re-run checks). Which should I start with?
