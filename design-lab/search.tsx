import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nContext } from '@/renderer/i18n/I18nContext';
import { hydrateLanguageCatalog } from '@/renderer/i18n/languageCatalog';
import { enMessages } from '@/renderer/i18n/locales/en';
import zhMessages from '../extensions/com.aiy.language.zh-cn/messages.json';
import ContentSearchScreen from '@/renderer/features/content-search/ContentSearchScreen';
import { initialAppLocation } from '@/renderer/components/app/app-navigation';
import { contentLookupInputSchema, type ContentLookupResult } from '@/shared/contracts/content-search';
import type { ContentSource } from '@/shared/contracts/content-source';
import { contentSearchQuery, contentSearchSnippet, normalizeSearchText } from '@/shared/content-search-query';
import './style.css';

// Explicitly synthetic IPC: this workbench never reads or writes a user's library.
const parameters = new URLSearchParams(location.search);
const locale = parameters.get('locale') === 'en' ? 'en' : 'zh';
const incomplete = parameters.has('partial');
const samples = [
  ['玫瑰试作记录', '红玫瑰不要压扁。保留原始参考，另做候选。'],
  ['星溪号 v12', '护罩几何适配尚待处理；v12 可继续编辑，不恢复旧入口。'],
  ['AIY 搜索需求', '找回已保存内容 → 核对命中证据 → 在新标签继续。'],
  ...Array.from({ length: 34 }, (_, index) => [
    'AIY 记录',
    `独立记录 ${index + 1}：旧内容也能找到，不能只查最新一页。`,
  ]),
];
const rows = samples.map(([title, text], index) => ({ id: `demo-${index + 1}`, title, text }));
const readSynthetic = async (source: ContentSource) => {
  const row = rows.find((item) => item.id === source.id);
  if (!row) throw new Error('Unavailable example');
  return {
    source: { ...source, revisionId: source.revisionId ?? 'demo-r2' },
    title: row.title,
    displayTitle: row.title,
    revisionId: source.revisionId ?? 'demo-r2',
    contentHash: 'synthetic',
    markdown: row.text,
    media: [],
    blocks: [],
  };
};
Object.defineProperty(window, 'desktopApi', {
  configurable: true,
  value: {
    contentLibrary: {
      lookup: async (raw: unknown): Promise<ContentLookupResult> => {
        const input = contentLookupInputSchema.parse(raw),
          query = contentSearchQuery(input.query);
        const matched =
          input.type !== 'ALL' && input.type !== 'ARTICLE'
            ? []
            : rows.filter((row) =>
                query.terms.every(
                  (term) => normalizeSearchText(row.title + '\n' + row.text).includes(term) || row.id === term,
                ),
              );
        const snapshot = JSON.stringify([query.terms, input.type]),
          reset = Boolean(input.offset && input.snapshot !== snapshot);
        const offset = reset ? 0 : input.offset;
        return {
          scope: 'CURRENT_SAVED_DOCUMENTS',
          snapshot,
          reset,
          coverage: {
            total: rows.length + (incomplete ? 2 : 0),
            ready: rows.length,
            pending: 0,
            unavailable: incomplete ? 1 : 0,
            limited: incomplete ? 1 : 0,
          },
          items: matched.slice(offset, offset + 30).map((row) => ({
            source: { kind: 'ARTICLE', id: row.id, revisionId: 'demo-r1' },
            title: row.title,
            preview: contentSearchSnippet(row.text, query.terms),
            updatedAt: '2026-09-14T00:00:00Z',
            bodyIndexed: true,
            branchRole: null,
            match: query.terms.length ? (row.id === query.phrase ? 'ID' : 'BODY') : 'RECENT',
          })),
          nextOffset: offset + 30 < matched.length ? offset + 30 : null,
        };
      },
      read: readSynthetic,
      readCurrent: (source: ContentSource) => readSynthetic({ ...source, revisionId: undefined }),
    },
  },
});

function Workbench() {
  const [search, setSearch] = useState(initialAppLocation.search);
  const [selected, setSelected] = useState('');
  return (
    <main className="flex h-screen flex-col bg-background text-foreground">
      {selected && <output className="text-sm text-muted-foreground">{selected}</output>}
      <ContentSearchScreen
        active
        location={search}
        onNavigate={setSearch}
        onOpen={(source) => setSelected(source.id)}
      />
    </main>
  );
}
createRoot(document.getElementById('root')!).render(
  <I18nContext.Provider
    value={{
      locale,
      setLocale: (value) => {
        location.search = '?locale=' + value;
      },
      messages: hydrateLanguageCatalog(locale === 'zh' ? zhMessages : {}, enMessages),
      availableLocales: ['zh', 'en'],
    }}
  >
    <Workbench />
  </I18nContext.Provider>,
);
