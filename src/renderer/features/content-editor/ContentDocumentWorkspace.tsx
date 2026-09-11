import type { ReactNode, RefObject } from 'react';
import { ContentWorkspace } from '@/renderer/features/content-editor/ContentWorkspacePanels';
import { articleEditorDocumentWidthClassName, type ArticleDocumentWidth } from '@/renderer/lib/articleTypography';

export function ContentDocumentToolbar({ children }: { children: ReactNode }) {
  return <div className="flex h-10 shrink-0 items-center gap-1 border-b bg-muted/20 px-2">{children}</div>;
}

export function ContentDocumentWorkspace({
  children,
  documentWidth,
  scrollRootRef,
  sidePanel,
  title,
  titleAccessory,
  toolbar,
}: {
  children: ReactNode;
  documentWidth: ArticleDocumentWidth;
  scrollRootRef: RefObject<HTMLDivElement | null>;
  sidePanel?: ReactNode;
  title: ReactNode;
  titleAccessory?: ReactNode;
  toolbar?: ReactNode;
}) {
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      {toolbar}
      <ContentWorkspace>
        <div ref={scrollRootRef} className="min-h-0 min-w-0 flex-1 overflow-y-auto py-6">
          <div className={`mx-auto w-full ${articleEditorDocumentWidthClassName(documentWidth)} px-6 lg:px-8`}>
            <div className="mb-7 flex items-start gap-2">
              {title}
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
