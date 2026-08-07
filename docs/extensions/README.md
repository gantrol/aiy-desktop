# 扩展开发

AIY 扩展是带有 `manifest.json` 的目录。当前宿主支持两类 manifest，但两类的外部加载能力不同：

| 类型     | `kind`       | 用途                                     | 可从用户扩展目录加载                |
| -------- | ------------ | ---------------------------------------- | ----------------------------------- |
| 语言扩展 | `LANGUAGE`   | 提供应用界面翻译 catalog                 | 是                                  |
| 能力扩展 | `CAPABILITY` | 声明模型、命令、工作流、工具、搜索等能力 | 仅支持宿主明确开放的 `HOST` runtime |

语言扩展完全由 JSON 构成，不执行插件 JavaScript。能力扩展也不执行包内代码；它只能通过 `runtime.kind: "HOST"` 绑定宿主已经实现并固定权限契约的运行时。

## 文档导航

- [manifest 参考](manifest.md)：通用字段、命名限制、兼容性、权限和本地化。
- [语言扩展与 i18n 模板](language-extensions.md)：`messages.json`、参数、分支、格式化和 fallback。
- [能力扩展](capability-extensions.md)：贡献点、声明式 `IMAGE_API` 配置及当前边界。
- [语言扩展 manifest 模板](templates/language/manifest.json)
- [语言扩展 messages 模板](templates/language/messages.json)
- [基础能力扩展模板](templates/capability/manifest.json)
- [IMAGE_API 能力扩展模板](templates/image-api/manifest.json)

## 包目录

每个直接子目录是一个扩展包：

```text
extensions/
  com.aiy.codex-image-discovery/
    manifest.json
  com.example.language.zh-cn/
    manifest.json
    messages.json
```

开发版扫描仓库的 `apps/desktop/extensions/`；安装版扫描应用资源中的 `extensions/`。用户本地扩展从以下目录扫描：

```text
Windows: %APPDATA%/AIY/extensions/
macOS:   ~/Library/Application Support/AIY/extensions/
```

实际根目录也可以由 `AIY_USER_DATA_DIR` 指定；应用会在该目录下使用 `extensions/`。
当前构建与验收目标只有 Windows 和 macOS；Linux 不在本项目的打包范围内。

设置 `AIY_USER_DATA_DIR` 时，本地扩展目录改为 `<AIY_USER_DATA_DIR>/extensions/`。扩展中心的“安装本地插件”会校验所选目录，只把 `manifest.json` 与语言 catalog 复制到受管目录，并立即重载；手动修改用户扩展目录后仍需重启应用。

宿主代码内置的能力扩展不能被本地包替换。随应用分发的数据型语言包允许由本地包按同 ID 或同 locale 替换；卸载本地包后自动回退到随应用分发的版本。每种界面 locale 只能有一个生效的语言扩展。

## 最短上手路径

创建简体中文语言包时：

1. 复制 [`templates/language/`](templates/language/) 到一个新的扩展目录。
2. 修改 `id`、`version`、作者维护的名称和描述。
3. 以宿主英文 catalog [`src/renderer/i18n/locales/en.ts`](../../src/renderer/i18n/locales/en.ts) 为 key 与函数签名的来源。
4. 在 `messages.json` 中写静态字符串或安全参数模板。
5. 在扩展中心选择“安装本地插件”，选中该目录并检查来源、兼容性和启用状态。

仓库中的可运行参考实现位于 [`extensions/com.aiy.language.zh-cn/`](../../extensions/com.aiy.language.zh-cn/)。

## 当前限制

- 界面 locale 目前只接受 `zh` 和 `en`。
- 外部 `CAPABILITY` 只能使用宿主白名单中的 `HOST` runtime，扩展 ID、权限和贡献点必须与宿主契约完全一致。
- 安装器当前只接受目录包，尚不接受 ZIP；卸载只适用于由安装器管理的本地包。
- manifest 贡献点不等于运行时实现。能力扩展必须由宿主注册对应 provider、命令或工作流。
