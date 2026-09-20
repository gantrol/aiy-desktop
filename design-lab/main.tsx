import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ExternalLink, MoreHorizontal } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { ContentSurface } from '@/renderer/components/ui/content-surface';
import { AssetMedia } from '@/renderer/components/media/AssetMedia';
import { ImagePlaybackButton } from '@/renderer/components/media/ImagePlaybackButton';
import { hidePetalByHub, revealPetalByHub, setPetalVisibility, type PetalVisibility } from '@/shared/petal-visibility';
import { I18nContext } from '@/renderer/i18n/I18nContext';
import { useI18n } from '@/renderer/i18n/useI18n';
import { hydrateLanguageCatalog } from '@/renderer/i18n/languageCatalog';
import { htmlLanguages } from '@/renderer/i18n/catalog';
import { enMessages } from '@/renderer/i18n/locales/en';
import zhMessages from '../extensions/com.aiy.language.zh-cn/messages.json';
import manifest from './cases.json';
import { animation, landscape, portrait, poster, smallSvg } from './fixtures';
import { animatedPng, animatedWebp } from './animated-fixtures';
import './style.css';

const params = new URLSearchParams(location.search);
const locale = params.get('locale') === 'en' ? 'en' : 'zh';
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
const width = Math.max(280, Math.min(640, Number(params.get('width')) || 320));
const chosen = manifest.cases.find((item) => item.id === params.get('case')) ?? manifest.cases[0];
const initialMotion = params.get('motion') === 'still' ? 'still' : params.get('motion') === 'play' ? 'play' : 'auto';
document.documentElement.lang = htmlLanguages[locale];
document.documentElement.dataset.theme = theme;

function change(key: string, value: string) {
  const next = new URLSearchParams(location.search);
  next.set(key, value);
  location.search = next.toString();
}

