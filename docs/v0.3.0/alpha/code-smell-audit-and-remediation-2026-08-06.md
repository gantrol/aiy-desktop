# 2026-08-06 代码坏味道审计与整改计划

状态：整改实施中；高风险边界、分类一致性、运行时配置和已定位的 React 生命周期问题已落地，性能与 i18n 全量治理仍待后续批次

范围：`apps/desktop` 为主，附带记录工作区门禁问题

目的：作为本轮整改的问题清单、实施台账、设计约束和验收口径

本文补充并修正此前的
[`code-audit-and-refactor-checklist.md`](code-audit-and-refactor-checklist.md)。旧文档保留上一轮重构的历史证据；
本文记录 2026-08-06 复查后仍存在或新发现的问题。若两份文档结论冲突，以本文为准。

## 已确认的产品边界

1. `0.3.0` 已确定为第一次正式发布的数据库 baseline，但产品尚未正式发布，因此兼容承诺还没有生效。
2. `0.3.0` 正式发布前，可以继续完善、合并或重新生成 `v03-baseline.sql`，不要求兼容旧开发库、预发布库或已经删除的编号迁移。
3. 不为旧开发库增加接管器、兼容垫片、猜测性迁移或自动修复分支。需要保留的开发数据通过显式快照、导出和一次性重标处理，不进入产品运行时。
4. `0.3.0` 正式发布时冻结 `v03-baseline.sql`。此后数据库结构只通过新增 forward-only migration 演进；已经出现在任一正式版本中的 baseline 或迁移都不得修改。
5. “已注册的当前空间数据库文件丢失后被静默创建为空库”仍是数据安全缺陷。它处理的是当前空间的文件丢失，不是旧版本兼容。
6. 异步化、Worker 化和批量 `Promise.all` 不自动等于性能修复。没有消费者、没有时效价值或结果立即被覆盖的 I/O 应直接删除；必要工作才考虑延迟、有界并发、缓存或增量化。
7. 本文最初只记录审计结论；用户随后授权生产代码整改，并在首批提交后明确授权修复 3 个失配的架构测试。本轮测试改动仅限把旧相对 import／精确 JSX 字符串断言改为 AST 结构断言，未扩展到其余测试债务。

## 2026-08-06 实施状态

下面的状态覆盖各问题章节中记录的“审计时现状”。“部分完成”表示已关闭明确的危险路径，但不能据此宣称整个主题已经治理完成。

