import { useEffect, useRef, useState } from 'react';
import type { KnowledgeDistillationProposalDto, Locale, WordPaletteDto } from '@/shared/contracts';
import { useStableCallback } from '@/renderer/lib/useStableCallback';

interface Options {
  locale: Locale;
  notify(message: string): void;
  onPaletteAccepted(palette: WordPaletteDto): void;
  refresh(): Promise<void>;
  requestIdentity: string;
}

interface DistillationSession {
  requestIdentity: string;
  revision: number;
  sourceAssetId: string;
  proposals: KnowledgeDistillationProposalDto[];
}

function messageFor(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}

export function useKnowledgeDistillationWorkflow(options: Options) {
  const [session, setSession] = useState<DistillationSession | null>(null);
  const [busyAssetId, setBusyAssetId] = useState<string | null>(null);
  const [acceptingProposalId, setAcceptingProposalId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const mountedRef = useRef(true);
  const workflowRevisionRef = useRef(0);
  const busyAssetIdRef = useRef<string | null>(null);
  const acceptingProposalIdRef = useRef<string | null>(null);
  const renderedRequestIdentity = `${options.locale}:${options.requestIdentity}`;
  const renderedRequestIdentityRef = useRef(renderedRequestIdentity);
  const getRequestIdentity = useStableCallback(() => `${options.locale}:${options.requestIdentity}`);
  const notify = useStableCallback(options.notify);
  const onPaletteAccepted = useStableCallback(options.onPaletteAccepted);
  const refresh = useStableCallback(options.refresh);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      workflowRevisionRef.current += 1;
      busyAssetIdRef.current = null;
      acceptingProposalIdRef.current = null;
    };
  }, []);

  const reset = useStableCallback(() => {
    workflowRevisionRef.current += 1;
    busyAssetIdRef.current = null;
    acceptingProposalIdRef.current = null;
    setBusyAssetId(null);
    setAcceptingProposalId(null);
    setError('');
    setSession(null);
  });

  useEffect(() => {
    if (renderedRequestIdentityRef.current === renderedRequestIdentity) return;
    renderedRequestIdentityRef.current = renderedRequestIdentity;
    reset();
  }, [renderedRequestIdentity, reset]);

  const open = useStableCallback(async (sourceAssetId: string) => {
    if (busyAssetIdRef.current || acceptingProposalIdRef.current) return;
    const requestIdentity = getRequestIdentity();
    const revision = ++workflowRevisionRef.current;
    const requestIsCurrent = () =>
      mountedRef.current && workflowRevisionRef.current === revision && getRequestIdentity() === requestIdentity;
    busyAssetIdRef.current = sourceAssetId;
    setBusyAssetId(sourceAssetId);
    setError('');
    setSession(null);
    try {
      let proposals = await window.desktopApi.knowledgeDistillationList(sourceAssetId);
      if (!requestIsCurrent()) return;
      if (!proposals.length) {
        proposals = [
          await window.desktopApi.knowledgeDistillationCreate({
            sourceAssetId,
            locale: options.locale,
          }),
        ];
      }
      if (!requestIsCurrent()) return;
      setSession({
        requestIdentity,
        revision,
        sourceAssetId,
        proposals,
      });
    } catch (reason) {
      if (!requestIsCurrent()) return;
      const message = messageFor(reason);
      setError(message);
      notify(message);
    } finally {
      if (workflowRevisionRef.current === revision) {
        busyAssetIdRef.current = null;
        if (mountedRef.current) setBusyAssetId(null);
      }
    }
  });

  const create = useStableCallback(async () => {
    const snapshot = session;
    if (
      !snapshot ||
      snapshot.requestIdentity !== getRequestIdentity() ||
      busyAssetIdRef.current ||
      acceptingProposalIdRef.current
    )
      return;
    const requestIsCurrent = () =>
      mountedRef.current &&
      workflowRevisionRef.current === snapshot.revision &&
      getRequestIdentity() === snapshot.requestIdentity;
    busyAssetIdRef.current = snapshot.sourceAssetId;
    setBusyAssetId(snapshot.sourceAssetId);
    setError('');
    try {
      const proposal = await window.desktopApi.knowledgeDistillationCreate({
        sourceAssetId: snapshot.sourceAssetId,
        locale: options.locale,
      });
      if (!requestIsCurrent()) return;
      setSession((current) =>
        current?.revision === snapshot.revision
          ? {
              ...current,
              proposals: [proposal, ...current.proposals.filter((item) => item.id !== proposal.id)],
            }
          : current,
      );
    } catch (reason) {
      if (!requestIsCurrent()) return;
      const message = messageFor(reason);
      setError(message);
      notify(message);
    } finally {
      if (workflowRevisionRef.current === snapshot.revision) {
        busyAssetIdRef.current = null;
        if (mountedRef.current) setBusyAssetId(null);
      }
    }
  });

  const accept = useStableCallback(async (proposalId: string, matchedTermIds: string[], candidateIds: string[]) => {
    const snapshot = session;
    if (
      !snapshot?.proposals.some((proposal) => proposal.id === proposalId) ||
      snapshot.requestIdentity !== getRequestIdentity() ||
      busyAssetIdRef.current ||
      acceptingProposalIdRef.current
    )
      return;
    const requestIsCurrent = () =>
      mountedRef.current &&
      workflowRevisionRef.current === snapshot.revision &&
      getRequestIdentity() === snapshot.requestIdentity;
    acceptingProposalIdRef.current = proposalId;
    setAcceptingProposalId(proposalId);
    setError('');
    try {
      const result = await window.desktopApi.knowledgeDistillationAccept({
        proposalId,
        locale: options.locale,
        matchedTermIds: [...matchedTermIds],
        candidateIds: [...candidateIds],
      });
      if (requestIsCurrent()) {
        setSession((current) =>
          current?.revision === snapshot.revision
            ? {
                ...current,
                proposals: current.proposals.map((proposal) =>
                  proposal.id === result.proposal.id ? result.proposal : proposal,
                ),
              }
            : current,
        );
      }
      await refresh().catch(() => undefined);
      if (!requestIsCurrent()) return;
      workflowRevisionRef.current += 1;
      acceptingProposalIdRef.current = null;
      setAcceptingProposalId(null);
      setError('');
      setSession(null);
      onPaletteAccepted(result.palette);
    } catch (reason) {
      if (!requestIsCurrent()) return;
      const message = messageFor(reason);
      setError(message);
      notify(message);
    } finally {
      if (workflowRevisionRef.current === snapshot.revision) {
        acceptingProposalIdRef.current = null;
        if (mountedRef.current) setAcceptingProposalId(null);
      }
    }
  });

  const changeDialogOpen = useStableCallback((open: boolean) => {
    if (!open) reset();
  });

  return {
    accept,
    acceptingProposalId,
    busy: Boolean(busyAssetId),
    changeDialogOpen,
    create,
    dialogOpen: Boolean(session),
    error,
    open,
    proposals: session?.proposals ?? [],
    reset,
  };
}
