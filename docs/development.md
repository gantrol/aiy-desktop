# 开发

[![简体中文](assets/zh-cn.svg)](development.md) [![English](assets/en.svg)](development.en.md)

以下命令均在桌面应用根目录执行，即包含 [package.json](../package.json) 的目录。使用完整工作区时，先进入 `apps/desktop/`。

## 环境要求

| 环境    | 要求                                                                             |
| ------- | -------------------------------------------------------------------------------- |
| 通用    | Git、Node.js 24 或 22.13+（22.x）、npm；以锁定工具链的 engines 要求为准          |
| Windows | 开发可直接运行；Store 组包另需 [Windows 构建工具](packaging.md#windows-构建环境) |
| macOS   | Xcode Command Line Tools，包含编译花瓣输入辅助程序所需的 Swift                   |
| Linux   | 用于源码运行与验证，当前打包命令不生成 Linux 安装包                              |

依赖版本由 `package.json` 和 `package-lock.json` 固定。浏览器伴侣在 `browser-companion/` 中维护自己的依赖。

## 首次安装

确认当前目录后，安装锁定依赖：

```sh
node --version
npm --version
npm ci --no-audit --no-fund
```

安装成功后启动开发环境：

```sh
npm run dev
```

`dev` 的前置步骤会准备 Electron，并在 macOS 上准备原生辅助程序。renderer 使用热更新；主进程和 preload 改动会重启 Electron。

## 已有环境

日常开发直接运行 `npm run dev`。只改应用源码、文案、文档或应用版本号，不需要重新安装依赖。

| 变化                                    | 处理                                    |
| --------------------------------------- | --------------------------------------- |
| 同一目录的依赖与运行环境未变            | 复用 `node_modules/`                    |
| 锁文件只更新顶层和根 package 的应用版本 | 核对差异后复用                          |
| 依赖声明、实际锁定依赖或安装选项变化    | 核对差异，按锁文件准备需要更新的依赖    |
| Node/Electron 原生 ABI、平台或架构变化  | 核对并重建或重装受影响的原生依赖        |
| 依赖缺失、损坏或安装曾中断              | 先查原因；需要完整恢复时再执行 `npm ci` |

`npm ls --depth=0` 可以辅助定位直接依赖缺失或版本无效，但不能代替锁文件核对或验证包文件完整性。不要跨机器、跨 checkout 复制依赖目录。

`npm ci` 会先移除已有 `node_modules/`。执行前检查 Dev、Preview 等进程是否占用该目录；有占用时先保存内容并正常退出对应会话。遇到 `EPERM` 先查文件占用，安装失败后确认依赖完整再继续。保留 npm 下载缓存，不反复清目录重试。[npm ci 说明](https://docs.npmjs.com/cli/v11/commands/npm-ci/)

## 构建与预览

| 命令                                      | 用途                                         |
| ----------------------------------------- | -------------------------------------------- |
| `npm run dev`                             | 开发模式，带热更新                           |
| `npm run build`                           | 完整生产构建，输出到 `out/`，不启动应用      |
| `npm run preview`                         | 准备生产构建并启动应用；复用未变化的构建目标 |
| `npm run preview -- --build-only`         | 按 Preview 的缓存规则准备构建，不启动应用    |
| `npm run preview -- --force --build-only` | 强制刷新 Preview 构建，不启动应用            |
| `npm run design:dev`                      | 启动组件设计工作台                           |

修改 `electron.vite.config.ts` 后完整重启开发进程。结束开发或预览时使用应用的“退出”，让编辑保存和数据库清理完成。

### Preview 与安装版的边界

`npm run preview` 使用当前工作树的生产构建，通过开发 Electron 启动；它没有热更新，也不具有正式安装包的全部行为。默认启动会固定本次 renderer 与 preload，后续源码改动需要再次启动 Preview 才会进入该实例。生产构建不能代替文件关联、安装资源、商店升级或迁移的发行验收。

Preview 不自动使用临时数据。未指定 `AIY_USER_DATA_DIR` 时，Dev、Preview 和非商店安装版都按非商店规则使用应用数据目录下的 `AIY`；商店版使用 `AIY-Store`。它们也可能因所选空间不同而显示不同内容。指定独立应用数据目录后，仍需确认所选空间是隔离副本，不能把另一个配置目录当作原数据已经复制。

目前打包配置与 MSIX manifest 声明的是 `aiy://` 协议，启动参数处理也只消费该协议；没有接通 `.md`／`.markdown` 文件关联与系统文件打开链路。已有 Markdown 收集导入不等于文件默认打开或原文件编辑。开发脚本中的 deep-link 注册只服务协议，不为 Preview 注册 Markdown 默认打开方式。

组件、页面状态和实验设计的组织与迁移见 [Design Lab](design-lab.md)。使用 `npm run design:storybook` 查看正式编辑工作面、大纲、内容条目、搜索、来源预览和基础控件；相关包只作为开发依赖，Cosmos 已移除。私有组件测试直接复用 stories。既有 `design:dev` 在完整媒体和旧实验迁移期间保留原入口。

## 浏览器伴侣

桌面端和浏览器伴侣分别启动。在桌面应用根目录打开另一个终端；首次使用伴侣时先安装其依赖：

```sh
npm run install:browser
```

后续开发直接启动：

```sh
npm run dev:browser
```

WXT 默认使用 `127.0.0.1:3017`，端口被占用时以终端输出为准。桌面端仍通过 `npm run dev` 单独启动。

开发扩展在构建完成后使用本地脚本和弹窗资源。`dev:browser` 只负责重建与热更新；停止服务或热更新连接中断后，已安装的开发扩展仍可上传和查看交接状态。桌面端交接服务仍须运行，目标网站也须可访问。首次采用这项改动时，需要重新构建并重新加载浏览器中原有的开发扩展。

桌面请求由伴侣后台通过扩展的本机访问权限发出，不依赖微博等网站的本机网络权限。后台只转发固定交接接口，核对页面与目标；图片按确认后的分块传输，签名与完整性校验保持不变。采用这项传输改动时，桌面端也须运行更新后的构建；仅重载扩展不足以更新桌面接口。

| 用途                 | 路径或命令                                  |
| -------------------- | ------------------------------------------- |
| 浏览器加载的开发扩展 | `browser-companion/.output/chrome-mv3-dev/` |
| 生产扩展输出         | `browser-companion/.output/chrome-mv3/`     |
| 类型检查             | `npm run typecheck:browser`                 |
| 生产构建             | `npm run build:browser`                     |

开发 Profile 应加载开发目录，生产目录不能替代正在运行的开发扩展。伴侣是独立产物，不包含在桌面 MSIX 中。

## 代码检查

按改动选择检查，发行时使用完整检查：

| 命令                                     | 检查内容                                                     |
| ---------------------------------------- | ------------------------------------------------------------ |
| `npm run verify:touched`                 | 已暂存、未暂存及未跟踪文件的格式和 lint                      |
| `npm run verify:touched -- --base <ref>` | 同时检查相对指定 Git 引用的已提交改动                        |
| `npm run typecheck`                      | TypeScript 类型                                              |
| `npm run test:smoke`                     | 通用启动与存储 smoke                                         |
| `npm run verify`                         | 定价目录结构、格式、lint、类型、smoke 边界、smoke 和生产构建 |

文档改动检查内容、命令、链接和差异。行为改动按风险运行对应的单元、组件或集成检查；通用 smoke 不代表完整功能验收。构建成功也不代表安装、平台交接或实际发布已经通过。

## 代码与资源位置

| 目录                            | 职责                                  |
| ------------------------------- | ------------------------------------- |
| `src/main/`                     | Electron 主进程、存储、任务与系统集成 |
| `src/preload/`                  | renderer 与主进程之间的受限桥接       |
| `src/renderer/`                 | React 界面、组件、样式与语言资源      |
| `src/shared/`                   | 跨进程契约、校验与共享规则            |
| `extensions/`、`content-packs/` | 随应用提供的扩展与内容包              |
| `browser-companion/`            | 浏览器扩展                            |
| `scripts/`、`native/`           | 构建工具与原生辅助程序                |

界面文案通过 `useI18n().messages` 获取；同时维护英文 `src/renderer/i18n/locales/en.ts` 和中文 `extensions/com.aiy.language.zh-cn/messages.json`。界面复用现有 shadcn 组件和 Tailwind 工具类，文件处理采用异步 I/O。

## 日志与排障

- 开发日志：`dev-logs/desktop-dev-current.log`。
- 预览日志：`dev-logs/desktop-preview-current.log`。
- renderer 诊断：应用用户数据目录下的 `diagnostics/renderer/renderer-current.jsonl`。

使用 `AIY_USER_DATA_DIR` 可以指定独立的应用数据目录。排查迁移、导入或恢复时使用数据副本，不直接修改唯一的用户数据库。报告问题时提供源码提交、运行命令及脱敏日志。

[文档首页](index.md) · [打包](packaging.md) · [发布](release.md)
