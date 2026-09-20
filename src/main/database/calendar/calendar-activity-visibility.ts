/** Product activity only. The original change_events audit remains intact. */
export const calendarVisibleActivitySql = `
  entity_type NOT IN ('PACK_OBJECT_LINK','PACK_RELEASE','PACK_INSTALLATION')
  AND NOT (entity_type='PACK' AND operation IN ('CREATE','UPDATE_METADATA'))
  AND NOT (entity_type='LOCAL_SPACE' AND operation='ALIGN_REGISTRY_IDENTITY')
  AND (entity_type<>'PACK_INSTALL_ATTEMPT' OR (
    operation IN ('SUCCEED','FAIL','CANCEL','INTERRUPT')
    AND NOT EXISTS (
      SELECT 1 FROM pack_install_attempts a JOIN pack_sync_runs s ON s.id=a.transaction_id
      WHERE a.id=rows.entity_id
    )
  ))`;
