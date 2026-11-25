-- Persist generated inbound responses before history writes or outbound enqueue.
create table if not exists public.inbound_responses (
  inbound_message_id text primary key,
  company_id text not null references public.companies(id) on delete cascade,
  phone text not null,
  inbound_text text not null default '',
  assistant_content text not null,
  customer_reply text not null,
  should_handoff boolean not null default false,
  handoff_summary text not null default '',
  history_saved boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_inbound_responses_created
  on public.inbound_responses(created_at);
alter table public.inbound_responses enable row level security;
revoke all on public.inbound_responses from public, anon, authenticated;
grant all on public.inbound_responses to service_role;

create or replace function public.commit_inbound_response_history(p_inbound_message_id text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  response_row public.inbound_responses%rowtype;
begin
  select * into response_row
  from public.inbound_responses
  where inbound_message_id = p_inbound_message_id
  for update;

  if not found then
    return false;
  end if;

  if not response_row.history_saved then
    if response_row.inbound_text <> '' then
      insert into public.messages(company_id, phone, role, content)
      values (response_row.company_id, response_row.phone, 'user', response_row.inbound_text);
    end if;

    insert into public.messages(company_id, phone, role, content)
    values (response_row.company_id, response_row.phone, 'assistant', response_row.assistant_content);

    update public.inbound_responses
    set history_saved = true
    where inbound_message_id = p_inbound_message_id;
  end if;

  return true;
end;
$function$;
revoke all on function public.commit_inbound_response_history(text) from public, anon, authenticated;
grant execute on function public.commit_inbound_response_history(text) to service_role;