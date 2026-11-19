# Kupit

Offline-first personal budgeting PWA for Filipino users. The local Dexie database remains usable without an account; Supabase email sign-in and cloud sync are optional.

## Run locally

```powershell
pnpm install
pnpm dev
```

Open the URL Vite prints (usually `http://localhost:5173`).

## Optional Supabase backend

1. Create a Supabase project.
2. In **SQL Editor**, run [`supabase/migrations/20261119223000_cloud_sync.sql`](./supabase/migrations/20261119223000_cloud_sync.sql).
3. In **Authentication → URL Configuration**, set the Site URL to your production origin, and allow these redirect URLs:
   - `http://localhost:5173/**`
   - `https://YOUR-PRODUCTION-DOMAIN/**`
   - Add your Vercel preview URL pattern if you will test sign-in on previews.
4. In **Project Settings → API**, copy the Project URL and the publishable key (`sb_publishable_...`; the legacy `anon` key also works).
5. Copy `.env.example` to `.env.local` and fill in:

   ```text
   VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
   VITE_SUPABASE_ANON_KEY=YOUR-PUBLISHABLE-KEY
   ```

6. Restart `pnpm dev`. In the app, open **Settings**, request an email sign-in link, then choose **Sync this device**. The first sync asks for confirmation before uploading local data.

The migration stores synchronized records in a user-owned JSONB table protected by Row Level Security. The sync client applies last-write-wins using `updatedAt`, and keeps soft-delete timestamps as tombstones. Receipt images use a private `receipts` Storage bucket. Never use or expose a Supabase service-role/secret key in this frontend.

### Keep the Supabase project active

Supabase may pause free projects after a period of inactivity. The GitHub Actions workflow at `.github/workflows/supabase-keepalive.yml` sends a read-only request to the database every Monday and Thursday at 08:00 UTC (4:00 PM Philippines time).

To enable it, add these repository **Actions secrets** under **Settings → Secrets and variables → Actions**:

- `SUPABASE_URL`: the Project URL.
- `SUPABASE_ANON_KEY`: the publishable key (`sb_publishable_...`) or legacy `anon` key.

The workflow also supports manual runs from the repository’s **Actions** tab. It only reads `cloud_records` with a one-row limit; Row Level Security prevents the anonymous request from seeing user data. A scheduled request is a best-effort way to avoid inactivity pauses, not an uptime guarantee; use a paid Supabase plan if uninterrupted availability is required.

## Deploy to Vercel

1. Push this repository to a GitHub repository you control.
2. In Vercel, choose **Add New → Project** and import that repository.
3. Use the detected Vite settings:
   - Build command: `pnpm build`
   - Output directory: `dist`
   - Install command: `pnpm install`
4. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as Vercel environment variables for **Production** (and Preview if desired).
5. Deploy. Set your final domain in Supabase Auth URL Configuration after Vercel assigns it, then redeploy.
6. Open the production URL in iPhone Safari, use **Share → Add to Home Screen**, and test a sync and airplane-mode launch.

Vercel reads [`vercel.json`](./vercel.json) to serve the SPA route fallback. The PWA must be opened over HTTPS for installation and service workers.

## Verify before release

```powershell
pnpm test
pnpm build
```

Keep `.env.local` private. The frontend publishable key is intended to be public; security comes from the SQL policies and Supabase Auth, not from hiding that key.
