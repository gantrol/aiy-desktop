# 桌面端测试体系：方案与进展

更新时间：2026-08-04

## 一、结论摘要

- 测试分层已从 3 条扩展到 6 条：新增**组件层（jsdom）**、**端到端层（Playwright + Electron）**、**基准层（vitest bench）**。
- 建立**零成本保证**：所有 lane 强制加载出站断路器，任何非环回请求直接失败；付费验收脚本被结构性隔离在所有 runner 之外。
- 建立**组合测试设计能力**：仓库内自带两两组合（pairwise）生成器，41,472 种组合 → 3,000 种合法组合 → **45 条用例**，确定性输出。
- 存量失败从 **9 条降到 0 条**。最后 3 条由 fixture loader 中一个不存在的负例图片阻断全部眼部示例导入导致，修复后回归断言继续保留并已通过。
- 端到端层脚手架完成并通过类型检查，但**冒烟用例尚未跑通**——原因是应用自身在当前构建下无法稳定启动，与 Playwright 无关。

各 lane 当前状态：

| Lane           | 命令                        | 结果                   |
| -------------- | --------------------------- | ---------------------- |
| 单元           | `npm run test:unit`         | 220 通过               |
| 组件（新增）   | `npm run test:component`    | 22 通过                |
| 架构           | `npm run test:architecture` | 79 通过                |
| 集成           | `npm run test:integration`  | 156 通过               |
| 基准（新增）   | `npm run bench`             | 可运行                 |
| 端到端（新增） | `npm run test:e2e`          | 脚手架完成，**未跑通** |

`npx tsc --noEmit` 通过。

---

## 二、改造前的诊断

### 2.1 覆盖率：总量不低，但缺口集中在进程边界

| 区域                      | 文件数 | 行数 |              行覆盖率 |
| ------------------------- | -----: | ---: | --------------------: |
| `src/renderer/components` |    183 | 8154 |             **14.9%** |
| `src/main/database`       |     44 | 4950 |                 67.1% |
| `src/main/extensions`     |     17 | 1067 | **1.9%**（分支 0.1%） |
| `src/main/model-worker`   |      3 |  727 |                **0%** |
| `src/main/index.ts`       |      1 |  677 |                **0%** |
| `src/main/ipc.ts`         |      1 |  451 |                **0%** |
| `src/preload/index.ts`    |      1 |  146 |                **0%** |

改造前统计快照：行 30.9%、函数 26.1%、分支 23.6%。**68 个超过 30 行的文件覆盖率为 0，合计 9,062 行。**当前统一口径见第八节进展记录。

关键判断：未覆盖的部分不是随机分布，而**恰好是集成面**。106 个 IPC 通道、主进程生命周期、模型 worker 进程监管全部为 0。纯逻辑核心反而覆盖良好（`libraries` 84%、`prompt-composition` 84%、`png-validation` 90%）。因此**端到端测试不是锦上添花，而是唯一能触达最大风险集中区的手段**。

### 2.2 三类设计缺陷

**（1）无法观测行为的"组件测试"**

21 个测试文件在 `environment: 'node'` 下使用 `renderToStaticMarkup`。在 SSR 字符串渲染中：`useEffect` / `useLayoutEffect` 不执行、事件处理器不触发、`ref` 为 null、只能观测首次渲染。同时 `include` 只匹配 `.ts` 不匹配 `.tsx`，从机制上劝退了真正的组件测试。

结果是：提取出的策略函数（如 `shouldExpandAlbumFromPullDown`）测得很好，但**组件是否真的调用它、是否传入真实指针坐标，完全没有验证**——交互缺陷恰恰藏在这条缝里。

**（2）断言源码文本而非架构的"架构测试"**

28 个文件用 `readFileSync` + 正则匹配源码。部分是合理的（token 分层、`tokens.css` 对比度计算），但大量是在匹配实现细节：

```ts
expect(materialCard).toContain('group-hover/card-button:scale-[1.015]');
expect(source).toContain('notify={notify} expanded/>');
```

