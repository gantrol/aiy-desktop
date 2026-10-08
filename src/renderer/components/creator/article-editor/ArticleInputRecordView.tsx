import type { ArticleInputRecord } from '@/shared/contracts/article-input-history';
import { useI18n } from '@/renderer/i18n/useI18n';

function InputText({ label, text }: { label: string; text: string | null | undefined }) {
  if (!text) return null;
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-medium text-muted-foreground">{label}</h3>
      <pre className="whitespace-pre-wrap break-words font-sans text-sm">{text}</pre>
    </section>
  );
}

export function ArticleInputRecordView({ record }: { record: ArticleInputRecord }) {
  const { locale, messages } = useI18n();
  const copy = messages.creator.inputHistory;
  const { text, writingInstruction, referenceAssetIds } = record.snapshot;
  // IDs and ordering remain available even when a referenced file no longer exists.
  const details = {
    ...record.snapshot,
    text: undefined,
    writingInstruction: undefined,
    document: undefined,
    ...record.requestDetails,
  };
  return (
    <div className="space-y-5">
      <InputText label={copy.instruction} text={writingInstruction} />
      <InputText label={copy.inputText} text={text} />
      <InputText label={copy.selection} text={record.selectionText} />
      {!text && !writingInstruction && <p className="text-sm text-muted-foreground">{copy.noText}</p>}
      {referenceAssetIds.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground">{copy.references}</h3>
          <ol className="grid grid-cols-3 gap-3 sm:grid-cols-5">
            {referenceAssetIds.map((id, index) => {
              const asset = record.referenceAssets.find((item) => item.id === id);
              return (
                <li key={`${index}:${id}`} className="space-y-1">
                  {asset ? (
                    <img
                      src={asset.mediaUrl}
                      alt={copy.referenceImage}
                      loading="lazy"
                      className="aspect-square w-full object-contain bg-muted"
                    />
                  ) : (
                    <span className="flex aspect-square items-center justify-center text-xs text-muted-foreground">
                      {copy.missingMedia}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {new Intl.NumberFormat(locale).format(index + 1)}
                  </span>
                </li>
              );
            })}
          </ol>
        </section>
      )}
      {record.videoAttachments?.map((video) => (
        <p key={video.materialId} className="text-sm">
          {video.name}
        </p>
      ))}
      {record.missingReferenceIds.length > 0 && (
        <p role="status" className="text-sm text-destructive">
          {copy.missingMedia}
        </p>
      )}
      {!record.canContinue && (
        <p role="status" className="text-sm text-muted-foreground">
          {copy.continueUnavailable}
        </p>
      )}
      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground">{copy.recordedSettings}</summary>
        <pre className="mt-2 whitespace-pre-wrap break-all">{JSON.stringify(details, null, 2)}</pre>
      </details>
    </div>
  );
}
