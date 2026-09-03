# 扩展权限模型

扩展权限约束宿主可以代扩展访问的资源和产生的外部副作用。贡献点只说明扩展提供什么，不产生授权；启用状态也不产生授权。

## 产品边界

| 层级         | 自维护内容                                                                                                            | 边界                                                                                       |
| ------------ | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 应用主干     | 本地空间与资料库、内容模型和不可变修订、编辑会话、任务生命周期、凭据保险库、扩展安装与授权、输入/响应校验、审计与恢复 | 不因任何渠道或模型扩展被禁用而失去本地编辑、保存和导出能力                                 |
| 能力扩展     | 模型 Provider、外部搜索、导入器、投递渠道、平台专用配置和工作流贡献                                                   | 只描述平台差异；通过宿主 broker 使用数据和产生副作用，不能直接访问主进程、数据库或凭据原文 |
| 浏览器适配器 | 目标网站识别、页面结构适配、把一次性交接填入草稿                                                                      | 不是授权中心，不读取资料库，不持有发布权限，不替用户触发最终提交                           |

以下能力不能插件化给不受信任代码：资料库事务与迁移、编辑器实时文档所有权、密钥解密、权限判定、任意 IPC/文件/进程访问、更新与签名策略、交接记录的真实性校验。它们可以由扩展触发，但实现和裁决必须留在主干。

判断一个功能是否适合插件化时，依次检查：

1. 是否绑定某个外部平台、模型或易变化的协议；如果是，优先作为扩展贡献。
2. 禁用后是否仍能安全打开、编辑和保存本地内容；如果不能，它属于主干。
3. 是否可以用精确资源、精确 origin 和一次操作范围表达；如果不能，暂不开放。
4. 是否包含发布、删除、付费或覆盖等高影响动作；如果包含，持久权限之外还必须逐次确认。

当前 `CAPABILITY` 包只绑定宿主白名单中的 `HOST` runtime，不执行包内 JavaScript。这让功能可以独立声明、版本化、启停和授权，同时把可执行代码继续置于应用维护的安全域内。

## 三层授权

每次敏感操作必须同时满足三层约束：

1. **声明能力**：manifest 声明该扩展可能使用的权限上限。
2. **持久授权**：宿主保存用户对固定资源范围的授权；撤销后立即阻止新操作。
3. **操作范围**：调用捕获不可变的内容修订、资源 ID、目标、内容哈希、请求 ID 和有效期。持久授权不能替代本次操作范围。

扩展只能收到宿主为当前调用组装的数据。它不能以持久权限为由枚举资料库、读取实时编辑器、解析任意路径或复用其他调用的资源。

## 权限类型

| 类型            | 示例                                    | 授权方式                                     |
| --------------- | --------------------------------------- | -------------------------------------------- |
| 固定资源        | `filesystem.read:codex-session-usage`   | 启用前持久授权                               |
| 固定网络 origin | `network:https://api.example.com`       | 持久授权；只匹配精确 origin                  |
| 凭据使用        | `credentials.use:openai-api-key`        | 持久授权；宿主代为使用，不返回原始值         |
| 选中资源        | `library.read:selected-references`      | 持久能力加本次调用中的资产 ID                |
| 语义写入        | `library.create:creations`              | 只允许创建，不包含更新或删除                 |
| 本地集成        | `integration.connect:codex-app-server`  | 只连接宿主实现的固定协议                     |
| 固定进程        | `process.execute:antigravity-cli`       | 只运行宿主解析的可执行文件和参数协议         |
| 浏览器交接      | `browser.handoff:weibo`                 | 持久能力加一次性交接包                       |
| 运行时网络范围  | `network:https://workspace.example.com` | 用户保存具体端点时产生；更换端点后撤销旧范围 |

插件私有存储在宿主分配的目录或数据库中，并受配额限制，不需要资料库权限。用户通过宿主文件选择器选定的单次导出位置，以及用户主动要求打开的宿主已验证文件，属于操作范围，不写入 manifest。

## 当前场景所需权限

