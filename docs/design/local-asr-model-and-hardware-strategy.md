# 本地 ASR 模型与硬件分档方案

状态：设计决策记录
记录日期：2026-08-12
目标版本：0.3.2 及后续迭代

## 1. 目标与边界

本方案面向 Desktop 的本地音视频转录能力，目标是让应用在 Windows + WSL2 下根据 GPU 显存选择可运行的模型档位，并将所有 Provider 结果归一化为现有 `TIMED_TRANSCRIPT`。

当前边界：

- 不采用 Whisper 系列；
- 第一阶段保持 Qwen3-ASR-0.6B 单模型闭环；
- 本地服务由 Desktop 托管，不要求用户配置本地 API Key；
- 转录作为后台任务执行，支持进度、取消和任务中心状态；
- 模型、Python、CUDA 环境和权重不进入 Desktop Git 仓库或安装包；
- 不依据营销 benchmark 直接决定默认模型，候选模型必须使用同一批项目素材实测；
- 模型文件大小不等于运行时显存，正式开放前必须测量峰值显存和失败边界。

## 2. 目标硬件分档

本方案覆盖三种主要场景：

| 硬件档位      |      参考显存 | 产品定位                           |
| ------------- | ------------: | ---------------------------------- |
| RTX 4060      |          8 GB | 入门本地转录，优先低资源与稳定性   |
| RTX 3080      | 10 GB / 12 GB | 主流质量档，兼顾 1.7B 与精确字幕   |
| RTX 5090 D V2 |         24 GB | 高质量、多模型、批量与实验性长音频 |

RTX 3080 必须读取实际显存，不可只根据型号推断 10 GB 或 12 GB。本文中的 5090 V2 指 RTX 5090 D V2 24 GB；普通 RTX 5090 为 32 GB，不应混为同一硬件档。

## 3. 模型候选矩阵

| 模型                      | 主要价值                                       | 时间戳与说话人                                           | 许可证/开放状态           | 接入判断                         |
| ------------------------- | ---------------------------------------------- | -------------------------------------------------------- | ------------------------- | -------------------------------- |
| Qwen3-ASR-0.6B            | 当前默认；中文、方言、中英混合、歌声；资源较低 | 裸服务无精确字幕时间戳；配合 Qwen ForcedAligner          | Apache-2.0                | 已有 Sidecar，最低成本           |
| Qwen3-ASR-1.7B            | Qwen 高质量档                                  | 配合 Qwen ForcedAligner                                  | Apache-2.0                | 沿用 Qwen Sidecar，低改造成本    |
| Qwen3-ForcedAligner-0.6B  | 把转录文本对齐为词/字级时间戳                  | 不是独立 ASR；官方单次对齐存在时长边界                   | Apache-2.0                | 优先补齐，替换粗粒度分块 cue     |
| FireRedASR2-AED           | 中文、方言、中英混合、歌声质量候选             | 原生词级时间戳与置信度                                   | Apache-2.0                | 需要自定义 Provider/Sidecar 适配 |
| Fun-ASR-Nano              | 方言、噪声、歌声和多语言候选                   | 已发布 Nano 权重的原生时间戳不作为可靠能力；说话人需组合 | Apache-2.0                | 使用 FunASR 独立运行配置         |
| SenseVoiceSmall           | 极速、低显存、CPU fallback、情绪和声音事件     | 支持 CTC 对齐；说话人需组合 CAM++                        | FunASR Model License      | 适合快速模式                     |
| Paraformer-zh / streaming | 精确字幕、热词、低延迟和成熟工程链             | 原生字符时间戳；可组合 VAD、标点、CAM++                  | FunASR Model License      | 适合精确实时字幕模式             |
| GLM-ASR-Nano              | 约 1.5B 的跨家族质量对照                       | 时间戳、热词、说话人不是其明确优势                       | 模型 MIT；仓库 Apache-2.0 | 先进入 benchmark，不作为默认项   |
| VibeVoice-ASR             | 长音频、多说话人、原生 who/when/what           | 原生说话人、时间戳和文本                                 | MIT                       | 7B 权重较大，仅高端显卡量化实验  |
| Parakeet TDT 0.6B         | 英语和欧洲语言、高吞吐、精确时间戳             | 原生词/段时间戳                                          | CC-BY-4.0                 | 不支持中文，仅未来区域语言路由   |

FunASR 工具代码的许可证与模型权重许可证应分别审计。SenseVoice、Paraformer 等权重不得因为工具仓库采用宽松许可证就自动按同一许可证处理。

## 4. 三档配置决策

