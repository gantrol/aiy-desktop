# 视频图文生成运行时与 Prompt Profile 设计

> 状态：`IMPLEMENTED_BASELINE`
> 最近核对：2026-08-14
> 适用范围：`apps/desktop` 当前视频图文生成实现
> 当前 Prompt profile：`video-article-zh-v1`

本文描述代码已经采用的“计划＋有界成文”运行时设计，并给出与实现一一对应的 UML
视图。它不是完整视频理解方案的替代品：章节级证据对齐、独立审计、定点修复和跨计划窗口合并仍是后续扩展点。

## 1. 目标与边界

当前实现解决四件事：

1. 把视频图文的自然语言指令集中到一个中文、版本化的 Prompt profile；
2. 把一次全片生成拆成 `PLAN_DOCUMENT`／`PLAN_WINDOW` 与 `DRAFT_CHAPTER` 两类有界 turn；
3. 让模型只返回严格 JSON，由宿主验证 cue、语义单元、候选图和时间范围；
4. 把 Prompt 版本写入检查点键和成功 revision 的 generation receipt，使结果可追溯且不会跨版本误复用。

当前明确不包含：

- `PLAN_WINDOW` 的重叠输入和 `MERGE_PLAN`；
- 章节级自适应补帧和 `ALIGN_EVIDENCE`；
- 独立的 `AUDIT_CHAPTER` 与 `REPAIR_BLOCK`；
- 模型直接生成 Markdown、磁盘路径或数据库对象；
- 没有可靠字幕时对语音、对白或画面外事实的推断。

## 2. 核心设计决策

| 关注点      | 决策                                                                  | 代码所有者                       |
| ----------- | --------------------------------------------------------------------- | -------------------------------- |
| Prompt 文本 | 所有运行时自然语言指令使用中文；阶段名、字段名和枚举保持 canonical ID | `generation-prompt-profile.ts`   |
| 输出合同    | Zod Schema 与提供给模型的 JSON Schema 独立于自然语言 Prompt           | `generation-profile.ts`          |
| 阶段编排    | 只选择阶段、构建有界输入、执行预算／重试／校验，不内联业务指令        | `generation-pipeline.ts`         |
| 窗口形成    | 按完整 cue 和候选图上限形成计划窗口、章节窗口及视觉回退窗口           | `generation-orchestration.ts`    |
| 模型传输    | 原样传递中文 developer instruction、用户输入、附件和输出 Schema       | `codex-text-adapter.ts`          |
| 持久化      | 服务冻结并复核输入，宿主渲染 Markdown，原子提交 revision 与 run       | `generation-service.ts`          |
| 复用        | 只有完整版本化输入哈希命中且重新通过宿主校验的检查点才可复用          | `generation-checkpoint-store.ts` |

不把完整 Prompt 复制到本文。代码中的 profile 是运行时唯一事实源，本文只冻结职责、依赖和版本规则，避免文档与实际指令出现两套可执行版本。

## 3. UML 组件图

下图同时标出 Electron 主进程与模型工作进程边界。渲染层不能直接读取本地证据路径、SQLite
或 Codex App Server。

```mermaid
flowchart LR
    subgraph Renderer["Renderer process"]
        UI["«component» VideoDocuments UI"]
        Actions["«component» useVideoDocumentContentActions"]
        UI --> Actions
    end

    subgraph Main["Electron main process"]
        Preload["«boundary» Typed preload API"]
        IPC["«component» Video document IPC"]
        WorkerClient["«component» ModelWorkerClient"]
        Preload --> IPC --> WorkerClient
    end

    subgraph Worker["Model worker process"]
        Dispatcher["«boundary» Request dispatcher"]
        Service["«service» VideoDocumentGenerationService"]
        Pipeline["«service» VideoDocumentGenerationPipeline"]
        Orchestration["«component» Window orchestration"]
        PromptProfile["«component» Chinese Prompt profile"]
        OutputSchema["«component» Runtime and output schemas"]
        Checkpoints["«repository» Checkpoint store"]
        KeyChanges["«service» Key-change evidence"]
        CodexAdapter["«adapter» CodexTextAdapter"]
        Database["«repository» LibraryDatabase"]

        Dispatcher --> Service
        Service --> Pipeline
        Service --> KeyChanges
        Service --> Database
        Pipeline --> Orchestration
        Pipeline --> PromptProfile
        Pipeline --> OutputSchema
        Pipeline --> Checkpoints
        Pipeline --> CodexAdapter
    end

    AppServer["«external» Codex App Server"]
    FFmpeg["«external» FFmpeg evidence extraction"]
    Storage["«storage» SQLite and library object store"]
    CacheFiles["«storage» Local checkpoint files"]

    Actions --> Preload
    WorkerClient --> Dispatcher
    CodexAdapter --> AppServer
    KeyChanges --> FFmpeg
    Database --> Storage
    Checkpoints --> CacheFiles
```