这类断言**误报率高**（重构即失败）、**漏报率也高**（源码里有这个类名并不等于渲染结果正确），工具选择本身就是错的。

**（3）把内容快照当成行为断言的集成测试**

```
expected { total: 1720 }        expected length 1715
expected 6 to be greater than 6  expected 'web-resources-2026-07-27-2'
```

`expected 6 to be greater than 6` 最能说明问题：断言编码的是某次种子数据的快照，而不是不变量。每次内容变更都会变红，长期结果是团队习惯性忽略红灯。

### 2.3 框架层面问题

| 问题                                 | 处理                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------ |
| 全部 lane 使用 `environment: 'node'` | 新增 jsdom lane                                                          |
| `include` 不匹配 `.tsx`              | 组件 lane 匹配 `*.dom.test.tsx`                                          |
| 无 Testing Library / user-event      | 已引入                                                                   |
| 无覆盖率阈值                         | 已加棘轮下限                                                             |
| 无 CI                                | **待办**                                                                 |
| 无 `unstubGlobals` / `unstubEnvs`    | 已开启                                                                   |
| 截图自动化逻辑写在产品代码里         | 已迁至 `src/main/development/capture.ts`（仍在生产目录，待迁入测试驱动） |
| `*.png` 被全局忽略                   | 已加 `!tests/fixtures/**/*.png` 例外                                     |
| **无出站网络防护**                   | 已建断路器                                                               |

---

## 三、目标测试架构

```
L0  纯函数        node       仅 fixtures           0 元   <1s
L1  组件         jsdom      注入 Fake             0 元   ~5s
L2  协议挡板      node       本地 HTTP/SSE 服务     0 元   ~10s
L3  应用集成      node       临时 SQLite + Worker   0 元   ~30s
L4  端到端        Electron   挡板 + 临时空间        0 元   ~3min
L5  性能         Electron   预置大库               0 元   ~5min
--  人工验收      真实 API   显式批准               付费   默认禁用
```

原则：**用能回答问题的最浅一层**。`GenerationAdapter` 已经是供应商无关边界，因此 L1 不需要新建 `OpenAiImageClient` 接口——`FakeGenerationAdapter` 直接实现现有契约即可。只有在引入官方 SDK 时才值得加那层隔离。

---

## 四、成本管控（挡板方案）

### 4.1 出站断路器

`tests/support/network-guard.ts` 通过 `vitest.shared.ts` 强制注入所有 lane，**没有任何 lane 可以豁免**：

- 拦截 `fetch`、`node:http`/`https`、`net.connect`/`tls.connect`
- 非环回目标直接失败；`fetch` 以 **reject** 而非同步抛出返回，符合真实语义
- 删除环境中的供应商密钥，使开发机行为与 CI 一致（Unix socket / 命名管道放行，避免影响 runner 自身）

`tests/paid-script-isolation.architecture.test.ts` 再验证这套安排本身：没有任何 runner glob 能命中 `scripts/`；付费脚本需要两道独立确认；所有 lane 都基于共享工厂构建。

### 4.2 三层挡板

| 层  | 工具                        | 验证内容                               |
| --- | --------------------------- | -------------------------------------- |
| L1  | `FakeGenerationAdapter`     | 协调器、持久化、重试、取消             |
| L2  | `startOpenAiStub()`         | multipart 顺序、响应头、SSE 分帧、超时 |
| L3  | 挡板 + 临时 SQLite + Worker | 完整 IPC 与恢复链路                    |

L2 挡板支持的故障注入：`json` / `fixture` / `sse` / `abort-mid-sse` / `abort-after-headers` / `never-respond` / `raw`。数组形式按调用次序消费、末项重复，因此 `[429, 200]` 可以直接表达"先失败一次再成功"，无需手工计数重试。挡板会记录 multipart 各部分名称与顺序——**这正是 `vi.mock()` 无法回答的问题**。

### 4.3 生产代码的最小接缝

`OpenAiImageAdapter` 新增第 4 个构造参数 `baseUrl`，默认值 `OPENAI_IMAGE_API_BASE_URL`：

