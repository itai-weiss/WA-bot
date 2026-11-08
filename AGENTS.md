# AGENTS.md

Guidance for AI coding agents working in this repository.

## Project Overview

This is a Node.js 20+ WhatsApp Web admin bot. It uses `whatsapp-web.js` with a local Express server and a static web UI in `public/`.

Main entry points:

- `server.js` - Express API, static UI hosting, and startup.
- `whatsapp.js` - WhatsApp Web client creation, QR/status lifecycle, browser discovery.
- `timings.js` - one-shot scheduled sends (one or more messages each) persisted in `timings.json`; a 15s due-check sends them, including late ones up to 6h.
- `keepAwake.js` - keeps Windows from idle-sleeping while timings are pending.
- `chatCommands.js` - scheduling from the user's own "Message yourself" WhatsApp chat (`תזמון` header, 1-10 messages, `תזמון: סוף`; plus `רשימה`, `בטל <code>`, `עזרה`). Replies start with `🤖 ` and are never read back.
- `test-timings.js`, `test-chat.js` - self-checks (`npm test`), fake client and temp dir.
- `metagroups.js` - saved group bundles persisted in `metagroups.json`.
- `eventLog.js` - in-memory recent send log.
- `dataDir.js` - resolves `DATA_DIR` (default: the app folder), where timings, metagroups, attachments and the WhatsApp session/cache live.
- `Dockerfile`, `deploy/` (compose + Caddy), `DEPLOY.md` - VPS deployment, one container per WhatsApp user.
- `public/index.html`, `public/app.js`, `public/styles.css` - admin UI.
- `list-groups.js` - terminal helper for printing WhatsApp group IDs.
- `HOW_TO_USE.txt` / `HOW_TO_USE_HE.txt` - end-user guides (English / Hebrew); the in-app Hebrew guide is the `#help-dialog` in `public/index.html`. Keep all three in sync when behavior changes.

## Commands

- Install dependencies: `npm install`
- Start the admin UI: `npm start`
- List WhatsApp groups: `npm run groups`
- Basic JS syntax check for changed files: `node --check <file>`

`npm test` runs `test-timings.js` and `test-chat.js`; they never send messages or touch real data.

## Runtime Behavior

- The server binds to `HOST` and `PORT` from `.env`, defaulting to `127.0.0.1:3000`.
- If the configured port is busy, `server.js` tries the next ports up to 10 attempts.
- WhatsApp authentication is stored by `whatsapp-web.js` under `<DATA_DIR>/.wwebjs_auth/`, cache under `<DATA_DIR>/.wwebjs_cache/`. On the server, user data is in `deploy/data/<name>/`.
- If `APP_PASSWORD` is set, every route needs HTTP Basic auth (any username). The server exits at startup if `HOST` is not loopback and `APP_PASSWORD` is empty.
- If `ready` hasn't fired 3 min after `authenticated` (upstream session-restore hang), `server.js` destroys and re-initializes the client.
- Browser lookup: `CHROME_PATH`, then Windows Chrome/Edge and Linux Chrome/Chromium paths, then Puppeteer's bundled Chrome (used in Docker).
- The only user-facing send workflow is creating and canceling future timings, from the web UI or from the self-chat (`chatCommands.js`). The self-chat handler must never react in any other chat.
- Metagroups are the only way to choose timing recipients. The server resolves `metagroupIds` to group IDs when the timing is saved, so deleting a metagroup does not change saved timings.
- Attachments are allowed only as part of a saved timing; there is no immediate-send UI.

## Safety Rules

- Do not commit or print secrets from `.env`.
- Do not delete or reset `.wwebjs_auth/` unless the user explicitly asks to re-authenticate WhatsApp.
- Do not run actions that send WhatsApp messages unless the user explicitly asks or the task requires a local manual verification they approved.
- Treat `timings.json`, `metagroups.json`, and `timing-attachments/` as user data. Avoid overwriting them except through the app behavior or an explicit user request.
- Without `APP_PASSWORD` the admin UI has no authentication and is for localhost only. Never expose it without `APP_PASSWORD`.
- Do not delete `deploy/data/` on a server; it holds every user's session and timings.
- Do not link the user's WhatsApp in a local container without asking: it adds a linked device.
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
node --check dataDir.js
node --check chatCommands.js
node --check whatsapp.js
node --check timings.js
node --check metagroups.js
node --check public/app.js
```

Only run `npm start` when a live WhatsApp/browser session is acceptable for the task. If started, verify the reported local URL and avoid using the UI to send messages unless requested.