### 3.1 组件职责约束

- `PromptProfile` 可以生成中文指令，但不能调用模型、访问数据库或决定重试。
- `Pipeline` 可以选择 stage profile，但不能新增临时 Prompt 字符串绕开 profile。
- `CodexTextAdapter` 只处理可用性、临时线程、附件、Schema、取消和用量，不追加业务角色说明。
- `Service` 是提交边界；模型结果在它完成输入复核、确定性渲染和媒体绑定之前不是正式文稿。
- `Renderer` 只得到类型化结果和 revision，不得到候选帧本地路径或模型线程的文件系统权限。

## 4. UML 时序图

### 4.1 一次成功生成

```mermaid
sequenceDiagram
    autonumber
    actor User as 用户
    participant UI as Renderer
    participant Main as IPC and ModelWorkerClient
    participant Service as GenerationService
    participant Repo as LibraryDatabase
    participant Evidence as KeyChangeService
    participant Pipeline as GenerationPipeline
    participant Profile as PromptProfile
    participant Codex as CodexTextAdapter
    participant Server as Codex App Server
    participant Cache as CheckpointStore

    User->>UI: 生成图文稿
    UI->>Main: videoDocumentArticleGenerate
    Main->>Service: generateArticle(documentId, noteId)
    Service->>Repo: 读取 document、逐字 revision、文章 parent
    Service->>Codex: preflightStructuredText
    Codex->>Server: 核验模型与启动条件
    Server-->>Codex: readiness
    Service->>Repo: 复核来源快照
    Service->>Evidence: allModelEvidence
    Evidence-->>Service: 候选帧白名单
    Service->>Repo: start generation run
    Service->>Pipeline: run(冻结输入)

    alt 有可靠带时间字幕
        loop 每个计划窗口
            Pipeline->>Profile: 构建 PLAN_DOCUMENT 或 PLAN_WINDOW 中文指令
            Pipeline->>Cache: 读取版本化检查点
            Cache-->>Pipeline: hit 或 miss
            alt 有效检查点
                Pipeline->>Pipeline: 再次执行计划业务校验
            else 未命中或缓存值失效
                Pipeline->>Codex: runStructuredText(prompt, schema)
                Codex->>Server: 临时线程和有界 turn
                Server-->>Codex: 结构化结果与 usage
                Codex-->>Pipeline: JSON 文本
                Pipeline->>Pipeline: Schema、cue 边界和语义单元校验
                Pipeline->>Cache: 保存已验证计划
            end
        end
    else 没有可靠字幕
        Pipeline->>Pipeline: 建立 ORIGINAL_LED 视觉窗口
    end

    loop 每个章节窗口
        Pipeline->>Profile: 构建 DRAFT_CHAPTER 中文指令和章节策略
        Pipeline->>Cache: 读取版本化检查点
        Cache-->>Pipeline: hit 或 miss
        alt 有效检查点
            Pipeline->>Pipeline: 再次执行草稿业务校验
        else 未命中或缓存值失效
            Pipeline->>Codex: runStructuredText(prompt, 0..8 张原帧, schema)
            Codex->>Server: 临时线程和有界 turn
            Server-->>Codex: 结构化结果与 usage
            Codex-->>Pipeline: JSON 文本
            Pipeline->>Pipeline: 校验分类、ID、时间和语义覆盖
            Pipeline->>Cache: 保存已验证草稿
        end
    end

    Pipeline->>Pipeline: 按源时间确定性聚合
    Pipeline-->>Service: article、usage、promptProfileId
    Service->>Repo: 复核逐字、文章 parent 与来源
    Service->>Service: 渲染 Markdown 并持久化选中图片
    Service->>Repo: 再次复核并原子提交 revision 和成功 run
    Service->>Cache: 清理本次检查点
    Service-->>UI: revision 与 generation run
    UI-->>User: 打开可校对图文稿
```

图中为主路径。若预检不能启动 turn，则记录 `BLOCKED`；输入不可用或准备失败则记录
`NOT_STARTED`。只有准备完成后才创建 `RUNNING` run。

### 4.2 单个模型阶段的检查点与重试

