export function creationOutputNotExcluded(seriesIdExpression: string, assetIdExpression: string) {
  return `NOT EXISTS (
    SELECT 1 FROM prompt_series_output_exclusions presentation_exclusion
    WHERE presentation_exclusion.series_id = ${seriesIdExpression}
      AND presentation_exclusion.image_asset_id = ${assetIdExpression}
  )`;
}

export function gifOutputExists(seriesIdExpression: string, assetIdExpression: string) {
  return `EXISTS (SELECT 1 FROM gif_export_runs gif_run
    JOIN gif_documents gif_document ON gif_document.id=gif_run.document_id
    WHERE gif_document.series_id=${seriesIdExpression} AND gif_run.output_asset_id=${assetIdExpression}
      AND gif_run.state='SUCCEEDED')`;
}

/**
 * A visible creation item may project one primary series together with the
 * direction series attached to its exploration batches. Historical batches
 * without a surviving series scope are projected from sibling slots instead.
 */
export function creationItemIncludesSeries(ownerSeriesIdExpression: string, candidateSeriesIdExpression: string) {
  return `(
    ${candidateSeriesIdExpression} = ${ownerSeriesIdExpression}
    OR EXISTS (
      SELECT 1
      FROM style_exploration_batches cover_batch
      JOIN style_exploration_slots cover_candidate_slot
        ON cover_candidate_slot.batch_id = cover_batch.id
        AND cover_candidate_slot.series_id = ${candidateSeriesIdExpression}
      WHERE (
        cover_batch.scope_kind = 'SERIES'
        AND cover_batch.scope_id = ${ownerSeriesIdExpression}
      ) OR (
        (
          cover_batch.scope_kind <> 'SERIES'
          OR NOT EXISTS (
            SELECT 1 FROM prompt_series cover_scoped_owner
            WHERE cover_scoped_owner.id = cover_batch.scope_id
              AND cover_scoped_owner.deleted_at IS NULL
          )
        )
        AND EXISTS (
          SELECT 1 FROM style_exploration_slots cover_owner_slot
          WHERE cover_owner_slot.batch_id = cover_batch.id
            AND cover_owner_slot.series_id = ${ownerSeriesIdExpression}
        )
      )
    )
  )`;
}

export function creationItemCoverSortOrder(candidateSeriesIdExpression: string, assetIdExpression: string) {
  return `(SELECT MIN(selected_creation_cover.sort_order)
    FROM prompt_series_cover_assets selected_creation_cover
    JOIN prompt_series selected_cover_owner
      ON selected_cover_owner.id = selected_creation_cover.series_id
      AND selected_cover_owner.deleted_at IS NULL
    WHERE selected_creation_cover.image_asset_id = ${assetIdExpression}
      AND ${creationItemIncludesSeries('selected_cover_owner.id', candidateSeriesIdExpression)}
  )`;
}
