# Security Policy

## Reporting a vulnerability

Please report security issues **privately** — do **not** open a public issue.
- Preferred: GitHub → the repo's **Security** tab → **Report a vulnerability** (private advisory).
- Or email **work@ottospace.co**.

You'll get an acknowledgement as fast as possible, and coordinated disclosure once a fix is ready.

## What Miraat does with your code

Miraat is a static analyzer that runs entirely on your machine.

- **Offline / telemetry-free.** It makes **no network calls** — nothing about your code, findings, or usage is ever sent anywhere. No analytics, no phone-home, no accounts. No optional network tiers — Miraat is offline end to end.
- **Read-scoped.** It only reads the files/paths you point it at, and writes **only** when you explicitly pass `--fix` (and only to those files, via AST-verified transforms). It never touches anything outside the target path.
- **No secrets handling.** It parses source for RTL layout patterns; it does not read `.env` files, credentials, or network resources.

## Supply chain

- **Zero runtime dependencies.** Nothing is pulled in at run time; a small `files` allowlist means only source + docs are published.
- Prefer a **pinned tag** — `npx github:Otto-OttoSpace/miraat@<tag>` — over a moving branch for reproducible, auditable runs.
- MIT-licensed; the full source is public and auditable.

## Supported versions

The latest published version receives fixes. Older 0.x versions are not maintained.
