# AIY生图管理工具

本地优先的 AI 生图、词典与素材管理桌面工具。正式运行时以 SQLite 与受管媒体目录为主库，不从 React 组件或网页 Demo 读取业务数据。首个公开版本 `0.3.0` 优先提供 Windows 10/11 x64 安装包和 ZIP；macOS 暂不属于这次公开发布范围。

## 下载与安装

发布版本从 [GitHub Releases](https://github.com/gantrol/aiy-desktop/releases) 下载。Windows 安装包和 ZIP 均附带 SHA-256 校验文件。当前首发候选没有 Authenticode 签名，Windows SmartScreen 可能显示“未知发布者”；运行前应先核对校验值。

## 许可

本仓库源码可见，但不是开源软件。个人、教育、研究等非商业用途可在 [AIY Non-Commercial Source License 1.0](LICENSE) 的约束下使用；商业使用、生产部署、收费服务、SaaS、转售及再分发均需事先取得书面商业授权。除许可证明确授予的权利外，版权所有者保留全部权利。

## 运行

```powershell
cd apps/desktop
npm ci
npm run dev
```

开发链使用 `electron-vite`：renderer 修改走 Vite HMR；main/preload 修改会重建并自动重启/刷新 Electron。Electron 42+ 改为首次运行时下载二进制，因此 `predev` 会先执行本地 `install-electron`，不需要手工处理。

## Codex 图片生成双选项（Windows 本机）

本节记录当前 Windows 本机的固定 CLI 路径；这些 `%LOCALAPPDATA%` 路径和 `win32-x64` 二进制不要直接复制到 macOS。

2026-08-03 起，本机使用两套彼此隔离的 Codex CLI，生图模型也明确拆成两个选项：

- `Codex App Server`：模型键 `codex-app-server/gpt-image-2`，只走 App Server，使用 PATH 中的 `0.144.1`。
- `Codex CLI`：模型键沿用 `gpt-image-2` 以兼容已有草稿和任务，只走一次性的 `codex exec -m gpt-5.5`，优先使用固定的 `0.143.0`。

两个选项不会自动改走对方的传输。不能把 `0.143.0` 全局接到 App Server；当前服务会要求新版 CLI，而且旧版 `thread/fork` 也可能无法处理较新版本留下的线程状态。重新启动桌面应用不会改变固定目录；只要文件仍在，选择 `Codex CLI` 仍会使用 `0.143.0`，选择 `Codex App Server` 则使用 `0.144.1`。

图片固定用于规避新版图片路径可能出现的下列网络错误。图片任务本身已有 15 分钟超时，因此单纯延长等待时间不能处理这个错误。

```text
image generation failed: network error: error sending request for url
(https://chatgpt.com/backend-api/codex/images/generations)
```

CLI 选项参考 [`eagleagentic/codex-imagegen-143`](https://github.com/eagleagentic/codex-imagegen-143)。固定二进制直接取自官方 npm 平台包 `@openai/codex@0.143.0-win32-x64`。

- App Server/PATH：`%LOCALAPPDATA%\Programs\OpenAI\Codex\bin\codex.exe`（`0.144.1`）
- 图片 CLI：`%LOCALAPPDATA%\OpenAI\Codex\pinned\0.143.0\bin\codex.exe`
- 原始 `0.144.1` 备份：`%LOCALAPPDATA%\OpenAI\Codex\binary-backups\0.144.1-20260803-073457\`
- 图片 CLI SHA-256：`5728E3DDF1480103BAD235560E95CF7764EA3069F06029F9B2F39EB74A8066F6`
- App Server CLI SHA-256：`CBACBB9726262EF558B4AF0438A1B2A5BBA9076132401D947B5B4D2BF92AB0E4`

验证两套版本：

```powershell
codex --version
# codex-cli 0.144.1

& "$env:LOCALAPPDATA\OpenAI\Codex\pinned\0.143.0\bin\codex.exe" --version
# codex-cli 0.143.0
```

可用 `CODEX_IMAGE_BINARY` 显式覆盖图片 CLI 路径；未设置时，Windows 默认检查上述固定目录。删除或移动固定文件后，`Codex CLI` 会改用 `CODEX_BINARY` 或 PATH 中的当前 CLI，仍然不会切到 App Server。Codex 桌面端更新可能覆盖 PATH 目录，但不会覆盖独立固定目录；生图问题修复后，应移除 `0.143.0` 固定版本并使用受支持的新版本。

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
