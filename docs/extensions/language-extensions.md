# 语言扩展与 i18n 模板

语言扩展使用 `kind: "LANGUAGE"`，通过数据型 `messages.json` 提供应用界面翻译。宿主不会加载语言扩展中的 JavaScript。

这里有两层不同的本地化概念：

| 位置                                      | 翻译对象                           |
| ----------------------------------------- | ---------------------------------- |
| `manifest.i18n`                           | 当前扩展自己的名称、描述和配置标签 |
| `language.catalog` 指向的 `messages.json` | AIY 应用界面                       |

完整可复制文件：

- [`templates/language/manifest.json`](templates/language/manifest.json)
- [`templates/language/messages.json`](templates/language/messages.json)
- [仓库内简体中文参考包](../../extensions/com.aiy.language.zh-cn/)

## 包结构

```text
com.example.language.zh-cn/
├─ manifest.json
└─ messages.json
```

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
  },
  "i18n": {
    "defaultLocale": "zh",
    "locales": {
      "zh": {
        "displayName": "简体中文",
        "description": "提供简体中文界面。"
      },
      "en": {
        "displayName": "Simplified Chinese",
        "description": "Provides a Simplified Chinese interface."
      }
    }
  }
}
```

当前 `language.locale` 只接受 `zh` 或 `en`；`htmlLanguage` 使用 2–35 字符的 BCP 47 标签。外部语言扩展必须把 `catalog` 写为固定文件名 `messages.json`。

## catalog 的来源契约

宿主英文 catalog [`src/renderer/i18n/locales/en.ts`](../../src/renderer/i18n/locales/en.ts) 是 key、嵌套结构和函数参数顺序的来源：

- 英文叶子是字符串：翻译也写字符串。
- 英文叶子是函数：翻译写参数模板对象。
- 不要改 key，不要把对象层级拍平。
- 新增英文 key 后，旧语言包仍可运行；缺失项自动显示英文。

`messages.json` 必须是 JSON 对象，最大 2 MiB。

## 静态字符串模板

```json
{
  "common": {
    "close": "关闭",
    "cancel": "取消"
  },
  "app": {
    "navigation": {
      "creator": "创作",
      "gallery": "素材"
    }
  }
}
```

翻译值不是字符串时，该项会回退到英文。

## 单参数模板

英文函数：

```ts
active: (count: number) => `${count} running`;
```

语言包：

```json
{
  "$params": ["count"],
  "$template": "{count} 个运行中"
}
```

`$params` 按英文函数的实参顺序建立参数名映射；模板中的 `{count}` 再取这个值。参数名必须匹配 `^[A-Za-z][A-Za-z0-9_]*$`，最多 20 项。

## 多参数模板

```json
{
  "$params": ["page", "count"],
  "$template": "第 {page} / {count} 页"
}
```

占位符格式是 `{parameterName}`。模板中引用未声明参数时，占位符会原样保留；值为 `null` 或 `undefined` 时替换为空字符串。

## `equals` 条件分支

适合零数量、布尔值或枚举值。`$variants` 按顺序检查，第一个匹配项生效；没有匹配项时使用 `$template`。

```json
{
  "$params": ["count"],
  "$template": "已收藏 {count} 项素材",
  "$variants": [
    {
      "when": { "param": "count", "equals": 0 },
      "template": "素材已经收藏"
    }
  ]
}
```

枚举模板：

```json
{
  "$params": ["status"],
  "$template": "待处理",
  "$variants": [
    {
      "when": { "param": "status", "equals": "RESOLVED" },
      "template": "已解决"
    },
    {
      "when": { "param": "status", "equals": "DISMISSED" },
      "template": "已移除"
    }
  ]
}
```

`equals` 可比较 JSON 字符串、数字、布尔值或 `null`，采用严格相等语义。

## `truthy` 条件分支

适合“有值时追加一段文案”：

```json
{
  "$params": ["position"],
  "$template": "排队",
  "$variants": [
    {
      "when": { "param": "position", "truthy": true },
      "template": "排队 {position}"
    }
  ]
}
```

多个参数也可以在分支模板中使用：

```json
{
  "$params": ["model", "detail"],
  "$template": "{model} 未连接，请到设置里检查。",
  "$variants": [
    {
      "when": { "param": "detail", "truthy": true },
      "template": "{model} 未连接：{detail}"
    }
  ]
}
```

`false`、`0`、空字符串、`null` 和缺失值按 false 处理。一个 `when` 只写 `equals` 或 `truthy`，不要同时写两者。每个参数模板最多 20 个 variants。

## 固定宽度格式

当前唯一格式化器是安全、有上限的 `padStart`：

```json
{
  "$params": ["versionNo"],
  "$template": "V{versionNo}",
  "$formats": {
    "versionNo": {
      "kind": "padStart",
      "length": 2,
      "fill": "0"
    }
  }
}
```

结果示例：`3` → `V03`。`length` 必须是 1–32 的整数，`fill` 长度为 1–8。格式同时作用于默认模板和所有 variant。

## Fallback 与容错

宿主以英文 catalog 为可执行骨架，并逐项合并语言包：

1. 合法翻译覆盖英文叶子。
2. 缺失或格式错误的叶子使用英文。
3. 语言包中英文 catalog 不认识的 key 被忽略。
4. 无效参数模板不会执行任意表达式，也不会执行插件代码，而是回退到英文函数。
5. 插件被停用、不兼容或 catalog 未加载时，该 locale 不可选；至少保留英文宿主 fallback。

这意味着语言包可以增量更新，但发布前仍应补齐全部当前 key，避免界面中英混排。

## 不支持的写法

当前模板不是 ICU MessageFormat，也不解析 JavaScript：

```json
{ "$template": "${count} items" }
```

```json
{ "$template": "{count, plural, one {...} other {...}}" }
```

以上都不会得到期望结果。请使用 `{count}` 与显式 `$variants`。

## 发布前检查

- manifest 能通过 [manifest v1](manifest.md) 约束。
- locale 没有与已安装语言插件重复。
- 所有英文字符串 key 在 `messages.json` 中是字符串。
- 所有英文函数 key 都有 `$params` 和 `$template`，参数顺序一致。
- 零值、空值、布尔值和枚举分支都手动检查过。
- JSON 文件是 UTF-8、无注释、无尾随逗号，且小于 2 MiB。
- 版本号在每次发布时递增。
- 在扩展中心选择“安装本地插件”，确认来源为“本地”并切换语言检查。
