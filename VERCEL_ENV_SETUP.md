# e-Gabay PWD: Vercel environment variables

Your app's Node API uses **seven** variables. In Vercel -> Project -> Settings -> Environment Variables, enter each name and value separately (no `export`, quotation marks, or surrounding spaces):

| Vercel key | Where the value comes from |
| --- | --- |
| `DB_HOST` | Public MySQL hostname from the database provider (Railway TCP Proxy host if using Railway) |
| `DB_PORT` | Public MySQL port from the provider (Railway's proxy port may **not** be 3306) |
| `DB_NAME` | Database name; Railway `MYSQLDATABASE` |
| `DB_USER` | Database user; Railway `MYSQLUSER` |
| `DB_PASS` | Database password; Railway `MYSQLPASSWORD` |
| `DB_SSL` | `true` when the provider's public endpoint supports TLS; otherwise `false` for development only |
| `SESSION_SECRET` | Generate a new random secret: `openssl rand -hex 32` |

**Do not enter the placeholder strings from `.env.example` as real values.** A Railway `*.railway.internal` hostname works only within Railway's network, not from Vercel. Use the *public* TCP proxy endpoint from Railway's MySQL connection panel. Ask the provider about TLS requirements; the current Node API uses `ssl: {minVersion:'TLSv1.2'}` when `DB_SSL=true`.

Add variables to the Production environment, save, and **redeploy** to apply changes. Vercel does not automatically get variables from a `.env.example` file in GitHub; that file is only a template.

**Database setup:** Use `DEV_DATABASE_SCHEMA.sql` on an empty TEST database only. It contains destructive `DROP TABLE` statements and must not be imported over an existing populated database. Do not use this development build with real PWD medical records or identity documents until the incomplete upload/authorization features have been implemented and tested.

Troubleshooting: open your deployment's **Functions Logs** in Vercel. `Database environment variables are not configured` means one of the required `DB_*` keys is missing. Connection timeout generally means the host/port is private, incorrect, or blocked. An access-denied error indicates credentials or MySQL user permissions need checking. Never paste passwords or `SESSION_SECRET` in chat/screenshots.

## Railway self-signed certificate fix (Nov 2026)

For `HANDSHAKE_SSL_ERROR: self-signed certificate in certificate chain`, the API now supports a PEM CA via `DB_SSL_CA_BASE64` (preferred for Vercel) or `DB_SSL_CA`. Keep `DB_SSL=true` and provide the actual MySQL CA from your own Railway service. Do not use `rejectUnauthorized: false`. See **RAILWAY_MYSQL_SSL_FIX.md** for instructions. This does not automatically provide or authenticate your database's CA certificate.
