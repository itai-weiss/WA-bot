# AGENTS.md

Guidance for AI coding agents working in this repository.

## Project Overview

This is a Node.js 20+ WhatsApp Web admin bot. It uses `whatsapp-web.js` with a local Express server and a static web UI in `public/`.

Main entry points:

- `server.js` - Express API, static UI hosting, and startup.
- `whatsapp.js` - WhatsApp Web client creation, QR/status lifecycle, browser discovery.
- `timings.js` - one-shot scheduled sends persisted in `timings.json`.
- `metagroups.js` - saved group bundles persisted in `metagroups.json`.
- `eventLog.js` - in-memory recent send log.
- `public/index.html`, `public/app.js`, `public/styles.css` - admin UI.
- `list-groups.js` - terminal helper for printing WhatsApp group IDs.

## Commands

- Install dependencies: `npm install`
- Start the admin UI: `npm start`
- List WhatsApp groups: `npm run groups`
- Basic JS syntax check for changed files: `node --check <file>`

There is currently no automated test script in `package.json`.

## Runtime Behavior

- The server binds to `HOST` and `PORT` from `.env`, defaulting to `127.0.0.1:3000`.
- If the configured port is busy, `server.js` tries the next ports up to 10 attempts.
- WhatsApp authentication is stored by `whatsapp-web.js` under `.wwebjs_auth/`.
- WhatsApp cache is stored under `.wwebjs_cache/`.
- The only user-facing send workflow is creating and canceling future timings.
- Metagroups are only a selection shortcut for the timing form.
- Attachments are allowed only as part of a saved timing; there is no immediate-send UI.

## Safety Rules

- Do not commit or print secrets from `.env`.
- Do not delete or reset `.wwebjs_auth/` unless the user explicitly asks to re-authenticate WhatsApp.
- Do not run actions that send WhatsApp messages unless the user explicitly asks or the task requires a local manual verification they approved.
- Treat `timings.json`, `metagroups.json`, and `timing-attachments/` as user data. Avoid overwriting them except through the app behavior or an explicit user request.
- The admin UI has no authentication and is intended for localhost only. Do not expose it publicly without adding auth.
- Be careful with `npm run groups`; it starts a WhatsApp Web client and may require QR authentication.

## Code Style

- Use CommonJS (`require`, `module.exports`) to match the existing code.
- Keep dependencies minimal; prefer existing packages already listed in `package.json`.
- Keep server-side validation close to the endpoint or persistence module that owns the data.
- Preserve existing user-facing Hebrew strings exactly when editing UI/status text. Use UTF-8-aware tooling for files that already contain Hebrew.
- Keep generated/session directories out of source control.

## Verification

For small JS-only edits, at minimum run:

```powershell
node --check server.js
node --check whatsapp.js
node --check timings.js
node --check metagroups.js
node --check public/app.js
```

Only run `npm start` when a live WhatsApp/browser session is acceptable for the task. If started, verify the reported local URL and avoid using the UI to send messages unless requested.