```mermaid
sequenceDiagram
    autonumber
    participant Pipeline as GenerationPipeline
    participant Profile as PromptProfile
    participant Cache as CheckpointStore
    participant Adapter as CodexTextAdapter
    participant Host as Host validator

    Pipeline->>Profile: developer instruction + stage prompt
    Profile-->>Pipeline: 中文指令与有界输入
    Pipeline->>Pipeline: 检查字符、阶段数、总时长预算
    Pipeline->>Cache: read(hash(profile + stage + schema + input + model))

    alt 命中且重新校验通过
        Cache-->>Pipeline: typed value + actualModel
        Pipeline->>Host: validate(value)
        Host-->>Pipeline: pass
    else 未命中或缓存值已失效
        loop 最多 2 次
            Pipeline->>Adapter: runStructuredText
            Adapter-->>Pipeline: finalMessage + usage
            Pipeline->>Host: JSON parse + Zod + 业务边界校验
            alt 通过
                Host-->>Pipeline: typed value
                Pipeline->>Cache: write(validated value)
            else 可重试的模型输出错误
                Host-->>Pipeline: VIDEO_DOCUMENT_MODEL_OUTPUT_INVALID
                Pipeline->>Profile: 加入中文重试约束
            else 不可重试错误或次数耗尽
                Host-->>Pipeline: fail closed
            end
        end
    end
```

检查点不是信任边界。命中后仍执行同一宿主业务校验；版本或动态输入任何一项变化都会得到不同哈希。

## 5. UML 领域类图

类图只表达当前内存合同之间的关系，不暗示新增数据库表。

```mermaid
classDiagram
    direction LR

    class VideoDocumentPromptProfile {
        +String id
        +String language
        +int contractVersion
    }

    class StagePromptProfile {
        +String stage
        +String id
        +int outputSchemaVersion
    }

    class ChapterPlanCandidate {
        +DocumentProfile documentProfile
    }

    class ChapterCandidate {
        +String heading
        +int startCueIndex
        +int endCueIndex
        +SegmentType segmentType
        +Confidence classificationConfidence
    }

    class PlannedChapter {
        +String id
        +int startTimestampMs
        +int endTimestampMs
        +SegmentType segmentType
        +Confidence classificationConfidence
        +DocumentProfile documentProfile
    }

    class PlannedSemanticUnit {
        +String id
        +String kind
        +String summary
        +int[] supportCueIndexes
    }

    class ChapterDraftWindow {
        +String id
        +int startTimestampMs
        +int endTimestampMs
        +Cue[] primaryCues
        +Cue[] boundaryCues
    }

    class EvidenceCandidate {
        +String id
        +int timestampMs
        +String filePath
        +String reason
    }

    class VideoDocumentDraftBatch {
        +DocumentProfile documentProfile
        +Confidence classificationConfidence
    }

    class DraftSection {
        +String heading
        +int startTimestampMs
        +int endTimestampMs
        +SegmentType segmentType
        +Confidence classificationConfidence
        +String[] paragraphs
        +String[] steps
        +int[] directQuoteCueIndexes
        +String[] visualCandidateIds
        +String[] coveredSemanticUnitIds
    }

    class GenerationPipelineResult {
        +String actualModel
        +String promptProfileId
        +TokenUsage usage
    }

    class GenerationReceipt {
        +String runId
        +String requestedModel
        +String actualModel
        +String promptProfileId
        +String transcriptRevisionId
        +TokenUsage usage
    }

    VideoDocumentPromptProfile "1" *-- "3" StagePromptProfile
    ChapterPlanCandidate "1" *-- "1..24" ChapterCandidate
    ChapterCandidate --> PlannedChapter : materialize
    PlannedChapter "1" *-- "1..24" PlannedSemanticUnit
    PlannedChapter "1" --> "1..*" ChapterDraftWindow : split
    ChapterDraftWindow "1" o-- "0..8" EvidenceCandidate : whitelist
    ChapterDraftWindow --> VideoDocumentDraftBatch : bounds
    VideoDocumentDraftBatch "1" *-- "1..16" DraftSection
    GenerationPipelineResult "1" *-- "1" VideoDocumentDraftBatch : article
    GenerationPipelineResult --> GenerationReceipt : persist profile and usage
```

关键不变量：

- `ChapterCandidate` 只能引用当前计划窗口提供的 cue；物化后章节连续、无重叠，并恰好覆盖该窗口全部 cue。
- 每个 `PlannedSemanticUnit` 获得宿主生成的稳定 ID，支持 cue 必须位于父章节。
- `DraftSection` 必须复制父章节的类型与置信度；成文阶段不能重新分类。
- 一个章节窗口中的必要语义 ID 必须被草稿恰好覆盖一次。
- 直接引语只返回 cue ID，原文由宿主复制；图片只返回当前白名单 candidate ID。
- `GenerationReceipt.promptProfileId` 对旧 revision 可缺省，对新成功生成必须写入当前 profile ID。

