# 01：安装与首次启动

## 使用已构建的应用

安装包用户不需要 Node.js。安装后直接启动应用即可；首次启动会建立 AIY 的用户数据目录。

如果系统提示应用未签名或无法验证开发者，这是本地未签名构建的预期现象。正式分发前需要由维护者完成 Apple Developer 签名、公证或 Windows 安装包签名。

## 从源码运行

开发环境需要 Node.js 22 或更新版本：

```bash
cd apps/desktop
npm ci
npm run dev
```

不要把 Windows 的 `node_modules/`、`out/` 或 `release/` 复制到 macOS。原生依赖必须在目标系统重新安装。

普通开发只需要补充目标检查：

```bash
npm run typecheck
npm test
```

## 首次启动选择

空的本地空间会显示开始入口。可以：

- 选择并导入图片或文本；
- 把导入内容直接作为一次新创作的输入；
- 导入内置入门内容包；
- 打开已经存在的本地空间。

入门内容包不是用户数据。需要空白空间时选择“保持空空间”，需要示例词条、词盘和示范创作时再导入。

“打开本地空间”只接受完整的运行时空间目录。内容包源目录、fixture 目录或只有部分文件的目录不能替代本地空间。

## 用户数据位置

默认根目录由 Electron 的应用数据目录和 `AIY` 组成：

| 系统    | 默认根目录                           |
| ------- | ------------------------------------ |
| Windows | `%APPDATA%/AIY/`                     |
| macOS   | `~/Library/Application Support/AIY/` |

目录通常包含：

```text
AIY/
├─ libraries/
│  ├─ index.json
│  └─ <library-id>/
│     ├─ library.json
│     ├─ library.sqlite3
│     ├─ objects/sha256/
│     └─ temp/
└─ extensions/
```

需要隔离测试空间时，可以设置 `AIY_USER_DATA_DIR`。设置后，注册表、连接配置、扩展和本地空间都会在该目录下生成。

已注册空间的 `library.sqlite3` 缺失时，应用会报告空间不可用并停止写入；不要通过手动创建空 SQLite 文件来“修复”它。