| 范围                       | 状态                   | 本轮结果／剩余工作                                                                                                                                                                                                                                                                                                                         |
| -------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| BND-01、CFG-01             | 已完成                 | 删除伪 `DeepSeekResponse`／泛型 decoder；从 `unknown` 经有界读取和 Zod schema 解码；DeepSeek provider definition、默认 model、base URL、endpoint 组合与 runtime snapshot 集中管理。                                                                                                                                                        |
| BND-02、BND-03             | 部分完成               | 已为当前图像 provider 和本地图像 worker 增加运行时协议 schema、响应字节上限与临时文件原子提交；受限权限 decoder 与所有格式的完整可解码性验证仍需继续。                                                                                                                                                                                     |
| LIB-01                     | 已完成                 | 已注册空间使用 must-exist 打开语义，数据库文件缺失时 fail closed，不再静默创建替代空库。                                                                                                                                                                                                                                                   |
| LIB-02、ASST-01            | 部分完成               | 模型 worker 协议升级并实现 request ID、取消、deadline 和生命周期隔离；所有跨 `LibraryContext` 的长链路尚未统一成显式 lease。                                                                                                                                                                                                               |
| CRED-01、STAGE-01          | 已完成                 | 凭据写入与测试结果使用 revision/CAS 和 stale-result guard；stage 改为原子消费。                                                                                                                                                                                                                                                            |
| CLS-01～CLS-03             | 已完成                 | move／restore／recursive merge 使用集合式 mutation plan；每个受影响术语只克隆一个完整 revision，并重建分类、facet 和目录投影。                                                                                                                                                                                                             |
| EVT-01                     | 部分完成               | 分类恢复补齐 local override tombstone/change event；内容包术语的分类 mutation 会更新或创建 local override。其余写路径仍需按实体逐项审计。                                                                                                                                                                                                  |
| DB-01                      | 已完成                 | baseline 安装阶段结束后统一启用 `foreign_keys = ON`，集成测试在该约束下通过。                                                                                                                                                                                                                                                              |
| REG-01、MEDIA-02、MEDIA-03 | 未完成                 | 保留为首发前风险项，不以现有测试绿灯代替实现。                                                                                                                                                                                                                                                                                             |
| UI-01                      | 代码已完成、待运行确认 | 两个 Tiptap 外部同步入口移到 microtask，避免 React lifecycle 内同步 dispatch；仍需在开发环境确认控制台不再出现 `flushSync` 警告。                                                                                                                                                                                                          |
| UI-02、UI-03               | 部分完成               | 已为本轮定位到的异步 UI 路径增加 latest-request/context guard；仍需继续覆盖所有 mutation 和查询入口。                                                                                                                                                                                                                                      |
| I18N-01、I18N-04           | 已完成                 | locale 写入改为 exact-write，首次语言加载不再把临时 fallback 持久化为用户选择。                                                                                                                                                                                                                                                            |
| I18N-02                    | 合同已澄清             | `term_category_localizations` 是任意 locale 的权威集合；facet 的 `name_zh/name_en` 只是当前产品 UI locale 的反规范化索引，不得反向覆盖其它语言。                                                                                                                                                                                           |
| I18N-03、I18N-05           | 部分完成               | 已迁移维护对话框和素材右键菜单，修复英文 catalog 中一处 mojibake；renderer 仍存在绕过 catalog 的硬编码文案，不能宣称 i18n 已完成。                                                                                                                                                                                                         |
| IO-01～IO-07               | 部分完成               | content-pack 的 manifest、fixture、dictionary、term catalog 和 palette 改为一次有界读取形成快照，校验、hash 与 reconcile 复用；嵌套 term 文件增加目录封闭、循环、文件数和总字节预算。其余批量加载、全量 refresh、projection、cache 和 watcher 路径必须先按性能手册测量，再删除无消费者工作或做增量化；不得用无意义异步／并发掩盖重复 I/O。 |
| IMP-01                     | 已完成                 | `src/**` 项目内 TypeScript import 统一为 `@/`，仅 CSS／SQL 等资源保留适合其加载器的相对路径；ESLint 已禁止重新引入相对 TS 模块引用，生产构建已验证 alias。                                                                                                                                                                                 |
| BUNDLE-01                  | 未完成                 | 生产构建报告 3 个压缩后 chunk 超过 500 kB；先记录依赖组成、首屏是否加载和 parse／execute 成本，再决定 lazy boundary 或依赖拆分，不直接用 `manualChunks` 隐藏问题。                                                                                                                                                                         |
| TEST-01～TEST-03           | 部分完成               | 已把本轮暴露的 2 个旧相对 import 断言与 1 个精确 JSX 断言改为共享 TypeScript AST 检查，全量与架构测试恢复全绿；其余源码字符串测试、bulk suppression 和工作区门禁债务仍按 TEST-01～TEST-03 跟踪。                                                                                                                                           |
| Worker 方法参数边界        | 未完成                 | worker envelope 已严格校验，但复杂方法参数仍应从 IPC 中抽取为共享 runtime schema，避免在 worker server 重复断言 DTO。                                                                                                                                                                                                                      |

## 当前验证快照

以下结果只证明相应门禁的当前状态，不能替代运行时性能、并发或外部协议验证：

| 范围                       | 结果                                                                                                                                          |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Desktop typecheck          | 通过                                                                                                                                          |
| Desktop lint               | 通过；现有 bulk suppression 债务仍按 TEST-02 跟踪                                                                                             |
| Desktop integration tests  | 25 个文件、153 个用例通过，包含数据库外键开启后的集成路径                                                                                     |
| Desktop full tests         | 105 个文件、486 个用例全部通过                                                                                                                |
| Desktop architecture tests | 23 个文件、83 个用例全部通过；旧相对 import 与精确 `<Popover modal>` 文本断言已改为 TypeScript AST 结构检查                                   |
| Desktop format             | 本轮修改文件通过定向 Prettier；全仓检查仍有 63 个文件失败，尚未执行全仓格式化                                                                 |
| 测试文件                   | 经用户明确授权，修改 3 个 architecture test，并新增共享 AST 断言 helper；未改动产品行为测试                                                   |
| 生产构建                   | `npm run build` 通过；main protocol、renderer index、CreatorScreen 共 3 个 chunk 超过 500 kB；未运行 `package`、`make`，未重新生成 `release/` |
| 运行时 UI／性能            | 尚未做 UI 自动化或规模化性能测量；`flushSync` 消失仍需开发环境人工确认                                                                        |

后续实现仍需逐批隔离；执行批量格式化、全仓机械重写或回滚前必须重新检查工作树，避免覆盖用户改动。

