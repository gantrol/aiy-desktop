import { useState } from 'react';
import { BookOpenCheckIcon, ChevronDownIcon, EyeOffIcon, PackageOpenIcon, RefreshCwIcon } from 'lucide-react';
import type { KnowledgeDistillationProposalDto, Locale } from '@/shared/contracts';
import { resolveWordPaletteContent } from '@/shared/word-palette-localization';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/renderer/components/ui/collapsible';
import { useI18n } from '@/renderer/i18n/useI18n';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/renderer/components/ui/dialog';
import { cn } from '@/renderer/lib/utils';

interface Props {
  open: boolean;
  locale: Locale;
  proposals: KnowledgeDistillationProposalDto[];
  busy: boolean;
  error: string;
  acceptingProposalId: string | null;
  onOpenChange(open: boolean): void;
  onCreate(): void | Promise<void>;
  onAccept(proposalId: string, matchedTermIds: string[], candidateIds: string[]): void | Promise<void>;
}

function displayRecipeName(locale: Locale, zh: string, en: string) {
  return (locale === 'zh' ? zh : en) || (locale === 'zh' ? en : zh);
}

function displayTermTitle(
  locale: Locale,
  term: { title: string; titleLocale: string; localizations: Array<{ locale: string; title: string }> },
) {
  if (term.titleLocale === locale) return term.title;
  return term.localizations.find((item) => item.locale === locale)?.title || term.title;
}

