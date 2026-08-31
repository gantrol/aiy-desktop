import type { ReactNode, RefObject } from 'react';
import { Input } from '@/renderer/components/ui/input';
import {
  articleEditorDocumentWidthClassName,
  articleTitleClassName,
  type ArticleDocumentWidth,
} from '@/renderer/lib/articleTypography';

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
  zh,
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
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      {toolbar}
      <div className="@container/creator relative flex min-h-0 min-w-0 flex-1">
        <div ref={scrollRootRef} className="min-h-0 min-w-0 flex-1 overflow-y-auto py-6">
          <div className={`mx-auto w-full ${articleEditorDocumentWidthClassName(documentWidth)} px-6 lg:px-8`}>
            <div className="mb-7 flex items-start gap-2">
              <Input
                value={title}
                maxLength={200}
                className={`${articleTitleClassName} h-auto min-w-0 flex-1 border-0 px-0 shadow-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring`}
                aria-label={zh ? '文章标题' : 'Article title'}
                placeholder={zh ? '未命名文章' : 'Untitled article'}
                onChange={(event) => onTitleChange(event.target.value)}
                onBlur={onPersist}
              />
              {titleAccessory}
            </div>
            {children}
          </div>
        </div>
        {sidePanel}
      </div>
    </section>
  );
}
