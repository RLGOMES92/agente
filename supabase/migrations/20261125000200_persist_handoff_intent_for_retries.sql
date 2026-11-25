-- Persist the handoff intent independently from outbound delivery.
-- This lets retries finish the customer acknowledgement after the conversation is paused.
create table if not exists public.message_handoffs (
  inbound_message_id text primary key,
  company_id text not null references public.companies(id) on delete cascade,
  phone text not null,
  summary text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists idx_message_handoffs_company_phone
  on public.message_handoffs(company_id, phone, created_at desc);
alter table public.message_handoffs enable row level security;
revoke all on public.message_handoffs from public, anon, authenticated;
grant all on public.message_handoffs to service_role;