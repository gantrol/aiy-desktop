# 发布输入与安装包边界

## 源码快照门禁

本地发行验收可以从已审核、已提交且工作树干净的最终候选构建安装包。对外分发或提交商店前，该包对应的同一提交必须已经进入公开 `main`，或由指向该公开提交的版本标签标识。候选整理过程和未提交工作区不是可复现输入；最终提交变化后必须重新构建和验证。

在开始构建前确认：

1. 当前提交直接属于预期的公开发行线，工作树和暂存区为空；
2. 相对上一公开版本的完整文件列表和最终 diff 已完成公开性、许可证、素材权利和凭据审核；
3. 应用版本、数据库 revision、扩展 manifest、内容包和更新元数据彼此一致；
4. 公开 smoke、类型检查、lint 和生产构建在同一最终提交上通过；
5. 构建记录只引用公开提交、版本标签、构建环境和产物摘要，不写入非公开来源或维护过程。

Git 发布约定见[Git 协作与发布约定](../git-workflow.md)。本文件中的 `release/` 始终指构建输出目录，不表示 Git 分支。

## Store MSIX 实际输入

普通构建只生成 Windows Desktop x64 的 Store MSIX。`electron-builder.yml` 仅生成临时 Windows 目录，`scripts/build-store-msix.ps1` 再把该目录、Store manifest、磁贴资源和原生更新 helper 组装为 MSIX；临时目录不是分发产物。

| 输入 | 作用 | 发布要求 |
| --- | --- | --- |
| `out/main/**` | Electron 主进程和后台 worker | 由当前源码重新构建，不提交构建产物 |
| `out/preload/**` | preload bridge | 由当前源码重新构建 |
| `out/renderer/**` | renderer bundle | 由当前源码重新构建 |
| `package.json` | 运行时元数据 | 与版本和入口一致 |
| `node_modules/better-sqlite3/lib/**`、`prebuilds/win32-x64.node` | SQLite 运行时驱动 | 只保留 Windows x64 loader 和预构建二进制；其余纯 JavaScript 依赖进入构建产物，不复制依赖源码树 |
| `extensions/` | 内置扩展 | 必须来自当前 checkout |
| `content-packs/` | 内置内容包 | JSON、manifest 和媒体引用必须完整可复现 |
| `configuration/` | 默认运行配置 | 只放可公开的默认配置，不放凭据 |
| `build/icon.png`、`build/icon.ico` | 应用图标 | 保留，不能依赖本机生成图标 |
| `build/msix/Package.appxmanifest` | Store 身份、版本、架构与 capability | 必须与 Partner Center 身份及 `package.json` 版本映射一致 |
| `build/msix/Assets/` | MSIX 应用磁贴和 Store logo | 必须来自当前 checkout，尺寸和引用完整 |
| `native/store-update-helper/` | Store 更新桥接 helper 源码 | 必须由当前 checkout 使用 Release x64 重新编译 |
| `scripts/build-store-msix.ps1` | 组包、解包复验、摘要和元数据生成 | 必须保留 fail-closed 的身份、内容、签名和协议检查 |

文档、测试、e2e、bench、脚本、历史 release 和源代码不会作为额外运行时资源打入安装包。

## 安装包资源优化约束

- Windows Electron 语言资源仅保留 `en-US`、`zh-CN`，配置位于 `electron-builder.yml` 的 `win.electronLanguages`。保留共享 ICU 数据；应用翻译 catalog 不替代 Electron `.pak`。增加语言时按[语言扩展提醒](../extensions/language-extensions.md#electron-语言资源与新增语言提醒)同步维护契约、配置和打包检查。
- 演示媒体由 Vite 引用进入 `app.asar`；`extraResources` 对 `com.aiy.feature-demo/assets/**` 保持排除，保留扩展 manifest。不得同时复制媒体源目录；延迟加载 JavaScript 不代表媒体已从安装包排除。
- 0.5.0 演示使用已验证的无损 WebP 派生文件；保留原始画幅、RGBA 和必要来源信息。`hand.png` 与三张 portrait PNG 保持原格式。转换方法见[运行时图片说明](../../extensions/com.aiy.feature-demo/assets/v050/README.md)。更换编码时同步更新消费者的 MIME、字节数和尺寸元数据；编码设置本身不能证明像素一致。
- `scripts/build-store-msix.ps1` 在成品 MSIX 解包后执行 `scripts/verify-store-payload.mjs`，拒绝多余或缺失的 Electron locale、丢失 ICU、重复演示资源、被替换后重新入包的 PNG 源图及缺失的运行时图片。此检查只读语言目录、固定文件元信息与有界 ASAR 索引，不扫描或解码媒体内容；无损与来源核对在替换资源时完成。
- 体积比较分别记录最终安装包大小、包内原始大小和压缩大小；拆分外部资源包后，主包、外部包和合计大小均需实测。不能用图片原始字节数直接推算安装包减幅。

检查失败时修正资源归属、导入或经过审阅的允许清单，不通过关闭检查、恢复完整语言目录或临时复制外部素材绕过。优化不改变下文的干净 checkout 与素材可复现要求。

## 不可接受的发布输入

- Windows junction、symlink 或其他指向仓库外的内容目录；
- 被 `.gitignore` 忽略但又被 manifest 引用的图片或视频；
- `v0.4` 或其他预发布编号的内容包文件；
- 本地用户数据库、`*.sqlite*`、媒体目录和临时目录；
- API key、连接配置、签名证书、`.p8`、`.p12`、`.provisionprofile`；
- `out/`、`release/`、coverage 和测试报告；
- 依赖当前开发机 PATH 的 Codex 可执行文件。

## 内容包复现门禁

在发布前必须从干净 checkout 检查：

1. `content-packs/creation-starter` 是普通仓库目录，不是外部 junction；
2. `manifest.json` 引用的每个 JSON 和媒体文件都能在 checkout 中找到；
3. starter 图片不会因为全局 `*.webp` 规则被忽略；
4. creation starter 的 pack manifest 版本为 `0.1.1`；其中词典、词盘和 fixture 的内容 schema 与文件名使用当前 `0.3.0` 口径；
5. Windows x64 的 `npm run build` 和 Store MSIX 脚本读取同一套已审核资源；其他平台安装包不在当前构建与验收范围内。

资源未满足这些条件时，应暂缓可分发构建，而不是在打包机上临时复制外部目录。

当前构建策略（2026-08-20）：`package`、`make` 与 `release:store` 都收敛到 Store 提交包；NSIS、便携 ZIP、DMG 和 macOS ZIP 已从普通脚本及 builder 目标移除。creation starter 仍是唯一允许随包进入的内容包，生产人像内容必须通过内容包导入器显式导入。

## 建议验收命令

```powershell
git status --short
git diff --check
npm ci
npm run package
```

`npm run make` 与 `npm run package` 等价，都会先执行 Store 门禁。门禁已经在当前最终提交通过、只需重复组包时可使用 `npm run make:store`；需要本机侧载时使用 `npm run make:store:local`，不得把其中的 PFX 或 local-test MSIX 提交到 Partner Center。

`release/` 是构建输出，不应作为源码输入或提交内容。脚本会在产物旁生成 `SHA256SUMS.txt`、`build-metadata.json`、打包后的 manifest 和 block map；发行证据另行保存，不写入仓库。
