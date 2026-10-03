import type { JSONContent } from '@tiptap/core';
import { captureBlockDocument } from '@/shared/contracts/block-document';
import plan from './plan.json';
import type { Topic, Work } from './types';

// Authored proposal content stays in its original language when the UI locale changes.
const paragraph = (id: string, text: string): JSONContent => ({
  type: 'paragraph',
  attrs: { blockId: id },
  content: text ? [{ type: 'text', text }] : [],
});
const heading = (id: string, text: string, level: number): JSONContent => ({
  type: 'heading',
  attrs: { blockId: id, level },
  content: [{ type: 'text', text }],
});
function document(id: string, title: string, sections: [string, string][]) {
  return captureBlockDocument({
    type: 'doc',
    content: [
      heading(id, title, 1),
      ...sections.flatMap(([name, body], index) => [
        heading(`${id}-${index}`, name, 2),
        paragraph(`${id}-${index}-body`, body),
      ]),
    ],
  });
}
function planDocument() {
  const targets = new Set(plan.map((item) => item.id));
  const blocks: JSONContent[] = [heading('minimal-plan', '特性、场景与验收', 1)];
  const ordered = [
    ...plan.filter((item) => item.kind === 'feature').sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0)),
    ...plan.filter((item) => item.kind !== 'feature'),
  ];
  for (const item of ordered) {
    blocks.push(heading(item.id, `${item.id} · ${item.title}`, 2));
    blocks.push(paragraph(`${item.id}-body`, item.body));
    if (item.kind === 'feature') {
      blocks.push(paragraph(`${item.id}-priority`, [item.priority, item.placement, item.disposition].join(' · ')));
      blocks.push(paragraph(`${item.id}-reentry`, item.reentry_condition ?? ''));
    }
    if (item.refs.length)
      blocks.push({
        type: 'paragraph',
        attrs: { blockId: `${item.id}-refs` },
        content: item.refs.flatMap((ref, index): JSONContent[] => [
          ...(index ? [{ type: 'text', text: ' · ' }] : []),
          {
            type: 'text',
            text: `${ref.relation}: ${ref.target}`,
            ...(targets.has(ref.target)
              ? { marks: [{ type: 'link', attrs: { href: `#aiy-block:${ref.target}` } }] }
              : {}),
          },
        ]),
      });
  }
  return captureBlockDocument({ type: 'doc', content: blocks });
}

export const topics: Topic[] = [
  {
    id: 'loop',
    title: 'AIY 最小创作循环',
    materials: [
      {
        id: 'intent',
        title: '这次要解决的问题',
        body: '从灵感到发布。先保住本地创作与主流平台交付，再把反馈带回下一次创作。',
      },
      {
        id: 'layout',
        title: '工作面的四个位置',
        body: '左侧主题，中间左侧为本次材料，中间编辑当前作品，右侧选择主题产出。辅助面板可以收起。',
      },
      {
        id: 'boundary',
        title: '本轮不做什么',
        body: '不替换生产入口，不迁移用户数据，不运行模型，不向平台发送，不把样例当作已通过的验收。',
      },
    ],
  },
  {
    id: 'design',
    title: '网页／平面设计内容包',
    materials: [
      {
        id: 'design-material',
        title: '内容包的起点',
        body: '先用一份可复用的排版方法做出样张，记录字体来源、许可与制作条件，再决定哪些资源值得打包。',
      },
    ],
  },
];
export function initialWorks(): Work[] {
  return [
    {
      id: 'loop-outline',
      topicId: 'loop',
      title: '最小创作工作台',
      inputs: [],
      document: document('loop-outline', '最小创作工作台', [
        ['开始', '允许直接写作，不要求先配置模型、整理材料或建立完整主题体系。'],
        ['选择', '主题里的全部资料，不等于这次明确选中的输入。'],
        ['创作', '大纲与正文沿用同一份内容；另写一份才创建独立作品。'],
        ['交付', '平台稿是原作品的发布变体。准备、导出与实际发布分别记录。'],
        ['再开始', '保留一点反馈、来源或方法，让它成为下一次创作的材料。'],
      ]),
    },
    { id: 'loop-plan', topicId: 'loop', title: '特性、场景与验收', inputs: [], document: planDocument() },
    {
      id: 'loop-article',
      topicId: 'loop',
      title: '从一点灵感到发布',
      inputs: [],
      document: document('loop-article', '从一点灵感到发布', [
        ['这次取哪一瓢', '面对海量信息，不先整理整个世界。围绕眼前作品，选取足够支持这次表达的材料。'],
        ['做出作品', '明确这次想表达什么、希望对谁有帮助，以及暂时不做什么。可以先写，再补证据。'],
        ['带回经验', '发布不是循环的终点。一个读者问题、一段旧稿或一种好用的方法，都能让下一次开始得更容易。'],
      ]),
    },
    {
      id: 'design-outline',
      topicId: 'design',
      title: '第一份设计包样张',
      inputs: [],
      document: document('design-outline', '第一份设计包样张', [
        ['作品', '一张封面，加一页说明排版取舍的制作记录。'],
        ['材料', '字体、许可、参考与排版参数各自保留来源。'],
        ['交付', '先交付可查看的样张，再考虑模板、字体分发和专用工具适配。'],
      ]),
    },
  ];
}
