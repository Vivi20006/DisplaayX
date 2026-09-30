# DisplayX — website & account backend

Product site for **DisplayX** (displayx.lol) plus the account system the site and the desktop app use:
register / sign in with **email, Google or Discord**, email verification, password reset,
**two-factor authentication (TOTP + recovery codes)**, account dashboard and the gated download.

- `public/` — the static site (plain HTML/CSS/JS, no build step, no external CDNs/trackers)
- `server/` — Node.js + Express API, SQLite via the built-in `node:sqlite`
- `test/` — API tests (`npm test`)

## Run locally

Requires **Node.js 22.13+**.

```bash
npm install
cp .env.example .env      # optional for local dev
npm run dev               # http://localhost:3000
```

Without SMTP configured, verification and reset emails are printed to the server console —
open the link from there. Without Google/Discord credentials, those buttons return to the
sign-in page with a “not available” message.

## Design

Black / violet look (same design language as the NOVA site): `#050408` background, violet `#a855f7` / `#c084fc`,
glowing panels, gradient buttons with a shine sweep, segmented controls with a gliding highlight, a glowing
custom cursor (mouse only) and a short warp-speed intro on the home page (once per browser session,
skippable, never with `prefers-reduced-motion`; `/?intro` replays it). Fonts: **Geist** and **Geist Mono**,
self-hosted in `public/fonts/` (SIL Open Font License, see `public/fonts/LICENSE.txt`) — no Google Fonts.

## Pages

| URL | |
|---|---|
| `/` | Home: intro, hero with before/after slider, built-for marquee, feature bento, ultra-zoom demo, equalizer demo, optimizer preview, auto-connect, colour lab, download, honest limits, FAQ |
| `/register`, `/login` | Sign in / register tabs (email, Google, Discord), verification states, 2FA step with 6-digit code boxes |
| `/forgot-password`, `/reset-password` | Password reset |
| `/dashboard` | Download, account details, change/set password, 2FA, sign out everywhere, delete account |
| `/imprint`, `/privacy` | **Templates** — fill in the `[bracketed]` values before going live |
| anything else | 404 |

## API

The contracts from the brief are kept as-is; everything else is additive.

| Method & path | Body | Result |
|---|---|---|
| `POST /api/auth/register` | `email, username, password` (min 6) | `{ token, user, needsVerification: true }` |
| `POST /api/auth/login` | `email, password` | `{ token, user }` · 403 `{ needsVerification: true }` · **new:** `{ needs2fa: true, twoFactorToken }` when 2FA is on |
| `POST /api/auth/2fa/verify` | `twoFactorToken, code` (6 digits or recovery code) | `{ token, user }` |
| `POST /api/auth/resend-verification` | `email` | `{ sent: true }` |
| `GET /api/auth/verify?token=…` | | redirect `/login?verified=1` (or `=0` if invalid/expired) |
| `POST /api/auth/forgot-password` | `email` | `{ sent: true }` |
| `POST /api/auth/reset-password` | `token, newPassword` | `{ success: true }` — signs out all sessions |
| `GET /api/auth/me` | Bearer | `{ user: { id, email, username, role, created_at, last_login, email_verified, auth_provider, has_password, two_factor_enabled, linked_providers } }` |
| `POST /api/auth/change-password` | Bearer · `currentPassword` (omit for OAuth-only), `newPassword` | `{ success: true, token }` — other sessions are signed out, `token` replaces the current one |
| `POST /api/auth/logout-all` | Bearer | `{ success: true }` |
| `GET /api/auth/2fa` | Bearer | `{ enabled, recoveryCodesLeft }` |
| `POST /api/auth/2fa/setup` | Bearer · `password` (if the account has one) | `{ secret, otpauthUrl, qr }` |
| `POST /api/auth/2fa/enable` | Bearer · `code` | `{ enabled: true, recoveryCodes: [10] }` |
| `POST /api/auth/2fa/disable` | Bearer · `password`, `code` | `{ enabled: false }` |
| `POST /api/auth/2fa/recovery-codes` | Bearer · `code` | `{ recoveryCodes }` |
| `DELETE /api/auth/account` | Bearer · `confirm` (username), `password`, `code` if 2FA | `{ success: true }` |
| `GET /api/oauth/google`, `GET /api/oauth/discord` | | provider login → `/dashboard?token=…&email=…`, or `/login?twofa=…` if 2FA is on |
| `GET /api/download/info` | | `{ version, size, os, available }` |
| `POST /api/download/link` | Bearer | `{ url }` — signed link, valid 2 minutes |

Token is stored client-side in `localStorage` under `dx_token`; a 401 from `/me` signs the user out.

> **Desktop app:** if the app signs in via `POST /api/auth/login`, it needs to handle the new
> `needs2fa` response — ask for the code and call `POST /api/auth/2fa/verify`.
> Accounts without 2FA behave exactly as before.

## Security notes

- Passwords: bcrypt (cost 12). Sessions: HS256 JWTs carrying a per-user `token_version`, so
  password change/reset and “sign out everywhere” revoke every existing token.
- Email verification and reset tokens are random, stored only as SHA-256 hashes, single-use, expiring (24 h / 1 h).
- TOTP secrets are AES-256-GCM encrypted at rest; codes can't be replayed; recovery codes are bcrypt-hashed and single-use.
- OAuth uses a `state` cookie. Only provider-verified emails are accepted. If an OAuth login matches an
  **unverified** email/password account, the unproven password is dropped (prevents pre-registration takeover).
- Rate limits on register, login (per IP and per email), 2FA, resend and reset (in-memory; single instance).
- Strict CSP (`'self'` only, no inline scripts/styles), `Referrer-Policy: no-referrer`, HSTS when served over HTTPS.
- Responses never reveal whether an email has an account (resend / forgot password).

## Assets to add

- `public/assets/scenes/grass.jpg`, `snow.jpg`, `desert.jpg` — real game scenes for the hero before/after and the colour lab.
  The bundled `.svg` illustrations are used until the `.jpg` files exist.
- The installer: `downloads/DisplayX.exe` or `DOWNLOAD_URL`.

## Deploy

Run `npm start` behind a reverse proxy with HTTPS, set `NODE_ENV=production`, `PUBLIC_URL`,
`JWT_SECRET`, SMTP and OAuth credentials, and back up the `data/` directory (SQLite database).

## Content rules

Copy follows the product brief: no invented numbers, reviews, user counts or prices. The unverified
performance claims (“< 1 % idle CPU”, “124 ms cold start”, “0 driver restarts”) are intentionally not used.
