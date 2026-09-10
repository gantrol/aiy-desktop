export const WECHAT_SOCIAL_POST = {
  origin: 'https://mp.weixin.qq.com',
  editorPath: '/cgi-bin/appmsg',
  editorType: '77',
  editorCreateType: '8',
  legacyEditorType: '77',
  menuContent: '.new-creation__menu-content',
  menuLabel: '贴图',
  body: '.share-text__input .ProseMirror[contenteditable="true"]',
  title: '.title-editor__input .ProseMirror[contenteditable="true"]',
  upload: '.pop-opr__group-select-image .js_upload_btn_container input[type="file"]',
  mediaRoot: '.image-selector',
  previews: '.image-selector__bottom-list-item',
  placeholder: '.editor_placeholder[contenteditable="false"]',
} as const;

export const WECHAT_ARTICLE = {
  ...WECHAT_SOCIAL_POST,
  editorCreateType: '0',
  legacyEditorType: '10',
  menuLabel: '文章',
  body: '.rich_media_content .ProseMirror[contenteditable="true"]',
  upload: '#js_editor_insertimage input[type="file"]',
  placeholder: '.editor_content_placeholder[contenteditable="false"],.editor_placeholder[contenteditable="false"]',
  title: '.title-editor__input .ProseMirror[contenteditable="true"],textarea#title',
} as const;

export function matchesWechatEditor(url: URL, config: typeof WECHAT_SOCIAL_POST | typeof WECHAT_ARTICLE): boolean {
  if (url.origin !== config.origin || url.pathname !== config.editorPath) return false;
  const type = url.searchParams.get('type');
  const createType = url.searchParams.get('createType');
  return (
    (type === config.editorType && createType === config.editorCreateType) ||
    (createType === null && type === config.legacyEditorType)
  );
}
