create or replace function public.claim_message_jobs(p_limit integer default 10)
returns setof public.message_jobs
language sql
security definer
set search_path = public
as $$
  with candidates as (
    select id from public.message_jobs
    where available_at <= now()
      and (status = 'pending' or (status = 'processing' and locked_at < now() - interval '5 minutes'))
    order by id for update skip locked
    limit greatest(1, least(coalesce(p_limit, 10), 20))
  )
  update public.message_jobs as jobs
  set status = 'processing', attempts = jobs.attempts + 1, locked_at = now(), last_error = null
  from candidates where jobs.id = candidates.id
  returning jobs.*;
$$;
revoke all on function public.claim_message_jobs(integer) from public, anon, authenticated;
grant execute on function public.claim_message_jobs(integer) to service_role;