## 优先级定义

- **P0**：首次公开发布前必须处理；可能造成跨空间写入、静默数据替换、付费任务取消失效或不可信外部数据进入持久化链路。
- **P1**：应在首发候选冻结前处理；可能造成数据语义漂移、安全边界扩大、稳定复现的状态竞态或系统性维护失败。
- **P2**：可分批治理，但必须先设置防新增门禁；包括无意义 I/O、架构漂移、i18n 一致性和测试假绿。
- **P3**：低风险清理；不得与 P0/P1 功能修改混入同一批次。

## P0：外部数据边界与供应商协议

### BND-01 DeepSeek 响应被“类型洗白”

证据：`src/main/assistant-models/deepseek.ts` 中的 `DeepSeekResponse` 将所有字段声明为
`optional + unknown`，随后用 `(await response.json()) as DeepSeekResponse` 直接缩窄网络数据。

这不是有效的类型建模：

- TypeScript interface 不产生运行时校验。
- `status` 为任意值时会进入成功路径。
- `output` 不是数组或包含 `null` 时会产生无语义的运行时异常。
- `Number(value) || 0` 会把字符串、布尔值等非法 token 计数强制转换，并将缺失、非法和真实零混为一谈。
- `model`、item `status`、`annotations` 等字段被猜测性声明但没有消费，增加了“看似完整”的错觉。

同文件的 `parseJsonObject<T>()` 只检查 JSON 顶层是对象，却允许调用者任意指定 `T` 并返回
`Partial<T>`，属于假的泛型 decoder。后续 `String()`、`Number()` 和数组 fallback 不能替代协议校验。

要求：

1. 网络响应必须从 `unknown` 开始，通过运行时 schema 解码，再由 schema 推导 TypeScript 类型。
2. DeepSeek 最终响应使用 `completed | failed | incomplete` 判别联合；每个分支只声明并验证实际消费的字段。
3. `usage` 若存在，token 数必须为有限、非负整数；缺失保持 `undefined`，不得伪造为零。
4. 未识别 status、畸形 output 或畸形 message content 返回稳定的 `PROVIDER_PROTOCOL_ERROR`，不能继续按成功结果处理。
5. provider envelope 与模型生成的业务 JSON 分两次解码，不能共用一个宽松 interface。
6. `directions`、`optimize` 和 `title` 使用各自的业务 schema；normalize 只处理已经验证的数据，不负责把任意数据强转成 DTO。
7. 响应读取增加字节上限；不要无界调用 `response.json()`。

未来验收：非法 status、字符串 output、`null` item、字符串／布尔／负数 usage、畸形业务 JSON 都必须得到结构化协议错误；有效 `failed`、`incomplete` 和 `completed` 分支仍能稳定处理。

### BND-02 同类问题覆盖全部外部图像适配器

同一模式还存在于：

- `generation-models/external-image/adapter-utils.ts`：`responseJson<T>()` 直接断言类型，JSON 解析失败时甚至返回伪造的 `{}`。
- `generation-models/openai-image/openai-image-adapter.ts`。
- Volcengine、Google Gemini、Alibaba Qwen 图像适配器。
- DeepSeek、OpenAI Image 和 external-image 的连接检测响应。

要求建立统一的 provider decoder 层：

```text
HTTP bytes with limit
        ↓
JSON unknown
        ↓
provider-specific runtime schema
        ↓
validated provider DTO
        ↓
domain normalization and persistence
```

禁止：

- `response.json() as SomeResponse`
- `JSON.parse(...) as DomainType`
- 不接收 runtime schema 的 `parse<T>()`／`responseJson<T>()`
- 解析失败后返回空对象继续执行

允许 provider 增加未消费字段，但已经消费的字段必须严格验证。错误响应和成功响应应使用不同 schema，不能用“所有字段都可选”的单一对象兼容所有分支。

### BND-03 供应商输出文件在持久化前验证不足

图像适配器目前可能在完整 base64／response buffer 进入内存后才检查，部分路径只检查路径非空、扩展名或声明 MIME。要求统一：

- 流式或分块限制响应字节；base64 解码前先估算上限。
- 校验 PNG/JPEG/WebP 文件签名、实际 MIME、非零尺寸和可解码性。
- 在临时文件中完成验证，验证成功后再原子提交对象存储和数据库。
- 失败路径不得创建成功 asset、generation output 或残留可被正常引用的文件。

## P0：本地空间、后台任务和数据安全

### LIB-01 已注册数据库缺失时静默创建空库

