# AIY生图管理工具

本地优先的 AI 生图、词典与素材管理桌面工具。正式运行时以 SQLite 与受管媒体目录为主库，不从 React 组件或网页 Demo 读取业务数据。`0.3.0` 提供 Windows 10/11 x64 安装包和 ZIP；`0.3.1` 增加 Apple Silicon（arm64）macOS DMG 和 ZIP。

## 下载与安装

发布版本从 [GitHub Releases](https://github.com/gantrol/aiy-desktop/releases) 下载，所有安装包均附带 SHA-256 校验值。Windows 包没有 Authenticode 签名，macOS 包没有 Apple Developer 签名或公证；SmartScreen 或 Gatekeeper 可能显示安全提示，运行前应先核对校验值。

## 许可

本项目按 [PolyForm Noncommercial License 1.0.0](LICENSE) 授权。个人、教育、研究及其他非商业用途可按许可证使用、修改和分发；商业使用需另行取得授权。

## 运行

```powershell
cd apps/desktop
npm ci
npm run dev
```

开发链使用 `electron-vite`：renderer 修改走 Vite HMR；main/preload 修改会重建并自动重启/刷新 Electron。Electron 42+ 改为首次运行时下载二进制，因此 `predev` 会先执行本地 `install-electron`，不需要手工处理。

## Codex 图片生成

应用提供彼此独立的 `Codex App Server` 与 `Codex CLI` 两个生图选项；模型键保持稳定，以兼容已有草稿和任务。默认使用 `CODEX_BINARY` 或 PATH 中当前受支持的 Codex CLI。`CODEX_IMAGE_BINARY` 仅用于开发和故障诊断时显式覆盖图片 CLI，正常使用应保持未设置。

图片生成、Codex 助手、会话和标题建议由“每个资料库一个”的独立后台模型进程执行。main/preload 的开发重启只会重新连接该进程，正在运行的任务不会因此中断；协议升级遇到旧 worker 时，有任务就先兼容连接并等待完成，空闲后再滚动换新。无客户端且无任务时，后台进程会在空闲期后自行退出。关闭窗口时若仍有模型任务，应用会让用户选择继续后台运行、取消任务并退出、经二次确认强制退出或返回；选择后台运行后会显示系统托盘，任务完成时通知，并在 30 秒后自动退出。修改 `electron.vite.config.ts` 后需要完整停止并重新执行一次 `npm run dev`，让开发宿主重新读取入口配置。

日常开发默认只运行 `npm run dev`，并按改动需要补 `npm run typecheck`、`npm test`。不要为普通界面或功能改动自动执行 `npm run package` / `npm run make`；只有明确要求可分发产物或进入发布里程碑时，才更新 `release/`。

Windows 验证与打包：

```powershell
npm test
npm run typecheck
npm run package
npm run make
```

macOS 必须使用 Node.js 22 或更新版本，并从 Git 源码执行全新的 `npm ci`；不要复用 Windows 生成的 `node_modules/`、`out/` 或 `release/`。本机验证通过后，可在 Mac 上运行：

```bash
npm run typecheck
npm test
npm run build
npm run make:mac
```

`make:mac` 生成 DMG 与 ZIP；默认只构建当前 Mac 的原生架构。Apple Developer 签名与公证凭据不保存在仓库中，正式对外分发前另行配置并验证。

首次启动会建立用户拥有的空白资料库。侧栏资料库切换器可以继续新建空白库，或打开由 AIY 0.3.0 baseline 创建的已有资料库目录。

运行时目录彼此独立。AIY 0.3.0 是首个公开数据 baseline；启动时不会接管、迁移或修复预发布资料库。默认用户数据结构为：

```text
%APPDATA%/AIY/libraries/
├─ index.json
└─ <library-id>/
   ├─ library.json
   ├─ library.sqlite3
   ├─ objects/sha256/
   └─ temp/generation/
```

“打开资料库…”只接受完整运行时资料库目录，且 schema 必须命中当前公开 baseline；fixture、内容包源目录和预发布数据库都不会被隐式转换为可用空间。

## 已打通

- 创作台：成果堆栈、Prompt 版本、参考图、词典选词、底部 Codex 抽屉、单图生成任务。
- 新创作：点击成果栏 `+` 进入独立空白态，可填写可选标题；首次生成后建立 Prompt 系列，后续修改叠为 version。
- 产出区：原比例完整显示、缩放、结果切换、点/矩形评注。
- 词典维护：可新建最小词条草稿，并继续编辑双语词义、别名、模型表达、多项属性，再保存或核准不可变版本。
- 导入：JSON/CSV 预检，重复与无效行提示，确认后进入草稿。
- 本地 Codex：使用既有 CLI 登录态；renderer 无法执行任意命令或访问文件系统。

UI 使用 React、Tailwind CSS v4 与 shadcn/ui 源码组件。通用控件位于 `src/renderer/components/ui/`；创作与词典能力按 feature 子目录拆分，页面只负责组合和短暂交互状态。

CSV 导入、首次启动、内容包、词典和本地空间教程见 [`docs/tutorials/`](docs/tutorials/README.md)。

扩展类型、manifest、语言包 i18n 语法和可复制模板见 [`docs/extensions/`](docs/extensions/README.md)。
