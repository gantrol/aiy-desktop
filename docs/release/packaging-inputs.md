# 发布输入与安装包边界

## 安装包实际输入

当前 `electron-builder.yml` 的安装包输入分为两层：

| 输入 | 作用 | 发布要求 |
| --- | --- | --- |
| `out/main/**` | Electron 主进程和后台 worker | 由当前源码重新构建，不提交构建产物 |
| `out/preload/**` | preload bridge | 由当前源码重新构建 |
| `out/renderer/**` | renderer bundle | 由当前源码重新构建 |
| `package.json` | 运行时元数据 | 与版本和入口一致 |
| `LICENSE`、`THIRD_PARTY_NOTICES.md` | 第一方授权和第三方许可索引 | 必须与当前发布版本一起分发；Windows 安装器展示 `LICENSE` |
| `extensions/` | 内置扩展 | 必须来自当前 checkout |
| `content-packs/` | 内置内容包 | JSON、manifest 和媒体引用必须完整可复现 |
| `configuration/` | 默认运行配置 | 只放可公开的默认配置，不放凭据 |
| `build/icon.png`、`build/icon.ico` | 应用图标 | 保留，不能依赖本机生成图标 |

文档、测试、e2e、bench、脚本、历史 release 和源代码不会作为额外运行时资源打入安装包。

## 不可接受的发布输入

- Windows junction、macOS symlink 或指向仓库外的内容目录；
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
4. creation starter 的 pack manifest 版本为 `0.1.0`；其中词典、词盘和 fixture 的内容 schema 与文件名使用当前 `0.3.0` 口径；
5. Windows 与 macOS 的 `npm run build` 都读取同一套资源；Linux 不在当前构建与验收范围内。

资源未满足这些条件时，应暂缓可分发构建，而不是在打包机上临时复制外部目录。

当前状态（2026-08-07）：creation starter 已是普通目录，5 个 JSON 与 4 张 WebP 均在 Git 提交树内；fixture 的媒体引用、hash、MIME、尺寸和字节数均与实际 WebP 一致，并已从提交归档复验。Windows x64 未打包目录已成功生成并复核许可文件；首发只生成未签名的 Windows NSIS／ZIP，附带 SHA-256 与 SmartScreen 提示。macOS 不属于本次公开发布范围。

## 建议验收命令

```bash
git status --short
git diff --check
npm ci
npm run typecheck
npm test
npm run build
npm run make:mac
```

`release/` 是构建输出，不应作为源码输入或提交内容。安装包生成后，另行保存产物校验和；签名和公证日志也不写入仓库。
