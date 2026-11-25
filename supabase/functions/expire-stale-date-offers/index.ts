/**
 * Edge Function: expire-stale-date-offers
 *
 * Scheduled expiry endpoint that invokes `public.expire_stale_date_offers()`
 * using the server-side `service_role` client.
 *
 * Authentication:
 *  - Accepts POST requests only.
 *  - Requires the `x-expire-secret` header matching the Supabase Edge Function
 *    secret `EXPIRE_STALE_DATE_OFFERS_SECRET` (constant-time HMAC verification).
 *  - Never accepts SQL, table names, or function names from the request.
 *
 * Deployment note:
 *  - Deploy with `--no-verify-jwt` because requests come from an external
 *    scheduler authenticated via `x-expire-secret`, not a member session JWT.
 *  - See `./README.md` for secret setup, deploy commands, and 5-minute external
 *    scheduler setup instructions.
 */

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { serviceRole, json } from "../_shared/supabase.ts";
import {
  createExpireStaleDateOffersHandler,
  EXPIRE_SECRET_ENV,
} from "./handler.ts";

const handler = createExpireStaleDateOffersHandler({
  getSecret: () => Deno.env.get(EXPIRE_SECRET_ENV),
  createServiceClient: () => serviceRole(),
  json,
});

serve(handler);