当前空间可用性检查主要确认目录存在；SQLite 打开路径允许创建缺失数据库，随后安装 baseline。结果是：空间目录仍在、数据库文件被移动或删除时，同一 library ID 可能打开一份新空库。

要求：

- “创建空间”和“打开已注册空间”使用不同入口。
- 已注册空间用 must-exist 语义打开；数据库缺失立即失败且零写入。
- schema、manifest 和必要文件的只读探测成功后，才能修改 registry 或外部 `library.json`。
- 错误界面提供明确的恢复／重新选择路径，不自动创建替代库。

### LIB-02 异步操作可能跨越两个 LibraryContext

`liveServiceProxy` 在每次属性访问时解析当前服务。跨 `await` 的导入、扫描或图片处理可能在空间 A 开始，在切换后使用空间 B 的服务，或在旧数据库关闭后迟到写入。

要求建立固定 lease：

```ts
interface LibraryContextLease {
  readonly libraryId: string;
  readonly epoch: number;
  readonly signal: AbortSignal;
  readonly services: LibraryServices;
  release(): void;
}
```

- IPC 请求入口只获取一次 lease，整个异步链使用固定 services。
- context 进入 draining 后拒绝新 lease。
- 可取消读取／扫描通过 signal 终止；已经进入原子提交阶段的写入等待完成。
- `dispose()` 必须异步等待活动 lease、watcher 和 scan promise 结束，再关闭数据库。
- 所有迟到结果在提交前校验 `libraryId + epoch`。

### ASST-01 DeepSeek 取消和退出没有端到端传播

现有退出取消主要覆盖 Codex；DeepSeek 依赖内部 timeout。客户端 RPC timeout 也可能只丢弃 pending promise，Worker 与供应商请求继续执行、计费并迟到写库。

要求：

- 每个 assistant request 有稳定 operation/run ID 和 `AbortController`。
- client timeout 同时发送 worker cancel，不得只删除 pending。
- worker 保存 request ID 到 controller/promise 的映射，并等待取消确认。
- DeepSeek adapter 合并调用方 signal 与内部 deadline signal，并传给 fetch。
- `cancelled`、`timeout`、`interrupted` 使用不同终态。
- 有副作用的 RPC timeout 返回“状态未知”，支持按 operation ID 查询和幂等重试，不能直接当作确定失败。

### CRED-01 连接测试可覆盖更新后的凭据状态

保存、清除和连接测试并发时，旧测试结果可能复活已经清除的 key，或让 save A 覆盖更晚的 save B。临时网络错误还可能把 last-known-good 凭据永久降为不可用。

要求：provider 配置使用 revision/CAS 或 provider 级串行队列；测试结果只在 revision 仍匹配时提交。401/403 才改变认证有效性；timeout、网络错误和 5xx 只记录临时检查失败，不清除 last-known-good READY。

### STAGE-01 Creator stage ID 缺少原子消费

同一 stage ID 可以被两个并发请求同时读取并执行，最终才 discard。要求在 materialize 前原子切换到 `CONSUMING`，只有一个消费者成功；失败根据是否已提交决定回滚到可重试或进入终态。

## P1：数据库语义和分类完整性

### CLS-01 分类 move／restore／merge 后 facet assignment 可能陈旧

分类操作会改变 category 的 primary facet 值，但部分路径只更新分类或直接关联词条，没有为受影响术语创建完整的新 revision 并重建不可变的 `term_facet_assignments`。Gallery、素材图集、文件投影和词典查询仍从这些 assignment 读取，可能显示旧分类。

要求将分类变更收敛到单一 mutation service：

1. 递归计算受影响子树、术语和新旧 facet。
2. 在提交前完成全层级名称冲突检查。
3. 在一个事务中批量 clone 完整 term revision、重建 membership／facet／placement、更新分类并写 change event／tombstone。
4. 使用临时表、CTE 或 set-based SQL，不能为每个术语执行一组独立查询。

### CLS-02 merge 会丢失 context profile 语义

当前 merge clone 没有完整复制 `definition`、`exclusion_boundary`，且没有 expression 的 profile 可能被遗漏。要求 revision clone 工具完整复制 profile、profile revision、所有表达式和无表达式 profile；分类变更不得改变非分类语义字段。

### CLS-03 merge 冲突计划只检查一层

直接子分类冲突处理后，孙级节点可能被重挂为同名兄弟。要求递归生成完整冲突计划；未解决的任意层级冲突必须在事务前失败，不能生成重复兄弟节点。

### EVT-01 多条写路径绕过标准 change event／tombstone

