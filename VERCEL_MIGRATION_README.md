# e-Gabay: Vercel Node.js migration (DEVELOPMENT BUILD — NOT PRODUCTION READY)

This is a **partial, source-level PHP-to-Node migration** of the e-Gabay site. The frontend stays under the same paths. The existing PHP API URL pattern (`api/login.php`) is rewritten to one Node.js function (`api/handler.js`), which uses MySQL 8+ via `mysql2`.

**Do not deploy as a live service for real persons with disabilities or upload sensitive identification/medical documents until all endpoints, permissions, security measures, and storage are completed and tested.** The PHP source is not needed for deployment and is deliberately omitted from the deployable project.

## Current status

Implemented in the Node function:
- Login: supports existing PHP bcrypt `$2y$` password hashes; secure, signed, HttpOnly cookie.
- Registration (PWD/caregiver only), logout, session, profile, password changes.
- Announcements (list/create/delete), notifications, mark notifications read.
- Current user's request history and access-controlled tracking.
- Staff/admin request listing and request detail metadata, status updates, staff/admin user listing/detail/update.
- MySQL parameterized queries and some audit entries, role checks, CSRF checks for state-changing operations.

**New in this release:** `assistance_create.php`, `id_application_create.php`, `document_upload.php`, and authenticated `document_download.php` are implemented using private Vercel Blob and the existing MySQL tables. **You must create and connect a PRIVATE Vercel Blob store first.** `profile_picture.php` still returns HTTP 501. The existing `my_request.php` edit/delete endpoint includes ownership and status checks. This remains a research/development build; follow `REQUEST_AND_DOCUMENT_SETUP.md`.

Not implemented: production rate limiting, password-reset flow, malware scanning, document-retention automation, production security audit, deployment/environment testing, application data import, and live infrastructure setup. Existing signed cookie sessions cannot be revoked early without server-side session storage; password changes do not invalidate other sessions. Add server-side revocation before handling sensitive personal data.

## Deploy to Vercel (development only)

1. Back up the existing Vercel project and database. Import `DEV_DATABASE_SCHEMA.sql` separately into a **privately hosted MySQL** database. NOTE: the supplied original SQL has `CREATE DATABASE`, `USE`, DROP TABLE statements, and a seeded administrator account — **do not run it against an existing production database**. Use an isolated development database and do not expose the SQL publicly.
2. For hosted MySQL, ensure your provider accepts secure connections from Vercel Functions, and grants only the necessary database privileges. If the provider assigns a database name and disallows CREATE DATABASE, adjust the SQL before import.
3. Push the *contents* of this project as the Vercel project root. The `api/handler.js` file is a Node.js function; `vercel.json` rewrites legacy `api/*.php` URLs to it.
4. In Vercel **Project → Settings → Environment Variables**, set:
   - `DB_HOST` (hosted database hostname)
   - `DB_PORT` (typically `3306`)
   - `DB_NAME` (the imported database, e.g. `e_gabay`)
   - `DB_USER` (dedicated app user, NOT root)
   - `DB_PASS` (database secret)
   - `DB_SSL=true` if your provider supports/mandates TLS (usually recommended)
   - `SESSION_SECRET` (32+ character cryptographically random secret, use `openssl rand -hex 32`)
5. Re-deploy after adding environment variables (they don't affect an existing deployment automatically).
6. Inspect `https://YOUR-PROJECT.vercel.app/api/session.php` — unauthenticated access should return **401 JSON**, not **405** or HTML. Use Network tab to see the status and response of login requests.
7. Test in a sandbox using non-sensitive dummy records and verify roles, cookie behavior, CSRF, DB connectivity, and every remaining endpoint before enabling real usage.

## Compatibility/security considerations

- Default login redirects and most existing frontend calls still use `api/*.php` paths; the Vercel rewrite provides compatibility without executing PHP.
- PHP's `password_hash()` using bcrypt is supported by replacing the hash prefix `$2y$` with `$2b$` for verification; newly registered passwords use bcryptjs.
- Same-origin, Secure, HttpOnly, SameSite=Lax cookies are used for sign-in; JSON POST APIs check CSRF tokens where implemented.
- The original SQL sample includes an admin seed hash. This corrected build includes a development-only schema with that admin seed removed. Never run destructive schema scripts against an existing database. For production provision admin accounts securely and rotate test credentials.
- Vercel Functions have read-only deployment storage (ephemeral `/tmp` only); uploaded PWD ID/medical documents now use private persistent Blob storage with authenticated access and require a PRIVATE Blob store to be connected. Never expose file URLs publicly or serve sensitive files as static assets.
- `mysql2` pooling per function instance is used; review DB provider connection limits and TLS setup.
- Vercel Function request/response payload maximum is currently 4.5 MB, which affects the original 5 MB document-upload limit. The implemented client sends each file separately (2 MiB maximum) through authenticated functions to private Blob storage.

## Smoke tests

Static syntax checks:

```sh
node --check api/handler.js
node --check assets/js/app.js
node --check assets/js/auth.js
```

Then test in Vercel with development DB:

- `GET /api/session.php` without login -> 401 JSON
- `POST /api/login.php` with dummy account -> 200 JSON; `Set-Cookie` header
- `GET /api/session.php` after login -> 200 JSON with user and CSRF token
- `POST /api/logout.php` -> 200 JSON; cookie cleared
- `POST /api/id_application_create.php` -> creates request and attaches previously uploaded private documents

## Original project

Keep your original `.rar` backup. The Node migration does not delete, overwrite, or import your original PHP/database source. For production, implement profile picture uploads if needed, add revocable sessions, malware scanning, retention controls and complete end-to-end testing.
