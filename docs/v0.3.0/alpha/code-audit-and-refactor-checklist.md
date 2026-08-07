# v0.3.0 Alpha 代码审计与重构清单

> **历史记录：** 本文记录 2026-08-04 结束的上一轮重构，不能代表当前发布就绪状态。2026-08-06 复审发现了新的数据边界、空间生命周期、分类完整性、i18n、I/O 和测试门禁问题；当前结论与整改顺序见
> [`code-smell-audit-and-remediation-2026-08-06.md`](code-smell-audit-and-remediation-2026-08-06.md)。

状态：上一轮核心工程重构已完成；当前状态由 2026-08-06 复审文档接管

范围：仅 `apps/desktop` 生产代码、资源、数据库迁移与现有验证门禁

排除：UI 视觉测评、网页原型、发布、安装包与分发产物

## 审计原则

- 以可复现证据、数据流和信任边界为依据，不以文件大小或个人风格单独判定缺陷。
- 优先消除主进程阻塞、重复工作、无界内存放大和数据库扫描，再处理结构性坏味道。
- 保持 SQLite 行、连接和文件路径在主进程；renderer 只使用类型化 IPC。
- 保持稳定 ID、不可变 revision、事务、change event 与 tombstone 语义。
- `0.3.0` 是第一次正式发布的 baseline；正式发布前允许继续完善 `v03-baseline.sql`，不要求兼容旧开发库。`0.3.0` 发布后冻结 baseline，此后只新增前向编号迁移，且不修改任何已经随正式版本发布的迁移。
- UI 结构重构保持现有可见行为；视觉质量与交互测评另行执行。
- 不修改现有测试文件；先记录当前基线，再用现有测试验证生产代码变更。

## P1：性能与可靠性

- [x] 将词典行映射从逐词条查询改为批量读取，消除 bootstrap 和分页搜索的 N+1。
- [x] 为 aliases、expressions、evidence、term/palette prompt bindings 的读取方向补充 0074–0075 前向索引迁移。
- [x] 明确 `term_search_fts` 的运行时职责：当前 unicode61 FTS 无法保持中文与 Prompt 片段的任意子串语义，因此停止无消费者的运行时重建。
- [ ] 收窄 `app:bootstrap`；当前所有 screen 同时挂载并消费完整聚合数据，需先建立按 screen 加载契约，见“保留项”。
- [x] renderer 全量刷新实行 single-flight/coalescing，避免终态事件并发重复查询。
- [x] 隐藏 Creator 停止词典搜索、scope resolve、推荐读取与全局快捷键副作用。
- [x] 原生图片选择改为主进程暂存；renderer 不接收再回传完整文件字节。
- [x] 输出图片校验与哈希在暂存阶段执行一次，对象存储使用异步已验证文件复制；单图 25 MiB、批次 100 MiB、8 张上限。

## P1：验证门禁

- [x] 记录并消除当前资源与测试契约漂移：词条总数、词典示例图、Web resource revision。
- [x] 区分产品资源回归与源码字符串架构测试误报；只恢复仍属于发布资源的有效参考图。
- [x] `npm run typecheck` 通过。
- [x] `npm run test:all` 与 Electron E2E 结果已复跑并记录。
- [x] 发布就绪文档已同步当前全绿结果和仍待人工确认的边界。

## P2：启动与存储

- [x] 普通干净启动不执行完整 SQLite integrity/foreign-key 扫描。
- [x] 迁移、异常退出、新库和显式诊断仍执行完整完整性校验。
- [x] builtin fixture 在源未变化时通过文件指纹、安装状态与链接计数快路径跳过词条解析、逐项哈希和 reconcile。
- [x] 词盘 catalog revision 命中时零写入，不重复更新相同 pinned 值。
- [x] 文件视图完整 repair 从资料库激活关键路径移到首屏后的隔离后台阶段。

## P2：安全边界

- [x] 所有 `ipcMain.handle` 通过统一入口验证 sender frame 与当前主窗口。
- [x] 统一入口保留每个通道的 schema 校验和领域错误语义。
- [x] 拒绝非预期页面导航、新窗口和 renderer 权限请求。
- [x] 保持 `contextIsolation: true`、`sandbox: true`、`nodeIntegration: false` 与生产 CSP。

## P2：结构性重构

- [ ] `CreatorScreen` 已抽出词典搜索与输出导入 hook；草稿、生成和助手编排仍是后续结构债务。
- [ ] `ipc.ts` 已拆出 storage、dictionary、creator import 与统一信任入口；generation、assistant、asset 仍保留在组合入口。
- [ ] `index.ts` 已拆出窗口安全策略与截图开发工具；空间切换生命周期仍保留在入口。
- [x] Creator import 合同已拆到 `src/shared/contracts/creator-import.ts`，并由兼容聚合出口重新导出。
- [x] `database.ts` 保持薄 facade；新增图片能力只委托 storage 与 creation import repository，不包含 SQL。
- [ ] Gallery 的窗口排序、精确总数与 bootstrap 载荷留待 UI 性能测评时做运行时 profiling。

