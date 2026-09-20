import type { BlockDocument, BlockNode } from '@/shared/contracts/block-document';
const text = (value: string): BlockNode => ({ type: 'text', text: value });
const paragraph = (id: string, value: string, link?: string, label?: string): BlockNode => ({
  type: 'paragraph',
  attrs: { blockId: id },
  content: [
    text(value),
    ...(link
      ? [
          text(' → '),
          { type: 'text', text: label || link, marks: [{ type: 'link', attrs: { href: `#aiy-block:${link}` } }] },
        ]
      : []),
  ],
});
const heading = (id: string, value: string, level = 2): BlockNode => ({
  type: 'heading',
  attrs: { blockId: id, level },
  content: [text(value)],
});
const list = (
  id: string,
  values: { id: string; value: string; link?: string; label?: string; children?: BlockNode[] }[],
): BlockNode => ({
  type: 'bulletList',
  attrs: { blockId: id },
  content: values.map((item) => ({
    type: 'listItem',
    attrs: { blockId: item.id },
    content: [paragraph(item.id + '-text', item.value, item.link, item.label), ...(item.children ?? [])],
  })),
});

/** Stable IDs belong to this example document only. These are not pre-existing library objects. */
export function aiyOutlineExample(): BlockDocument {
  return {
    schemaVersion: 1,
    format: 'PROSEMIRROR_JSON',
    root: {
      type: 'doc',
      content: [
        heading('aiy-root', 'AIY：AI 帮你 DIY', 1),
        paragraph('aiy-purpose', '从一句灵感到多份作品。由人决定方向、修改与发布，AI 提供帮助。'),
        heading('aiy-needs', '需求：为什么需要 AIY'),
        list('aiy-needs-list', [
          {
            id: 'need-find',
            value: 'N1 找回：图片、视频、提示词和原会话分散，几天后难以继续。',
            link: 'concept-content',
            label: 'C1 内容与身份',
          },
          {
            id: 'need-desktop',
            value: 'N2 放在手边：参考图与便签能贴到桌面，收回后不丢原件。',
            link: 'concept-petal',
            label: 'C2 花瓣是入口',
            children: [
              list('need-desktop-children', [
                {
                  id: 'need-hide',
                  value: '暂时休息后恢复桌面，不把早已收回的内容重新弹出。',
                  link: 'design-visibility',
                  label: 'D1 桌面状态',
                },
                {
                  id: 'need-recover',
                  value: '一份便签保存失败时，知道是哪份、为什么，其他入口仍可暂隐。',
                  link: 'test-recovery',
                  label: 'T2 保存与恢复',
                },
              ]),
            ],
          },
          {
            id: 'need-output',
            value: 'N3 多份输出：教程、封面和短帖分别修改，仍能追溯共同来源。',
            link: 'concept-group',
            label: 'C3 组织不取得所有权',
          },
        ]),
        heading('aiy-concepts', '概念：每个动作改变什么'),
        list('aiy-concepts-list', [
          {
            id: 'concept-content',
            value: 'C1 内容、作品、修订：入口改变不换身份；另写一稿有独立身份；保存不等于发布。',
          },
          {
            id: 'concept-petal',
            value: 'C2 花瓣是内容入口。展开、暂隐、收回和删除原内容是四种动作。',
            link: 'design-visibility',
            label: 'D1 桌面状态',
          },
          {
            id: 'concept-group',
            value: 'C3 创作项把同一件事的多份作品组织在一起；图集维护成员与次序；来源与引用另记。',
            link: 'design-reference',
            label: 'D2 固定引用',
          },
          {
            id: 'concept-outline',
            value: 'C4 大纲展示正文或资料的结构；格式、组件、来源引用不是同一概念。',
            link: 'test-outline',
            label: 'T3 大纲交互',
          },
          { id: 'concept-mask', value: 'C5 面具为同一内容选择文件、嵌入或封面加链接；独立改写不是面具。' },
        ]),
        heading('aiy-design', '设计：把规则变成可操作的界面'),
        list('aiy-design-list', [
          {
            id: 'design-visibility',
            value: 'D1 管理入口：资料／本文／桌面各有范围。选择不改变显隐；恢复桌面不取消收回。',
            link: 'test-visibility',
            label: 'T1 状态序列',
          },
          {
            id: 'design-reference',
            value: 'D2 引用：按已保存修订与稳定块 ID 固定内容；引用创作项或图集时，固定成员清单。',
            link: 'test-reference',
            label: 'T4 引用边界',
          },
          {
            id: 'design-outline',
            value: 'D3 大纲：三角展开与折叠，圆点聚焦，标题定位正文，面包屑返回。个人折叠不写入作品。',
            link: 'test-outline',
            label: 'T3 大纲交互',
          },
          { id: 'design-menu', value: 'D4 同一内容跨窗口保留同类操作；便签只获得当前对象所需的窄权限。' },
        ]),
        heading('aiy-tests', '验收：怎样确认确实做到了'),
        list('aiy-tests-list', [
          {
            id: 'test-visibility',
            value: 'T1 A 暂隐、B 收回、C 从未贴出、D 图层隐藏。恢复桌面只重新显示 A；重启后仍成立。',
          },
          { id: 'test-recovery', value: 'T2 区分修订已确认与恢复稿已保留；新便签不能只凭内存检查点就消失。' },
          { id: 'test-outline', value: 'T3 搜索保留祖先；聚焦可返回；键盘能走完整棵树；折叠后导出的正文不减少。' },
          {
            id: 'test-reference',
            value: 'T4 移动块后旧引用仍定位原修订；删除来源保留快照；更改图集成员不改写旧引用；未插入的摘录不算被引。',
          },
        ]),
        paragraph(
          'aiy-example-boundary',
          '本示例中的 N／C／D／T 是同一文档内的定位链接。真正跨作品的固定引用，需先保存来源，再从“插入固定引用”中选择。',
        ),
      ],
    },
  };
}