- **仅限主进程注入**，不经过 IPC、不进入渲染进程配置
- 架构测试断言 `shared/contracts.ts` 中不出现 `baseUrl`——可配置端点会让不可信状态重定向带凭据的请求

### 4.4 Fixtures

`tests/fixtures/` 全部按官方字段结构**手工构造，绝不录制**（录制要花钱，且会随供应商变更悄悄失效）：

- 12 个 JSON：成功、编辑、用量、401、403、429、moderation_blocked、用户错误、5xx、空 data、损坏 base64、只有 url
- 4 个 SSE：正常完成、部分图、中途断流、流内错误
- 6 个 PNG：由 `npm run fixtures:images` 用零依赖 PNG 编码器确定性生成（有效图、1024 大图、匹配遮罩、尺寸不匹配遮罩、截断损坏图、MIME 伪装图）

### 4.5 付费验收脚本

`scripts/manual-openai-image-acceptance.mjs`，位于所有 runner glob 之外，需同时满足 `OPENAI_LIVE_TEST=1` 与 `--confirm-paid`，硬编码：1 次请求、`quality=low`、`partial_images=0`、无参考图、无编辑、无重试，执行前打印计划。

> 注意：凭据检查或模型列表检查**只能证明"凭据可用"，不能证明"具备图片生成权限"**。UI 文案应据此区分。

---

## 五、组合测试设计

### 5.1 两两组合（pairwise）：用于功能测试

响应是二元的（通过/失败），目标是**单位用例的缺陷检出率最大化**。经验上多数现网缺陷由 1~2 个参数交互触发。

`tests/models/generation.pict` 定义 9 个因子：

| 因子      | 取值                                                                                |
| --------- | ----------------------------------------------------------------------------------- |
| Provider  | openai / gemini / codex / internal                                                  |
| Operation | GENERATE / EDIT                                                                     |
| Inputs    | none / ref1 / ref8 / source_mask                                                    |
| Quality   | low / medium / high                                                                 |
| Size      | auto / valid / invalid                                                              |
| Outcome   | OK / AUTH / RATE_LIMITED / SAFETY / NETWORK / NO_OUTPUT / CORRUPT_B64 / UNAVAILABLE |
| Delivery  | nonstream / stream_ok / stream_cut                                                  |
| Lifecycle | complete / cancel / restart                                                         |
| Persist   | commit_ok / db_fail                                                                 |

**41,472 → 约束过滤后 3,000 → 两两覆盖 45 条**（约 921 倍压缩，2 路交互全覆盖）。

`tests/support/combinatorial.ts` 是仓库内自带实现，不依赖外部 PICT 二进制——只有部分机器能复现的测试设计步骤不算测试设计步骤。因子空间足够小，因此约束可满足性是**精确判定而非采样**：不会产出违反约束的用例，也不会要求模型禁止的组合。

三个要点：

1. **强制种子**：`tests/models/generation.seed` 把 7 条高风险组合无条件写入（如 `openai + EDIT + source_mask + OK + db_fail`、`openai + OK + restart`）。**绝不能让生成器决定最危险的用例要不要包含。**
2. **错误子模型升到 3 路**：Provider × Outcome × Lifecycle 才是真交互缺陷所在（取消过程中收到 429 会不会泄漏临时目录？）。
3. **权重**：`OK (4)` 让正常路径按生产分布出现，仅用于打破平局，不影响覆盖保证。

生成器自身有测试（`tests/combinatorial-model.test.ts`）：验证约束满足、覆盖完整、规模受控、种子存在、结果确定。**声称拥有实际没有的覆盖率，比没有覆盖率更糟。**

### 5.2 正交实验（OA）：用于性能测试

响应是连续的（毫秒、MB），目标是**估计各因子主效应**，即"哪个旋钮最重要"，而不是"是否坏了"。

以图库滚动为例，4 因子 3 水平：

| 因子       | L1         | L2       | L3     |
| ---------- | ---------- | -------- | ------ |
| A 数据规模 | 2,000      | 10,000   | 50,000 |
| B 列数     | 3          | 5        | 8      |
| C overscan | 1          | 3        | 6      |
| D 图像来源 | 缩略图缓存 | 原图解码 | 占位图 |