分类 override、restore、creation 删除等路径存在直接写表或删除记录的实现，未统一进入标准 repository 生命周期。要求明确软引用与正式生命周期边界，并让创建、替换、恢复、删除都产生一致的不可变 revision、change event 和 tombstone。

### DB-01 外键声明与运行时策略不一致

schema 声明了大量 foreign key 和 `ON DELETE`，运行时却长期关闭 enforcement。需要作出明确决策：

- 若这些关系是硬约束，修复现有违反项后启用 foreign keys，并保证每个连接一致。
- 若产品选择软引用，schema、repository、完整性审计和删除语义必须明确反映软引用合同，不能保留误导性的硬约束声明。

### REG-01 registry 主副本同时损坏时不应伪装为首次启动

主 registry 与 backup 都无法解析时，当前路径可能按首次启动继续并覆盖状态。要求隔离损坏文件、保留恢复证据并进入显式 recovery；不得自动覆盖。

## P1：媒体信任边界

### MEDIA-01 媒体协议绕过强 resolver

`aiy-media` protocol 和部分 workbench 路径使用弱路径解析，缺少统一的 realpath、symlink、签名和 MIME 检查，而 asset-file repository 已经存在更强 resolver。

要求 protocol、thumbnail、clipboard、copy/save/open/reveal 和 generation import 全部消费同一安全解析结果，至少验证：DB 状态、lexical containment、realpath containment、regular file、非 symlink、扩展名／MIME／签名一致。

### MEDIA-02 缩略图解码环境权限过高

图片 thumbnail worker 使用带 Node 权限、关闭隔离和 sandbox 的 BrowserWindow 加载文件。不能据此断言现成 RCE，但它显著扩大了解码器漏洞的影响面。

要求迁移到无 Node 权限、`contextIsolation: true`、`sandbox: true` 的隔离环境，优先 utility process 或专用受限 decoder。无效图片 fail closed，不能回退返回未验证原文件。

### MEDIA-03 cache、watcher 和 helper 缺少 dispose/cancel

空间切换和退出时，thumbnail cache、发现扫描或 helper 可能继续排队。要求所有后台资源实现异步 dispose、取消新任务、等待在途任务并释放进程／窗口。

## P1：React 与异步状态

### UI-01 Tiptap 在 React lifecycle 内触发 `flushSync`

已证明的最强调用链是：`CreatorPromptComposer` 的 effect 同步执行 `editor.commands.setContent()`，内容创建 React NodeView，Tiptap 的 `ReactRenderer` 在同一 lifecycle 调用栈内执行 `flushSync`。

要求将外部 editor 内容同步收口到专用 hook：effect 只登记 revision，通过 `queueMicrotask` 执行 `setContent`；执行前重新检查 editor 未销毁、revision 仍最新且文档签名确实不同。保留 `emitUpdate: false`，防止外部同步触发 autosave。不得修改 `node_modules`。

未来验收必须覆盖 StrictMode、连续切换草稿／版本、空内容和带 term／recipe NodeView 的内容；警告消失且最终只显示最后一次输入。

### UI-02 mutation 完成后覆盖用户更晚的选择

OutputInspector 的 annotation/crop/refine/reframe 和 CreatorScreen 的完成后导航可能在用户已经从系列 A 切到 B 后，把 UI 拉回 A 或把 A 的临时数据写入 B 的局部数组。

规则：持久化 mutation 可以完成，但只有发起时的 `{seriesId, assetId, requestEpoch}` 仍与当前界面一致时，才能修改局部 UI、关闭弹窗或导航。

### UI-03 查询失效和 loading 也必须受 request identity 保护

- `useCreatorTermSearch` 在 inactive／空查询提前返回前没有先递增 revision，旧响应可覆盖 reset。
- `useClassificationManager.loadTree` 缺少 request ID，旧 locale 响应和旧 `finally` 可覆盖新树或清除新 loading。

要求统一 latest-request gate：新请求先失效旧请求；`then/catch/finally` 都检查当前 revision。无用户价值的请求不启动，不能用扩大并发掩盖状态设计问题。

## P1/P2：i18n 合同

### I18N-01 读取 fallback 与写入 locale 匹配混用

`word-palette-localization` 的 base-language 匹配会把 `zh-CN`、`zh-TW`、`zh-Hans` 视为同组，保存一个 locale 时可能删除其他地区的本地化。

规则：读取可以按 exact → canonical parent → product fallback；写入、替换和删除只允许精确 canonical locale tag。

### I18N-02 分类支持任意 locale，但 facet 投影只有 zh/en