| 扩展场景                   | 必需权限                                                                                                                         | 可选或运行时权限                                                             |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 语言包、过场预览、功能演示 | 无                                                                                                                               | 无                                                                           |
| Codex App Server           | `integration.connect:codex-app-server`、`codex.manage:extension-owned-threads`、`library.read:selected-references`               | 无；线程权限只覆盖扩展自己绑定的线程                                         |
| Antigravity CLI            | `process.execute:antigravity-cli`、`library.read:selected-references`                                                            | 无；可执行文件和参数由宿主固定                                               |
| OpenAI 图像 API            | `network:https://api.openai.com`、`credentials.use:openai-api-key`、`library.read:selected-references`                           | 无                                                                           |
| DeepSeek API               | `network:https://api.deepseek.com`、`credentials.use:deepseek-api-key`                                                           | `library.read:selected-references`；自定义视觉端点由模板产生精确 origin      |
| Google Gemini API          | `network:https://generativelanguage.googleapis.com`、`credentials.use:google-gemini-api-key`、`library.read:selected-references` | 自定义 HTTPS 端点模板                                                        |
| 阿里云百炼图像 API         | `credentials.use:alibaba-model-studio-api-key`、`library.read:selected-references`                                               | 根据 workspace 与地域生成精确 HTTPS origin，不使用宽泛的 `aliyuncs.com` 权限 |
| 火山引擎方舟 / BytePlus    | `network:https://ark.cn-beijing.volces.com`、`credentials.use:volcengine-ark-api-key`、`library.read:selected-references`        | 两个声明的 BytePlus 地域 origin，或自定义 HTTPS 端点模板                     |
| Codex 图片发现             | `filesystem.read:codex-generated-images`、`library.create:creations`                                                             | 无                                                                           |
| Codex 聊天记录搜索         | `filesystem.read:codex-session-metadata`、`filesystem.read:codex-thread-content`                                                 | 无；索引仅写入扩展私有存储，撤销任一必需权限时清空                           |
| Codex 可视化发现           | `filesystem.read:codex-visualizations`、`filesystem.read:codex-session-metadata`                                                 | `filesystem.read:codex-thread-content`；打开和用户选择的导出位置属于操作范围 |
| Codex 用量分析             | `filesystem.read:codex-session-usage`                                                                                            | `account.read:codex-rate-limits`；用户选择的导出位置属于操作范围             |
| 微博浏览器交接             | `browser.handoff:weibo`                                                                                                          | 一次性交接包；没有资料库枚举、Cookie、Session 或最终发布权限                 |

## 声明规则

- `permissions` 是扩展工作所必需的固定能力；缺少任意一项时扩展不可激活。
- `optionalPermissions` 是独立功能或运行时权限模板。模板本身永不被授予。
- 本地和市场能力扩展首次发现时默认禁用，所有权限默认拒绝。纯数据 `LANGUAGE` 包按语言包规则启用且没有 runtime 能力。应用随包分发的受信任扩展可以获得初始必需授权。
- 更新增加的新权限默认拒绝。只有明确记录为更窄语义的旧权限可以迁移到新权限。
- manifest 权限必须存在于宿主权限目录中。未知命名空间、未知固定范围和运行时模板出现在必需权限中都会使 manifest 失效。

## 动态网络端点

`network:user-configured-https-endpoint` 和 `network:user-configured-deepseek-vision-endpoint` 是声明模板，不是实际网络权限。

用户保存端点时，宿主必须：

1. 验证完整 URL；拒绝用户名、密码、query 和 fragment。
2. 规范化成精确 origin，例如 `network:https://gateway.example.com`。
3. 在首次网络请求前记录该 origin 的运行时授权。
4. 保存流程异常退出时撤销本次新建的授权；配置已持久化但服务暂时不可达时保留用户刚选择的 origin。
5. 配置切换或删除后撤销不再使用的运行时 origin。

通用模板只接受 HTTPS。DeepSeek 视觉模板还允许 HTTP loopback，但不允许局域网或其他明文地址。

## 微博渠道

桌面扩展只声明：

```json
{
  "contributes": {
    "deliveryChannels": ["weibo"],
    "workflows": ["delivery.weibo.fillDraft"]
  },
  "permissions": ["browser.handoff:weibo"]
}
```

