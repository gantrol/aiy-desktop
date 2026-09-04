import { useRef, useState } from 'react';
import type {
  BrowserCompanionBrowserOpenError,
  BrowserCompanionStageInput,
  BrowserCompanionTarget,
  BrowserCompanionWatermarkSelection,
} from '@/shared/contracts';

const TARGET_LABELS: Record<BrowserCompanionTarget, { en: string; zh: string }> = {
  chatgpt: { en: 'ChatGPT', zh: 'ChatGPT' },
  wechat: { en: 'WeChat Official Account', zh: '微信公众号' },
  weibo: { en: 'Weibo', zh: '微博' },
};

type PreparedHandoff = Omit<BrowserCompanionStageInput, 'target' | 'watermark'>;

const OPEN_ERROR_LABELS: Record<BrowserCompanionBrowserOpenError, { en: string; zh: string }> = {
  BROWSER_NOT_FOUND: { en: 'The configured browser was not found', zh: '未找到已配置的浏览器' },
  CHROME_NOT_FOUND: { en: 'Google Chrome was not found', zh: '未找到 Google Chrome' },
  DESTINATION_NOT_SELECTED: { en: 'Choose a browser Profile for this destination', zh: '请为该目标选择浏览器 Profile' },
  PROFILE_NOT_SELECTED: { en: 'Choose a Chrome Profile first', zh: '请先选择 Chrome Profile' },
  PROFILE_UNAVAILABLE: { en: 'The configured browser Profile is unavailable', zh: '已配置的浏览器 Profile 不可用' },
  COMPANION_NOT_INSTALLED: {
    en: 'AIY Companion is not installed in the selected browser Profile',
    zh: '所选浏览器 Profile 未安装 AIY 伴侣',
  },
  DESKTOP_SERVICE_UNAVAILABLE: { en: 'AIY desktop companion service is unavailable', zh: 'AIY 桌面伴侣服务不可用' },
  NATIVE_HOST_UNAVAILABLE: { en: 'AIY desktop connection could not be registered', zh: 'AIY 桌面连接注册失败' },
  LAUNCH_FAILED: { en: 'The selected browser Profile could not be opened', zh: '无法打开所选浏览器 Profile' },
};

function openedMessage(target: BrowserCompanionTarget, targetLabel: string, zh: boolean) {
  if (target === 'chatgpt') {
    return zh
      ? '已打开 ChatGPT；生成后可在对应图片上选择“回填 AIY”'
      : 'ChatGPT opened; choose “Return to AIY” on the generated image';
  }
  if (target === 'wechat') {
    return zh
      ? '已打开微信公众号，AIY 伴侣将进入“贴图”并填入内容；请确认后再发布'
      : 'WeChat Official Account opened; AIY Companion will open the social post editor and fill it; review before publishing';
  }
  return zh
    ? `已打开${targetLabel}，AIY 伴侣将自动填入；请确认后再发布`
    : `${targetLabel} opened; AIY Companion will fill it automatically`;
}

export function useBrowserCompanionHandoff({
  notify,
  prepare,
  zh,
}: {
  notify(message: string): void;
  prepare(target: BrowserCompanionTarget): Promise<PreparedHandoff | null>;
  zh: boolean;
}) {
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);

  async function handoff(
    target: BrowserCompanionTarget,
    watermark?: BrowserCompanionWatermarkSelection,
  ): Promise<void> {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const prepared = await prepare(target);
      if (!prepared) return;
      const result = await window.desktopApi.browserCompanionStage({
        target,
        ...prepared,
        ...(watermark ? { watermark } : {}),
      });
      const targetLabel = TARGET_LABELS[target][zh ? 'zh' : 'en'];
      notify(
        result.browserOpened
          ? openedMessage(target, targetLabel, zh)
          : result.browserOpenError
            ? `${OPEN_ERROR_LABELS[result.browserOpenError][zh ? 'zh' : 'en']} · ${
                zh ? '内容已保存在伴侣历史中' : 'Saved to Companion history'
              }`
            : zh
              ? '内容已保存在伴侣历史中，但未能打开浏览器'
              : 'Saved to Companion history, but the browser could not be opened',
      );
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return { busy, handoff };
}