UI 可输入 ja/ko/fr 等 locale，分类 facet 的持久化和读取却只投影 `name_zh/name_en`。必须选择并文档化一种合同：要么当前产品只允许 zh/en 写入，要么将分类名称改为真正的 locale collection；不能让 UI 承诺任意 locale 后静默写空投影。

### I18N-03 多套 fallback 算法导致同一实体跨页面显示不同语言

分类 manager 使用 base-language fallback，普通词典 SQL 更接近 exact locale。要求建立唯一 locale resolution service，并让 renderer、SQL 投影、extension catalog 和 native UI 使用同一优先级。

### I18N-04 i18n 首次加载失败会退回英文并持久化错误选择

I18nProvider 初始只有英文，语言包和 extension list 使用一个 `Promise.all`；任一 IPC 失败可能把加载标记为完成、切成英文并写入 localStorage。要求分别处理可恢复失败，保留用户选择，不因临时加载失败改写偏好；语言插件安装／更新后要显式刷新 catalog。

### I18N-05 用户可见文案绕过 catalog

当前 renderer 中存在大量 `locale === 'zh'`、组件内 `copy[locale]` 和 locale prop/context 混用。`DictionaryMaintenanceDialog` 是现有架构测试漏掉的明确例子。

规则：

- renderer 用户可见文案只能来自 feature catalog；toast、placeholder、title、aria-label、空状态和错误都在范围内。
- IPC／database／provider 返回 `{code, params, diagnostic}`，renderer 决定本地化文案；不持久化或直接展示原始供应商英文错误。
- native dialog/menu 使用应用 locale，而不是 OS locale。
- locale key 和参数签名由类型约束；catalog drift、mojibake 和英文复数错误不能依赖 fallback 掩盖。
- 专有名词、模型名、协议值、日志和 fixture 进入有理由的白名单。

## P1/P2：无意义批量 I/O 与加载路径

所有性能项在修改前必须按 `docs/performance-playbook.md` 建立数据规模、查询数、读取字节、主线程阻塞和峰值内存基线。下面是静态审计结论，不等于已经完成运行时测量。

### IO-01 `app:bootstrap` 聚合完整历史并触发多层 N+1

Creation、assistant run、style exploration、direction task 等 repository 在默认列表中继续逐项读取子记录；workbench 还读取并解析全部历史 snapshot/descriptor/request。要求拆成首屏必要 snapshot 与按 screen／detail 懒加载，查询数只与固定批次数或 page size 有关。

### IO-02 局部 mutation 后仍执行全量 refresh

Dictionary、media、classification 和 generation terminal 已拿到局部 DTO 或事件，却继续刷新完整 bootstrap。要求使用 typed domain event／delta 更新当前 screen；真正跨域失效才做定向 refresh，不允许把 single-flight 当作删除无意义工作的替代品。

### IO-03 intake 顺序读取仍保留所有 ArrayBuffer

renderer 虽顺序 `await` 文件读取，但把所有 buffer 保留到一个 IPC 调用，峰值仍接近整批大小。要求复用主进程 staging，以 stage ID／chunk 传输；renderer 不持有完整批次字节。

### IO-04 文件投影每次全量 reconcile

当前路径可能读取全部 asset、逐项 resolve/stat/read header，并把全部 active 行先标 RETIRED 再 upsert ACTIVE；单次 generation terminal 也会触发。要求以 change event 增量维护投影，完整 repair 只用于显式维护／恢复。

### IO-05 全局 cache revision 造成一次写入后全表重载

单个 IMAGE_ASSET 变化使全局 revision 失效，下一次 path lookup 重新加载全部 assets。要求按 asset ID 精确失效，或使用增量 revision map；不能在列表访问时逐项 hash。

### IO-06 watcher 和搜索重复扫描全量数据

- Codex discovery watcher 丢失具体 thread ID，refresh 时重新枚举所有 thread/image 并重复 stat。
- classification search 每次键入先构建完整 tree／localization/count，再执行 term query。

要求保留 watcher 事件 identity、增量索引；分类树按 revision/locale 缓存，搜索使用 existence/selected recursive CTE，不在每次键入重建全树。

### IO-07 import 和 content pack 重复读取／解析／查询

dictionary import 在循环中重复 prepare/select；content pack 同一 fixture、dictionary 和 term file 在校验、seed、repair 中被多次读取和解析，term 校验存在逐项多次 SELECT。

要求一次读取和解析后携带 canonical representation；先用廉价 manifest digest/version 判断是否需要深入；数据库验证改为 set-based。异步化这些重复工作不是修复。

### 批量任务统一预算

