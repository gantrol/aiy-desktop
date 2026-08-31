import { useState } from 'react';
import type { AnnotationRefinementState } from '@/renderer/components/creator/annotationRefinement';
import type { CreatorLocation } from '@/renderer/components/app/app-navigation';
import type { CreationOutputMode } from '@/renderer/components/creator/CreationOutputTabs';

export function useCreatorOutputUiState(location: CreatorLocation) {
  const [mode, setMode] = useState<CreationOutputMode>(location.surface === 'idea-creation' ? 'records' : 'results');
  const [requestedAssetId, setRequestedAssetId] = useState<string | null>(
    location.surface === 'existing-creation' ? location.assetId : null,
  );
  const [annotationRefinement, setAnnotationRefinement] = useState<AnnotationRefinementState | null>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);

  return {
    annotationRefinement,
    galleryOpen,
    mode,
    requestedAssetId,
    setAnnotationRefinement,
    setGalleryOpen,
    setMode,
    setRequestedAssetId,
  };
}