| 配置         | RTX 4060 8 GB                   | RTX 3080 10/12 GB              | RTX 5090 D V2 24 GB                          |
| ------------ | ------------------------------- | ------------------------------ | -------------------------------------------- |
| 默认模型     | Qwen3-ASR-0.6B                  | Qwen3-ASR-0.6B                 | Qwen3-ASR-1.7B                               |
| 高质量       | 0.6B + Aligner，顺序加载        | 1.7B + Aligner，顺序加载       | 1.7B + Aligner，可验证同时常驻               |
| 极速模式     | SenseVoiceSmall / Paraformer    | SenseVoiceSmall / Paraformer   | Qwen 0.6B 批量 / SenseVoiceSmall             |
| 中文实验     | Fun-ASR-Nano                    | FireRedASR2-AED / Fun-ASR-Nano | FireRedASR2-AED / Fun-ASR-Nano               |
| 多说话人     | CAM++ 组合                      | CAM++ 组合                     | VibeVoice-ASR 量化版实验                     |
| 禁止默认启用 | Qwen 1.7B 多模型常驻、VibeVoice | VibeVoice、FireRedASR2-LLM     | VibeVoice 原精度、FireRedASR2-LLM 未实测配置 |

### 4.1 RTX 4060 8 GB

- 保持 Qwen3-ASR-0.6B、batch 1、单转录任务；
- ASR 与 ForcedAligner 必须顺序加载，用完即释放；
- 精确时间戳优先考虑 Paraformer，而不是强行让多个 Qwen 模型常驻；
- Qwen3-ASR-1.7B 和 FireRedASR2-AED 只能作为实验配置，不能出现在自动默认路径；
- OOM 时只降低 batch、上下文和 GPU memory utilization，不自动切换到远程 Provider。

### 4.2 RTX 3080 10/12 GB

- 默认仍使用 Qwen3-ASR-0.6B；
- 开放 Qwen3-ASR-1.7B 质量模式；
- 先完成 ASR、卸载后再运行 ForcedAligner；
- FireRedASR2-AED 进入中文质量对照；
- 10 GB 使用更保守的显存预算，12 GB 可在实测后提高 batch 或音频窗口；
- 不运行 VibeVoice-ASR 和 FireRedASR2-LLM 原精度版本。

### 4.3 RTX 5090 D V2 24 GB

- 默认使用 Qwen3-ASR-1.7B；
- 验证 Qwen ASR 与 ForcedAligner 同时常驻，但不能在未测前承诺；
- FireRedASR2-AED 作为中文/方言高质量模式；
- Qwen3-ASR-0.6B 用于批量高吞吐；
- VibeVoice-ASR 只开放量化实验配置；其约 17.3 GB 权重加上运行时缓存后仍可能逼近 24 GB；
- FireRedASR2-LLM 同样先量化和实测，再决定是否开放。

## 5. 自动选择规则

Sidecar 在启动模型前读取 GPU 型号、总显存和当前可用显存。产品能力根据总显存分档；本次是否能启动还要依据可用显存 fail closed。

```text
total VRAM < 9 GB
  default = qwen3-asr-0.6b
  aligner = sequential
  concurrency = 1

9 GB <= total VRAM < 16 GB
  default = qwen3-asr-0.6b
  quality option = qwen3-asr-1.7b
  aligner = sequential
  concurrency = 1

total VRAM >= 20 GB
  default = qwen3-asr-1.7b
  experimental = firered-asr2-aed
  aligner = resident only after validation
  batch mode = enabled after validation
```

16–19 GB 暂时沿用中档规则。不能仅凭显存分档自动开放未经当前 CUDA、驱动、WSL 和运行时组合验证的模型。

用户界面只暴露能力档位，不直接要求普通用户理解模型部署细节：

- 快速；
- 标准；
- 高质量；
- 实验性多说话人。

模型 ID、量化方式、显存比例、Sidecar 类型和依赖版本由主进程 resolver 决定。更改模型不能影响本地服务会话凭据或远程 Provider 凭据。

## 6. 运行架构约束

不同本地模型不要求共享同一个 Python 环境，但必须共享 Desktop 侧的领域契约：

1. Renderer 只提交文档、Provider 和能力档位，不提交路径、命令、端口或密钥；
2. Main 捕获不可变 library context、源素材 hash 和逐字稿 parent revision；
3. 后台任务注册后立即返回，任务中心展示排队、运行、取消、成功或失败；
4. Sidecar Manager 启动受控 WSL 前台进程，并只绑定随机 loopback 端口；
5. Provider 响应先作为 `unknown` 做有界 schema 校验，再校验模型业务输出；
6. Provider 结果统一为 `TIMED_TRANSCRIPT`，`transcriptBasis=AUDIO_TRANSCRIPT`；
7. 完成前重新验证源素材及 parent revision，变化时不覆盖现有逐字稿；
8. 失败或取消不提交局部 revision；
9. 应用退出或空间切换先取消或 drain 后台任务，再关闭上下文和 Sidecar。

Qwen、FunASR、FireRed、GLM 和 VibeVoice 可以分别使用独立运行配置；OpenAI-compatible 只表示传输协议相似，不表示返回结构、时间戳语义或错误码天然兼容。

## 7. 评测与准入