function LabSelect({
  name,
  label,
  value,
  options,
}: {
  name: string;
  label: string;
  value: string;
  options: { id: string; label: string }[];
}) {
  return (
    <div className="grid gap-1 text-xs text-muted-foreground">
      <label htmlFor={`lab-${name}`}>{label}</label>
      <Select value={value} onValueChange={(next) => change(name, next)}>
        <SelectTrigger id={`lab-${name}`} className="max-w-65">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function VisibilityCase() {
  const { messages } = useI18n();
  const copy = messages.designLab;
  const [states, setStates] = useState<Record<string, PetalVisibility>>({
    active: { visible: true },
    collected: { visible: false },
  });
  return (
    <div className="lab-visibility flex flex-col gap-3.5 text-[13px]">
      {Object.entries(states).map(([id, state]) => (
        <p key={id} data-petal={id} data-visible={state.visible}>
          {copy[id as 'active' | 'collected']} ·{' '}
          {state.visible ? copy.visible : state.hiddenByHub ? copy.temporarilyHidden : copy.hidden}
        </p>
      ))}
      <Button
        data-action="hide"
        variant="outline"
        onClick={() =>
          setStates((value) =>
            Object.fromEntries(Object.entries(value).map(([id, state]) => [id, hidePetalByHub(state)])),
          )
        }
      >
        {copy.hide}
      </Button>
      <Button
        data-action="show"
        variant="outline"
        onClick={() =>
          setStates((value) =>
            Object.fromEntries(Object.entries(value).map(([id, state]) => [id, revealPetalByHub(state)])),
          )
        }
      >
        {copy.show}
      </Button>
      <Button
        data-action="collect"
        variant="ghost"
        onClick={() => setStates((value) => ({ ...value, active: setPetalVisibility(value.active, false) }))}
      >
        {copy.collect}
      </Button>
    </div>
  );
}

function Lab() {
  const { messages } = useI18n();
  const copy = messages.desktopPetals.media;
  const lab = messages.designLab;
  const [motion, setMotion] = useState<'auto' | 'play' | 'still'>(initialMotion);
  const [notice, setNotice] = useState('');
  const [failed, setFailed] = useState(chosen.fixture === 'missing');
  const title = chosen.id === 'long-title' ? lab.longTitle : lab.cases[chosen.id as keyof typeof lab.cases];
  const isPaper = ['paper', 'visibility'].includes(chosen.fixture);
  const animatedFixture =
    chosen.fixture === 'animation'
      ? { mediaUrl: animation, mimeType: 'image/gif' }
      : chosen.fixture === 'apng'
        ? { mediaUrl: animatedPng, mimeType: 'image/png' }
        : chosen.fixture === 'webp'
          ? { mediaUrl: animatedWebp, mimeType: 'image/webp' }
          : null;
  const asset = {
    id: chosen.id,
    mediaUrl: animatedFixture
      ? animatedFixture.mediaUrl
      : chosen.fixture === 'svg-large'
        ? '/never-load-large-original.svg'
        : chosen.fixture === 'svg-small'
          ? smallSvg
          : chosen.fixture === 'landscape'
            ? landscape
            : portrait,
    mimeType: animatedFixture?.mimeType ?? 'image/svg+xml',
    byteSize: chosen.fixture === 'svg-large' ? 3_000_000 : 2000,
    width: chosen.fixture === 'landscape' ? 600 : 400,
    height: chosen.fixture === 'landscape' ? 400 : 600,
  };
  const preview = animatedFixture ? poster : chosen.fixture === 'svg-large' ? smallSvg : asset.mediaUrl;
  return (
    <div className="lab mx-auto max-w-290 p-4.5 sm:px-8 sm:py-7">
      <header className="lab-header border-b border-border pb-5.5">
        <strong className="text-xl font-semibold tracking-tight">
          AIY <span className="ml-3 font-normal">{lab.title}</span>
        </strong>
      </header>
      <nav className="lab-controls mt-5 mb-9 flex flex-wrap gap-5" aria-label={lab.settings}>
        <LabSelect
          name="case"
          label={lab.case}
          value={chosen.id}
          options={manifest.cases.map((item) => ({
            id: item.id,
            label: lab.cases[item.id as keyof typeof lab.cases],
          }))}
        />
        <LabSelect
          name="locale"
          label={lab.language}
          value={locale}
          options={[
            { id: 'zh', label: '简体中文' },
            { id: 'en', label: 'English' },
          ]}
        />
        <LabSelect
          name="theme"
          label={lab.theme}
          value={theme}
          options={[
            { id: 'light', label: lab.light },
            { id: 'dark', label: lab.dark },
          ]}
        />
        <LabSelect
          name="width"
          label={lab.width}
          value={String(width)}
          options={[280, 320, 480, 640].map((value) => ({
            id: String(value),
            label: String(value),
          }))}
        />
      </nav>
      <main
        className="lab-stage flex min-h-135 flex-wrap items-start justify-center gap-6 sm:gap-12"
        data-case={chosen.id}
      >
        <div className="lab-example max-w-full shrink-0" style={{ width, height: Math.min(760, width / chosen.ratio) }}>
          <ContentSurface
            kind={isPaper ? 'paper' : 'media'}
            title={title}
            className="lab-content size-full"
            tools={
              <>
                {animatedFixture && (
                  <ImagePlaybackButton
                    asset={asset}
                    poster={preview}
                    motion={motion}
                    labels={copy}
                    onMotionChange={setMotion}
                  />
                )}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={copy.original}
                  onClick={() => setNotice(lab.sourceUnavailable)}
                >
                  <ExternalLink />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={messages.desktopPetals.actions.more}
                  onClick={() => setNotice(lab.sourceUnavailable)}
                >
                  <MoreHorizontal />
                </Button>
              </>
            }
            status={failed ? copy.preview : undefined}
          >
            {chosen.fixture === 'visibility' ? (
              <VisibilityCase />
            ) : isPaper ? (
              <div className="lab-note text-[15px] leading-[1.85]">
                <p>{lab.noteTitle}</p>
                <p className="mt-6 text-foreground-secondary">{lab.noteBody}</p>
              </div>
            ) : failed ? (
              <div className="content-surface__empty grid place-content-center justify-items-center gap-3 p-4">
                <Button variant="secondary" onClick={() => setFailed(false)}>
                  {copy.retry}
                </Button>
              </div>
            ) : (
              <AssetMedia
                asset={asset}
                src={preview}
                previewSize={512}
                motion={motion}
                alt={title}
                onError={() => setFailed(true)}
              />
            )}
          </ContentSurface>
        </div>
        <aside className="lab-contract flex w-full flex-col gap-2.5 pt-3 text-xs text-muted-foreground sm:w-57.5">
          {chosen.rules.map((rule) => (
            <code className="font-mono wrap-anywhere" key={rule}>
              {rule}
            </code>
          ))}
          <a className="mt-3 text-selected-foreground underline underline-offset-3" href="./cases.json">
            cases.json
          </a>
        </aside>
      </main>
      <p className="lab-notice mt-6 min-h-6 text-center text-xs text-muted-foreground" role="status">
        {notice}
      </p>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <I18nContext.Provider
    value={{
      locale,
      setLocale: (next) => change('locale', next),
      messages: hydrateLanguageCatalog(locale === 'zh' ? zhMessages : {}, enMessages),
      availableLocales: ['zh', 'en'],
    }}
  >
    <Lab />
  </I18nContext.Provider>,
);