宿主负责保存社交贴图、捕获不可变修订、解析资产 ID、验证媒体、按交接目标解析已配置的浏览器 Profile、创建交接记录和登记结果。渠道扩展没有资料库、文件系统、网络、Cookie 或凭据权限。

创作界面的投递目标来自当前有效的 `deliveryChannels` 贡献；扩展被禁用或权限被撤销后，微博目标从界面移除，主进程的交接 broker 仍会再次拒绝绕过界面的调用。

`aiy-agent action send-weibo` 是独立的显式操作入口：只有随应用分发的微博扩展清单通过固定 host-runtime 契约校验时才会被公布和接受；该命令本身只授权所给已完成任务的不可变输出，不产生可复用的持久授权。

浏览器扩展只接收目标为 `weibo` 的一次性交接。浏览器端受 HMAC 认证的固定回环连接和精确微博 host permission 不替代桌面端的 `browser.handoff:weibo`。当前能力只填入草稿；最终发布必须由用户操作。未来若增加实际发布，必须使用独立的 `platform.publish:weibo` 高风险能力，并对每篇内容重新确认。

## 禁止的权限

当前宿主不接受以下能力：

- 任意 SQLite、主进程 IPC、Electron 或 Node API；
- 任意文件系统根目录、任意命令或 Shell 参数；
- 原始密钥读取、浏览器 Cookie 或登录 Session 导出；
- `<all_urls>`、除固定 `127.0.0.1:47831` 伴侣服务外的任意 HTTP 网络，或未规范化的自定义端点；
- 由持久授权触发的静默发布、删除或覆盖；
- 从远端下载并执行扩展代码。

## 安全检查

安全性不是一次“扫描通过”的结论，而是安装、激活和每次执行都重新成立的一组约束：

1. **包检查**：限制 manifest 和 catalog 字节数，按严格 schema 解析，拒绝多余字段、未知权限和不兼容 engine。能力包的 runtime ID、扩展 ID、贡献点、必需权限和可选权限必须与宿主契约完全一致。
2. **来源与默认状态**：记录来源、版本、manifest 哈希和状态事件。本地与市场能力默认禁用、默认拒绝；更新增加的新权限不会静默继承，只有显式登记的旧权限窄化别名可以迁移。
3. **激活检查**：扩展必须已启用、版本兼容且全部必需权限已授予。设置页可见或 manifest 声明存在都不代表 runtime 可执行。
4. **执行检查**：敏感调用在实际 broker 处再次检查扩展和权限，并只使用调用捕获的不可变 ID、修订和资源集合。后台 runtime 只在扩展已激活时接受和保留凭据配置；禁用或撤销必需权限会清除该配置。跨进程数据保持为 `unknown`，通过运行时 schema 后才消费。
5. **资源检查**：网络只匹配精确 origin；文件、媒体和远端响应受签名、MIME、尺寸、字节数、数量、超时与并发限制；用户选择的单次文件位置不会升级为目录权限。
6. **撤销与失败闭合**：撤销立即阻止新调用；动态网络授权在保存流程异常退出时回滚，配置更换或删除时撤销旧 origin。未知状态、格式错误和目标不一致均停止，而不是降级为更宽权限。
7. **浏览器复核**：浏览器伴侣只声明 ChatGPT、微信公众号、微博和固定 IPv4 回环服务的精确 host；Electron 主进程验证 HMAC、网页 Origin、时间窗、nonce、当前站点和交接目标。目标 URL 只携带随机交接 ID，连接密钥只经扩展自有页面的 fragment 导入并立即清除；媒体元数据经过认证，媒体本体按长度和 SHA-256 复核，适配器不寻找发布控件。

权限清单只能证明“最多允许什么”，不能证明实现没有缺陷。后续若开放第三方代码 runtime，还必须增加包签名、可复现构建或来源证明、隔离进程、稳定 ABI、资源配额、崩溃隔离与撤销后的进程终止；这些门禁完成前不接受第三方 JavaScript 能力包。

## 执行门禁

敏感路径必须在实际执行位置重新检查授权，不能只依赖设置页状态。网络、文件读取、资料库写入、浏览器交接和账号数据读取分别由对应宿主 broker 执行。输入与响应在进程边界按运行时 schema 校验，并应用字节数、数量、超时和并发上限。
