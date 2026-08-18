# Baileys WhatsApp Integration Report

## Summary

This document captures the full SchoolBase WhatsApp integration analysis, the fixes applied to `backend/src/communications/whatsapp-baileys.ts` and `frontend/src/app/admin/whatsapp-baileys/page.tsx`, and the recommended next steps to keep this connection solid.

## Context

SchoolBase uses a custom admin page to start a Baileys-powered WhatsApp Web session through a backend session manager. The failure mode was:

- a valid QR code was generated and shown
- the backend received `creds.update`
- immediately after, the socket closed with `statusCode: 515` and `errorMessage: "Stream Errored (restart required)"`
- the existing integration treated that close as a terminal or benign QR state and did not recover cleanly

The underlying Baileys library itself was confirmed working via the standalone POC and the WhatsApp connection succeeded once the retry path was implemented.

## Root cause analysis

The integration failure came from two main issues:

1. **Stale auth/session state handling**
   - The connect flow reused existing auth state on a fresh pairing attempt.
   - This caused the handshake flow to enter an invalid state before the new session could complete.

2. **515 stream-error closure was not recovered**
   - `connection.update` reported `close` with `statusCode: 515` after the QR was generated.
   - The existing code preserved QR state but did not retry the Baileys handshake.
   - As a result, the UI could show a QR and then the backend remained effectively closed until a manual reconnect.

## Fixes applied

### Backend fix (`backend/src/communications/whatsapp-baileys.ts`)

- Added a pino-compatible logger wrapper for Baileys with `trace`, `debug`, `info`, `warn`, and `error`.
- Ensured any prior socket is cleaned up before starting a new connection.
- Forced a fresh auth-state reset on explicit `connect()` requests to avoid reuse of stale pairing state.
- Added explicit handling for `statusCode === 515`:
  - preserve the current QR state
  - schedule a short reconnect after the stream error close
  - retry the Baileys handshake automatically
  - limit retries to avoid runaway loops
- Exposed `streamErrorRetrying` and `streamErrorReconnectAttempts` in the status/debug payload.

### Frontend fix (`frontend/src/app/admin/whatsapp-baileys/page.tsx`)

- Continued polling while the session is in `qr` or `connecting` states.
- Rendered explicit status and retry indicator when the backend is recovering from a stream error.
- Kept the UI stable and made the QR state clearer.

## Verification

The integration is now verified working end-to-end.

Observed successful flow:

- `connect()` requested
- Baileys package selected: `@whiskeysockets/baileys`
- auth folder created/used: `.baileys-session/auth_info`
- QR generated successfully
- `creds.update` emitted
- `connection.close` with `statusCode: 515` was observed
- retry scheduled and executed
- final state reached `connection: open`
- connected phone: `2349088559072:55@s.whatsapp.net`

## Why this is solid

These changes make the integration far more resilient because they now handle the actual WhatsApp pairing lifecycle instead of assuming a single connect attempt will always finish cleanly.

Key hardening points:

- automatic recovery from `Stream Errored (restart required)`
- deliberate auth-state reset before pairing retry
- explicit socket cleanup before reconnect
- richer debug state surfaced in the admin UI

## Next actions

1. **Send a test message** using the admin UI or the `POST /api/admin/whatsapp-baileys/send-message` endpoint.
2. **Add automated regression tests** for the WhatsApp connect flow and `515` recovery path.
3. **Monitor the session state** during normal operation so `streamErrorRetrying` can be surfaced in logs/alerts.
4. **Keep the Baileys POC script** available for environment validation when the backend or host machine changes.
5. **Document retry behavior** in the integration README so future maintainers understand why `515` must be retried.

## Stability checklist

- [x] `backend/src/communications/whatsapp-baileys.ts` handles stale auth and stream errors
- [x] `frontend/src/app/admin/whatsapp-baileys/page.tsx` surfaces retry state
- [x] QR generation is logged and persisted to `.baileys-session/last_qr.txt`
- [x] Admin UI can now show `connected` and phone JID
- [x] POC confirms Baileys is valid independently of SchoolBase
- [ ] Add automated tests for reconnection flows
- [ ] Add alerting on repeated Baileys retry failures

## Recommended long-term guardrails

- Keep a small watchdog around the Baileys session in production and restart it when the session status remains `error` for more than one minute.
- Persist the auth files and avoid unnecessary auth resets unless a connection failure occurs.
- Preserve the standalone `backend/scripts/baileys-poc.ts` script as a platform-level smoke test.
- Log `streamErrorReconnectAttempts` and `connection.update` events to help distinguish intermittent WhatsApp transport glitches from deeper integration failures.

## How to test now

### Manual

1. Open the admin page at `/admin/whatsapp-baileys`.
2. Click `Connect`.
3. Scan the QR code with WhatsApp.
4. Confirm the page moves to `connected`.
5. Send a test message.

### Programmatic

```bash
curl -X POST http://localhost:3006/api/admin/whatsapp-baileys/connect \
  -H 'Content-Type: application/json' \
  -d '{"phoneNumber":"2349088559072","usePairingCode":false}'
```

### Debug

```bash
curl http://localhost:3006/api/admin/whatsapp-baileys/status
```

## Conclusion

The WhatsApp Baileys integration is fixed and now recovers from the exact stream error that previously blocked completion. The connection is confirmed working, and the next phase is to add regression tests and operational visibility so the integration remains stable over time.