全因子 3⁴ = 81 组 × 5 次重复 ≈ 4.5 小时；**L9(3⁴) 正交表只需 9 组**（约 50 分钟），仍可无偏估计全部主效应。响应量取"固定滚动 3000px 期间 p95 长帧时长"的 5 次中位数，按极差排序因子。

预期结论：**D（图像来源）主导，A（数据规模）近乎平坦**——因为 `virtual-grid.tsx` 的窗口化已被单测充分验证。**如果 A 的极差很大，说明虚拟化在漏**，这个发现本身就值回实验成本。

两点必须说明：

- OA 假设交互效应可忽略，但 B×C 明显相乘（列数 × overscan 共同决定挂载瓦片数）。因此 L9 只作**筛选设计**，再对排名前二的因子跑 3×3 全因子（再 9 组）测交互。**筛选后细化**才是 OA 的正确用法。
- 需要加入二值因子（GPU 加速开关、masonry vs 均匀网格）时改用 L18(2¹×3⁷)。

### 5.3 不适用的场景

纯逻辑核心（`prompt-composition`、`png-validation`、`dictionary-core`，覆盖率已 84~90%）不该用这两种方法，应使用**边界值分析**与**基于性质的测试**（`fast-check`）。组合设计针对的是**配置空间**，性质测试针对的是**取值空间**——对字符串参数做 pairwise 属于范畴错误。

---

## 六、UI 端到端测试

### 6.1 技术选型与合规

Playwright 通过 DevTools 协议驱动 Electron：输入**分发到渲染进程**，不做 OS 级注入，不移动真实指针、不抢占键盘焦点、不影响当前活动应用——符合 `AGENTS.md` 的自动化约束。（建议与规则作者确认该条是否也意在涵盖 CDP 级分发。）

### 6.2 已建脚手架

`e2e/support/app-fixture.ts` 为每个用例提供：

- `stub` —— 环回供应商挡板，任何 journey 不得触达真实供应商
- `userDataDir` —— 借助既有 `AIY_USER_DATA_DIR` 接缝创建每用例临时空间，不碰开发者真实资料库
- `app` / `page` —— 已在主进程替换原生对话框（`electronApp.evaluate` 直接改写 `dialog.*`，**无需在产品代码里加任何测试分支**）
- `stubOpenDialog` / `stubSaveDialog` —— 排队文件选择结果

选择器契约收敛到 `e2e/support/selectors.ts`，基于产品已有的 `data-view` / `data-action` 属性。

### 6.3 当前受阻

`electron.launch()` 0.2 秒返回，随后应用**阻塞主进程事件循环或直接退出**，不创建窗口。已验证的证据：

- **直接启动**（`npx electron out/main/index.js`，不经 Playwright）同样不稳定：有时存活到超时，有时立即退出且 user-data 目录为空。**因此不是 Playwright 导致的。**
- `app.evaluate()` 在启动后立即挂起，说明主进程没有在处理事件循环。
- 每次运行都**遗留 `electron.exe` 僵尸进程**（几次探测后发现 5 个）。模型 worker 以 `detached: true` + `unref()` 派生，会比应用活得更久，随后干扰后续启动。
- `src/main/index.ts` 的启动失败路径先调用 `dialog.showErrorBox` 再 `app.quit()`。该对话框是模态的，**任何启动错误都会表现为无提示的挂起而非干净失败**。

已在 fixture 中将其转为可操作的报错信息（列出三种成因），而不是沉默超时。建议先在**已知良好的提交**上排查。

清理僵尸进程：

```bash
taskkill /F /IM electron.exe
```

### 6.4 规划中的 12 条 journey

按"覆盖其他手段无法触达的代码量"排序，完整清单见 `e2e/README.md`。其中第 10 条（**运行中强杀应用 → 重启 → INTERRUPTED 恢复**）是**唯一无法用其他层测试、且真实用户会因此丢失工作**的场景。

---

