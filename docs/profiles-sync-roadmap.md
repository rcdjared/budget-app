# Profiles & Sync: future phases

Phase 1 keeps finance data local. Google sign-in is optional, cloud sync stays off, and each local profile is isolated by `profileId`. Do not upload existing profiles as a side effect of signing in.

The `delete-account` Edge Function must be deployed to the configured Supabase project before cloud-account deletion is available. It uses the project's `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` server-side environment variables; never expose the service-role key in the app.

## Phase 2: opt-in personal sync

- Add an explicit per-profile sync opt-in and show the destination account before the first upload.
- Keep each user's records in `cloud_records`, scoped by the authenticated Supabase user and protected by RLS. Never trust a client-supplied `user_id`.
- Preserve profile IDs across devices. A profile belongs to one signed-in user; signing in must not merge unrelated local data automatically.
- Resolve concurrent changes deterministically using record IDs and update timestamps, while surfacing irreconcilable conflicts instead of silently overwriting.
- Sync attachments through the private `receipts` bucket with user-scoped object paths and RLS.
- Turning sync off stops uploads and downloads; it does not delete cloud data without a separate confirmation.

## Phase 3: shared profiles

- Model shared spaces as separate groups, memberships, and invitations; do not make a local profile shared by changing its owner.
- Enforce membership and role checks in database policies and server-side operations, not only in the UI.
- Define owner, editor, and viewer permissions before adding shared editing.
- Keep invitations revocable and expiring. Never expose transaction details in invitation links or notification text.
- Record membership changes and ownership transfers so collaborators can understand who can access a space.

## Phase 4: portability and account lifecycle

- Provide explicit profile-level export and import with a preview, duplicate handling, and a rollback-safe commit.
- Keep local profile deletion distinct from cloud-account deletion. Phase 1's account deletion endpoint requires recent authentication and removes cloud records and private receipt files; add shared-space ownership checks before groups exist.
- Before deleting a shared space, require ownership transfer or explicit member-removal behavior; do not orphan shared records.
- Document retention and recovery behavior for deleted profiles, cloud data, and exported files.
- Add integration tests for RLS boundaries, multi-device conflict cases, shared membership changes, and account deletion before enabling these features.

These phases are design guidance only; shared profiles and cross-device sync are not enabled by Phase 1.
