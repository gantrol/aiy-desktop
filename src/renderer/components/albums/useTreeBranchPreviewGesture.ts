import { useRef, useState, type ComponentProps } from 'react';
import {
  shouldExpandTreeBranchFromPullDown,
  TREE_BRANCH_INTERACTION,
} from '@/renderer/components/albums/treeBranchInteraction';
import { useHoverIntent } from '@/renderer/components/ui/use-hover-intent';

interface TreeBranchPreviewGestureOptions {
  open: boolean;
  expandable: boolean;
  canSpreadPreview: boolean;
  onGestureExpand?(): void;
  onPointerTrackStart?(clientY: number): void;
  onPointerTrack?(clientY: number): boolean;
}

type TreeBranchPreviewGestureBindings = Pick<
  ComponentProps<'span'>,
  'onPointerEnter' | 'onPointerMove' | 'onPointerLeave' | 'onPointerCancel' | 'onFocusCapture' | 'onBlurCapture'
>;

/**
 * Shared pointer choreography for a tree preview. Hover only spreads the
 * preview; after a deliberate pause, downward travel may open the branch.
 * Gesture-open lifetime is owned by useTreeBranchExpansion.
 */
export function useTreeBranchPreviewGesture({
  open,
  expandable,
  canSpreadPreview,
  onGestureExpand,
  onPointerTrackStart,
  onPointerTrack,
}: TreeBranchPreviewGestureOptions): {
  previewExpanded: boolean;
  bindings: TreeBranchPreviewGestureBindings;
} {
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const focusWithin = useRef(false);
  const pointerInside = useRef(false);
  const pointerStartY = useRef<number | null>(null);
  const pointerCurrentY = useRef<number | null>(null);
  const pullDownArmed = useRef(false);
  const pullDownTriggered = useRef(false);
  const gestureOpen = useRef(open);
  const pullDownIntent = useHoverIntent(TREE_BRANCH_INTERACTION.pullDownArmDelayMs);
  gestureOpen.current = open;

  function tryGestureExpand() {
    if (
      pullDownTriggered.current ||
      pointerStartY.current === null ||
      pointerCurrentY.current === null ||
      !shouldExpandTreeBranchFromPullDown({
        armed: pullDownArmed.current,
        originY: pointerStartY.current,
        currentY: pointerCurrentY.current,
      }) ||
      !expandable ||
      gestureOpen.current ||
      !onGestureExpand
    )
      return false;

    pullDownTriggered.current = true;
    gestureOpen.current = true;
    onGestureExpand();
    return true;
  }

  function trackPreviewPointer(clientY: number) {
    pointerCurrentY.current = clientY;
    if (onPointerTrack?.(clientY)) {
      gestureOpen.current = false;
      pointerStartY.current = clientY;
      pullDownTriggered.current = false;
    }
    tryGestureExpand();
  }

  function clearPointer() {
    pullDownIntent.cancel();
    pointerInside.current = false;
    pointerStartY.current = null;
    pointerCurrentY.current = null;
    pullDownArmed.current = false;
    pullDownTriggered.current = false;
    setPreviewExpanded(focusWithin.current && canSpreadPreview);
  }

  return {
    previewExpanded,
    bindings: {
      onPointerEnter(event) {
        // Touch scrolling is not hover or a pull-to-open tree gesture.
        if (event.pointerType === 'touch') return;
        pointerInside.current = true;
        setPreviewExpanded(canSpreadPreview);
        pointerStartY.current = event.clientY;
        pointerCurrentY.current = event.clientY;
        pullDownArmed.current = false;
        pullDownTriggered.current = false;
        onPointerTrackStart?.(event.clientY);
        pullDownIntent.schedule(
          () => {
            pullDownArmed.current = true;
            tryGestureExpand();
          },
          expandable && Boolean(onGestureExpand),
        );
      },
      onPointerMove(event) {
        if (event.pointerType !== 'touch' && pointerInside.current) trackPreviewPointer(event.clientY);
      },
      onPointerLeave(event) {
        if (event.pointerType === 'touch') return;
        if (pointerInside.current) trackPreviewPointer(event.clientY);
        clearPointer();
      },
      onPointerCancel() {
        clearPointer();
      },
      onFocusCapture() {
        focusWithin.current = true;
        setPreviewExpanded(canSpreadPreview);
      },
      onBlurCapture(event) {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          focusWithin.current = false;
          setPreviewExpanded(pointerInside.current && canSpreadPreview);
        }
      },
    },
  };
}