- 普通文件 I/O 默认并发上限 4。
- Chromium／图片 decoder 默认并发上限 2。
- 同时限制任务数和 inflight bytes。
- 大任务提供进度、取消、背压和分批清理。
- 列表 item mapping／render 中禁止同步 SQL、stat、realpath、readFile 和 hash。

具体数值需通过测量调整，不能把建议值写成永不变化的产品常量。

## P2：配置、导入路径和进程边界

### CFG-01 DeepSeek model、endpoint 和 credentials 耦合

DeepSeek model literal、Responses URL 和 fallback 分散在 adapter、routing、worker 与 UI。连接记录还可能因默认 model 改变而失效。

要求建立唯一 provider definition 和 resolver：

```text
product defaults
      + persisted settings
      + development/test override
                    ↓
validated immutable runtime config snapshot
                    ↓
worker / adapter / assistant run
```

- 官方 base URL 可以作为产品默认值，但必须集中、可覆盖并由 route 组合 endpoint。
- model 是 capability/runtime selection，不属于凭据身份；修改 model 不得使 API key 失效。
- worker 不再定义独立 fallback。
- 每个 run 保存实际 provider、model 和 config revision；在途请求不受之后的设置变化影响。

### IMP-01 项目内源码统一使用 `@/`

行业常见折中是同目录保留 `./`、跨目录使用 alias、禁止 `../`。本项目选择更强的一致性规则：

- `src/**` 中所有项目内部 TypeScript 模块使用 `@/` 直达源文件，包括同目录模块。
- 第三方包、`node:*`、CSS／资源导入可保留各自标准形式。
- `tests/**` 引用生产源码使用 `@/`；测试自身 helper 可使用 `./`，或后续建立 `@test/*`。
- 配置文件和独立脚本只有在其运行器明确加载 alias 时才使用 `@/`。
- 不用 barrel 为统一路径制造循环依赖；继续直达具体文件。

边界门禁：

- renderer 禁止 main、preload、Node 和 Electron。
- main 禁止 renderer、preload。
- shared 禁止依赖任何运行层或平台 API。
- preload 原则上只依赖 Electron 与 shared contracts。
- main、preload、renderer、shared 使用各自的 tsconfig/global 环境，不能全局同时获得 DOM 与 Node 能力。

迁移应作为独立机械批次执行，不能与数据库或行为修改混在一起。先统一 TypeScript、Vite、Vitest 和 Worker 的 alias resolver，再迁移 import，最后启用 `no-restricted-imports`。

### BUNDLE-01 生产 chunk 已超过默认体积警戒线

当前生产构建通过，但 Vite 报告 main `protocol`、renderer `index` 和 `CreatorScreen` 三个压缩后 chunk 超过 500 kB。体积警告本身不等于用户可感知回归，也不能靠调整警告阈值或随意配置 `manualChunks` 关闭。

处理前先记录每个 chunk 的依赖组成、是否进入首屏、冷／热启动下载或磁盘读取、parse／execute 时间和跨 chunk 重复模块。确认瓶颈后优先建立真实功能 lazy boundary、移除未消费依赖或缩小共享 schema 的运行时入口；避免为了数字好看制造额外串行请求和 waterfall。

## P2：测试和质量门禁

### TEST-01 架构测试大量依赖源码字符串

23 个 architecture test 文件中，绝大多数读取源码文本。已确认的问题包括：

- i18n 测试只扫描列举文件和少数语法，漏掉 `DictionaryMaintenanceDialog` 的 `copy[locale]`。
- content isolation 只禁止若干方法名，helper 可以绕过。
- media visual contract 固定 Tailwind class 和精确函数调用，与 `tests/README.md` 自己的原则冲突。

本轮已先处理实际阻塞新 import 规则的 3 个失败用例：模块依赖改为解析 import declaration，`Popover` 的 `modal` 合同改为解析 JSX 布尔属性。格式、换行和其它 props 的增减不再造成误报；其余源码扫描仍需按风险逐步迁移。

要求按不变量选验证方式：import graph 用 ESLint/AST；IPC 输入用实际 handler；类型合同用 TypeScript；状态交互用组件行为；视觉合同只保留少量真正的浏览器截图。变量重命名和 helper 抽取不应让测试失败，无效实现必须能让测试失败。

### TEST-02 bulk suppression 让 lint 绿灯失去定位能力

当前 baseline 隐藏 146 个违规，其中 hooks dependencies、complexity、长函数和长文件占绝大多数。按“文件 + 规则 + 数量”记录意味着修掉一个旧问题并引入一个新问题时，只要数量不变就可能继续通过。

