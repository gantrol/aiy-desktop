# 06：Store MSIX 打包验收

这篇面向需要生成 Microsoft Store 候选包的维护者，不是普通用户的安装教程。普通分发只维护 Windows Desktop x64 Store MSIX；NSIS、便携 ZIP、DMG、macOS ZIP 和独立 unpacked 目录不在发行矩阵中。

## 构建环境

从干净的 Windows 10/11 x64 checkout 开始，不复用其他 checkout 或机器的依赖和构建输出：

```powershell
cd apps/desktop
node --version # 22 或更新版本
npm ci
```

机器还需要 Visual Studio 2022 或 Build Tools 的 MSVC x64 C++ 工具链。Store 组包工具由项目依赖提供；构建脚本会在开始时检查 manifest、Assets、原生更新 helper 工程、`electron-builder` 和 `winapp` 是否齐全。

## 普通提交包

```powershell
npm run package
```

`npm run make` 是完全相同的入口。两者先运行 Store 门禁，再构建 renderer、preload、main 和原生更新 helper，最后生成未签名的 Partner Center 提交包。

如果当前最终提交上的门禁已经通过，只需重复组包，可以运行：

```powershell
npm run make:store
```

提交目录为 `release/store-msix-<app-version>/submission/`，至少包含：

- `AIY-<app-version>-store-x64.msix`；
- `SHA256SUMS.txt`；
- `build-metadata.json`；
- 从成品包提取的 `AppxManifest.xml` 和 `AppxBlockMap.xml`。

提交包必须保持未签名，由 Microsoft 在认证后签名。不要把本地证书、开发身份或旧安装器产物混入该目录。

## 本地侧载包

```powershell
npm run make:store:local
```

该命令在 `release/store-msix-<app-version>/local-test/` 生成带短期本地测试签名的 MSIX、PFX 和 CER。它只用于侧载验收：信任 CER 后安装，验收结束后移除信任；PFX、密码和 local-test MSIX 不得提交、上传或进入源码。

## 产物门禁

脚本会在保留产物前自动解包并检查：

- Store identity、publisher、Windows Desktop x64 架构和四段 Store 版本；
- `package.json` 的三段应用版本与 manifest Store 版本映射；
- `creation-starter` 是唯一随包内容包，且不包含生产人像内容；
- 原生 Store 更新 helper 存在，并声明受支持的协议版本；
- submission 包没有签名，local-test 包具有签名；
- MSIX 的 SHA-256、源提交和工作区 dirty 状态写入构建元数据。

Electron Builder 生成的 `win-unpacked` 仅是组包暂存输入，成功后会删除，不得作为安装包或便携版发布。

## 发布验收

上传前核对成品 manifest 和 `build-metadata.json`，确认版本、身份、架构、签名模式、摘要和源提交属于同一候选。随后按 Microsoft Store 当前要求完成包分析、Windows App Certification Kit、Partner Center 上传验证和 Store 安装后的发布 smoke；这些证据保存在发行记录中，不写入源码仓库。
