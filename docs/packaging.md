# 打包

[![简体中文](assets/zh-cn.svg)](packaging.md) [![English](assets/en.svg)](packaging.en.md)

桌面应用的 Windows 发行产物是 x64 Store MSIX。以下命令在包含 [package.json](../package.json) 的应用根目录执行。

## Windows 构建环境

- Windows 10/11 x64，Git、Node.js 和 npm，依赖按[开发文档](development.md)准备。
- Visual Studio 或 Build Tools，安装 MSVC v143 C++ 工具集和 Windows SDK。原生更新辅助程序使用 `Release|x64` 构建。
- 锁文件指定的 Electron、electron-builder 和 `@microsoft/winappcli`。Windows 组包需要安装 optional dependencies 中的 winapp CLI。

构建配置位于 [electron-builder.yml](../electron-builder.yml)、[MSIX manifest](../build/msix/Package.appxmanifest) 和 [组包脚本](../scripts/build-store-msix.ps1)。应用支持的最低 Windows 版本以 manifest 为准。

## 打包前

1. 按[发布文档](release.md)核对版本、源文件和本次交付范围。版本只调整一次，失败重试不再递增。
2. 确认依赖完整。已有且兼容的依赖直接复用；打包本身不要求执行 `npm ci`。
3. 同一目录只运行一个组包任务。检查目标输出目录，保留仍需使用的旧产物：脚本会覆盖同版本、同模式的输出目录。
4. 正式发行使用干净、已提交的源码。开发工作区也能组包，但必须保留 `sourceDirty` 的真实记录，不能据此认定已具备发行条件。

## Windows 命令

| 命令                       | 用途                                          |
| -------------------------- | --------------------------------------------- |
| `npm run package`          | 完整检查、生产构建、生成未签名 Store 提交包   |
| `npm run make`             | 与 `package` 相同                             |
| `npm run verify:store`     | 单独执行完整检查，包含一次生产构建            |
| `npm run make:store`       | 准备 Electron、生产构建并组包；不重复完整检查 |
| `npm run make:store:local` | 生成带本地测试签名的 MSIX；不执行完整检查     |

通常直接运行：

```sh
npm run package
```

如果同一源码、依赖和环境已经通过完整检查，运行 `npm run make:store`。不要先运行 `verify:store` 再运行 `package`，以免重复检查。当前完整流程的检查阶段和组包阶段都会构建；`make:store` 仍会重新生成生产输出。

`build:unpacked` 只生成临时应用目录；正式 Windows 交付使用 MSIX。

## 输出与核对

未签名提交包位于：

```text
release/store-msix-<应用版本>/submission/
  AIY-<应用版本>-store-x64.msix
  build-metadata.json
  SHA256SUMS.txt
  AppxManifest.xml
  AppxBlockMap.xml
```

组包脚本会核对源 manifest 和包内 manifest 的身份、版本、架构与协议，验证更新辅助程序、资源载荷及签名状态，并生成 SHA-256。脚本记录脏工作区，但不会因 `sourceDirty: true` 自动拒绝输出。

交付前核对：

| 项目                         | 正式提交包要求                                                        |
| ---------------------------- | --------------------------------------------------------------------- |
| `appVersion`、`storeVersion` | 与源码和 manifest 一致；Store 版本为 `(主版本 + 1).次版本.修订版本.0` |
| `sourceCommit`               | 本次审核、检查和打包对应的最终提交                                    |
| `sourceDirty`                | `false`                                                               |
| `architecture`               | `x64`                                                                 |
| `signedForLocalTest`         | `false`                                                               |
| `artifact`、`sha256`         | 与实际 MSIX 文件名和独立计算的哈希一致                                |

用 PowerShell 独立计算哈希，和 `build-metadata.json`、`SHA256SUMS.txt` 比较：

```powershell
$appVersion = (Get-Content -Raw -LiteralPath package.json | ConvertFrom-Json).version
$packageDir = Join-Path "release/store-msix-$appVersion" 'submission'
$metadata = Get-Content -Raw -LiteralPath (Join-Path $packageDir 'build-metadata.json') | ConvertFrom-Json
Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $packageDir $metadata.artifact)
Get-Content -LiteralPath (Join-Path $packageDir 'SHA256SUMS.txt')
$metadata
```

哈希核对不替代功能验收。安装、上一个稳定版本升级、数据保存与恢复、系统协议交接以及 Windows App Certification Kit 的结果应分别记录；尚未执行的项目明确标为未验证。[WACK 说明](https://learn.microsoft.com/en-us/windows/uwp/debug-test-perf/windows-app-certification-kit)

## 本地验证包

```sh
npm run make:store:local
```

输出位于 `release/store-msix-<应用版本>/local-test/`，MSIX 文件名包含 `-local-test`。该目录还可能包含本地证书文件；私钥 `.pfx` 不作为交付附件。

本地签名包只用于隔离环境验证，不上传到 Store。提交 Store 使用 `submission/` 中的未签名 MSIX；商店认证后由 Microsoft 签名。[Store 包要求](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/app-package-requirements)

## macOS 本地构建

在 macOS 上安装 Xcode Command Line Tools，按开发文档准备依赖，然后运行：

```sh
npm run make:mac
```

配置位于 [electron-builder.mac.cjs](../electron-builder.mac.cjs)，输出到 `release/macos/`，为当前机器架构生成 DMG。arm64 与 x64 分别构建和验证。当前配置使用 ad-hoc 签名且不做公证，构建完成不能视为已满足 macOS 正式分发要求。

## 常见问题

| 问题                        | 处理                                                              |
| --------------------------- | ----------------------------------------------------------------- |
| 依赖安装报 `EPERM`          | 查看[依赖管理](development.md#已有环境)，先处理文件占用和中断安装 |
| 找不到 MSBuild、v143 或 SDK | 补齐 Windows C++ 构建组件，再重试组包                             |
| manifest 版本不一致         | 修正版本映射，保持 Store 身份和 Publisher 与产品登记一致          |
| 检查或载荷验证失败          | 修复报告中的具体问题，不跳过校验交付                              |
| 需要重新获取同一产物        | 先核对已有包的来源和哈希；未变化时直接复用                        |

[文档首页](index.md) · [开发](development.md) · [发布](release.md)