要求：

1. 立即禁止 suppression 数量增长。
2. 优先清理 `react-hooks/exhaustive-deps`，逐处判断 stale closure、状态机边沿或重复请求。
3. 合理例外改为局部禁用并写明原因。
4. 再拆分 CreatorScreen、ResultLibrary、IPC registrar 和 contracts。
5. 最终删除 bulk suppression 文件。

### TEST-03 当前质量门禁并非全绿

- Desktop `format:check` 失败。
- `gpt-sites-demo` lint/TypeScript 失败。
- coverage 未达到仓库既定阈值。

这些项目必须在发布就绪文档中保持可见，不能只引用 typecheck、lint 和普通测试通过得出“完成”结论。

## 分批实施顺序

### 批次 0：文档和防新增门禁

- 固化本文、预发布 migration policy、provider boundary policy、i18n 和 import 规则。
- 建立性能测量基线和 suppression 不增长门禁。
- 不做全仓格式化，不修改业务行为。

### 批次 1：数据与计费安全

- 已注册 DB must-exist。
- LibraryContext lease、drain 和 async dispose。
- DeepSeek／worker 端到端取消与 operation ID。
- credential revision/CAS。
- stage 原子消费。

### 批次 2：外部协议和 provider 配置

- 替换 DeepSeek envelope／业务 JSON 的伪类型。
- 统一所有图像 provider decoder 和响应字节上限。
- 统一 DeepSeek provider definition/resolver/run snapshot。
- 供应商错误改为结构化诊断。

### 批次 3：数据库与媒体完整性

- 分类 mutation plan、完整 revision clone、recursive conflict 和 event/tombstone。
- 明确 foreign-key／soft-reference 合同。
- 统一 media resolver、输出文件验证和受限 decoder。

### 批次 4：React、异步状态和 i18n

- Tiptap microtask 外部同步。
- latest-request gate 和 mutation UI context guard。
- exact-write locale、唯一 fallback resolver、catalog reload 和结构化错误本地化。

### 批次 5：删除无意义工作并增量化

- 收窄 bootstrap 和全量 refresh。
- staging/chunk intake。
- 增量文件投影、精确 cache invalidation、增量 watcher/search。
- content pack 单次解析和 set-based 校验。

每一项必须用消费者、触发时机、查询／文件调用数、读取字节、峰值内存和取消语义证明保留价值。优先删除工作，再讨论并发。

### 批次 6：机械一致性与结构收尾

- 独立迁移 `@/` import。
- 拆分 tsconfig 和进程 globals。
- 替换脆弱架构测试、清理 suppression、拆分超大模块。
- 修复 format、demo typecheck/lint 和 catalog drift。

## 首发候选完成条件

1. 本文 P0 全部关闭，且每项有可复现的验收证据。
2. P1 数据完整性、媒体安全、React 已知警告和 i18n 写入破坏问题关闭。
3. 启动、列表、搜索、导入和文件投影有按性能手册记录的规模化测量；不存在无消费者的批量工作。
4. 外部数据边界全部遵循 `unknown → runtime schema → inferred type`，不存在直接断言 provider/domain DTO 的通用 parser。
5. 当前注册空间缺失数据库时 fail closed；空间切换、取消、退出和乱序响应不会跨 context 写入或复活旧状态。
6. 发布文档明确区分“`0.3.0` 已确定为首发 baseline”和“该 baseline 已随正式版本冻结”；真正发布时才记录冻结事实和之后的 forward-only migration 起点。

## 参考

- [TypeScript `paths`](https://www.typescriptlang.org/tsconfig/paths.html)：alias 需要由运行时／bundler 同步解析，TypeScript 本身不会改写 emitted import。
- [ESLint `no-restricted-imports`](https://eslint.org/docs/latest/rules/no-restricted-imports)：可用于统一 import 风格和限制不适用于当前运行环境的模块。
- [typescript-eslint `no-unsafe-type-assertion`](https://typescript-eslint.io/rules/no-unsafe-type-assertion/)：禁止把宽类型通过 assertion 缩窄成未经证明的具体类型。
- [Tiptap React performance guide](https://tiptap.dev/docs/guides/performance)：说明 React lifecycle 中的 `flushSync` 警告及 `queueMicrotask` 处理方式。
- [DeepSeek API integration configuration](https://api-docs.deepseek.com/quick_start/agent_integrations/deepcode)：官方集成同样把 `MODEL` 与 `BASE_URL` 作为独立配置，并为 base URL 提供默认值。
