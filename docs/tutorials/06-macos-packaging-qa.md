# 06：macOS 打包验收

这篇面向需要验证安装包的维护者，不是普通用户的安装教程。

## 准备干净 checkout

在 macOS 上从 Git checkout 开始，不复用 Windows 的依赖和构建输出：

```bash
cd apps/desktop
node --version # 22 或更新版本
npm ci
```

确认 `content-packs/creation-starter` 不是指向开发者机器外部目录的 junction 或软链接，并确认 starter 内容包及其图片都能从 checkout 得到。

## 验证顺序

```bash
npm run typecheck
npm test
npm run build
npm run make:mac
```

`make:mac` 会先执行项目的 `verify`，因此格式、lint、类型和 coverage 门禁都必须先收敛。`npm run build` 只验证生产 bundle，不等于安装包已经可分发。

当前脚本生成 DMG 和 ZIP，默认针对执行命令的 Mac 原生架构。需要 arm64、x64 或 universal 的额外产物时，应在发布配置中明确架构矩阵，不要把一次本机构建标成 universal。

## 安装包检查

安装包验收至少包括：

- DMG 和 ZIP 均能打开；
- 首次启动能创建空空间或导入 starter；
- 重启后空间、词条和素材仍可用；
- SQLite 原生模块加载的是 macOS 架构；
- 内容包、扩展和图标均能从安装包资源目录读取；
- 缺少数据库文件时不会静默创建替代空库；
- 退出时后台任务状态符合预期。

本地未签名构建可能触发 Gatekeeper 提示。正式分发的 Developer ID 签名、公证凭据和临时钥匙串配置不应进入仓库。
