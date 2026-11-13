# e-Gabay PWD — Vercel deployment guide (development/testing only)

## What this corrected ZIP includes
- Static frontend and Vercel Node.js API in `api/handler.js`.
- Legacy `/api/*.php` rewrites to the Node.js handler (PHP is not executed on Vercel).
- Fixed request editing/deletion endpoint (`my_request`); only the owning PWD/caregiver may edit/delete requests still in `Received` status. Requests with stored document records are deliberately protected from deletion because deleting their DB records alone cannot remove external files safely.
- Cleaned obsolete PHP/XAMPP/localhost advice in frontend JavaScript.
- Development-only database schema without the original sample administrator account (`DEV_DATABASE_SCHEMA.sql`). **Warning:** this script DROPS tables; use only on a fresh disposable database.

## Important limitations
This remains a **partial migration**. The following routes intentionally respond HTTP 501:
- `assistance_create.php`
- `id_application_create.php`
- `profile_picture.php`
- `document_download.php`

Do NOT collect real PWD IDs, medical certificates or personal records in this development build. Vercel Functions do not supply persistent local uploads. To finish these features, use authenticated private object storage, server-verified permissions for every download, file size/type validation, malware scanning, and direct uploads appropriate for the platform's payload limits. Do not make document blobs public.

You will need a separately hosted MySQL 8+ database reachable from Vercel, with TLS where available. Your XAMPP `localhost` MySQL will not work from Vercel.

## Deployment procedure
1. Create a **new, empty development database** on a MySQL host, and import `DEV_DATABASE_SCHEMA.sql` only there. If your host does not permit `CREATE DATABASE`, remove the initial `CREATE DATABASE` / `USE` statements and select the assigned database in your SQL client. Never import it over existing project records.
2. Upload this project's **extracted contents** to a GitHub repository (not the ZIP itself) and import that repo using Vercel → Add New → Project. Framework preset: **Other**. Root directory: repository root. No custom build command is needed.
3. Set the Vercel environment variables `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASS`, `DB_SSL`, and `SESSION_SECRET` per `.env.example`. Set `SESSION_SECRET` to at least 32 random characters. Keep secrets in Vercel environment variables, never GitHub.
4. Deploy / redeploy. Visit `https://YOUR-PROJECT.vercel.app/` and verify `/api/session.php` returns a JSON `401` when not logged in, not an HTML `404`/`405`.
5. Register a dummy PWD/caregiver account (without real private data), then test login and profile. No admin account is pre-created: admin provisioning requires a secure admin bootstrap process before staff/admin testing; do not register privileged roles publicly.
6. Check Vercel Logs for Node/API errors and verify database networking/permissions.

## Local validation
```
node --check api/handler.js
node --check assets/js/app.js
node --check assets/js/auth.js
npm install
```
`npm install` requires a working npm registry connection. Node syntax checks alone do not prove that Vercel deployment, MySQL access, or APIs work in production.

## Security notes
- The supplied original SQL file contains a seeded privileged account hash; do not publish or use it for production. This ZIP's dev schema omits that account.
- The database schema is development-only; the front-end and API have not undergone production security tests.
- File upload/download, session revocation, rate limiting, and a safe administrative onboarding mechanism must be completed before a real service launch.
