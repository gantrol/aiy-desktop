# Extension manifest v1

每个扩展目录必须包含 UTF-8 JSON 文件 `manifest.json`。对象采用严格校验：多余字段、错误类型、无效 ID 或不受支持的枚举值都会使包失效。

## 最小结构

```json
{
  "manifestVersion": 1,
  "kind": "LANGUAGE",
  "id": "com.example.language.zh-cn",
  "version": "0.1.0",
  "displayName": "Simplified Chinese",
  "description": "Provides a Simplified Chinese interface.",
  "engines": { "aiy": "^0.3.0" },
  "contributes": {},
  "permissions": [],
  "optionalPermissions": [],
  "language": {
    "locale": "zh",
    "htmlLanguage": "zh-CN",
    "catalog": "messages.json"
  }
}
```

## 通用字段

| 字段                  | 必填     | 约束                                 | 含义                               |
| --------------------- | -------- | ------------------------------------ | ---------------------------------- |
| `manifestVersion`     | 是       | 固定为 `1`                           | manifest 协议版本                  |
| `kind`                | 是       | `LANGUAGE` 或 `CAPABILITY`           | 扩展类型                           |
| `id`                  | 是       | 3–160 字符；`^[a-z0-9][a-z0-9._-]*$` | 全局稳定 ID                        |
| `version`             | 是       | SemVer；新扩展从 `0.1.0` 起          | 扩展版本                           |
| `displayName`         | 是       | 1–120 字符                           | 缺少 `i18n` 时使用的名称           |
| `description`         | 是       | 最多 500 字符                        | 缺少 `i18n` 时使用的描述           |
| `engines`             | 是       | 只能包含 `aiy`                       | 宿主兼容范围                       |
| `contributes`         | 是       | 严格对象                             | 扩展贡献点声明                     |
| `permissions`         | 是       | 最多 80 项                           | 必需权限                           |
| `optionalPermissions` | 是       | 最多 80 项                           | 可选权限                           |
| `i18n`                | 否       | 见下文                               | 扩展自身的名称、描述和配置界面翻译 |
| `language`            | 条件必填 | 仅 `LANGUAGE` 可用                   | 应用界面语言包声明                 |
| `runtime`             | 否       | 仅受控 `CAPABILITY` 包可用           | 宿主运行时绑定                     |
| `configuration`       | 否       | `IMAGE_API` 或 `ARTICLE_DELIVERY`    | 宿主渲染并执行的声明式配置         |

`source`、安装时间、启用状态和授权状态由宿主管理，不写入 manifest。

## 宿主兼容性

当前宿主 engine key 是 `aiy`，宿主 API 版本是 `0.3.9`。支持三种范围格式：

```json
{ "engines": { "aiy": "*" } }
{ "engines": { "aiy": "0.3.0" } }
{ "engines": { "aiy": "^0.3.0" } }
```

- `*`：接受任意宿主版本。
- 精确版本：只接受相同的 major、minor、patch。
- caret：使用 SemVer 上界；例如 `^0.3.0` 接受 `>=0.3.0 <0.4.0`。

当前不支持 `~`、`>=`、逻辑或或复合范围。无法识别的范围会被判定为不兼容。

## 贡献点

`contributes` 可包含以下数组；每项 ID 长度为 3–160，格式为 `^[A-Za-z0-9][A-Za-z0-9._-]*$`：

```json
{
  "contributes": {
    "themes": ["example.dark"],
    "fields": ["example.seed"],
    "filters": ["example.rating"],
    "commands": ["example.refresh"],
    "workflows": ["example.generate"],
    "tools": ["example.image.generate"],
    "searchProviders": ["example.assets"],
    "modelProviders": ["example-image-api"],
    "deliveryChannels": ["example-social"]
  }
}
```

每个数组最多 200 项。manifest 声明不会自动创建实现；当前运行时支持情况见 [能力扩展](capability-extensions.md)。

## 权限

权限 key 长度为 3–240，格式为 `^[A-Za-z0-9][A-Za-z0-9._:/-]*$`。同一权限不能同时出现在必需和可选列表中；通过格式校验但不在宿主权限目录中的 key 仍会被拒绝。

```json
{
  "permissions": ["network:https://api.example.com", "credentials.use:example-api-key"],
  "optionalPermissions": ["network:user-configured-https-endpoint"]
}
```

必需权限未授权时，扩展状态为 `PERMISSION_REQUIRED`。`network:user-configured-https-endpoint` 是只能放入 `optionalPermissions` 的运行时模板，模板本身不会被授权；宿主在用户保存配置时记录精确网络 origin。

`LANGUAGE` 是纯数据包，不能声明权限、能力贡献、runtime、能力 category 或 `configuration`。

权限只是声明和持久授权边界；能力扩展的宿主实现仍必须在执行路径中检查权限，并用本次调用的不可变资源范围限制实际访问。完整规则见 [扩展权限模型](permissions.md)。

## manifest 自身的 i18n

`manifest.i18n` 翻译的是插件自己的名称、描述和配置标签，不是整个应用界面。当前 locale 只接受 `zh`、`en`。

```json
{
  "displayName": "Example Image API",
  "description": "Generate images through Example API.",
  "i18n": {
    "defaultLocale": "en",
    "locales": {
      "en": {
        "displayName": "Example Image API",
        "description": "Generate images through Example API."
      },
      "zh": {
        "displayName": "示例图像 API",
        "description": "通过示例 API 生成图像。"
      }
    }
  }
}
```

`defaultLocale` 对应的条目必须存在。宿主先取当前 locale，再回退到 `defaultLocale`，最后回退到顶层 `displayName` 和 `description`。

声明 `configuration` 时，每个 locale 可增加完整的配置文案对象：

```json
{
  "displayName": "Example Image API",
  "description": "Generate images through Example API.",
  "configuration": {
    "title": "Example API connection",
    "apiKeyLabel": "API Key",
    "apiKeyPlaceholder": "Enter an API key",
    "endpointLabel": "Service endpoint",
    "endpointOptions": {
      "example-global": "Global endpoint",
      "custom": "Other compatible endpoint"
    },
    "customEndpointLabel": "Custom request URL",
    "customEndpointPlaceholder": "https://gateway.example.com/v1/images/generations",
    "modelIdLabel": "Model ID",
    "modelIdPlaceholder": "example-image-1",
    "fields": {}
  }
}
```

配置文案是严格对象，不能只填写部分字段。每个 endpoint preset 都必须有对应 `endpointOptions`；允许自定义端点时还必须包含 `custom`。每个 `settingFields` 项也必须在 `fields` 中提供 `{ "label", "placeholder" }`。

## 类型专属约束

- `LANGUAGE` 必须声明 `language`；外部语言包还必须指定 `language.catalog: "messages.json"`。
- `CAPABILITY` 不能声明 `language`。
- 外部 `CAPABILITY` 必须声明受支持的 `runtime.kind: "HOST"`，并满足对应宿主契约。
- `configuration` 接受 `kind: "IMAGE_API"` 或 `kind: "ARTICLE_DELIVERY"`，详见 [能力扩展](capability-extensions.md)。

## 外部包读取限制

- `manifest.json` 最大 256 KiB。
- 外部加载器只扫描扩展根目录的直接子目录。
- 当前只加载外部 `LANGUAGE` 包；外部 `CAPABILITY` 会被拒绝。
- 同 ID 的后续扩展会被忽略；扩展不能覆盖内置 ID。
