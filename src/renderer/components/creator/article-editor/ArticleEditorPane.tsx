import { Input } from '@/renderer/components/ui/input';
import { ContentWorkspace } from '@/renderer/features/content-editor/ContentWorkspacePanels';
import { useI18n } from '@/renderer/i18n/useI18n';
import {
  articleEditorDocumentWidthClassName,
  articleTitleClassName,
  type ArticleDocumentWidth,
} from '@/renderer/lib/articleTypography';
import type { ReactNode, RefObject } from 'react';

export function ArticleEditorPaneToolbar({ children }: { children: ReactNode }) {
  return <div className="flex h-10 shrink-0 items-center border-b bg-muted/20 px-2">{children}</div>;
}

export function ArticleEditorPane({
  children,
  documentWidth,
  scrollRootRef,
  sidePanel,
  title,
  titleAccessory,
  toolbar,
  onPersist,
  onTitleChange,
}: {
  children: ReactNode;
  documentWidth: ArticleDocumentWidth;
  scrollRootRef: RefObject<HTMLDivElement | null>;
  sidePanel?: ReactNode;
  title: string;
  titleAccessory?: ReactNode;
  toolbar: ReactNode;
  zh: boolean;
  onPersist(): void;
  onTitleChange(title: string): void;
}) {
  const copy = useI18n().messages.contentEditor;
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      {toolbar}
      <ContentWorkspace>
        <div ref={scrollRootRef} className="min-h-0 min-w-0 flex-1 overflow-y-auto py-6">
          <div className={`mx-auto w-full ${articleEditorDocumentWidthClassName(documentWidth)} px-6 lg:px-8`}>
            <div className="mb-7 flex items-start gap-2">
              <Input
                value={title}
                maxLength={200}
                className={`${articleTitleClassName} h-auto min-w-0 flex-1 border-0 px-0 shadow-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring`}
                aria-label={copy.title}
                placeholder={copy.untitledArticle}
                onChange={(event) => onTitleChange(event.target.value)}
                onBlur={onPersist}
              />
              {titleAccessory}
            </div>
            {children}
          </div>
        </div>
        {sidePanel}
      </ContentWorkspace>
    </section>
  );
}
