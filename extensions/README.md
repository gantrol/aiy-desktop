# Extensions

此目录存放随应用分发的声明式扩展。包内代码不会被执行；能力包只能绑定宿主明确开放的运行时。完整的作者文档、类型说明和模板见：

- [`docs/extensions/README.md`](../docs/extensions/README.md)
- [`docs/extensions/language-extensions.md`](../docs/extensions/language-extensions.md)
- [`docs/extensions/templates/`](../docs/extensions/templates/)

当前随应用分发的简体中文参考包位于 [`com.aiy.language.zh-cn/`](com.aiy.language.zh-cn/)。
Codex 聊天记录、用量、图片、可视化与连接能力由宿主内置的统一 `com.aiy.codex-app-server` 插件提供。旧声明包目录仅保留用于迁移既有安装状态与授权，不再注册为独立插件。
自然水印能力包位于 [`com.aiy.natural-watermark/`](com.aiy.natural-watermark/)。
