begin;
revoke execute on function public.orulo_media_cas(uuid,jsonb,jsonb) from service_role;
drop function public.orulo_media_cas(uuid,jsonb,jsonb);
commit;

