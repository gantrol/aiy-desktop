# 视频图文 Prompt 管理

视频图文运行时 Prompt 的唯一业务来源是
`generation-prompt-profile.ts`。`generation-profile.ts` 只维护模型输出 Schema 和领域类型，
`generation-pipeline.ts` 只负责阶段编排、预算、重试和校验，不得再内联业务 Prompt。

组件边界、运行时序、领域合同、状态机和版本失效规则见
[视频图文生成运行时与 Prompt Profile 设计](../../../docs/design/video-article-generation-prompt-runtime.md)。

## Profile 规则

- 总 profile ID 标识一次可比较的完整 Prompt 行为，例如 `video-article-zh-v1`。
- 每个模型阶段还有独立 stage profile ID 和输出 Schema 版本。
- Prompt 的自然语言指令统一使用中文；`PLAN_DOCUMENT`、`cue`、`candidate` 等值是稳定协议标识，不翻译。
- 标题、字幕、语义单元和候选帧等动态数据只能由构建函数放入有界输入区，不能进入共享常量。
- 共同安全边界、阶段职责、内容类型策略、输入证据和输出 Schema 分层维护。

以下变化必须升级总 profile ID，并同步升级受影响的 stage profile ID：

- 改变事实边界、语义覆盖、分类、剧透或选图行为；
- 增删阶段职责或内容类型策略；
- 改变模型可引用的 ID、证据范围或失败回退；
- 改变输出 Schema 的含义。

只修正文案错字且不改变行为时可以不升级。输出 Schema 结构变化还必须升级对应
`outputSchemaVersion`。已完成文稿会在 generation receipt 中保存总 profile ID；生成检查点的
缓存键同时包含总 profile、stage profile 和 Schema 版本，避免跨版本复用旧结果。

## 阶段边界

- `PLAN_DOCUMENT`／`PLAN_WINDOW`：只规划章节、分类和必要语义。
- `DRAFT_CHAPTER`：只依据已验证计划和当前窗口证据成文。
- `ALIGN_EVIDENCE`、`AUDIT_CHAPTER`、`REPAIR_BLOCK` 尚未成为运行时合同；实现前应先增加严格
  Schema、宿主校验和不可变输入包，不能只添加一段未被消费的 Prompt。
