-- Backend-only application tables: block browser roles and grant the backend role.
revoke all on public.companies, public.users, public.user_sessions, public.conversations,
  public.messages, public.seen_webhook_events, public.audit_logs, public.message_jobs
  from anon, authenticated;
grant all on public.companies, public.users, public.user_sessions, public.conversations,
  public.messages, public.seen_webhook_events, public.audit_logs, public.message_jobs
  to service_role;
grant usage, select on all sequences in schema public to service_role;
