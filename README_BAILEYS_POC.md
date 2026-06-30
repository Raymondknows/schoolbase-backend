Baileys POC — Quick instructions

Purpose

This standalone script checks whether Baileys can run and connect from this machine without touching SchoolBase internals.

Files

- `scripts/baileys-poc.ts` — the standalone proof-of-concept script
- `.baileys-poc-auth/` — authentication files created by Baileys when you run the script
- `BAILEYS_POC_REPORT.md` — template report to record results

Run

1. From the repo root run:

```bash
cd /Applications/SchoolBase/backend
TO_NUMBER=2348012345678 npx tsx scripts/baileys-poc.ts
```

2. Scan the QR code located at `.baileys-poc-auth/last_qr.txt` (open that file) or follow the printed logs. After pairing the script will print `connection open` and send a test message.

Notes

- The script does not touch the database, routes, or other app code.
- To re-run cleanly, remove the auth folder:

```bash
rm -rf .baileys-poc-auth
```


Troubleshooting

- If `connection` never becomes `open`, check `.baileys-poc-auth/last_qr.txt` and scan the QR with your phone.
- If pairing fails, inspect the console logs for `creds.update` and `connection.update` entries.

