create table if not exists public.cloud_records (
  user_id uuid not null references auth.users (id) on delete cascade,
  table_name text not null,
  record_id text not null,
  payload jsonb not null,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  primary key (user_id, table_name, record_id)
);

create index if not exists cloud_records_user_updated_idx
  on public.cloud_records (user_id, updated_at);

alter table public.cloud_records enable row level security;

create policy "Users read their own cloud records"
  on public.cloud_records for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users insert their own cloud records"
  on public.cloud_records for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users update their own cloud records"
  on public.cloud_records for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users delete their own cloud records"
  on public.cloud_records for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.apply_cloud_record(
  p_table_name text,
  p_record_id text,
  p_payload jsonb,
  p_updated_at timestamptz,
  p_deleted_at timestamptz default null
)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  accepted boolean;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if p_table_name not in (
    'profiles', 'accounts', 'categories', 'transactions', 'budgets',
    'goals', 'debts', 'recurring', 'holdings', 'quickNotes',
    'splitGroups', 'splitMembers', 'streaks', 'attachments', 'settings'
  ) then
    raise exception 'Unsupported record type';
  end if;

  insert into public.cloud_records (
    user_id, table_name, record_id, payload, updated_at, deleted_at
  )
  values (
    auth.uid(), p_table_name, p_record_id, p_payload, p_updated_at, p_deleted_at
  )
  on conflict (user_id, table_name, record_id) do update
  set payload = excluded.payload,
      updated_at = excluded.updated_at,
      deleted_at = excluded.deleted_at
  where public.cloud_records.updated_at <= excluded.updated_at
  returning true into accepted;

  return coalesce(accepted, false);
end;
$$;

revoke all on function public.apply_cloud_record(text, text, jsonb, timestamptz, timestamptz)
  from public, anon;
grant execute on function public.apply_cloud_record(text, text, jsonb, timestamptz, timestamptz)
  to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'receipts',
  'receipts',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
on conflict (id) do nothing;

create policy "Users read their own receipts"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "Users upload their own receipts"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "Users update their own receipts"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "Users delete their own receipts"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
