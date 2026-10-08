# 发布

[![简体中文](assets/zh-cn.svg)](release.md) [![English](assets/en.svg)](release.en.md)

本页说明源码版本、Git 标签与 Windows Store 提交。产物生成见[打包](packaging.md)，日常环境准备见[开发](development.md)。命令在桌面应用仓库根目录执行。

## 发布顺序

1. 确定版本和变更范围，准备面向用户的中英文更新说明。
2. 审核待发布文件及相对上一公开版本的完整差异，形成最终提交。
3. 在该提交上完成适用检查、组包和验收，核对版本、源码提交与产物哈希。
4. 发布已审核的源码提交和版本标签；按交付渠道提交相应产物。
5. 分别确认源码可见、商店提交、认证和上架状态。

源码、依赖、manifest 或构建输入变化后，重新评估受影响的检查并重新组包，不能沿用旧包的结果。重试同一候选不重复增加版本号。

## 版本清单

| 项目             | 位置与规则                                                                                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 应用版本         | [package.json](../package.json) 与 [package-lock.json](../package-lock.json) 顶层、根 package 版本保持一致                                                                     |
| Store 版本       | [Package.appxmanifest](../build/msix/Package.appxmanifest) 使用 `(主版本 + 1).次版本.修订版本.0`，与组包脚本计算结果一致                                                       |
| 语言扩展         | [内置英文 manifest](../src/main/extensions/builtin-manifests.ts) 与 [简体中文 manifest](../extensions/com.aiy.language.zh-cn/manifest.json) 对齐本次应用版本                   |
| 其他扩展、内容包 | 按本次实际变化调整各自 manifest；没有变化的不机械升级                                                                                                                          |
| 扩展 Host API    | [product.ts](../src/shared/product.ts) 的 `EXTENSION_HOST_VERSION` 只随兼容契约变化调整                                                                                        |
| 数据库           | [schema.ts](../src/main/database/core/schema.ts) 的 revision 和 [SQL 列表](../src/main/database/sql/)；已发布迁移保持不变，新增迁移兼容已有数据                                |
| 浏览器伴侣       | 独立核对 [package.json](../browser-companion/package.json)、[lockfile](../browser-companion/package-lock.json) 和 [wxt.config.ts](../browser-companion/wxt.config.ts) 中的版本 |

每次发行中，各 manifest、插件和数据库 revision 最多推进一次。缓存版本只在对应存储格式或读取语义变化时调整。应用补丁版本变化不代表 Host API、全部插件和数据库都需要升级。

## 源码快照

公开发布提交只包含经明确允许清单审核的文件，以发布前最新的 `origin/main` 为唯一父提交。不把其他开发历史通过 merge、squash merge 或 cherry-pick 导入公开线。

检查最终差异中的源代码、锁文件、资源、许可证和文档。移除不属于交付范围的日志、数据库、凭据、证书私钥、临时输出和机器专属配置。历史归档目录不自动纳入发行清单。

许可与源码交付遵守[软件许可与插件例外](licensing.md)：携带 `LICENSE`、`LICENSE-PLUGIN-EXCEPTION` 及第三方声明，提供与实际产物匹配的对应源码及必要构建脚本，并在下载入口标明源码取得方式。独立插件可按自己的许可分发；宿主修改仍须履行 AGPL 义务。

在任何提交或推送前核对实际仓库、分支、upstream 和远程地址：

```sh
git status --short --branch
git branch -vv
git remote -v
git remote get-url --push origin
```

`origin` 应指向公开仓库 `https://github.com/gantrol/aiy-desktop.git` 或同一仓库的 SSH 地址。确认目标后刷新公开基准，并检查候选（将 `<发布提交>` 替换为审核过的完整提交 ID）：

```sh
git fetch --no-tags origin main
git rev-parse origin/main
git rev-list --parents -n 1 <发布提交>
git rev-list --count origin/main..<发布提交>
git diff --stat origin/main <发布提交>
git diff --check origin/main <发布提交>
git diff origin/main <发布提交>
```

候选必须只有一个父提交，且父提交等于刚获取的 `origin/main`；提交数必须为 `1`。若公开基准前进，重新准备快照并审核，不能强制覆盖。已公开的 hotfix 和外部贡献必须保留在后续版本中。

## 标签与源码交付

版本标签使用 `v<应用版本>`，必须指向与产物 `sourceCommit` 相同的最终提交。标签已存在时核对其目标，不移动已经公开的发行标签。

确认发布条件后，创建注释标签并显式推送两个引用。以下占位符必须替换为已审核的值：

```sh
git tag -a v<应用版本> <发布提交> -m "AIY <应用版本>"
git push --atomic --no-follow-tags origin <发布提交>:refs/heads/main refs/tags/v<应用版本>:refs/tags/v<应用版本>
git ls-remote origin refs/heads/main refs/tags/v<应用版本> "refs/tags/v<应用版本>^{}"
```

推送后核对远端 `main` 和注释标签解析后的提交均为发布提交。禁止裸 `git push`、`--all`、`--mirror` 或顺带推送无关标签。默认不上传候选分支、不创建公开 Draft PR。

GitHub Release 的说明只描述本版可见变化、兼容性、安装条件和已知问题。附件逐个选择需要分发的文件，不上传整个构建目录。

## Windows Store 提交

1. 按[打包文档](packaging.md#输出与核对)核对 `submission/` 中 MSIX 和元数据；确认 `sourceDirty: false`、`signedForLocalTest: false`。
2. 在 Partner Center 中选择与 manifest 身份、Publisher 一致的产品，上传未签名 MSIX。不要上传 `local-test/` 包或 `.pfx`。
3. 核对解析出的版本、架构和设备要求，并更新本次需要调整的商店说明、截图、隐私链接和支持信息。
4. 完成提交并记录提交 ID；等待认证结果，再单独确认实际上架状态。Microsoft Store 的上传、认证和发布是不同阶段。[发布流程](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/publish-first-app)

浏览器伴侣单独构建、验收和交付，不能以桌面 MSIX 发布代替。macOS 产物按其签名、公证和平台验收结果单独判断。

## 发布记录

| 状态       | 记录内容                                     |
| ---------- | -------------------------------------------- |
| 源码已发布 | 应用版本、最终提交、标签和可访问的版本链接   |
| 已打包     | 产物文件名、平台、架构、SHA-256 和构建元数据 |
| 已验收     | 实际执行的检查、平台场景、结果及未验证项     |
| 已提交商店 | 产品、提交 ID、提交时间                      |
| 已上架     | 认证结果、商店版本和可获取状态               |

保留最终 MSIX 及哈希，以便核对同一版本。线上问题优先通过下一次修复版本解决，不覆盖已发布标签或重新使用版本号替换不同内容的包。

[文档首页](index.md) · [开发](development.md) · [打包](packaging.md)