每个候选模型必须使用完全相同的音频归一化、切块方式和项目素材测试。建议素材覆盖：

- 清晰普通话；
- 多人会议；
- 粤语和其他方言；
- 中英混合；
- 远场、混响和背景噪声；
- 数字、专有名词及重复短语；
- 歌声和背景音乐。

记录指标：

| 指标             | 说明                                                                        |
| ---------------- | --------------------------------------------------------------------------- |
| CER / WER        | 同一人工金标准上的字符/词错误率                                             |
| 时间戳偏差       | cue 起止相对人工字幕的平均和 P95 偏差                                       |
| DER              | 只有宣称说话人分离时才记录                                                  |
| RTF              | 转录耗时 / 音频时长，低于 1 表示快于实时                                    |
| 冷启动时间       | 从任务启动到模型 ready                                                      |
| 峰值显存         | 包含 Sidecar、模型、缓存和对齐器                                            |
| GPU 使用率与功率 | 采样平均值和峰值，不用瞬时值冒充整体负载                                    |
| 能耗             | `Wh = 平均系统功率 W × 运行小时`；条件允许时同时记录 GPU 功耗和整机插座功耗 |
| 等效电费         | `电费 = Wh / 1000 × 当地电价`，必须展示采用的电价和口径                     |
| 稳定性           | 空输出、重复、幻觉、OOM、协议错误和任务恢复率                               |

厂商公开 benchmark 只作为候选筛选依据。不同数据集、硬件、精度、batch 和并发条件下的速度或 CER 不能直接横向比较。

## 8. 分阶段落地

### 阶段一：跑通并稳定当前闭环

- Qwen3-ASR-0.6B；
- Desktop 托管 WSL Sidecar；
- 后台任务、进度、取消和结果 revision；
- 暂用有界音频块形成粗粒度 cue；
- 记录耗时、RTF、峰值显存、GPU 使用率、功率和 API 等效价格。

### 阶段二：提高字幕质量

- 接入 Qwen3-ForcedAligner-0.6B；
- 增加 Qwen3-ASR-1.7B 质量档；
- 按 4060、3080、5090 D V2 实测并固化显存 resolver；
- 不要求 ASR 与 Aligner 同时常驻。

### 阶段三：扩展 Provider

优先顺序：

1. FireRedASR2-AED：中文、方言、词级时间戳与置信度；
2. SenseVoiceSmall：极速、低资源、情绪和声音事件；
3. Paraformer-zh / streaming：精确时间戳、热词和实时字幕；
4. Fun-ASR-Nano：方言、噪声、歌声对照；
5. GLM-ASR-Nano：跨模型质量对照；
6. VibeVoice-ASR：高端显卡上的量化多说话人实验；
7. Parakeet：未来英文和欧洲语言专项路由。

## 9. 参考资料

- [Qwen3-ASR 官方仓库](https://github.com/QwenLM/Qwen3-ASR)
- [Qwen3-ASR-1.7B 模型文件](https://huggingface.co/Qwen/Qwen3-ASR-1.7B/tree/main)
- [FireRedASR2S 官方仓库](https://github.com/FireRedTeam/FireRedASR2S)
- [FireRedASR2-AED 模型文件](https://huggingface.co/FireRedTeam/FireRedASR2-AED/tree/main)
- [FunASR 官方仓库与模型列表](https://github.com/modelscope/FunASR)
- [Fun-ASR-Nano 模型页](https://huggingface.co/FunAudioLLM/Fun-ASR-Nano-2512)
- [SenseVoice 官方仓库](https://github.com/QwenAudio/SenseVoice)
- [FunASR 模型许可证说明](https://github.com/FunAudioLLM/SenseVoice/issues/286)
- [GLM-ASR 官方仓库](https://github.com/zai-org/GLM-ASR)
- [GLM-ASR-Nano-2512 模型页](https://huggingface.co/zai-org/GLM-ASR-Nano-2512)
- [VibeVoice 官方仓库](https://github.com/microsoft/VibeVoice)
- [VibeVoice-ASR 模型页](https://huggingface.co/microsoft/VibeVoice-ASR)
- [Parakeet TDT 0.6B v3 模型页](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3)
- [NVIDIA RTX 5090 规格](https://www.nvidia.com/en-us/geforce/graphics-cards/50-series/rtx-5090/)
- [NVIDIA RTX 4060 系列规格](https://www.nvidia.com/en-us/geforce/graphics-cards/40-series/rtx-4060-4060ti/)
- [NVIDIA RTX 3080 系列规格](https://www.nvidia.com/en-gb/geforce/graphics-cards/30-series/rtx-3080-3080ti/)

相关产品交互与任务编排见 [视频文档统一创作与后台转录工作流](video-document-creation-workflow.md)，部署步骤见 [Windows WSL2 部署 Qwen3-ASR](../tutorials/07-qwen3-asr-wsl-local-deployment.md)。
