-- Only the backend worker role may claim durable WhatsApp jobs.
revoke execute on function public.claim_message_jobs(integer) from public, anon, authenticated;
grant execute on function public.claim_message_jobs(integer) to service_role;
