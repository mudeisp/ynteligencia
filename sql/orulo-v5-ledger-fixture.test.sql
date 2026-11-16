\set ON_ERROR_STOP on
begin;
do $$
declare r jsonb;
begin
 r:=orulo_audit.v5_fixture_audited_cas('f5f8b6c1-93de-4140-bbce-a1a1cb281a10','8bb7f1f8-bcd5-4ca4-b08b-fb219ae4c16b');
 if r->>'status'<>'UPDATED' then raise exception 'AUDITED_CAS_NOT_UPDATED'; end if;
 if (select count(*) from orulo_audit.v5_fixture_receipts)<>1 then raise exception 'RECEIPT_MISSING'; end if;
 begin
 perform orulo_audit.v5_fixture_audited_cas('f5f8b6c1-93de-4140-bbce-a1a1cb281a10','8bb7f1f8-bcd5-4ca4-b08b-fb219ae4c16b');
 raise exception 'DUPLICATE_OPERATION_ACCEPTED';
 exception when raise_exception then
 if sqlerrm='DUPLICATE_OPERATION_ACCEPTED' then raise; end if;
 if sqlerrm<>'V5_DUPLICATE_OPERATION' then raise; end if;
 end;
 if (select raw_data->>'price' from orulo_audit.v5_fixture_properties where id='3f61222d-09e3-487b-9f4d-9b7771b225c9')<>'1000000' then
 raise exception 'NONIMAGE_DRIFT'; end if;
end $$;
rollback;
