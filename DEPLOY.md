# Deploying to Vercel + Neon (free)

The whole app is a single Next.js project talking to one Postgres database,
so deployment is just "push the frontend, point it at a managed Postgres."
Total cost: **$0/month** on both services' free tiers.

## 1. Create a Neon Postgres database

1. Sign up at [neon.tech](https://neon.tech) and create a project.
2. Copy the connection string it gives you (the "pooled connection" one is
   fine — Prisma works through it). It looks like:
   `postgresql://user:password@ep-xxx.neon.tech/neondb?sslmode=require`
3. `pg_trgm` (used for search and related-word suggestions) is available on
   Neon by default — no extra setup needed, the app's own migration enables
   it.

## 2. Create a Google OAuth client for the production domain

In the same [Google Cloud OAuth client](https://console.cloud.google.com/apis/credentials)
used for local dev (or a new one), add:

- Authorized JavaScript origin: `https://<your-vercel-domain>`
- Authorized redirect URI: `https://<your-vercel-domain>/api/auth/callback/google`

(`<your-vercel-domain>` is either the `*.vercel.app` domain Vercel assigns,
or a custom domain you attach afterward — either way, come back and add it
here once you know it.)

## 2b. Google Calendar (optional, but needed for the day timeline)

Signing in only needs the basic profile scopes, which Google treats as
non-sensitive — that's why login works on an unverified app. The calendar
integration asks for `https://www.googleapis.com/auth/calendar.events`,
which is a **sensitive** scope, and sensitive scopes are gated on who is
allowed to consent. Getting `Error 403: access_denied` on the consent
screen is that gate, not a bug in the request.

In the [Google Auth Platform](https://console.cloud.google.com/auth/overview)
section of the console:

1. **Data access** → add the scope `.../auth/calendar.events`.
2. **Audience** → this is the part that causes 403:
   - If publishing status is **Testing**, only accounts listed under **Test
     users** may consent. Add the Google account you sign in with. Note the
     cost: in Testing, **refresh tokens expire after 7 days**, so the app
     will ask you to re-link the calendar every week.
   - **Publish app** moves it to production. A sensitive scope on an
     unverified app shows an "unverified app" interstitial (continue via
     *Advanced*), and there is a 100-user cap, but refresh tokens stop
     expiring. For a single-user deployment this is usually the better
     trade. Full verification is only worth starting if real users are
     going to sign in.
3. **APIs & Services → Library** → enable **Google Calendar API** for the
   project. (A disabled API fails later, at the first calendar request
   rather than at consent — worth ruling out while you're here.)
4. **Credentials** → the same OAuth client used for login needs one more
   authorized redirect URI:
   `https://<your-vercel-domain>/api/google-calendar/callback`

One more thing that produces the same 403: consenting while signed into a
different Google account than the one you added — a Workspace account, for
instance, whose admin blocks unconfigured third-party apps. Check the
account shown in the top-right of the consent screen.

## 3. Deploy to Vercel

1. Import this repository into [Vercel](https://vercel.com/new).
2. Set the **Root Directory** to `frontend`.
3. Add these Environment Variables:
   - `DATABASE_URL` — the Neon connection string from step 1
   - `AUTH_SECRET` — a random string, e.g. `openssl rand -base64 33`
   - `AUTH_GOOGLE_ID` — the Google OAuth client ID
   - `AUTH_GOOGLE_SECRET` — the Google OAuth client secret
4. Deploy. The build runs `prisma migrate deploy` before `next build` (see
   `frontend/package.json`), so the database schema is created/updated on
   every deploy automatically — no separate migration step needed.

That's it — no servers, containers, or reverse proxy to manage. Vercel
terminates HTTPS and handles scaling/cold starts on its free tier.

## Updating

Just push to the branch Vercel is tracking — it redeploys (and re-runs
migrations) automatically.

## Notes

- The app talks to Postgres directly from Next.js server code (Server
  Actions / Server Components), so there's nothing else to expose publicly.
- If you outgrow Neon's free tier (usage-based compute/storage limits) or
  Vercel's, both have inexpensive paid tiers that scale up without changing
  anything in this repo.
