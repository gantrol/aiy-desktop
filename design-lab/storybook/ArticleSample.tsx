import { useEffect, useLayoutEffect, useState, type ComponentProps } from 'react';
import { ArticleEditor } from '@/renderer/components/creator/ArticleEditor';
import {
  ArticleEditorSessionRegistryProvider,
  useArticleEditorSessions,
} from '@/renderer/components/creator/article-editor/ArticleEditorSessionProvider';
import { ArticleDeliveryProvider } from '@/renderer/features/article-delivery/ArticleDeliveryProvider';
import { BackgroundIssueProvider } from '@/renderer/features/background-issues/BackgroundIssueProvider';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';
import { createArticleSample, type ArticleScenario } from './articleScenarioData';
import { installArticlePreviewHost, isolateArticlePreferences } from './articlePreviewHost';

type Sample = Awaited<ReturnType<typeof createArticleSample>>;
type EditorProps = ComponentProps<typeof ArticleEditor>;
export interface ArticleSampleProps {
  scenario: ArticleScenario;
  onSave?: EditorProps['onSave'];
  onSaved?: EditorProps['onSaved'];
}

function SessionLifetime({
  spaceId,
  articleId,
  scenario,
}: {
  spaceId: string;
  articleId: string;
  scenario: ArticleScenario;
}) {
  const registry = useArticleEditorSessions();
  const copy = useI18n().messages.designLab.storybook.sample;
  const [unsavedTitle] = useState(copy.unsavedTitle);
  useLayoutEffect(() => {
    let seeded = false;
    let stopRecovery: (() => void) | undefined;
    let observed: ReturnType<NonNullable<typeof registry>['find']>;
    const watch = () => {
      const session = registry?.find(spaceId, articleId);
      if (!session || observed === session) return;
      observed = session;
      const seed = () => {
        if (seeded || session.getRecoveryStatus() !== 'none' || scenario !== 'saveFailure') return;
        seeded = true;
        session.titleChanged(unsavedTitle);
        void session.flush('manual');
      };
      stopRecovery = session.subscribeRecovery(seed);
      seed();
    };
    const stop = registry?.subscribe(watch);
    watch();
    return () => {
      stop?.();
      stopRecovery?.();
      registry?.find(spaceId, articleId)?.dispose();
    };
  }, [registry, spaceId, articleId, scenario, unsavedTitle]);
  return null;
}

function ArticleSession({
  sample,
  spaceId,
  scenario,
  onSave,
  onSaved,
}: ArticleSampleProps & { sample: Sample; spaceId: string }) {
  const { locale, messages } = useI18n();
  const [article, setArticle] = useState(sample.initial);
  const [notice, notify] = useState('');
  const unavailable = async () => {
    throw new Error(messages.designLab.storybook.sample.unavailable);
  };
  const reportUnavailable = () => notify(messages.designLab.storybook.sample.unavailable);
  return (
    <ArticleEditorSessionRegistryProvider>
      <SessionLifetime spaceId={spaceId} articleId={article.id} scenario={scenario} />
      <BackgroundIssueProvider spaceId={spaceId} refresh={unavailable} notify={notify}>
        <ArticleDeliveryProvider spaceId={spaceId} notify={notify}>
          <div className="flex h-full min-h-0 flex-col">
            {notice && (
              <div role="alert" className="flex items-center gap-2 border-b px-4 py-2 text-sm">
                <span className="min-w-0 flex-1">{notice}</span>
                <Button variant="ghost" size="sm" onClick={() => notify('')}>
                  {messages.common.close}
                </Button>
              </div>
            )}
            <ArticleEditor
              article={article}
              spaceId={spaceId}
              locale={locale}
              canvasPresets={[]}
              extensions={[]}
              relations={[]}
              coverGenerations={{}}
              onOpenCoverGeneration={reportUnavailable}
              onSave={onSave ?? sample.save}
              onSaved={(next) => {
                setArticle(next);
                onSaved?.(next);
                notify('');
              }}
              onCopyForWechat={unavailable}
              onExport={unavailable}
              onCreateArticle={unavailable}
              onGenerateHeader={unavailable}
              onGenerateIllustration={unavailable}
              onConfigureArticleCheck={reportUnavailable}
              onEditCreationInput={unavailable}
              onOpenRelation={reportUnavailable}
              notify={notify}
            />
          </div>
        </ArticleDeliveryProvider>
      </BackgroundIssueProvider>
    </ArticleEditorSessionRegistryProvider>
  );
}

export function ArticleSample(props: ArticleSampleProps) {
  const copy = useI18n().messages.designLab.storybook.sample;
  const [initial] = useState(() => ({ copy, scenario: props.scenario }));
  const [environment, setEnvironment] = useState<{ sample: Sample; spaceId: string } | null>(null);
  const [failure, setFailure] = useState('');
  useEffect(() => {
    let active = true;
    const spaceId = `storybook-${crypto.randomUUID()}`;
    const restoreBridge = installArticlePreviewHost(initial.copy.unavailable);
    const restorePreferences = isolateArticlePreferences(spaceId);
    void createArticleSample(initial.copy, initial.scenario).then(
      (sample) => {
        if (active) setEnvironment({ sample, spaceId });
      },
      (error: unknown) => {
        if (active) setFailure(String(error));
      },
    );
    return () => {
      active = false;
      restorePreferences();
      restoreBridge();
    };
    // Sample content is a starting document. Changing UI language must not replace the author's draft.
  }, [initial]);
  if (failure) return <div role="alert">{failure}</div>;
  return environment ? <ArticleSession {...props} {...environment} /> : null;
}