function ProposalCard({
  proposal,
  locale,
  initiallyOpen,
  accepting,
  blocked,
  onAccept,
}: {
  proposal: KnowledgeDistillationProposalDto;
  locale: Locale;
  initiallyOpen: boolean;
  accepting: boolean;
  blocked: boolean;
  onAccept(proposalId: string, matchedTermIds: string[], candidateIds: string[]): void | Promise<void>;
}) {
  const labels = useI18n().messages.creator.knowledgeDistillation;
  const [open, setOpen] = useState(initiallyOpen);
  const [matchedTermIds, setMatchedTermIds] = useState(
    proposal.acceptedSelection?.matchedTermIds ?? proposal.recipeCandidate.matchedTermIds,
  );
  const [candidateIds, setCandidateIds] = useState(
    proposal.acceptedSelection?.candidateIds ?? proposal.recipeCandidate.remainingTermCandidateIds,
  );
  const editable = proposal.status === 'READY' && !blocked;
  const statusLabel =
    proposal.status === 'ACCEPTED' ? labels.accepted : proposal.status === 'CLOSED' ? labels.closed : labels.ready;
  const timestamp = new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(proposal.createdAt));

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="overflow-hidden rounded-lg border bg-surface">
      <div className="flex min-w-0 items-center gap-2 px-3 py-2.5">
        <PackageOpenIcon className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium">
              {displayRecipeName(locale, proposal.sourceTitleZh, proposal.sourceTitleEn)}
            </span>
            <Badge variant="secondary" className="h-5 shrink-0 rounded-sm px-1.5 text-[10px]">
              V{proposal.sourceVersionNo}
            </Badge>
            <Badge variant="outline" className="h-5 shrink-0 rounded-sm px-1.5 text-[10px]">
              {statusLabel}
            </Badge>
          </div>
          <div className="mt-0.5 text-2xs text-muted-foreground">
            {timestamp} · {proposal.matchedTerms.length} {labels.terms} · {proposal.remainingTermCandidates.length}{' '}
            {labels.candidates}
          </div>
        </div>
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={open ? labels.close : labels.description}>
            <ChevronDownIcon className={cn('size-4 transition-transform', open && 'rotate-180')} />
          </Button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        <div className="grid gap-3 border-t bg-surface-sunken/25 p-3">
          <div className="flex flex-wrap items-center gap-1.5 text-2xs text-muted-foreground">
            <Badge variant="secondary" className="h-5 gap-1 rounded-sm px-1.5 text-[10px]">
              <EyeOffIcon className="size-3" />
              {labels.noVision}
            </Badge>
            <span>
              {labels.basis} · V{proposal.sourceVersionNo}
            </span>
            {proposal.capabilityReceipt.modelKey && (
              <>
                <span aria-hidden="true">·</span>
                <span>{proposal.capabilityReceipt.modelKey}</span>
              </>
            )}
          </div>

          <section className="grid gap-1.5">
            <h3 className="text-xs font-semibold">{labels.frozenInput}</h3>
            <div className="max-h-24 overflow-y-auto rounded-md border bg-background px-2.5 py-2 font-mono text-2xs leading-5 text-foreground-secondary">
              {proposal.inputSnapshot.userInstruction || proposal.inputSnapshot.finalPrompt}
            </div>
          </section>

          <section className="grid gap-1.5">
            <h3 className="text-xs font-semibold">
              {labels.matched} · {proposal.matchedTerms.length}
            </h3>
            {proposal.matchedTerms.length ? (
              <div className="flex flex-wrap gap-1.5">
                {proposal.matchedTerms.map((term) => (
                  <label
                    key={`${proposal.id}:${term.termId}`}
                    title={`${term.reason} · ${Math.round(term.confidence * 100)}%`}
                    className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs"
                  >
                    <Checkbox
                      checked={matchedTermIds.includes(term.termId)}
                      disabled={!editable}
                      onCheckedChange={(checked) =>
                        setMatchedTermIds((current) =>
                          checked === true
                            ? [...new Set([...current, term.termId])]
                            : current.filter((termId) => termId !== term.termId),
                        )
                      }
                    />
                    <span>
                      {displayTermTitle(locale, term)} · {Math.round(term.confidence * 100)}%
                    </span>
                  </label>
                ))}
              </div>
            ) : (
              <span className="text-xs text-muted-foreground">{labels.empty}</span>
            )}
          </section>

          <section className="grid gap-1.5">
            <h3 className="text-xs font-semibold">
              {labels.remaining} · {proposal.remainingTermCandidates.length}
            </h3>
            {proposal.remainingTermCandidates.length ? (
              <div className="grid gap-1.5 sm:grid-cols-2">
                {proposal.remainingTermCandidates.map((candidate) => (
                  <article key={candidate.id} className="min-w-0 rounded-md border bg-background p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <label className="flex min-w-0 items-center gap-2">
                        <Checkbox
                          checked={candidateIds.includes(candidate.id)}
                          disabled={!editable}
                          onCheckedChange={(checked) =>
                            setCandidateIds((current) =>
                              checked === true
                                ? [...new Set([...current, candidate.id])]
                                : current.filter((candidateId) => candidateId !== candidate.id),
                            )
                          }
                        />
                        <strong className="truncate text-xs">{displayTermTitle(locale, candidate)}</strong>
                      </label>
                      <Badge variant="secondary" className="h-5 shrink-0 rounded-sm px-1.5 text-[10px]">
                        {candidate.negative ? labels.negative : labels.positive}
                      </Badge>
                    </div>
                    <p className="mt-1 line-clamp-3 text-2xs leading-5 text-foreground-secondary">
                      {candidate.positive || candidate.negative}
                    </p>
                  </article>
                ))}
              </div>
            ) : (
              <span className="text-xs text-muted-foreground">{labels.empty}</span>
            )}
          </section>

          <section className="rounded-md border bg-background p-2.5">
            <div className="flex items-center gap-2">
              <BookOpenCheckIcon className="size-4 text-muted-foreground" />
              <h3 className="text-xs font-semibold">{labels.recipe}</h3>
              <Button
                type="button"
                size="sm"
                className="ml-auto"
                disabled={!editable || (!matchedTermIds.length && !candidateIds.length)}
                onClick={() => void onAccept(proposal.id, matchedTermIds, candidateIds)}
              >
                <BookOpenCheckIcon className="size-3.5" />
                {accepting ? labels.savingRecipe : proposal.status === 'ACCEPTED' ? labels.accepted : labels.saveRecipe}
              </Button>
            </div>
            <p className="mt-1 text-sm font-medium">
              {resolveWordPaletteContent(proposal.recipeCandidate, locale).name}
            </p>
            <p className="mt-0.5 text-2xs text-muted-foreground">
              {matchedTermIds.length} {labels.terms} · {candidateIds.length} {labels.candidates}
            </p>
          </section>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function KnowledgeDistillationDialog({
  open,
  locale,
  proposals,
  busy,
  error,
  acceptingProposalId,
  onOpenChange,
  onCreate,
  onAccept,
}: Props) {
  const labels = useI18n().messages.creator.knowledgeDistillation;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-3xl gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-5 py-4">
          <div className="flex items-center justify-between gap-3 pr-8">
            <DialogTitle className="flex items-center gap-2">
              <PackageOpenIcon className="size-5" />
              {labels.title}
            </DialogTitle>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy || Boolean(acceptingProposalId)}
              onClick={() => void onCreate()}
            >
              <RefreshCwIcon className={cn('size-3.5', busy && 'animate-spin')} />
              {labels.rerun}
            </Button>
          </div>
          <DialogDescription className="sr-only">{labels.description}</DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[calc(85vh-8rem)] gap-2 overflow-y-auto p-4">
          {error && (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}
          {proposals.map((proposal, index) => (
            <ProposalCard
              key={proposal.id}
              proposal={proposal}
              locale={locale}
              initiallyOpen={index === 0}
              accepting={acceptingProposalId === proposal.id}
              blocked={busy || Boolean(acceptingProposalId)}
              onAccept={onAccept}
            />
          ))}
        </div>
        <DialogFooter className="border-t px-5 py-3">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {labels.close}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export type { Props as KnowledgeDistillationDialogProps };
