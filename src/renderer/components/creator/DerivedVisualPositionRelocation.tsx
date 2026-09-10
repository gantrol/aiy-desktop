import { useMemo, useState } from 'react';
import type { ArticleDto } from '@/shared/contracts';
import { articleIllustrationBlocks, articleIllustrationInsertionOffset } from '@/shared/article-wechat-renderer';
import { useI18n } from '@/renderer/i18n/useI18n';
import { Button } from '@/renderer/components/ui/button';
import { Textarea } from '@/renderer/components/ui/textarea';

export function DerivedVisualPositionRelocation({
  article,
  blocked,
  onAdopt,
}: {
  article: ArticleDto;
  blocked: boolean;
  onAdopt(selectedText: string, expectedRevisionId: string): void;
}) {
  const labels = useI18n().messages.creator.derivedVisual.position;
  const [snapshot, setSnapshot] = useState<ArticleDto | null>(null);
  const [passage, setPassage] = useState('');
  const blocks = useMemo(() => (snapshot ? articleIllustrationBlocks(snapshot.content.markdown) : []), [snapshot]);
  const valid = useMemo(
    () => snapshot && articleIllustrationInsertionOffset(snapshot.content.markdown, passage.trim(), blocks) !== null,
    [snapshot, passage, blocks],
  );
  return (
    <div className="mt-2 space-y-2 text-xs">
      <p role="status">{labels.missing}</p>
      {!snapshot ? (
        <Button
          variant="outline"
          size="sm"
          disabled={blocked}
          onClick={() => {
            setSnapshot(article);
            setPassage('');
          }}
        >
          {labels.choose}
        </Button>
      ) : (
        <>
          <p>{labels.help}</p>
          <p>{labels.revision.replace('{revision}', String(snapshot.revisionNo))}</p>
          <pre className="max-h-48 select-text overflow-auto whitespace-pre-wrap rounded border p-2">
            {snapshot.content.markdown}
          </pre>
          <Textarea
            aria-label={labels.passage}
            placeholder={labels.passage}
            value={passage}
            maxLength={12_000}
            disabled={blocked}
            onChange={(event) => setPassage(event.target.value)}
          />
          {passage && !valid && (
            <p role="alert" className="text-destructive">
              {labels.invalid}
            </p>
          )}
          <div className="flex gap-2">
            <Button size="sm" disabled={blocked || !valid} onClick={() => onAdopt(passage.trim(), snapshot.revisionId)}>
              {labels.apply}
            </Button>
            <Button size="sm" variant="ghost" disabled={blocked} onClick={() => setSnapshot(null)}>
              {labels.cancel}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