## 6. UML 状态图

```mermaid
stateDiagram-v2
    [*] --> Preparing
    Preparing --> NotStarted: 输入缺失或准备失败
    Preparing --> Blocked: App Server 暂时不能启动 turn
    Preparing --> Running: 预检和证据准备完成

    state "RUNNING" as Running {
        [*] --> RouteByTranscript
        RouteByTranscript --> Plan: 有可靠带时间字幕
        RouteByTranscript --> Draft: 无可靠字幕
        Plan --> Draft: 计划均通过宿主校验
        Draft --> Aggregate: 所有章节窗口通过
        Aggregate --> RevalidateInputs
        RevalidateInputs --> PersistEvidence
        PersistEvidence --> FinalRevalidate
        FinalRevalidate --> Commit
        Commit --> [*]
    }

    Running --> Succeeded: revision 与 run 原子提交
    Running --> Failed: 不可恢复错误或重试耗尽
    Running --> Cancelled: AbortSignal 取消
    Running --> Interrupted: 工作进程中断

    state "NOT_STARTED" as NotStarted
    state "BLOCKED" as Blocked
    state "SUCCEEDED" as Succeeded
    state "FAILED" as Failed
    state "CANCELLED" as Cancelled
    state "INTERRUPTED" as Interrupted

    NotStarted --> [*]
    Blocked --> [*]
    Succeeded --> [*]
    Failed --> [*]
    Cancelled --> [*]
    Interrupted --> [*]
```

`NOT_STARTED` 与 `BLOCKED` 是准备阶段的诚实结果，不伪造为一次已经开始的失败调用。运行中任一来源、逐字 revision 或文章 parent 发生变化时，提交必须失败关闭。

## 7. Prompt 组合与版本管理

### 7.1 组合结构

```mermaid
flowchart TB
    Invariant["中文共同硬边界"] --> DeveloperBuilder["buildVideoDocumentDeveloperInstructions"]
    StagePolicy["中文阶段职责"] --> DeveloperBuilder
    RetryPolicy["中文重试约束"] --> DeveloperBuilder

    PlanRules["章节分类与计划规则"] --> UserBuilder["阶段 Prompt builder"]
    SegmentPolicy["当前章节内容策略"] --> UserBuilder
    VisualPolicy["视觉选择规则"] --> UserBuilder
    DynamicInput["标题、cue、语义单元、candidate 映射"] --> UserBuilder

    DeveloperBuilder --> Turn["一次有界 structured turn"]
    UserBuilder --> Turn
    OutputSchema["严格 JSON Schema"] --> Turn
    Turn --> RuntimeSchema["Zod 与宿主业务校验"]
```

共同 developer instruction 不包含动态数据；字幕、标题、文件名、图片说明和既有 JSON 全部在硬边界中被声明为惰性来源数据。每次 turn 只注入当前阶段和当前章节所需的策略，不把九种内容策略全部重复发送。

### 7.2 当前 profile

| 范围       | ID                                  | Schema 版本         | 职责                             |
| ---------- | ----------------------------------- | ------------------- | -------------------------------- |
| 总 profile | `video-article-zh-v1`               | `contractVersion=1` | 标识整套中文 Prompt 行为         |
| 完整计划   | `video-article-plan-document-zh-v1` | `1`                 | 在一个有界字幕输入内形成完整计划 |
| 窗口计划   | `video-article-plan-window-zh-v1`   | `1`                 | 只规划当前字幕窗口               |
| 章节成文   | `video-article-draft-chapter-zh-v1` | `2`                 | 在冻结章节和证据白名单内成文     |

### 7.3 变更与失效矩阵

| 变化                                               | 必须更新                                          | 自动失效依据                                |
| -------------------------------------------------- | ------------------------------------------------- | ------------------------------------------- |
| 事实边界、分类、语义覆盖、剧透、选图或失败回退改变 | 总 profile ID、受影响 stage ID                    | profile 与 stage ID 进入检查点键            |
| 阶段职责或 Prompt 组合合同改变                     | 总 profile ID、`contractVersion`、受影响 stage ID | contract version 进入检查点键               |
| 输出字段结构或字段语义改变                         | 上述 ID 与对应 `outputSchemaVersion`              | Schema 版本和 Schema 内容进入检查点键       |
| 标题、字幕、候选帧、语义单元等运行输入改变         | 不升级 profile                                    | 构建后的 Prompt、附件和候选 ID 进入检查点键 |
| 请求模型或推理强度改变                             | 不升级 profile                                    | model 与 effort 进入检查点键                |
| 不改变行为的错字修正                               | 可不升级                                          | 变更后的完整 Prompt 本身仍改变检查点哈希    |

