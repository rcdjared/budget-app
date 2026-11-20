-- The sync RPC runs as the signed-in user (SECURITY INVOKER), so that user's
-- table privileges are required in addition to the row-level security policies.
-- RLS still limits every operation to rows whose user_id matches auth.uid().
grant select, insert, update, delete on table public.cloud_records to authenticated;

grant execute on function public.apply_cloud_record(text, text, jsonb, timestamptz, timestamptz)
  to authenticated;
