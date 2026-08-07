export interface AnnotationRefinementInstruction {
  id: string;
  number: number;
  comment: string;
}

/** The complete annotated edit currently visible in the creation input. */
export interface AnnotationRefinementState {
  sourceSeriesId: string;
  sourceAssetId: string;
  annotations: AnnotationRefinementInstruction[];
}
