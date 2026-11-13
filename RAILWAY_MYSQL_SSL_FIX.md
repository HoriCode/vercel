# e-Gabay PWD — fix HANDSHAKE_SSL_ERROR safely

Your Vercel logs showed `HANDSHAKE_SSL_ERROR: self-signed certificate in certificate chain`. The serverless API previously requested TLS but did not know the Railway MySQL certificate authority (CA). This release allows **DB_SSL_CA_BASE64** or **DB_SSL_CA**, and retains certificate verification (`rejectUnauthorized: true`). It does **not** disable TLS checks.

## 1. Get the *correct* CA from your own Railway MySQL service

Use your MySQL Workbench connection and run:

```sql
SHOW GLOBAL VARIABLES LIKE 'ssl_ca';
SHOW GLOBAL VARIABLES LIKE 'datadir';
```

For the official MySQL Docker image, the CA is commonly at `/var/lib/mysql/ca.pem`. Confirm the path shown by `ssl_ca` in your database. Use a Railway service shell/SSH terminal for **your MySQL container** to read this **public CA certificate only**. A Railway CLI connection can be opened with `railway ssh --service MySQL` (after `railway login` and `railway link`; select the actual MySQL service). If this is unavailable, contact Railway support for a supported CA retrieval method.

```sh
cat /var/lib/mysql/ca.pem
```

Copy from `-----BEGIN CERTIFICATE-----` through `-----END CERTIFICATE-----`. **Never copy `ca-key.pem`, `server-key.pem`, `client-key.pem`, any passwords, or connection URLs.** Confirm the CA came from your own service, not an untrusted public download.

In Windows PowerShell, if you saved the CA as `railway-mysql-ca.pem`:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes((Resolve-Path './railway-mysql-ca.pem')))
```

Alternatively paste the original multi-line PEM into `DB_SSL_CA` in Vercel if its UI supports multiline values; do not set both CA variables.

## 2. Update Vercel (Project → Settings → Environment Variables)

Keep `DB_HOST`, `DB_PORT`, `DB_NAME=e_gabay`, `DB_USER`, `DB_PASS`, `DB_SSL=true`, and `SESSION_SECRET`. Add **one** new secret variable:

```
DB_SSL_CA_BASE64=<base64 of the CA PEM copied from your own Railway MySQL service>
```

Then push the patched files to the `HoriCode/vercel` GitHub repository (the source of your Vercel project). Redeploy the current main branch. Changing only Vercel settings **without deploying the updated API code** cannot fix this.

## 3. Test

Register a fictional test user. If it still fails, look in Vercel → Logs for the new exact error. A certificate *hostname mismatch* needs Railway/provider support or a verified matching server certificate. Do not bypass certificate identity checking.

## More secure alternative

If the self-signed CA cannot be obtained or validated, run the Node backend **on Railway beside MySQL** and use Railway's private network for their connection, while keeping the static frontend on Vercel. This requires a backend/API routing migration; this ZIP does not implement that alternate architecture.

## Notes and safeguards

- No existing MySQL tables are modified. The provided `DEV_DATABASE_SCHEMA.sql` remains destructive and **must not be rerun** on your current database.
- Passwords and session secrets disclosed in screenshots or chat should be rotated and updated in Vercel. Never commit `.env` or certificates with private keys.
- Document uploads and some request features remain incomplete; do not use this development build for actual PWD identity or medical information.
- The certificate itself has not been retrieved or tested against your live Railway service in this environment. Supplying a trusted CA remains necessary to resolve the reported certificate-chain error.
