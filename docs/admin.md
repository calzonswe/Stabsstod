# Admin guide — Stabsstöd

Covers Caddy CA trust, user/incident management, sync, backup, and day-to-day
operations. Swedish is the default UI language; English is available via the
language switch in the header.

## 1. Caddy CA and HTTPS

Caddy terminates TLS with `tls internal`, issuing its own root CA. Client
devices must trust this CA for service workers (and therefore offline mode) to
install.

### Fetching the CA certificate

The CA cert is served by Caddy at:

```
https://<server-hostname>:/cadavercert
```

(Or export it from the running Caddy container: the certificate file is under
the Caddy data path, typically `/data/caddy/authorities/local/root.crt`.)

### Installing on a device

- **Linux**: copy the `.crt` to `/usr/local/share/ca-certificates/` and run
  `update-ca-certificates`.
- **Windows**: import into "Trusted Root Certification Authorities" (certlm.msc).
- **macOS**: add to Keychain Access and set trust to "Always Trust".
- **iOS/Android**: install the profile/certificate and enable full trust for SSL.

After install, open `https://<server-hostname>/` on the device. The service
worker registers and the app works offline. The header shows an offline
indicator when there is no network, and an in-app diagnostic reports
"Offline support: active / not available — why".

## 2. Bootstrap admin and first login

On first start, the API bootstraps an `admin` user from the `ADMIN_PASSWORD`
env var in `.env`.

1. Open `https://<server-hostname>/`.
2. Log in as `admin` with `ADMIN_PASSWORD`.
3. Set a new password (min 12 chars, letter + digit, not the username). The
   old bootstrap password is invalidated.
4. You land on the home page. The admin can now go to **Insatser → Skapa
   insats** and to **Inställningar → Användarhantering**.

## 3. User management (Inställningar → Användarhantering)

- **Skapa användare**: username, password (policy enforced), optional display
  name, role (`user` or `admin`).
- **Inaktivera / Aktivera**: disabling a user prevents new logins; existing
  sessions are not forcibly ended (use "Logga ut alla enheter" on /konto for
  that).
- **Återställ lösenord**: issues a policy-compliant temporary password. Show it
  to the user; they must change it at next login.

Roles: `admin` can manage users, settings, and all incidents. `chief_of_staff`
and `deputy_chief` can write mission/direction and manage members/functions.
`function_lead` and `staff_member` write within their functions. `observer`
sees only.

## 4. Incidents and members

From **Insatser**:
- **Skapa insats**: name, type, start time, and which functions to pre-create.
- Inside an incident, **Stab → Lägg till medlem** adds existing users to the
  incident with a role and optional function assignment.

## 5. Sync and offline

The client sync engine (plan §5.3):

- Pushes the local outbox to `POST /api/sync/push` (idempotent on record id;
  server assigns `serverSeq`).
- Pulls via `GET /api/sync/pull?since=`.
- Live updates via SSE `GET /api/events` (`event: records`).
- Triggers: browser `online` event, tab focus, and a 30 s re-query on
  ingestion.

Unknown parent ids are not errors — a record can reference a parent that
hasn't arrived yet; it resolves when the parent is pulled.

Append-only: every change is a new versioned `RecordEnvelope`. "Delete" is a
`retract` record with a reason. Postgres triggers reject `UPDATE`/`DELETE` on
`records`.

## 6. Backup

```
scripts/backup.sh
# → data/backups/<YYYYMMDD-HHMMSS>/db.sql.gz, attachments.tar.gz, manifest.txt
```

Backed up online; the stack keeps serving. Copy `data/backups/` off the server
for real backup purposes. `.env` is not backed up.

Restore:

```
scripts/restore.sh [data/backups/<YYYYMMDD-HHMMSS>]
```

Destructive — replaces the database and attachments volume.

## 7. Password policy

- Min 12 characters, at least one letter and one digit, not the username.
- Changes must differ from the current password.
- Enforced on change-password, user creation, and password reset.
- Temporary passwords (reset) always satisfy the policy.

## 8. Security headers

Set on every API response (static assets too):

| Header | Value |
|--------|-------|
| `Strict-Transport-Security` | `max-age=31536000` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `no-referrer` |
| `Content-Security-Policy` | `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'` |

## 9. Not in v1

SSO, chat, need-to-know partitioning, multi-organisation, native apps, server
clustering, server-side PDF rendering. Address-level search may be too heavy;
city/place/kommun/län search is the fallback.
