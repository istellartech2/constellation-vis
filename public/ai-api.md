# Constellation Visualizer: AI session HTTP API

This public application provides private, temporary browser sessions. No account is required: access is authorized by independent, cryptographically random capability tokens. Treat tokens as passwords. Do not put them in URLs, logs, commits, or public messages.

## Connect to a browser

Open the application, open the menu, select シナリオ, then click **AI連携を開始**. This uploads the current editor configuration to an encrypted temporary session. Click **AI向け接続情報をコピー** and give that text to your AI. The browser polls every two seconds while connected. Keep the page open; reloading loses the browser's credentials and requires a new session.

Each session expires **one hour after creation**, without extending its lifetime on use. **連携を終了** immediately deletes the active Redis record. Closing the page leaves it until expiry. Tokens remain only in browser memory. The current scenario remains visible in that browser after expiry/end. The AI integration does not persist credentials or the full scenario in browser storage. The existing application separately saves view preferences, including ISL endpoint selections, locally in the browser. Explicitly saving settings.toml downloads a local file.

Scenario text is encrypted with AES-256-GCM before Redis storage. The server processes plaintext in memory. Read/write access requires a session token; there is no public listing or public scenario URL. Redis TTL removes live records; infrastructure/provider backup retention is governed by the providers. This is not a promise that data never leaves your machine: the API, storage and AI provider receive/process data as described above.

## Credentials

The copied instructions contain an absolute endpoint `/api/sessions/{sessionId}` and a controller token. Send it in an HTTP header:

```http
Authorization: Bearer <controllerToken>
```

The controller may read and update only that session. The browser's separate owner token can also acknowledge application and end the session. Neither token is returned by reads. Responses use `Cache-Control: no-store, private`. Tokens and scenario bodies are not logged by the application. HTTP requests from terminal tools such as curl are supported; cross-origin browser requests are rejected.

## Read

`GET /api/sessions/{sessionId}` returns:

```json
{
  "sessionId": "…",
  "revision": 0,
  "appliedRevision": 0,
  "applicationStatus": "applied",
  "expiresAt": "2026-10-03T01:00:00.000Z",
  "scenario": {
    "satText": "",
    "constText": "",
    "gsText": "",
    "startTime": "2026-10-03T00:00:00.000Z"
  }
}
```

`GET ...?after=0` omits scenario text if revision is still 0, but always returns application status. A successful PUT means accepted by the API. Wait for `applicationStatus: "applied"` **and** `appliedRevision` matching the returned revision before reporting browser application. `pending` means awaiting the browser; `error` means browser validation/application failed. A background or closed browser can delay application.

## Update

Send `PUT /api/sessions/{sessionId}` with `Content-Type: application/json`:

```json
{
  "expectedRevision": 0,
  "operation": {
    "type": "replace",
    "scenario": {
      "satText": "",
      "constText": "",
      "gsText": "[[groundstations]]\nname = \"Tokyo\"\nlatitudeDeg = 35.68\nlongitudeDeg = 139.76\nheightKm = 0\nminElevationDeg = 10\n",
      "startTime": "2026-10-03T00:00:00Z"
    }
  }
}
```

Supported operations:

- `replace`: replace the whole scenario with the four fields above. Blank TOML sections are supported.
- `bundle`: `{ "type": "bundle", "text": "contents of settings.toml" }`. Use the application's exported format with `# === satellites ===`, `# === constellation ===`, `# === groundstations ===` section markers and `startTime`.
- `append`: `{ "type": "append", "section": "groundstations", "text": "TOML array-table entries" }`. Valid sections: `satellites`, `constellation`, `groundstations`. Constellation input uses `[[constellation.shells]]`; if an epoch is provided it must match the existing constellation epoch.
- `remove`: `{ "type": "remove", "section": "groundstations", "index": 0 }`. Indices are zero-based TOML entries in the current section, not generated satellite indices. Removing a constellation entry removes its whole shell. Use GET and its revision before removal. To change an individual generated satellite, edit/replace the constellation definition or represent that satellite separately.
- `clear`: `{ "type": "clear", "section": "satellites" }`. Omit section to clear all three sections; startTime is preserved.

A successful update returns `{ "revision": 1, "applicationStatus": "pending" }`. Every write must include the current `expectedRevision`. On `409`, GET again, reconcile the desired change and retry. This prevents two agents silently overwriting each other. Retrying an accepted request with its old revision returns 409 rather than appending twice.

Limits: 256 KiB JSON request/scenario, 2,000 expanded satellites, 500 ground stations. UTC startTime must end in `Z`. Malformed TOML, invalid domain values and excessive generated counts are rejected before commit. Unknown root tables are rejected. TOML is the application's existing schema; use single-line scalar values as in exported settings.

## Browser acknowledgements and ending a session

Browser owner only:

- `PATCH /api/sessions/{sessionId}`: `{ "revision": 1, "status": "applied" }` (or `error`). A stale revision returns 409.
- `DELETE /api/sessions/{sessionId}`: deletes the session record. Subsequent credentials no longer work.

For headless creation, `POST /api/sessions` with `{}` creates an empty session; optionally include `scenario`. It returns `sessionId`, `ownerToken`, `controllerToken`, `expiresAt`, and `revision`. This alone does not connect a browser. For browser visualization, start the session in the UI and use its copied credentials.

## Errors and throttling

- 400: invalid input; revise the request.
- 401: missing, incorrect, expired or ended session credentials. Missing IDs and incorrect tokens return the same result.
- 403: browser-only operation attempted with controller token, or cross-origin request.
- 409: revision conflict.
- 413 / 415: body too large / wrong content type.
- 429: rate limit. Creation: 10 per IP per hour. Authenticated requests: 120 per token role per session per minute. Back off before retrying.
- 503: service unavailable/configuration missing. Retry with backoff; do not assume a write succeeded. GET the revision before retrying.

## curl example

Set `SESSION_API` and `SESSION_TOKEN` from the copied instructions in your private environment. Do not echo the token. Store the JSON payload in a file.

```sh
curl --fail-with-body -H "Authorization: Bearer $SESSION_TOKEN" "$SESSION_API"
curl --fail-with-body -X PUT -H "Authorization: Bearer $SESSION_TOKEN" \
  -H 'Content-Type: application/json' --data-binary @update.json "$SESSION_API"
```
