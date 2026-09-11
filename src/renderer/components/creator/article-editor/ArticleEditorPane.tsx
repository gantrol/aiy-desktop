import { Input } from '@/renderer/components/ui/input';
import { ContentDocumentWorkspace } from '@/renderer/features/content-editor/ContentDocumentWorkspace';
import { useI18n } from '@/renderer/i18n/useI18n';
import { articleTitleClassName, type ArticleDocumentWidth } from '@/renderer/lib/articleTypography';
import type { ReactNode, RefObject } from 'react';

export function ArticleEditorPane({
  children,
  documentWidth,
  scrollRootRef,
  sidePanel,
  title,
  titleAccessory,
  onPersist,
  onTitleChange,
}: {
  children: ReactNode;
  documentWidth: ArticleDocumentWidth;
  scrollRootRef: RefObject<HTMLDivElement | null>;
  sidePanel?: ReactNode;
  title: string;
  titleAccessory?: ReactNode;
  zh: boolean;
  onPersist(): void;
  onTitleChange(title: string): void;
}) {
  const copy = useI18n().messages.contentEditor;
  return (
    <ContentDocumentWorkspace
      documentWidth={documentWidth}
      scrollRootRef={scrollRootRef}
      sidePanel={sidePanel}
      titleAccessory={titleAccessory}
      title={
        <Input
          value={title}
          maxLength={200}
          className={`${articleTitleClassName} h-auto min-w-0 flex-1 border-0 px-0 shadow-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring`}
          aria-label={copy.title}
          placeholder={copy.untitledArticle}
          onChange={(event) => onTitleChange(event.target.value)}
          onBlur={onPersist}
        />
      }
    >
      {children}
    </ContentDocumentWorkspace>
  );
}
