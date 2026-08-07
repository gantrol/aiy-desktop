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

包可以独立更新版本、名称、描述、本地化和兼容范围，但不能放宽权限或把运行时绑定到另一个扩展 ID。当前开放的参考运行时是 `codex-image-discovery`，清单位于 [`extensions/com.aiy.codex-image-discovery/`](../../extensions/com.aiy.codex-image-discovery/)。

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
  "optionalPermissions": ["library.write:creations"]
}
```

完整字段和命名规则见 [manifest v1](manifest.md)。

## 贡献点

`contributes` 当前识别以下键：

| 键                | 声明的能力    |
| ----------------- | ------------- |
| `themes`          | 主题          |
| `fields`          | 领域字段      |
| `filters`         | 筛选器        |
| `commands`        | 命令          |
| `workflows`       | 工作流        |
| `tools`           | 工具          |
| `searchProviders` | 搜索 Provider |
| `modelProviders`  | 模型 Provider |

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
  "permissions": ["network:https://api.example.com", "secrets:example-api-key"],
  "optionalPermissions": ["network:user-configured-https-endpoint"]
}
```

- 固定远端域名放入必需权限。
- 只有用户选择自定义端点时才需要的网络能力放入可选权限。
- manifest 不存 API Key；凭据由宿主的安全存储层管理。
- 声明权限不等于自动执行权限检查。宿主实现应在每条敏感路径再次校验授权。

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