## 七、性能测试

### 7.1 四层

1. **存储微基准**（`vitest bench`）—— 数据库层是唯一随用户资料库增长而变化的部分，此前完全没有刻画。已建 `bench/dictionary-query.bench.ts`，重点在**首页 vs 深翻页的对比形态**（OFFSET 扫描线性劣化；一旦分化明显，就该换成 keyset 游标）。
2. **启动与生命周期**（Playwright）—— 复用既有 `AIY_RESTART_READY_FILE` 接缝。
3. **渲染交互**（CDP）—— 滚动期间 p95 长帧、点击到绘制延迟（INP 类比）、JS 堆；主进程侧用 `app.getAppMetrics()` 取各进程 RSS（Electron 内存回归通常出现在 GPU/渲染进程拆分上，而非主进程）。
4. **内存与进程**。

参考预算（仅作看板，不作红绿门禁）：

| 指标                       | 建议 p95  |
| -------------------------- | --------- |
| 进程启动 → `ready-to-show` | < 1500 ms |
| → `app:bootstrap` 完成     | < 800 ms  |
| → 首屏图库绘制（1 万素材） | < 2000 ms |
| 本地空间切换               | < 1200 ms |
| 模型 worker 冷启动         | < 3000 ms |

### 7.2 门禁策略：不要断言绝对数值

CI 机器波动可达 ±40%。应采用：

- **相对门禁**：同一 job 内跑基线构建与候选构建，候选超过基线 1.25 倍才失败
- **趋势**：中位数写入 JSON 制品，对 7 次滑动平均告警
- **n ≥ 5 次，报告中位数与 p95，丢弃首次**（JIT 预热）

`e2e/startup-performance.e2e.ts` 目前采用**附件记录**而非断言，只保留极宽松的冒烟上限。

---

## 八、已完成清单

```
tests/support/network-guard.ts             出站断路器（全 lane 强制）
tests/support/openai-stub-server.ts        L2 环回 HTTP/SSE + 故障注入
tests/support/fake-generation-adapter.ts   L1 可编排适配器
tests/support/combinatorial.ts             两两组合生成器
tests/support/dom.tsx / dom-setup.ts       组件层渲染helper与 jsdom 补齐
tests/support/fixtures.ts                  fixture 读取
tests/support/creation-output-fixtures.ts  创作输出构造器
tests/fixtures/openai-image/*              12 JSON + 4 SSE
tests/fixtures/images/*                    6 PNG（脚本生成）
tests/models/generation.pict / .seed       因子模型与强制种子
e2e/support/{app-fixture,selectors,global-setup}.ts
playwright.config.ts / vitest.component.config.ts / vitest.bench.config.ts
scripts/generate-image-fixtures.mjs
scripts/manual-openai-image-acceptance.mjs
```

新增测试：网络断路器 5 条、组合模型 7 条、协议契约 15 条、选择器契约 4 条、付费隔离 5 条、组件层 22 条。

组件层当前新增了 4 个真实 DOM suite，覆盖生成提交/禁用、失败重试、Intake 操作回调和 Toast 副作用；仍有 21 个旧的 `renderToStaticMarkup` suite 待逐步迁移。此前按 8 个手选文件计算的 44.56% / 67.25% 已撤销。`npm run test:all` 现在通过 Vitest projects 同时运行 node 与 jsdom；`npm run test:coverage` 以完整 `src/**/*.{ts,tsx}` 为分母合并两种环境，当前真实基线为行 29.51%、语句 27.25%、函数 25.36%、分支 22.78%。

`dom-setup.ts` 中的 jsdom 补齐值得说明：`Element.scrollTo` 被实现为**真正生效的 polyfill**（写入偏移并派发事件），而不是空函数——空桩会让滚动相关代码"通过"却从未移动。

---

## 九、框架已发现的问题

### 9.1 已修复的 fixture 回归

`git bisect` 定位到 **`22ef546 "feat: review and hide failed creator outputs"`**。在**同一份未变更的 fixture** 上测量前后：