## P3：依赖与维护

- [x] 生产依赖审计保持 0。
- [x] `brace-expansion` 5.0.9、`fast-uri` 3.1.5 与 `postcss` 8.5.25 已通过 lockfile 补丁升级，完整 `npm audit` 为 0。
- [x] 开发截图/捕获工具已隔离到 `src/main/development/capture.ts`，仅在显式环境变量存在时运行。
- [x] 清理重复窗口监听、重复刷新入口和失效发布记录。

## 当前基线

- `npm run typecheck`：通过。
- `npm run test:all`（审计开始）：95 个文件中 90 通过、5 失败；417 个用例中 408 通过、9 失败。
- `npm run test:all`（2026-08-04 最新复跑）：100 个文件、455 个用例全部通过。
- `npm run test:e2e`：5 个 Electron 用例全部通过，包括隔离首启、导航、renderer 错误、启动网络和性能记录。
- `npm audit --omit=dev`：0 个漏洞。
- `npm audit`（审计开始）：2 high、1 moderate；重构后为 0。
- Git 工作树在重构开始前干净。
- `npm run build`：通过；未运行 `package` 或 `make`。

## 执行结果与证据

- 词条投影：原路径为主查询与媒体批量查询后，每个词条再执行 facets、aliases、expressions、evidence、prompt count、pending annotations 六次查询，即 `6N + 2`；当前为主查询、媒体与六类批量投影，共 8 次，不随本页词条数增长。
- 词盘投影：原路径按 palette、revision、parameter、option 多层递归查询；当前 palette、revision、terms、parameters、media、prompt nodes、options、contents 共 8 次批量读取。
- 迁移恢复：0074 保持已落库的四索引历史，0075 单独补齐 palette prompt binding 索引；已在出现 0074 标记但缺少该索引的资料库副本上验证自动修复与完整性，并完成真实资料库启动验证。
- 启动：`database_shutdown_state` 在打开时标记 dirty、正常关闭时标记 clean；仅新库、接管库、迁移库或上次非干净关闭执行完整完整性扫描。
- fixture：快路径指纹包含 profile、相对路径、size、mtime 与 ctime，并校验已选 release、预期 item 数和 active object link 数；源或安装状态变化时自动回退到完整解析与 reconcile。
- 图片导入：原生文件从选择、签名校验、SHA-256、暂存到对象存储均留在主进程；暂存 15 分钟失效，进程重启后的遗留暂存文件会在下次使用时清理。
- IPC：处理器统一拒绝非当前窗口、非主 frame 调用；窗口导航、新窗口和 Electron permission request 默认拒绝。

## 已解决的验证漂移

- 资源数量与 Web revision 断言已同步当前发布资源，不再把资源演进误报为运行时失败。
- 已从 fixture 登记中移除不存在的失败眼部图片；两张有效眼部参考图重新进入词典、Gallery 与 Rating 链路。
- 媒体 hover 与 `OutputVersionStrip` 的脆弱源码字符串断言已由可执行 DOM 契约覆盖。
- Electron 启动器从应用目录解析资源，并在退出时显式关闭隔离 worker；不再因错误路径、原生弹窗或 Windows 临时目录锁产生假失败。

## 保留项

| 项目                                           | 风险                                      | 负责人/触发条件                              | 下一步                                                                |
| ---------------------------------------------- | ----------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------- |
| 按 screen 收窄 `app:bootstrap`                 | 中；当前刷新仍传完整聚合 DTO              | Desktop runtime；UI 测评确定首屏与切屏边界后 | 增加 screen snapshot IPC、按需挂载 screen，并测量序列化字节与首屏耗时 |
| Gallery 查询 profiling                         | 中；CTE、窗口排序与精确总数随素材规模增长 | Database/UI performance；UI 测评阶段         | 在 1k/10k/100k 素材集记录 `EXPLAIN QUERY PLAN`、P50/P95 与游标稳定性  |
| Creator / IPC / local-space 生命周期继续领域化 | 低到中；主要是维护成本                    | 对应功能改动触发，不做无行为收益的大搬移     | 沿现有 hook/handler 边界增量抽取，并同步契约测试                      |
| UI 视觉与交互测评                              | 按用户要求后续执行                        | UI 测评任务                                  | dev-mode 人工验收，不使用 OS 级输入注入                               |

## Alpha 完成定义

- P1 生产代码项完成，且没有引入新的类型错误或现有测试失败。
- P2 中启动、IPC 安全与模块边界完成；UI 可见结构保持不变。
- 性能关键路径具有可重复的查询数、耗时或内存证据。
- 未解决项保留负责人、证据、风险与下一步，不以笼统“后续优化”关闭。
- UI 测评继续保持独立待办，不阻塞本轮代码结构收敛。
