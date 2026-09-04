# 能力扩展

能力扩展使用 `kind: "CAPABILITY"`，用于声明主题、字段、筛选器、命令、工作流、工具、搜索 Provider 或模型 Provider。

> 当前状态：外部包不能执行 JavaScript。宿主只加载带有受支持 `HOST` runtime 声明的能力包，并校验扩展 ID、权限与贡献点是否和宿主契约完全一致。没有对应宿主实现的通用能力 manifest 仍不会获得可执行能力。

可复制模板：

- [`templates/capability/manifest.json`](templates/capability/manifest.json)：通用能力声明。
- [`templates/image-api/manifest.json`](templates/image-api/manifest.json)：带声明式连接配置的图像 API 能力。

## 声明与实现是两层

manifest 负责让扩展中心知道“这个扩展是什么、贡献什么、需要什么权限”。它不会加载插件 JavaScript，也不会自动创建 IPC、网络请求、命令处理器或 Provider。

一个当前可工作的能力扩展至少包含两部分：

1. 通过 manifest 声明身份、兼容性、贡献点、权限和可选配置。
2. 由宿主代码注册相同 ID 的 Provider 或功能实现，并在调用路径中执行权限检查、输入校验、状态持久化和错误隔离。

缺少第 2 部分时，manifest 最多只能作为元数据展示，不能提供实际功能。

## `HOST` runtime

宿主已实现的能力可以把 manifest 独立打包，并显式绑定运行时：

```json
{
  "runtime": {
    "kind": "HOST",
    "id": "codex-image-discovery"
  }
}
```

`runtime.id` 不是任意入口名。宿主为每个 ID 固定以下契约：

- 唯一允许的扩展 ID；
- 必需权限与可选权限；
- 命令、工作流、工具和 Provider 贡献点；
- 实际运行时代码及其 IPC、存储和错误隔离边界。

包可以独立更新版本、名称、描述、本地化和兼容范围，但不能放宽权限或把运行时绑定到另一个扩展 ID。当前开放的参考运行时包括：

