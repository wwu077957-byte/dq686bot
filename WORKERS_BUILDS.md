# Deployment

This Worker is deployed by Cloudflare Workers Builds, connected 2026-11-10.
Pushes to main trigger a build: wrangler deploy runs in the cloudflare/ directory
(path setting), using cloudflare/wrangler.toml (KV binding BOT_KV, vars, cron triggers).
Secrets stay in the Cloudflare dashboard, never in this repo.
