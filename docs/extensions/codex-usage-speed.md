# Codex 用量调查的模型速度参考

“当前官方模型速度”按模型解析，表示 Fast 相对于 Standard 的模型速度标称。它与完成轮次耗时比、Fast 的 Credits 消耗倍率、API 价格倍率分别处理。

- 扫描、打开报告或导出时，异步读取 `$CODEX_HOME/models_cache.json`；未配置 `CODEX_HOME` 时使用用户目录下的 `.codex`。每次只读取一个有大小上限的模型目录，不启动 Codex、不联网、不重扫 rollout。
- 按规范化模型标识读取 `service_tiers` 中的 `fast` 或 `priority`。目前解析描述中的明确速度声明，例如 `2x speed`、`1.5× speed`、`2x faster`；仅有 `2.5x usage` 不算速度声明。
- 目录中出现模型但没有可识别的 Fast 速度声明、存在冲突倍率或格式变化时，显示“未知”。新增模型只要沿用该元数据格式，就能直接识别，无需添加模型白名单。
- 目录缺失、不可读或不含该模型时，优先保留报告中先前观察到的目录参考；否则使用按模型维护的内置参考。2026-09-11 的参考为 Astra 2×，GPT-5.6 Sol/Terra/Luna、GPT-5.5、GPT-5.4 为 1.5×；其他模型没有通用默认值。Astra 依据当日 Codex 模型目录，其余模型依据[官方速度文档](https://learn.chatgpt.com/docs/agent-configuration/speed)。

界面总览与各比较行使用对应模型的参考，悬停倍率可查看来源及日期。速度数据在读取统计缓存后单独补充；目录变化不触发会话统计重新计算。历史报告打开或导出时使用当前可获得的参考，完成轮次与实测耗时保持原有统计。因此该数值不是历史发生时的速度承诺；旧报告中全局写死的 `officialSpeedMultiplier` 仅为兼容读取而接受，随后丢弃。

JSON 导出 schemaVersion 为 13，各比较行的 `officialSpeed` 保存 `multiplier`、`source` 和 `asOf`。CSV 在对应比较行保存 `official_speed_multiplier`、`official_speed_source`、`official_speed_as_of`，汇总行不再输出统一倍率。`asOf` 为模型目录的抓取日期或内置参考核对日期，不表示速度调整的生效日期；未知倍率导出为 JSON `null` 或 CSV 空值。
