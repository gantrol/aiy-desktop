export const articleDocumentWidthClassName = 'max-w-[43rem]';

export const articleWideDocumentWidthClassName = 'max-w-[64rem]';

export type ArticleDocumentWidth = 'STANDARD' | 'WIDE';

export function articleEditorDocumentWidthClassName(width: ArticleDocumentWidth) {
  return width === 'WIDE' ? articleWideDocumentWidthClassName : articleDocumentWidthClassName;
}

export const articleTextMeasureClassName = 'max-w-[40rem]';

export const articleTitleClassName =
  'text-[2rem] leading-[1.25] font-semibold tracking-[-0.012em] text-[var(--button-primary)]';

export const articleReferenceTitleClassName =
  'text-[1.75rem] leading-[1.3] font-semibold tracking-[-0.01em] text-[var(--button-primary)]';

export const articleRichTextClassName = [
  'text-[16px] leading-[1.875] tracking-[0.012em] text-foreground-secondary',
  '[&>h1:first-child]:hidden',
  '[&_h2]:mb-5 [&_h2]:mt-12 [&_h2]:border-b [&_h2]:border-selected-border [&_h2]:pb-2.5',
  '[&_h2]:text-[1.375rem] [&_h2]:leading-[1.45] [&_h2]:font-semibold [&_h2]:tracking-[0.01em]',
  '[&_h2]:text-[var(--button-primary)]',
  '[&_h3]:mb-4 [&_h3]:mt-10 [&_h3]:border-l-[3px] [&_h3]:border-[var(--button-primary)] [&_h3]:pl-3',
  '[&_h3]:text-[1.1875rem] [&_h3]:leading-[1.5] [&_h3]:font-semibold [&_h3]:text-[var(--button-primary)]',
  '[&_h4]:mb-3 [&_h4]:mt-8 [&_h4]:text-[1.0625rem] [&_h4]:leading-[1.55] [&_h4]:font-semibold',
  '[&_h4]:text-[var(--button-primary)]',
  '[&_h5]:mb-2.5 [&_h5]:mt-7 [&_h5]:text-[15px] [&_h5]:leading-[1.6] [&_h5]:font-semibold',
  '[&_h5]:text-[var(--button-primary)]',
  '[&_h6]:mb-2 [&_h6]:mt-6 [&_h6]:text-sm [&_h6]:leading-[1.6] [&_h6]:font-semibold',
  '[&_h6]:tracking-[0.04em] [&_h6]:text-[var(--button-primary)]',
  '[&>p]:my-5',
  '[&_strong]:font-semibold [&_strong]:text-foreground',
  '[&_a]:font-medium [&_a]:text-[var(--button-primary)] [&_a]:underline',
  '[&_a]:decoration-selected-border [&_a]:underline-offset-4',
  '[&_blockquote]:my-7 [&_blockquote]:border-l-[3px] [&_blockquote]:border-[var(--button-primary)]',
  '[&_blockquote]:bg-selected/35 [&_blockquote]:px-5 [&_blockquote]:py-4',
  '[&_blockquote]:text-[15px] [&_blockquote]:leading-[1.8] [&_blockquote]:text-muted-foreground',
  '[&_blockquote_p]:my-0 [&_blockquote_p]:text-inherit [&_blockquote_p+p]:mt-3',
  '[&>ul]:my-5 [&_ul]:list-disc [&_ul]:space-y-2.5 [&_ul]:pl-6',
  '[&>ol]:my-5 [&_ol]:list-decimal [&_ol]:space-y-2.5 [&_ol]:pl-6',
  '[&_li]:pl-0.5 [&_li>p]:my-0 [&_li>div>p]:my-0 [&_li>ul]:mt-2.5 [&_li>ol]:mt-2.5',
  '[&_ul[data-type=taskList]]:list-none [&_ul[data-type=taskList]]:pl-0',
  '[&_li[data-type=taskItem]]:flex [&_li[data-type=taskItem]]:items-start',
  '[&_li[data-type=taskItem]]:gap-2.5 [&_li[data-type=taskItem]>label]:pt-1',
  '[&_li[data-type=taskItem]>div]:min-w-0 [&_li[data-type=taskItem]>div]:flex-1',
  '[&_code]:rounded-sm [&_code]:bg-surface-sunken [&_code]:px-1.5 [&_code]:py-0.5',
  '[&_code]:font-mono [&_code]:text-[0.9em] [&_code]:tracking-normal [&_code]:text-foreground',
  '[&_pre]:my-7 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:bg-surface-sunken',
  '[&_pre]:px-5 [&_pre]:py-4 [&_pre]:font-mono [&_pre]:text-sm [&_pre]:leading-6 [&_pre]:tracking-normal',
  '[&_pre_code]:rounded-none [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-[inherit]',
  '[&_hr]:mx-auto [&_hr]:my-10 [&_hr]:w-16 [&_hr]:border-0 [&_hr]:border-t-2 [&_hr]:border-selected-border',
  '[&_.tableWrapper]:my-7 [&_.tableWrapper]:overflow-x-auto [&_.tableWrapper]:rounded-md [&_.tableWrapper]:border',
  '[&_table]:my-7 [&_table]:w-full [&_table]:border-collapse [&_table]:text-sm [&_table]:leading-6',
  '[&_table]:tracking-normal [&_.tableWrapper_table]:my-0',
  '[&_th]:border-r [&_th]:border-b [&_th]:border-border [&_th]:bg-selected/35 [&_th]:px-4 [&_th]:py-3',
  '[&_th]:text-left [&_th]:font-semibold [&_th]:text-selected-foreground',
  '[&_td]:border-r [&_td]:border-b [&_td]:border-border [&_td]:px-4 [&_td]:py-3 [&_td]:align-top',
  '[&_tr>*:last-child]:border-r-0 [&_tbody_tr:last-child>td]:border-b-0',
  '[&_.ProseMirror-selectednode]:ring-2 [&_.ProseMirror-selectednode]:ring-selected-border',
].join(' ');
