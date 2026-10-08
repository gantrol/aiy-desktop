import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ImageEditDocument, ImageEditMark } from '@/shared/contracts/image-edit';
import {
  IMAGE_PRIVACY_COVER_COLOR,
  type ImagePrivacyOptions,
  type ImagePrivacyRegion,
  type ImagePrivacyResult,
} from '@/shared/contracts/image-privacy';
import type { ImageEditSession } from '@/renderer/features/image-editing/image-edit-session';
import { exportImageEdit } from '@/renderer/features/image-editing/image-edit-export';
import { imageViewport } from '@/renderer/features/image-editing/image-edit-geometry';

type Candidate = { kind: ImagePrivacyRegion['kind']; mark: ImageEditMark };
type Status = ImagePrivacyResult['status'] | 'idle' | 'scanning' | 'empty' | 'invalidTerms' | 'applied';
type Preview = { base: ImageEditDocument; candidates: Candidate[]; selected: Set<string> };

function candidate(region: ImagePrivacyRegion, document: ImageEditDocument): Candidate {
  const inverse = new DOMMatrix(imageViewport(document).matrix).inverse();
  const points = [
    [region.x, region.y],
    [region.x + region.width, region.y],
    [region.x, region.y + region.height],
    [region.x + region.width, region.y + region.height],
  ].map(([x, y]) => inverse.transformPoint({ x, y }));
  const x = Math.max(0, Math.floor(Math.min(...points.map((point) => point.x))));
  const y = Math.max(0, Math.floor(Math.min(...points.map((point) => point.y))));
  return {
    kind: region.kind,
    mark: {
      id: crypto.randomUUID(),
      kind: 'cover',
      x,
      y,
      width: Math.min(document.width, Math.ceil(Math.max(...points.map((point) => point.x)))) - x,
      height: Math.min(document.height, Math.ceil(Math.max(...points.map((point) => point.y)))) - y,
      color: IMAGE_PRIVACY_COVER_COLOR,
      stroke: 1,
      fontSize: 32,
      text: '',
    },
  };
}

export function useImagePrivacy(session: ImageEditSession, image: HTMLImageElement, disabled: boolean) {
  const { document } = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [kinds, setKinds] = useState<ImagePrivacyOptions['kinds']>(['email', 'phone', 'credential']);
  const [terms, setTerms] = useState('');
  const [result, setResult] = useState<Preview | null>(null);
  const pending = useRef<{ id: string; base: ImageEditDocument } | null>(null);
  const cancel = useCallback(() => {
    const request = pending.current;
    pending.current = null;
    if (request)
      void window.desktopPetals.imagePrivacy({ kind: 'cancel', requestId: request.id }).catch(() => undefined);
  }, []);
  useEffect(() => cancel, [cancel]);
  useEffect(() => {
    cancel();
    setResult(null);
    setStatus('idle');
  }, [document, disabled, cancel]);
  const current = !disabled && result?.base === document ? result : null;
  const marks = current?.candidates.filter(({ mark }) => current.selected.has(mark.id)).map(({ mark }) => mark) ?? [];
  const preview = current ? { ...document, marks: [...document.marks, ...marks] } : null;
  const reset = () => {
    cancel();
    setResult(null);
    setStatus('idle');
  };
  const scan = async () => {
    if (disabled || pending.current || !kinds.length) return;
    const words = terms
      .split(/\r?\n/)
      .map((word) => word.trim())
      .filter(Boolean);
    if (kinds.includes('custom') && (!words.length || words.length > 30 || words.some((word) => word.length > 100))) {
      setStatus('invalidTerms');
      return;
    }
    const request = { id: crypto.randomUUID(), base: document };
    pending.current = request;
    setResult(null);
    setStatus('scanning');
    try {
      const bytes = await exportImageEdit(image, request.base);
      if (pending.current !== request || session.getSnapshot().document !== request.base) return;
      const response = await window.desktopPetals.imagePrivacy({
        kind: 'scan',
        requestId: request.id,
        bytes,
        options: { kinds, terms: kinds.includes('custom') ? words : [] },
      });
      if (pending.current !== request || session.getSnapshot().document !== request.base) return;
      if (response.status !== 'ready') {
        setStatus(response.status);
        return;
      }
      if (response.regions.length + request.base.marks.length > 300) {
        setStatus('tooMany');
        return;
      }
      if (!response.regions.length) {
        setStatus('empty');
        return;
      }
      const candidates = response.regions.map((region) => candidate(region, request.base));
      setResult({ base: request.base, candidates, selected: new Set(candidates.map(({ mark }) => mark.id)) });
      setStatus('ready');
    } catch {
      if (pending.current === request) setStatus('failed');
    } finally {
      if (pending.current === request) pending.current = null;
    }
  };
  return {
    open,
    status,
    kinds,
    terms,
    current,
    preview,
    selectedCount: marks.length,
    show: () => setOpen(true),
    close: () => {
      reset();
      setOpen(false);
    },
    stop: reset,
    scan,
    setTerms: (value: string) => {
      reset();
      setTerms(value);
    },
    toggleKind: (kind: ImagePrivacyRegion['kind']) => {
      reset();
      setKinds((value) => (value.includes(kind) ? value.filter((entry) => entry !== kind) : [...value, kind]));
    },
    toggleCandidate: (id: string) =>
      setResult((value) => {
        if (!value) return null;
        const selected = new Set(value.selected);
        if (selected.has(id)) selected.delete(id);
        else selected.add(id);
        return { ...value, selected };
      }),
    apply: () => {
      if (disabled || !current || !marks.length || session.getSnapshot().document !== current.base) return;
      session.change({ ...current.base, marks: [...current.base.marks, ...marks] });
      setResult(null);
      setStatus('applied');
      setOpen(false);
    },
  };
}
