-- Shared login throttling across serverless instances.
create table if not exists public.auth_login_attempts (
  attempt_key text primary key check (attempt_key ~ '^[a-f0-9]{64}$'),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  window_started_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.auth_login_attempts enable row level security;
revoke all on public.auth_login_attempts from public, anon, authenticated;
grant all on public.auth_login_attempts to service_role;

create or replace function public.check_login_attempts(p_keys text[])
returns boolean
language sql security definer set search_path=public
as $function$
  select coalesce(bool_or(attempt_count >= 8), false)
  from public.auth_login_attempts
  where attempt_key = any(coalesce(p_keys, array[]::text[]))
    and window_started_at > now() - interval '15 minutes';
$function$;

create or replace function public.record_login_failure(p_keys text[])
returns boolean
language plpgsql security definer set search_path=public
as $function$
declare
  k text;
  blocked boolean;
begin
  foreach k in array coalesce(p_keys, array[]::text[]) loop
    if k !~ '^[a-f0-9]{64}$' then
      raise exception 'invalid attempt key';
    end if;
    insert into public.auth_login_attempts(attempt_key, attempt_count, window_started_at, updated_at)
    values (k, 1, now(), now())
    on conflict (attempt_key) do update
      set attempt_count = case
            when auth_login_attempts.window_started_at <= now() - interval '15 minutes' then 1
            else auth_login_attempts.attempt_count + 1
          end,
          window_started_at = case
            when auth_login_attempts.window_started_at <= now() - interval '15 minutes' then now()
            else auth_login_attempts.window_started_at
          end,
          updated_at = now();
  end loop;
  delete from public.auth_login_attempts where updated_at < now() - interval '1 day';
  select coalesce(bool_or(attempt_count >= 8), false) into blocked
  from public.auth_login_attempts
  where attempt_key = any(coalesce(p_keys, array[]::text[]))
    and window_started_at > now() - interval '15 minutes';
  return blocked;
end;
$function$;

create or replace function public.clear_login_attempts(p_keys text[])
returns void
language sql security definer set search_path=public
as $function$
  delete from public.auth_login_attempts
  where attempt_key = any(coalesce(p_keys, array[]::text[]));
$function$;

revoke all on function public.check_login_attempts(text[]) from public, anon, authenticated;
revoke all on function public.record_login_failure(text[]) from public, anon, authenticated;
revoke all on function public.clear_login_attempts(text[]) from public, anon, authenticated;
grant execute on function public.check_login_attempts(text[]) to service_role;
grant execute on function public.record_login_failure(text[]) to service_role;
grant execute on function public.clear_login_attempts(text[]) to service_role;