新阶段只有在中文 Prompt、严格运行时 Schema、宿主白名单校验、预算、检查点版本和失败语义同时具备时才可加入 `VIDEO_DOCUMENT_PROMPT_PROFILE.stages`。

## 8. 当前预算与失败关闭

| 限制                     |  当前值 | 所有者                                   |
| ------------------------ | ------: | ---------------------------------------- |
| 计划窗口 cue 数          |     500 | `generation-orchestration.ts`            |
| 计划窗口估算字符数       |  60,000 | `generation-orchestration.ts`            |
| 单阶段最终 Prompt 字符数 | 120,000 | `generation-pipeline.ts`                 |
| 单个模型 turn 图片数     |       8 | `generation-orchestration.ts` 与 adapter |
| 单阶段模型输出尝试       |       2 | `generation-pipeline.ts`                 |
| 一次 pipeline 最大阶段数 |      64 | `generation-pipeline.ts`                 |
| 单阶段时限               | 15 分钟 | `generation-pipeline.ts`                 |
| pipeline 总时限          | 50 分钟 | `generation-pipeline.ts`                 |
| 已知总 token 上限        | 500,000 | `generation-pipeline.ts`                 |
| 最终文章 section 数      |     500 | `generation-pipeline.ts`                 |
| 单个检查点大小           |   4 MiB | `generation-checkpoint-store.ts`         |

模型结果依次经过：响应字节上限、JSON 解析、Zod Schema、阶段业务校验、全文业务校验和提交前输入复核。任何未知 ID、越界时间、重分类、漏掉必要语义或输入并发变化都不会降级成“尽量保存”。

## 9. 后续扩展接缝

下一阶段沿现有边界扩展，不把新职责重新塞回 `DRAFT_CHAPTER`：

```mermaid
flowchart LR
    CurrentPlan["PLAN_DOCUMENT or PLAN_WINDOW<br/>已实现"] --> MergePlan["MERGE_PLAN<br/>待实现"]
    CurrentPlan --> Align["ALIGN_EVIDENCE<br/>待实现"]
    MergePlan --> Align
    Align --> Draft["DRAFT_CHAPTER<br/>已实现基础版"]
    Draft --> Audit["AUDIT_CHAPTER<br/>待实现"]
    Audit -->|通过| Render["确定性合并与渲染"]
    Audit -->|可修复| Repair["REPAIR_BLOCK<br/>待实现"]
    Repair --> Audit
```

- `MERGE_PLAN` 需要重叠计划窗口、稳定冲突规则和独立 Schema；当前顺序拼接不等同于合并。
- `ALIGN_EVIDENCE` 需要章节级证据计划和视觉组合同；当前 0–8 张窗口白名单只是基础候选约束。
- `AUDIT_CHAPTER` 必须使用隔离 turn，只报告结构化 issue；不能继承生成线程的解释历史。
- `REPAIR_BLOCK` 只能替换 issue 指定的最小块，并继续使用同一个不可变 run context。

## 10. 代码追踪

| 设计项                             | 实现位置                                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------------------------- |
| 中文 Prompt、profile 和阶段构建器  | [`generation-prompt-profile.ts`](../../src/main/video-documents/generation-prompt-profile.ts)     |
| Prompt 管理约定                    | [`PROMPTS.md`](../../src/main/video-documents/PROMPTS.md)                                         |
| 输出 Schema 与领域类型             | [`generation-profile.ts`](../../src/main/video-documents/generation-profile.ts)                   |
| 计划／章节窗口与确定性物化         | [`generation-orchestration.ts`](../../src/main/video-documents/generation-orchestration.ts)       |
| 阶段执行、检查点、预算、重试和校验 | [`generation-pipeline.ts`](../../src/main/video-documents/generation-pipeline.ts)                 |
| 输入快照、渲染、媒体绑定和原子提交 | [`generation-service.ts`](../../src/main/video-documents/generation-service.ts)                   |
| 检查点文件合同                     | [`generation-checkpoint-store.ts`](../../src/main/video-documents/generation-checkpoint-store.ts) |
| Codex App Server 结构化文本适配    | [`codex-text-adapter.ts`](../../src/main/assistant/codex-text-adapter.ts)                         |
| generation receipt 与 IPC 数据合同 | [`video-document.ts`](../../src/shared/contracts/video-document.ts)                               |