- `codex-image-discovery`：发现并导入 Codex 生成图片，清单位于 [`extensions/com.aiy.codex-image-discovery/`](../../extensions/com.aiy.codex-image-discovery/)。
- `codex-history-search`：从 Codex 只读任务元数据与聊天投影建立扩展私有 FTS5 索引，搜索标题、用户消息和最终回答；支持归档状态、角色、子代理、工作区、分支和日期筛选。搜索查询不读取 rollout；选中单个任务后，详情区按页读取该任务的聊天投影，旧版任务则在严格路径校验后按固定字节上限倒序读取对应 rollout。索引不进入资料库、不上传，并在任一必需权限撤销时清空。清单位于 [`extensions/com.aiy.codex-history-search/`](../../extensions/com.aiy.codex-history-search/)。
- `codex-visualization-discovery`：按 Codex 任务发现 HTML 交互可视化、静态可视化、SVG、PDF、线框图、UML 与图表源文件；HTML 仅按需进入关闭脚本、网络、表单和下载的短期沙箱静态预览，并受文件、请求数和总资源体积限制。能力包不改动来源文件，同时提供外部打开、定位和导出。清单位于 [`extensions/com.aiy.codex-visualization-discovery/`](../../extensions/com.aiy.codex-visualization-discovery/)。
- `codex-usage-investigator`（Codex今天努力了吗？）：以 Codex `state_*.sqlite` 为任务索引，将逐次 token、Chat turn 终态与完成耗时、会话来源、上下文压缩次数、订阅套餐、模型、Standard/Fast 及 primary/secondary 额度窗口增量导入拓展专用 SQLite；每完成一个 rollout 即提交检查点，中断后从未完成文件继续。界面默认按本地日历“今天”调查，以左侧报告历史轨和右侧总览、速度、会话、额度、模型分区组织结果。Fast 实测按完成时刻归属所选范围，只比较同一规范化模型与同一推理强度中明确记录模式的完成轮次，分别计算 Standard/Fast `task_complete.duration_ms` 中位数，并以两者之比对照[官方 1.5 倍模型速度标称](https://learn.chatgpt.com/docs/agent-configuration/speed)；Fork 继承轮次只保留最早自有记录。导入时以会话累计计数器还原真实增量，为每个用量事件生成不含内容的稳定指纹，并在读取时只保留跨会话历史重放中的全局最早事件。可选详细统计以完整会话为一级单位，按末个自有终态 Chat turn 归属时间范围；Fork 继承的 Chat turn 与上下文压缩均不重复计数，用户直聊、Fork 与子代理分开比较，仅按单一规范化模型控制样本，Standard、Fast、混合及未知服务模式合并进入 Token 分桶。会话按轮数排序后采用动态近似等频分桶：组数随样本量对数增长，并限制为每约 5 个完整会话至多增加一组；同轮数会话不拆分，超大同轮数组后重新均衡剩余组。低于 5 个样本的组继续展示，但不参与成本最低点及趋势信号。API 等值统一折算为同模型在事件日期的 Standard 公开费率，因此模式未知的会话仍可进入 API 中位数。界面同时展示总体覆盖、跨比较组轮数信号、上下文压缩次数平均值、轮均 Token/API 中位数与会话峰值上下文范围。Credits 等值仍按事件的 Standard/Fast 模式应用公开倍率；会话缺少模式事件时，仅对 Codex 配置文件修改时间之后的事件使用其中的模式兜底，显式会话标记始终优先。API 等值仅作为公开费率对照而非账单。额度换算只统计 `resetsAt` 之前且落在 10080 分钟周窗口内的事件；`resetsAt` 仅作为下一次重置预测，按 5 分钟容差推进同一额度流，旧预测快照会被丢弃，预测前移时结束当前连续观测段。每个观测段以去重后的 Token 总数除以该段观测到的额度消耗百分点，并列出 Sol、Luna、Terra 及其他模型与 Standard/Fast 组合的 Token 占比、非缓存输入加输出 Token 与缓存输入占比。扫描与计算阶段分别报告可访问的后台进度，加工结果按原始数据修订号和算法版本缓存。拓展不会保存或导出 Prompt、回复、工作目录或本机绝对路径。清单位于 [`extensions/com.aiy.codex-usage-investigator/`](../../extensions/com.aiy.codex-usage-investigator/)。
- `weibo-browser-handoff`：把当前内容和已验证的资产交给浏览器伴侣填入微博草稿。它只接受 `com.aiy.channel.weibo`，并要求 `browser.handoff:weibo`；最终发布仍由用户在微博页面完成。清单位于 [`extensions/com.aiy.channel.weibo/`](../../extensions/com.aiy.channel.weibo/)。
- `article-draft-delivery`：由外部扩展声明唯一渠道、站点 origin、URL 前缀和凭据权限；宿主只代管密钥、捕获不可变文章修订、上传已绑定图片并调用固定的 AIY 文章导入协议。扩展包不执行 JavaScript，渠道包可在站点仓库独立维护和安装。

## Codex 的非 Fast 周额度等效 Token

总览的“100% 额度等效非 Fast Token 总量”按调查范围内同一套餐、同一周额度池的可用观测段，展示完整周额度在非 Fast（Standard）模式下的 Token 总量。公式为 `(Standard Token + Σ(各模型 Fast Token × 对应额度倍率)) ÷ 累计观测消耗百分点 × 100`。总量包含缓存输入与输出，不依赖 API 金额或费率覆盖；它沿用观测到的模型与缓存比例，不是固定套餐承诺。Fast 使用[官方额度消耗倍率](https://learn.chatgpt.com/docs/agent-configuration/speed)，不使用模型速度提升倍率。模式未记录时，用该部分 Token 的 1× 与对应模型的 Fast 倍率形成上下界；倍率无公开依据或模型份额缺失时仅给出下限。已保存报告直接从模型份额与额度观测转换，不因某个模式缺失就丢弃整段。

每分钟取最高额度快照，累计相邻分钟的正向消耗。首次观测分钟与额度下降分钟只建立基线，其用量不参与换算；重置预测前移后重新分段。因此 reset 不会抵消此前消耗，也不会被直接当成已用满 100% 额度。模式覆盖按已明确或补回模式的 Token 占比计算。截断与历史算法报告可从可用观测转换，并在提示中标明范围限制；混合套餐或额度池及没有有效额度消耗的报告仍不强行合并。

读取模式时，完整 `thread_settings_applied` 设置快照中省略或清空 `service_tier` 的情况按默认 Standard 补回，并保留推断标记；缺少模型与 provider 身份的稀疏记录不使用该规则。[Codex 的设置快照协议](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/protocol.rs)在没有指定档位时省略该字段。同一轮仅有一种明确模式时，可补回该轮缺失的模式；整轮没有设置记录时保留“未记录”，不把后来的设置或当前配置套到过去。修复只更新可重建的扩展索引与报告，不修改 Codex 原始日志。

## 通用能力 manifest

```json
{
  "manifestVersion": 1,
  "kind": "CAPABILITY",
  "id": "com.example.asset-search",
  "version": "0.1.0",
  "displayName": "Example Asset Search",
  "description": "Searches assets through an example service.",
  "engines": { "aiy": "^0.3.0" },
  "contributes": {
    "commands": ["example.assets.refresh"],
    "workflows": ["example.assets.import"],
    "searchProviders": ["example.assets"]
  },
  "permissions": ["network:https://api.example.com"],
  "optionalPermissions": ["library.create:creations"]
}
```

完整字段和命名规则见 [manifest v1](manifest.md)。

## 贡献点

`contributes` 当前识别以下键：

| 键                 | 声明的能力    |
| ------------------ | ------------- |
| `themes`           | 主题          |
| `fields`           | 领域字段      |
| `filters`          | 筛选器        |
| `commands`         | 命令          |
| `workflows`        | 工作流        |
| `tools`            | 工具          |
| `searchProviders`  | 搜索 Provider |
| `modelProviders`   | 模型 Provider |
| `deliveryChannels` | 外部投递渠道  |

这些数组目前都是贡献 ID 列表，不是实现体。通用的外部贡献点注册 API 尚未开放；宿主实现必须显式识别扩展 ID 和贡献 ID。不要仅凭 manifest 声明就假定某个命令或 Provider 已可调用。

## `IMAGE_API` 声明式配置

能力 manifest 可以附带一种宿主可渲染的连接配置：

```json
{
  "configuration": {
    "kind": "IMAGE_API",
    "defaultEndpointPresetId": "example-global",
    "endpointPresets": [
      {
        "id": "example-global",
        "endpointTemplate": "https://api.example.com/v1/images/generations",
        "modelId": "example-image-1"
      }
    ],
    "settingFields": [],
    "customEndpointAllowed": true,
    "customModelIdAllowed": true,
    "connectionCheckPresetIds": ["example-global"]
  }
}
```

| 字段                       | 约束                   | 含义                         |
| -------------------------- | ---------------------- | ---------------------------- |
| `kind`                     | 固定为 `IMAGE_API`     | 配置协议类型                 |
| `defaultEndpointPresetId`  | 必须引用一个 preset    | 初始端点                     |
| `endpointPresets`          | 1–30 项，ID 不重复     | 内置端点及其默认模型         |
| `settingFields`            | 最多 30 项，key 不重复 | 端点模板需要的附加文本字段   |
| `customEndpointAllowed`    | 布尔值                 | 是否显示自定义请求 URL       |
| `customModelIdAllowed`     | 布尔值                 | 是否允许自定义模型 ID        |
| `connectionCheckPresetIds` | 只能引用已声明 preset  | 哪些内置端点支持显式连接检查 |

### 端点模板

端点必须是无用户名、密码、query 和 hash 的 HTTPS URL。动态片段写成 `{fieldKey}`，并为每个片段声明一个 `settingFields` 项：

```json
{
  "endpointPresets": [
    {
      "id": "example-workspace",
      "endpointTemplate": "https://{workspaceId}.api.example.com/v1/images/generations",
      "modelId": "example-image-1"
    }
  ],
  "settingFields": [
    {
      "key": "workspaceId",
      "required": true,
      "endpointPresetIds": ["example-workspace"]
    }
  ]
}
```

`endpointPresetIds` 表示该字段在哪些端点下出现；引用未知 preset、使用未声明占位符或重复 key 都会使 manifest 失效。

### 配置文案的 i18n

声明 `configuration` 时，可以在 `manifest.i18n.locales.<locale>.configuration` 中提供设置页文案。该对象是完整对象，不是局部补丁：

- `endpointOptions` 必须覆盖每个 preset。
- `customEndpointAllowed` 为 `true` 时必须再提供 `custom` 选项。
- `fields` 必须覆盖所有 `settingFields`，每项都有 `label` 和 `placeholder`。

完整的中英文配置文案见 [`templates/image-api/manifest.json`](templates/image-api/manifest.json)。`manifest.i18n` 只翻译扩展自身和配置界面；它不提供应用界面翻译。应用界面翻译属于 [`LANGUAGE` 扩展](language-extensions.md)。

## 权限与凭据

建议按实际执行边界拆分权限：

```json
{
  "permissions": ["network:https://api.example.com", "credentials.use:example-api-key"],
  "optionalPermissions": ["network:user-configured-https-endpoint"]
}
```

- 固定远端域名放入必需权限。
- 只有用户选择自定义端点时才需要的网络能力放入可选权限。
- manifest 不存 API Key；凭据由宿主的安全存储层管理，`credentials.use:*` 只允许宿主代为使用，不能读取原始值。
- 自定义端点权限是声明模板。保存配置时，宿主把它收窄为 `network:<精确 origin>`，切换或清除配置后撤销旧 origin。
- 声明权限不等于自动执行权限检查。宿主实现应在每条敏感路径再次校验授权。

资料库中由用户选中的参考图、文件选择器返回的单次导出路径，以及用户明确要求打开的已验证文件属于操作范围，不应扩大成整个资料库或文件系统的持久权限。完整规范见 [扩展权限模型](permissions.md)。

## 宿主实现清单

新增一个内置能力时，应同时完成：

- 将 manifest 放入随应用分发的 `extensions/`；若需要独立打包，则声明受控的 `HOST` runtime。
- 注册贡献点对应的 Provider、命令、工作流或工具实现。
- 为设置、密钥和连接状态提供存储与 IPC 边界。
- 在网络、文件、资料库写入等执行路径检查 manifest 权限。
- 为扩展中心提供真实的 `READY`、`NEEDS_CONFIGURATION` 或 `UNAVAILABLE` 状态。
- 对远端响应和用户配置做运行时校验，不能只依赖 manifest 校验。
- 为用户可见的扩展名称和配置标签补齐 `manifest.i18n`。

宿主硬编码参考位于 [`src/main/extensions/builtin-manifests.ts`](../../src/main/extensions/builtin-manifests.ts)，独立 capability 包参考位于 [`extensions/com.aiy.codex-image-discovery/`](../../extensions/com.aiy.codex-image-discovery/)。图像 API 的配置与端点解析可参考 [`src/main/extensions/external-image-api/`](../../src/main/extensions/external-image-api/)。

## 外部分发尚缺的运行时

要让第三方能力包携带自己的代码独立分发，还需要确定并实现：代码入口与隔离方式、贡献点注册 ABI、权限沙箱、签名与信任、崩溃隔离，以及稳定的宿主 API。在这些边界落地前，第三方最适合独立维护数据型 `LANGUAGE` 扩展；`HOST` runtime 包适合把宿主已有能力的清单、版本和本地化独立发版。
