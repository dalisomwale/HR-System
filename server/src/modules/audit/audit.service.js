/**
 * Audit log writer. Always called with the same transaction as the change it records, so an
 * audit entry exists if and only if the change was committed.
 */
export async function writeAudit(trx, entry) {
  const {
    actorType,
    actorEmployeeId = null,
    action,
    entityType,
    entityId = null,
    before = null,
    after = null,
    ipAddress = null,
    userAgent = null,
    requestId = null,
  } = entry;

  if (!['USER', 'SYSTEM', 'CLI'].includes(actorType))
    throw new Error(`Invalid audit actorType: ${actorType}`);
  if (!action || !entityType) throw new Error('Audit entries require action and entityType');

  await trx('audit_log').insert({
    actor_type: actorType,
    actor_employee_id: actorEmployeeId,
    action,
    entity_type: entityType,
    entity_id: entityId === null ? null : String(entityId),
    before_data: before === null ? null : JSON.stringify(before),
    after_data: after === null ? null : JSON.stringify(after),
    ip_address: ipAddress,
    user_agent: userAgent ? String(userAgent).slice(0, 255) : null,
    request_id: requestId,
  });
}
