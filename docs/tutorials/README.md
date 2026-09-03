# 使用教程

这组教程面向第一次使用 AIY 的用户，也覆盖需要在 Windows 上验证 Store MSIX 候选版本的维护者。

建议按以下顺序阅读：

1. [安装与首次启动](01-install-and-first-launch.md)
2. [完成第一次生图](02-first-generation.md)
3. [导入与整理素材](03-import-and-organize.md)
4. [维护词典与词盘](04-dictionary-and-prompt-palettes.md)
5. [本地空间、备份与恢复](05-local-spaces-backup-and-recovery.md)

维护者再阅读 [Store MSIX 打包验收](06-store-msix-packaging-qa.md)、[在 Windows WSL2 部署 Qwen3-ASR](07-qwen3-asr-wsl-local-deployment.md) 和 [发布输入与安装包边界](../release/packaging-inputs.md)。

## 先知道三件事

- `0.3.0` 是当前首个正式发布 baseline。预发布数据库不会被应用自动迁移、接管或修复。
- 本地空间的数据库和受管媒体目录属于用户数据，不要把它们当作源码或内容包提交。
- 真实模型连接、失败/取消、重试和重启恢复仍需要人工验收；自动化测试不能替代供应商验收。
