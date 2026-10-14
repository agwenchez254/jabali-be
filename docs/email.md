# Email

The API sends three transactional emails. Templates live in `src/mail/templates/`; each has an HTML part and a plain-text part.

| Email | When | Contents |
|---|---|---|
| **Verification code** | A customer signs up (and when they ask for a new code) | A 6-digit code, valid for 10 minutes. The code is never in the subject or in a link. |
| **Welcome** | The moment the code is confirmed and the account becomes active | A branded welcome with Jabali's four promises and shop and gift links. |
| **Order confirmation with receipt** | An order is created (not on an idempotent replay) | Itemised receipt in the body: lines, subtotal, discount, delivery, total in KES, payment instructions, delivery or pickup details. |

Sending is fire-and-forget with three attempts (now, after 2 s, after 10 s). A mail failure never fails a request, and the body of a message is never logged (recipients are masked).

## How sign-up and activation work

1. `POST /api/v1/store/auth/register` creates a **pending** account, emails a code and returns `{ email, expiresInSeconds: 600, resendAfterSeconds: 60 }`. There are no tokens yet.
2. `POST /api/v1/store/auth/verify` with `{ email, code, password }` activates the account, sends the welcome email and returns the first tokens. The password is the one chosen at sign-up: activation needs the code **and** the password, so nobody can finish somebody else's half-started sign-up.
3. `POST /api/v1/store/auth/resend` with `{ email }` always answers `200 { resendAfterSeconds: 60 }`. It sends a fresh code only for a pending account, at most once a minute and five an hour, and says nothing about whether the email exists.
4. Five wrong codes void the current code (request a new one). Signing in before activating answers `403 email_not_verified` (only after a correct password).
5. A second sign-up for a still-pending email with a different password answers `409 signup_in_progress` (with the same password it just re-sends the code). An abandoned sign-up frees its email and phone once its code has expired.

## Configure

| Variable | Meaning |
|---|---|
| `SMTP_URL` | `smtp://user:pass@host:587` (STARTTLS) or `smtps://user:pass@host:465`. Empty means log-only (nothing is sent) in development and test. **Required in production.** |
| `MAIL_FROM` | Sender, e.g. `Jabali <orders@yourdomain.com>`. The domain needs SPF, DKIM and DMARC records at your provider or mail will land in spam. |
| `MAIL_REPLY_TO` | Optional reply address. |
| `STORE_URL` | Public storefront URL used for links in emails. Must be https in production. |

Any SMTP provider works (Amazon SES SMTP, SendGrid, Mailgun, Zoho, Google Workspace app password). In production, connections to `smtp://` URLs require TLS.

## Try it locally

1. `docker compose up -d mailpit` (SMTP on 1025, inbox UI on http://localhost:8025). This is a dev-only catcher: nothing is delivered to real addresses.
2. Put `SMTP_URL=smtp://localhost:1025` in `.env` and restart the API.
3. Sign up through the storefront (or `POST /api/v1/store/auth/register`): the verification email appears in Mailpit. Confirm the code to receive the welcome email.
4. `npm run mail:sample` sends the verification, welcome and a sample receipt so you can review all three layouts.

## Known limits

- The storefront checkout still simulates orders locally, so the order email is sent only for orders created through the API (`POST /api/v1/store/orders`) until real order placement is wired into the storefront.
- Retries are in memory; a crash during the 12 s retry window loses that email. A database-backed outbox is the upgrade path.
- Not built yet: password reset, order status emails (paid, shipped, delivered), a PDF receipt attachment.
