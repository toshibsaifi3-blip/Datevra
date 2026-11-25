# Edge Function: `expire-stale-date-offers`

> **Status:** Code implemented in this repository. **Not deployed yet. Secret not set yet. No external scheduler is configured or active yet.**

## What This Function Does

`POST /functions/v1/expire-stale-date-offers` executes the existing database RPC `public.expire_stale_date_offers()` (defined in `db/migrations/030_date_offers_and_invitations.sql`, `SECURITY DEFINER`, executable only by `service_role`).

That RPC sweeps and expires overdue:
- `public.automatic_date_offers` (`status = 'pending' AND expires_at <= now()`)
- `public.manual_date_offers` (`status = 'pending' AND expires_at <= now()`)
- `public.date_invitations` (`status = 'active' AND expires_at <= now()`)
- `public.date_invitation_recipients` (`response = 'pending'` belonging to newly expired invitations)

### Security Design
- Accepts **`POST` only** (`405 Method Not Allowed` with `Allow: POST` for all other methods).
- Requires the **`x-expire-secret`** header, verified in constant time against the server-side environment secret **`EXPIRE_STALE_DATE_OFFERS_SECRET`** (`401` on missing/invalid header, `503` if the secret is unset).
- Uses the server-side `serviceRole()` client (`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` injected automatically by Supabase Edge Functions).
- Hardcodes `supabase.rpc("expire_stale_date_offers")` with zero arguments and ignores any request body or query string.
- Never logs secret values and never exposes `EXPIRE_STALE_DATE_OFFERS_SECRET` or `SUPABASE_SERVICE_ROLE_KEY` to frontend code.

## Current Repository Deployment State (Inspected)

- There is currently **no `supabase/config.toml`** in this repository.
- No Supabase project ref or scheduler configuration is pre-configured in this workspace.
- Replace `<project-ref>` below with your actual Supabase project reference ID.

---

## Step 1 — Generate & Set the Edge Function Secret (Your Action)

Generate a strong random secret (at least 32 bytes / 64 hex characters):

```bash
openssl rand -hex 32
```

Store it as a Supabase Edge Function secret (never commit it to git and never add it as a `VITE_*` variable):

```bash
supabase secrets set EXPIRE_STALE_DATE_OFFERS_SECRET="<paste-generated-secret>" --project-ref <project-ref>
```

> `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically by the Supabase Edge Functions runtime.

---

## Step 2 — Deploy the Edge Function (Your Action)

Because this endpoint is invoked by an external scheduler authenticating with `x-expire-secret` (not a member JWT), deploy it with `--no-verify-jwt`:

```bash
supabase functions deploy expire-stale-date-offers --no-verify-jwt --project-ref <project-ref>
```

### Verify After Deployment

```bash
# 1. Wrong HTTP method -> expects HTTP 405
curl -i -X GET "https://<project-ref>.supabase.co/functions/v1/expire-stale-date-offers"

# 2. Missing secret header -> expects HTTP 401
curl -i -X POST "https://<project-ref>.supabase.co/functions/v1/expire-stale-date-offers"

# 3. Valid secret header -> expects HTTP 200 {"ok":true,"rpc":"expire_stale_date_offers","executedAt":"..."}
curl -i -X POST "https://<project-ref>.supabase.co/functions/v1/expire-stale-date-offers" \
  -H "x-expire-secret: <paste-generated-secret>"
```

---

## Step 3 — Configure an External Scheduler Every 5 Minutes (Your Action)

> **Important:** No scheduler is configured or active yet. Choose **one** external scheduler below and configure it after Step 1 and Step 2 succeed.

- **Target URL:** `https://<project-ref>.supabase.co/functions/v1/expire-stale-date-offers`
- **Method:** `POST`
- **Schedule:** Every 5 minutes (`*/5 * * * *`)
- **Required Header:** `x-expire-secret: <EXPIRE_STALE_DATE_OFFERS_SECRET>`
- **Body:** None required (any body is ignored).

### Option A — Hosted HTTP Cron Service (e.g., cron-job.org, Upstash QStash, Render/Cloudflare Cron)
1. Create a new scheduled HTTP job with cron expression `*/5 * * * *`.
2. Set Method to `POST` and URL to `https://<project-ref>.supabase.co/functions/v1/expire-stale-date-offers`.
3. Add HTTP header `x-expire-secret` with the exact value stored in `EXPIRE_STALE_DATE_OFFERS_SECRET` (use the provider's encrypted secret/header vault).
4. Set a reasonable timeout (e.g., 15 seconds) and enable failure alerts for non-2xx responses.

### Option B — GitHub Actions Scheduled Workflow
Add encrypted repository secrets `SUPABASE_PROJECT_REF` and `EXPIRE_STALE_DATE_OFFERS_SECRET` in GitHub (**Settings → Secrets and variables → Actions**), then create `.github/workflows/expire-stale-date-offers.yml`:

```yaml
name: Expire Stale Date Offers

on:
  schedule:
    - cron: "*/5 * * * *"
  workflow_dispatch:

jobs:
  expire:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger expire-stale-date-offers Edge Function
        env:
          PROJECT_REF: ${{ secrets.SUPABASE_PROJECT_REF }}
          EXPIRE_SECRET: ${{ secrets.EXPIRE_STALE_DATE_OFFERS_SECRET }}
        run: |
          curl --fail --silent --show-error --max-time 15 \
            -X POST "https://${PROJECT_REF}.supabase.co/functions/v1/expire-stale-date-offers" \
            -H "x-expire-secret: ${EXPIRE_SECRET}"
```

> Note: GitHub Actions cron schedules can experience occasional minute-level queueing delays; for strict 5-minute precision, prefer Option A or Option C.

### Option C — Server `crontab`
Store `EXPIRE_STALE_DATE_OFFERS_SECRET` in a root-readable `0600` env file (not inline in the crontab command string so it stays out of process listings), and trigger via `curl --config`:

```cron
*/5 * * * * /usr/local/bin/datevra-expire-stale-date-offers.sh
```
