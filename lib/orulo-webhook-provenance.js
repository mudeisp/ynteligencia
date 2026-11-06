// Prepared adapter. No default connection, service-key fallback, retries or activation.
// client must be a server-owned, parameterized PostgreSQL connection authenticated
// directly as orulo_webhook_writer; the database enforces session_user independently.
export function createTransactionalWebhookWriter(client) {
  if (typeof client?.query !== 'function') throw Error('V9_DEDICATED_CLIENT_REQUIRED');
  const apply = async (buildingId, rows, removed) => {
    let result;
    try {
      result = await client.query(
        'select orulo_audit.apply_webhook($1::text,$2::jsonb,$3::boolean,$4::timestamptz) as result',
        [String(buildingId), JSON.stringify(rows), removed, new Date().toISOString()]
      );
    } catch {
      // A lost COMMIT response is uncertain. Never retry or fall back to REST.
      throw Error('V9_TRANSACTION_FAILED_OR_UNCERTAIN_NO_RETRY');
    }
    const value = result?.rows?.[0]?.result;
    if (!value || !['existingRows','savedRows','deactivatedRows'].every(k => Array.isArray(value[k])))
      throw Error('V9_TRANSACTION_RESPONSE_UNCERTAIN_NO_RETRY');
    return value;
  };
  return Object.freeze({
    syncBuilding: (id, rows) => apply(id, rows, false),
    removeBuilding: async id => (await apply(id, [], true)).deactivatedRows
  });
}
