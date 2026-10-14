# Security control matrix

Scope: the Jabali storefront (`gift-shoe-app`) and the public `/store/*` API with customer authentication (`jabali-be`).
Method: OWASP ASVS 4.0 Level 2 requirements, mapped to ISO/IEC 27001:2022 Annex A controls.
Statuses: **Implemented** (in code, with a test or check), **Partial** (some of it), **Organisational gap** (needs people, process or a supplier, not code).

This document does not claim ISO certification or compliance. ISO 27001 certifies an organisation's management system; the "Organisational gap" rows are what remains for that.

| # | Control | ASVS 4.0 | ISO 27001:2022 | Where | Verification | Status |
|---|---|---|---|---|---|---|
| 1 | Passwords: 12 to 128 characters, common-password list, no email in password | 2.1.1, 2.1.2, 2.1.7 | A.5.17, A.8.5 | `jabali-be/src/customer-auth/password-policy.ts`, `gift-shoe-app/src/lib/password.ts` | `password-policy.spec.ts`, `password.test.ts` | Implemented |
| 2 | Password storage: argon2id (64 MiB, t=3, p=4) | 2.4.1 | A.8.24 | `customer-auth.service.ts` | `customer-auth.e2e-spec.ts` | Implemented |
| 3 | Generic login errors, equalised timing, account lockout (5 failures, 15 min) | 2.2.1, 2.2.3 | A.8.5 | `customer-auth.service.ts` | e2e: generic error, lockout | Implemented |
| 4 | Rate limiting on login (10/min/IP, 5/min/email), register, refresh; global 120/min/IP; SSE streams capped at 5/IP | 2.2.1, 11.1.4 | A.8.20, A.8.6 | `src/common/rate-limit/*`, `store-events.controller.ts` | `rate-limiter.spec.ts`, `rate-limit.e2e-spec.ts` | Implemented (single instance, in-memory) |
| 5 | Session tokens: short-lived access JWT, rotating refresh tokens, reuse detection revokes the family, logout revokes | 3.3.1, 3.5.1, 3.5.2 | A.8.5 | `customer-auth.service.ts` | e2e: rotation and reuse | Implemented |
| 6 | Customer and staff tokens cannot be used for each other's routes | 4.1.1, 4.1.3 | A.5.15, A.8.3 | `guards.ts`, `customer.guard.ts` | `guards.spec.ts`, e2e isolation test | Implemented |
| 7 | Orders require an authenticated customer; idempotency keys cannot replay another customer's order | 4.2.1, 4.1.1 | A.8.3 | `orders.service.ts`, `checkout.controller.ts` | `orders-auth.spec.ts`, `customer-orders.e2e-spec.ts` | Implemented |
| 8 | Input validation: DTO whitelist and forbid-unknown, body size 100 kB (oversize answers 413, not 500) | 5.1.3, 13.2.6 | A.8.28 | `setup.ts`, DTOs, `problem-details.filter.ts` | `hardening.e2e-spec.ts` | Implemented |
| 9 | SQL injection: Prisma parameterised queries; raw queries only as tagged templates | 5.3.4, 5.3.5 | A.8.28 | `src/**` | Code review of raw queries (no `$queryRawUnsafe` with input) | Implemented |
| 10 | Output encoding and no DOM injection sinks in the storefront | 5.3.3, 5.3.6 | A.8.28 | `gift-shoe-app/src` | `source-scan.test.ts` | Implemented |
| 11 | Untrusted CMS image URLs restricted to https (http only on localhost) | 5.1.5, 12.5.2 | A.8.28 | `src/lib/media.ts`, `Photo.tsx` | `media.test.ts` | Implemented |
| 12 | Content-Security-Policy without unsafe-eval or script unsafe-inline (hash for the one inline script) | 14.4.3, 14.4.7 | A.8.9, A.8.26 | `scripts/headers.mjs`, `write-headers.mjs` | `headers.test.mjs`, strict build proof, real-browser load with the generated headers | Partial: `style-src` keeps `'unsafe-inline'` |
| 13 | Transport and browser security headers (HSTS, nosniff, referrer, permissions, COOP, frame-ancestors) | 14.4.1-14.4.6, 9.1.1 | A.8.20, A.8.21 | `headers.mjs`, `src/setup.ts` | `headers.test.mjs`, `setup.spec.ts`, `hardening.e2e-spec.ts` | Implemented (host must honour `_headers`) |
| 14 | API responses: no framework banner; production CSP `default-src 'none'`; Swagger off in production | 14.3.2, 14.4.1 | A.8.9 | `src/setup.ts` | `setup.spec.ts`, e2e headers | Implemented |
| 15 | Uploaded files cannot run script in the API origin (sandbox CSP, nosniff) | 12.5.1, 12.4.1 | A.8.12 | `src/setup.ts` | `hardening.e2e-spec.ts` | Implemented |
| 16 | CORS allow-list; wildcard and non-https origins rejected in production | 14.5.3 | A.8.20 | `src/config/config.ts` | `config.spec.ts` | Implemented |
| 17 | Config safety: JWT secret 32+ characters, rate limiting cannot be disabled in production, secrets not in `VITE_*` | 14.1.3, 6.4.1 | A.8.9, A.5.17 | `config.ts`, `env-check.mjs` | `config.spec.ts`, `env-check.test.mjs` | Implemented |
| 18 | Security event logging with secret redaction and masked emails | 7.1.1, 7.1.2, 7.2.1 | A.8.15 | `src/common/security-log/*` | `security-log.spec.ts`, `security-log.e2e-spec.ts` | Implemented |
| 19 | Admin writes audited (existing) | 7.2.1 | A.8.15 | `audit.interceptor.ts` | existing | Implemented |
| 20 | Vulnerable dependencies: `npm audit --omit=dev --audit-level=high` passes in both repos | 14.2.1 | A.8.8 | `package.json` scripts and overrides | `npm run audit` | Implemented (see advisories below) |
| 21 | Error handling: RFC 7807 problem responses, no stack traces, generic client errors | 7.4.1 | A.8.28 | `problem-details.filter.ts`, `ErrorState.tsx` | existing | Implemented |
| 22 | Client token handling: access token in memory only, refresh token in `localStorage` | 3.2.3, 8.2.1 | A.8.24 | `src/store/authPersist.ts` | `authPersist.test.ts` | Partial: refresh token readable by injected script (mitigated by CSP) |
| 23 | Password reset (email verification at sign-up is row 34; the mail transport now exists, the reset flow is not built) | 2.5.x | A.5.17 | not built | n/a | Organisational gap |
| 24 | Phone ownership verification. A verified-email account is linked by phone to an existing guest `Customer` (so new orders attach to it), but never sees or edits that record (row 36). Order history for accounts must wait for phone verification. | 2.7.x | A.5.16 | not built (no SMS provider) | n/a | Organisational gap |
| 25 | Customer MFA | 2.8.x | A.8.5 | not built | n/a | Organisational gap |
| 26 | ISMS scope, security policies, roles and responsibilities | n/a | A.5.1, A.5.2, A.5.4 | n/a | n/a | Organisational gap |
| 27 | Risk assessment and treatment plan | n/a | clause 6.1 | n/a | n/a | Organisational gap |
| 28 | Supplier security (hosting, Safaricom, Unsplash) | n/a | A.5.19, A.5.21 | n/a | n/a | Organisational gap |
| 29 | Incident response plan and breach notification | n/a | A.5.24, A.5.26 | n/a | n/a | Organisational gap |
| 30 | Backups, restore testing, business continuity | n/a | A.8.13, A.5.30 | n/a | n/a | Organisational gap |
| 31 | Independent penetration test | n/a | A.8.29 | n/a | n/a | Organisational gap |
| 32 | Edge WAF and DDoS protection; shared rate-limit store for multiple API instances | n/a | A.8.20, A.8.6 | n/a | n/a | Organisational gap |
| 33 | Secrets manager and rotation; central log shipping, alerting and retention | n/a | A.8.15, A.8.16, A.5.17 | n/a | n/a | Organisational gap |
| 34 | Email verification at sign-up: 6-digit code from a CSPRNG, stored only as a keyed hash, 10 minute expiry, 5 attempts then void, constant-time compare; no tokens until verified; unverified accounts cannot sign in | 2.2.x, 2.3.x, 2.7.x | A.5.17, A.8.5 | `src/customer-auth/otp.ts`, `customer-auth.service.ts` | `otp.spec.ts`, `customer-auth.e2e-spec.ts` | Implemented |
| 35 | Resend and verify cannot be used to probe for accounts or flood a mailbox: identical responses for any email, 60 s cool-down and 5 codes per hour enforced silently, plus per-IP and per-email rate limits | 2.2.1, 2.2.3 | A.8.5, A.8.6 | `customer-auth.service.ts`, `customer-auth.controller.ts` | `customer-auth.e2e-spec.ts` | Implemented |
| 36 | No account pre-hijacking: activation needs the code AND the sign-up password; a pending sign-up cannot be continued with a different password; an abandoned sign-up frees its email and phone | 2.1.x, 3.x | A.5.15, A.8.3 | `customer-auth.service.ts` | e2e: pre-hijack scenario, password-bound verify | Implemented |
| 36a | A linked guest `Customer` record is never exposed or modified by the account (own display name; phone not editable via profile) | 4.1.x, 8.x | A.8.3, A.8.12 | `customer-auth.service.ts` | e2e: guest details never shown or edited | Implemented |
| 37 | Email content is HTML-escaped, subjects cannot carry extra headers, links use only the configured store URL | 5.3.3, 5.3.10 | A.8.28 | `src/mail/templates/*`, `mail.service.ts` | `templates.spec.ts`, `mail.service.spec.ts` | Implemented |
| 38 | SMTP credentials only in environment variables; TLS required for `smtp://` in production; production refuses to start without SMTP | 9.1.x, 14.1.3 | A.8.24, A.8.9 | `config.ts`, `mail.service.ts` | `config.spec.ts` | Implemented |
| 39 | Email logging masks recipients and never logs bodies or codes | 7.1.1, 7.1.2 | A.8.15 | `mail.service.ts`, `security-log.service.ts` | `mail.service.spec.ts`, `security-log.e2e-spec.ts` | Implemented |
| 40 | Sender authentication for the mail domain (SPF, DKIM, DMARC) and mail delivery monitoring | n/a | A.8.20, A.5.14 | n/a | n/a | Organisational gap |

## Remaining dependency advisories

`npm audit --omit=dev` reports 0 vulnerabilities in both repositories as of 2026-10-14. Two were cleared by pinning patched versions in `jabali-be/package.json` `overrides` instead of a breaking major upgrade, and must be revisited when the upstream packages ship fixed ranges:

- `js-yaml` pinned to 5.4.3 (advisory GHSA-r3ph-w7gj-g6xm, affects 5.0.0 to 5.4.0; pulled in by `@nestjs/swagger`).
- `deepmerge-ts` pinned to 8.0.2 (advisory GHSA-ggr8-5vv4-36mx, affects below 8.0.0; pulled in by the Prisma CLI through `@prisma/config`).
