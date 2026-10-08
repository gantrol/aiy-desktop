import type { useDocumentWriting } from '@/renderer/components/creator/workflows/useDocumentWriting';
import { Button } from '@/renderer/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/renderer/components/ui/collapsible';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { ContentMarkdown } from '@/renderer/features/content-editor/ContentMarkdown';
import { useI18n } from '@/renderer/i18n/useI18n';

export function DocumentWritingCandidate({
  writing,
  disabled,
}: {
  writing: ReturnType<typeof useDocumentWriting>;
  disabled: boolean;
}) {
  const labels = useI18n().messages.creator.documentWriting;
  const candidate = writing.candidate;
  if (!candidate) return null;
  return (
    <div className="space-y-3 border-t pt-3">
      <Select value={writing.candidateId} onValueChange={writing.setCandidateId}>
        <SelectTrigger className="h-8 w-full gap-2" aria-label={labels.candidate}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {[...writing.candidates].reverse().map((item) => (
            <SelectItem key={item.id} value={item.id}>
              {labels[item.documentTask!.kind]} · {new Date(item.createdAt).toLocaleString()}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {writing.changed && (
        <span className="text-xs text-muted-foreground" role="status">
          {labels.basedOnEarlier}
        </span>
      )}
      <ContentMarkdown
        typography="article"
        className="max-h-64 overflow-y-auto px-1"
        components={{ a: ({ children }) => <span>{children}</span>, img: () => null }}
      >
        {candidate.result.assistantMessage}
      </ContentMarkdown>
      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm">
            {labels.requestInput}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="max-h-40 space-y-2 overflow-y-auto whitespace-pre-wrap px-2 text-sm text-muted-foreground">
          {candidate.message && <div>{candidate.message}</div>}
          <div>{candidate.documentTask?.selection?.text ?? candidate.prompt}</div>
        </CollapsibleContent>
      </Collapsible>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" size="sm" disabled={disabled} onClick={() => void writing.adopt('append')}>
          {labels.append}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={disabled || writing.changed}
          onClick={() => void writing.adopt('replace')}
        >
          {candidate.documentTask?.kind === 'rewrite' ? labels.replaceSelection : labels.replaceBody}
        </Button>
      </div>
    </div>
  );
}