|            | ALL   | 其中 REFERENCE | DICTIONARY | CREATION |
| ---------- | ----- | -------------- | ---------- | -------- |
| `22ef546^` | 9     | 3              | 8          | 6        |
| `22ef546`  | **7** | **1**          | **6**      | 6        |

根因是 `FIXTURE_EYE_EXAMPLES` 声明了不存在的 `EYE-INNER-DOUBLE-001-V01-R01.png`，而修复函数采用全有或全无的文件存在检查，因此两个有效的正例也被整体跳过。移除不存在的负例声明后，两张参考图恢复导入；三条原回归断言未放宽并全部通过。

### 9.2 失效的截图选择器

`src/main/development/capture.ts` 引用了 4 个渲染层已不存在的 `data-action`：`library-switcher`、`dictionary-overview`、`codex-drawer`、`word-palette-add-parameter`。由于使用 `document.querySelector(...)?.click()`，**每一个都会静默失败并截到错误的界面**。已记录为只减不增的棘轮。

### 9.3 `.gitignore` 会吞掉所有 fixture PNG

仓库全局忽略 `*.png`。已在创建 fixture 前加入例外。

---

## 十、存量失败的处理

从 9 条降到 3 条：

| 原失败                                                                | 定性                         | 处理                                                                                                                                 |
| --------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 分面检索计数（267/361/12/15/16/20）                                   | 内容漂移                     | 改为断言**集合代数**：同分面取值产生精确并集；跨分面产生非空真子集，且逐条校验确实同时带有两个分面值                                 |
| 词典分页 `total: 1720`、`offset: 1680`、`[500]`、`filtered.total: 12` | 内容漂移                     | 全部由 `searchTerms('zh').length` 推导。修好 total 后**又暴露出两个此前被首条失败掩盖的硬编码偏移**                                  |
| 内容包 `1715` / `1725`                                                | 内容漂移                     | 改为 `termRevisions.length + recipeRevisions.length`，并断言链接数等于条目数；不变量（只含两种对象类型、各链接一次、重开不重导）保留 |
| 网页资源 `40` / 固定 revision / 固定 `collectedAt`                    | 内容漂移（实际增长到 41 条） | 计数由数据推导；revision 与日期改为断言**格式**                                                                                      |
| `MaterialCard` 类名出现次数 = 3                                       | 源码文本脆性                 | 改为断言**配对不变量**：凡是 hover 时隐藏的，必须在键盘 focus 时恢复，否则元数据对键盘用户不可达。断言两者数量相等且非零             |
| `OutputVersionStrip` 精确 JSX / 类名                                  | 源码文本脆性                 | **删除该架构测试**，改写为 `tests/output-version-strip.dom.test.tsx`，渲染组件并断言 `data-output-*` 属性与点击选中                  |
| 词典图库参考图相关 3 条                                               | fixture 导入回归             | 移除不存在且不可发布的负例图片声明；原断言保留并通过                                                                                 |

---

## 十一、待办路线图

1. **已完成：修复 9.1 的 fixture 回归**，`npm run verify` 恢复为可执行门禁。
2. **排查端到端启动阻塞**（见 6.3），建议从已知良好提交开始。
3. **接入 CI**：`typecheck → unit → component → architecture → integration → e2e`，覆盖率采用**按目录棘轮**（`src/main/ipc.ts` 0→40%，`src/main/model-worker` 0→50%，`src/renderer/components` 15→35%），而不是一个谁也推不动的全局阈值。
4. **把 45 条 pairwise 用例接到 `FakeGenerationAdapter`** 上跑起来——这是单位工时覆盖率提升最大的一步。
5. **补 E2E journey 1、2、7、10**，并把截图自动化从 `src/main/development/capture.ts` 迁入测试驱动。
6. **把 L9 图库性能实验跑一轮**，确认虚拟化没有泄漏。
7. **逐步改写 21 个 `renderToStaticMarkup` 组件测试**到组件层；`output-version-strip` 已作为范例。
8. 视觉回归基线（`toHaveScreenshot`）按平台分别提交，替代剩余的 Tailwind 类名字符串断言。
