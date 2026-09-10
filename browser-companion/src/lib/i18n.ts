const FALLBACK_MESSAGES = {
  en: {
    extensionName: 'AIY Companion',
    extensionDescription:
      'Automatically receive AIY handoffs on supported sites. You decide whether to send or publish.',
    siteChatgpt: 'ChatGPT',
    siteWechat: 'WeChat Official Account',
    siteWeibo: 'Weibo',
    siteX: 'X (Twitter)',
    siteXiaohongshu: 'Xiaohongshu',
    errorXiaohongshuTitleTooLong: 'Shorten the Xiaohongshu title to 20 full-width characters (40 Latin characters).',
    errorXiaohongshuBodyTooLong: 'Shorten the Xiaohongshu text to 1,000 characters.',
    errorXiaohongshuMediaUnsupported: 'Use 1–18 PNG/JPEG/WebP images, up to 32 MB each, for Xiaohongshu.',
    errorXiaohongshuLoginRequired:
      'Log in to Xiaohongshu Creator Center in this browser Profile, then upload again from AIY.',
    errorMediaUnsupported: 'Use up to four PNG/JPEG/WebP/GIF files (5 MB per still image, 15 MB per GIF).',
    errorComposerHasMedia: 'The editor already has media. Remove it before filling from AIY.',
    popupBadgeNoPublish: 'Never publishes',
    popupSingleContent: 'Single item',
    popupPasteText: 'Paste text',
    popupIdentifyingSite: 'Identifying',
    popupUnsupportedSite: 'Unsupported',
    popupWaitingForContent: 'Waiting for content',
    popupWaitingToFill: 'Ready to fill',
    popupFilling: 'Filling',
    popupConnectingAiy: 'Connecting to AIY',
    popupFillFromHistory: 'Fill from history',
    popupFillCurrentPage: 'Fill current page',
    popupManualFillSuccess: 'Filled $1 characters. Check the page before continuing.',
    popupDesktopFillSuccess: 'Filled $1 characters and $2 images from AIY. Check the page before continuing.',
    popupReceiptFailed: 'Content was filled, but AIY could not confirm the result.',
    popupRefreshAndRetry: 'Refresh this page and try again.',
    errorInvalidRequest: 'This content could not be read. Try again.',
    errorUnsupportedSite: 'Automatic fill is not available on this page.',
    errorBusy: 'Another item is being filled. Wait a moment.',
    errorComposerNotFound: 'Open the editor on this page, then try again.',
    errorComposerAmbiguous: 'More than one editor was found, so nothing was changed.',
    errorComposerNotEmpty: 'The editor already has content, so nothing was overwritten.',
    errorMediaInputNotFound: 'The image input could not be found on this page.',
    errorMediaFillFailed: 'The images could not be confirmed as filled. Try again.',
    errorFillFailed: 'The content could not be confirmed as filled. Refresh the page and try again.',
    errorDesktopInvalidRequest: 'AIY could not read this connection request.',
    errorUnauthorized: 'AIY has not authorized this Companion. Reopen AIY and try again.',
    errorTargetMismatch: 'This page does not match the content waiting to be filled.',
    errorDraftAlreadyClaimed: 'This content is already being handled in another window.',
    errorHandoffNotFound: 'No content is waiting. Return to AIY and upload it again.',
    errorHandoffTokenMismatch: 'This handoff has expired. Upload it again from AIY.',
    errorMediaNotFound: 'A handoff image is no longer available. Upload it again from AIY.',
    errorMediaChanged: 'A handoff image changed. Upload it again from AIY.',
    errorOutputImportNotAllowed: 'This ChatGPT handoff is not linked to an AIY image creation.',
    errorOutputUploadNotFound: 'The image return expired. Select the image again.',
    errorOutputUploadChanged: 'The selected image changed before AIY could import it.',
    errorStateConflict: 'The handoff changed in AIY. Upload it again.',
    errorCorruptState: 'The handoff record is damaged. Upload it again from AIY.',
    errorInternal: 'AIY could not process this handoff. Try again shortly.',
    errorDesktopConnection:
      'AIY Desktop could not be reached. Make sure AIY is running; the content is still available in history.',
    errorMediaDownload: 'A handoff image could not be read. Try again from history.',
    automaticHandoffFailedTitle: 'Automatic fill did not finish',
    automaticHandoffDesktopDetail:
      'AIY Desktop could not be reached. Make sure AIY is running, open AIY Companion, then choose “Fill from history.” Your content is still available in Companion history.',
    automaticHandoffMediaDetail:
      'A handoff image could not be read from AIY Desktop. Open AIY Companion and try again from history; your original content is still available.',
    automaticHandoffGenericDetail:
      'This page could not be filled safely. Open AIY Companion and try again from history; your original content is still available.',
    automaticHandoffLogSummary: 'Automatic handoff did not finish',
    automaticHandoffRetryAction: 'Open AIY Companion and choose “Fill from history” to retry',
    chatgptOutputReturnAction: 'Return to AIY',
    chatgptOutputReturning: 'Returning…',
    chatgptOutputReturned: 'Returned',
    chatgptOutputReturnSuccessTitle: 'Returned to AIY',
    chatgptOutputReturnAdoptedDetail: 'The selected image is now the linked cover in AIY.',
    chatgptOutputReturnImportedDetail: 'The image was saved in the linked AIY creation; review the cover there.',
    chatgptOutputReturnFailedTitle: 'Could not return the image',
    chatgptOutputReturnFailedDetail: 'Keep AIY open, then select this image again.',
    conflictSiteHasContent: '$1 already has content',
    conflictCurrentInputHasContent: 'The current editor already has content',
    conflictQuestion: 'Clear the existing content and fill this AIY handoff?',
    conflictKeepExisting: 'Keep existing content',
    conflictReplaceExisting: 'Clear and fill',
  },
  zh: {
    extensionName: 'AIY 伴侣',
    extensionDescription: '在支持的网站自动接收 AIY 交接内容，由用户决定是否发送或发布。',
    siteChatgpt: 'ChatGPT',
    siteWechat: '微信公众号',
    siteWeibo: '微博',
    siteX: 'X（推特）',
    siteXiaohongshu: '小红书',
    errorXiaohongshuTitleTooLong: '小红书标题最多 20 个全角字符（40 个英文字符），请缩短标题。',
    errorXiaohongshuBodyTooLong: '小红书正文最多 1,000 字，请缩短正文。',
    errorXiaohongshuMediaUnsupported: '小红书图文请选择 1–18 张 PNG/JPEG/WebP 图片，每张不超过 32 MB。',
    errorXiaohongshuLoginRequired: '请在当前浏览器 Profile 登录小红书创作服务平台，再从 AIY 重新上传。',
    errorMediaUnsupported: '请选择最多四个 PNG/JPEG/WebP/GIF 文件（静态图片每张 5 MB，GIF 每个 15 MB）。',
    errorComposerHasMedia: '编辑器已有媒体，请先移除后再从 AIY 填入。',
    popupBadgeNoPublish: '不代点发布',
    popupSingleContent: '单条内容',
    popupPasteText: '粘贴文本',
    popupIdentifyingSite: '识别中',
    popupUnsupportedSite: '不支持',
    popupWaitingForContent: '等待内容',
    popupWaitingToFill: '等待填入',
    popupFilling: '正在填入',
    popupConnectingAiy: '正在连接 AIY',
    popupFillFromHistory: '从历史填入',
    popupFillCurrentPage: '填入当前页',
    popupManualFillSuccess: '已填入 $1 字，请在网页确认。',
    popupDesktopFillSuccess: '已从 AIY 填入 $1 字、$2 张图，请在网页确认。',
    popupReceiptFailed: '内容已填入，但 AIY 未能确认结果。',
    popupRefreshAndRetry: '请刷新当前网页后再试。',
    errorInvalidRequest: '这条内容无法识别，请重试。',
    errorUnsupportedSite: '当前网页暂不支持自动填入。',
    errorBusy: '正在处理上一条内容，请稍候。',
    errorComposerNotFound: '未找到可安全填入的编辑器，请打开编辑区后重试。',
    errorComposerAmbiguous: '页面有多个编辑器，无法安全判断填入位置。',
    errorComposerNotEmpty: '编辑器已有内容，为避免覆盖已停止。',
    errorMediaInputNotFound: '未找到当前页面的图片入口。',
    errorMediaFillFailed: '图片未能确认填入，请重试。',
    errorFillFailed: '内容未能确认填入，请刷新网页后重试。',
    errorDesktopInvalidRequest: 'AIY 无法读取这次连接请求。',
    errorUnauthorized: 'AIY 桌面端未授权此伴侣，请重新打开 AIY 后重试。',
    errorTargetMismatch: '当前网页与待填入内容不匹配。',
    errorDraftAlreadyClaimed: '这条内容已在其他窗口处理中。',
    errorHandoffNotFound: '没有找到待填入内容，请回到 AIY 重新上传。',
    errorHandoffTokenMismatch: '交接已失效，请从 AIY 重新上传。',
    errorMediaNotFound: '交接图片已不可用，请从 AIY 重新上传。',
    errorMediaChanged: '交接图片已变化，请从 AIY 重新上传。',
    errorOutputImportNotAllowed: '这次 ChatGPT 交接未关联到 AIY 图片创作。',
    errorOutputUploadNotFound: '图片回填已过期，请重新选择这张图。',
    errorOutputUploadChanged: '所选图片在 AIY 导入前发生了变化。',
    errorStateConflict: 'AIY 中的交接状态已变化，请重新上传。',
    errorCorruptState: '交接记录损坏，请从 AIY 重新上传。',
    errorInternal: 'AIY 未能处理这次交接，请稍后重试。',
    errorDesktopConnection: '无法连接 AIY 桌面端。请确认 AIY 正在运行；内容仍保留在历史中。',
    errorMediaDownload: '交接图片读取失败，请从历史记录重试。',
    automaticHandoffFailedTitle: '自动填入未完成',
    automaticHandoffDesktopDetail:
      '无法连接 AIY 桌面端。请确认 AIY 正在运行，打开 AIY 伴侣，选择“从历史填入”重试。内容仍保留在伴侣历史中。',
    automaticHandoffMediaDetail: '交接图片未能从 AIY 桌面端读取。请打开 AIY 伴侣，从历史记录重试；原内容仍会保留。',
    automaticHandoffGenericDetail: '页面未能安全填入。请打开 AIY 伴侣，从历史记录重试；原内容仍会保留。',
    automaticHandoffLogSummary: '自动交接未完成',
    automaticHandoffRetryAction: '打开 AIY 伴侣并选择“从历史填入”重试',
    chatgptOutputReturnAction: '回填 AIY',
    chatgptOutputReturning: '回填中…',
    chatgptOutputReturned: '已回填',
    chatgptOutputReturnSuccessTitle: '已回填 AIY',
    chatgptOutputReturnAdoptedDetail: '所选图片已成为对应创作的封面。',
    chatgptOutputReturnImportedDetail: '图片已保存到对应 AIY 创作，请在 AIY 中确认封面。',
    chatgptOutputReturnFailedTitle: '图片回填失败',
    chatgptOutputReturnFailedDetail: '请保持 AIY 打开，然后重新选择这张图。',
    conflictSiteHasContent: '$1已有内容',
    conflictCurrentInputHasContent: '当前输入框已有内容',
    conflictQuestion: '是否清空现有内容并填入 AIY 交接？',
    conflictKeepExisting: '保留现有内容',
    conflictReplaceExisting: '清空并填入',
  },
} as const;

export type CompanionMessageKey = keyof (typeof FALLBACK_MESSAGES)['en'];

function resolvedLanguage(): 'en' | 'zh' {
  try {
    return browser.i18n.getUILanguage().toLowerCase().startsWith('zh') ? 'zh' : 'en';
  } catch {
    return 'en';
  }
}

function substituteFallback(message: string, substitutions: readonly string[]): string {
  return substitutions.reduce(
    (current, substitution, index) => current.replaceAll(`$${index + 1}`, substitution),
    message,
  );
}

export function companionLanguageTag(): 'en' | 'zh-CN' {
  return resolvedLanguage() === 'zh' ? 'zh-CN' : 'en';
}

export function companionMessage(key: CompanionMessageKey, substitutions: readonly string[] = []): string {
  try {
    const localized = substitutions.length
      ? browser.i18n.getMessage(key, [...substitutions])
      : browser.i18n.getMessage(key);
    if (localized) return localized;
  } catch {
    // Development pages outside the extension runtime use the typed fallback below.
  }
  return substituteFallback(FALLBACK_MESSAGES[resolvedLanguage()][key], substitutions);
}
