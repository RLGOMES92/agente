-- The worker RPC is server-only. Never allow browser roles to claim queued WhatsApp jobs.
REVOKE EXECUTE ON FUNCTION public.claim_message_jobs(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_message_jobs(integer) TO service_role;
