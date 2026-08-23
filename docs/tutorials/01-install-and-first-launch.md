# 01：安装与首次启动

## 使用已构建的应用

Microsoft Store 安装用户不需要 Node.js。安装后直接启动应用即可；首次启动会建立 Store 身份隔离的 AIY 用户数据目录。

正式包由 Microsoft Store 在认证后签名和分发。维护者通过 `make:store:local` 生成的本地测试 MSIX 使用临时证书，只能在明确信任导出的 CER 后侧载；不要把本地测试 PFX 或 MSIX 当作正式分发包。

## 从源码运行

开发环境需要 Node.js 22 或更新版本。Windows、macOS 和 Ubuntu x64 均可按下面的方式从源码启动；Linux 当前只用于源码试用，不提供安装包：

```bash
npm ci
npm run dev
```

Ubuntu 的源码开发进程会关闭 Chromium 进程沙箱，以兼容 npm 安装的 Electron 与 Ubuntu 24.04 的 AppArmor 用户命名空间限制；只应运行可信源码。该行为不改变正式打包应用的渲染进程沙箱配置。

不要复用其他 checkout 或机器生成的 `node_modules/`、`out/`、`release/`。原生依赖和发行 bundle 必须从当前源码重新安装、构建。

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

默认根目录由 Electron 的应用数据目录决定：

| 运行方式         | 逻辑目录                             |
| ---------------- | ------------------------------------ |
| Microsoft Store  | Store 应用数据中的 `AIY-Store/`      |
| Windows 源码开发 | `%APPDATA%/AIY/`                     |
| macOS 源码开发   | `~/Library/Application Support/AIY/` |
| Ubuntu 源码试用  | `~/.config/AIY/`                     |

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
