# 两两图片对比

## 决策

两两对比提供三个稳定的主模式：

1. **并排（Side by side）**：同时查看两张完整图片，用于整体构图、色彩和版本选择。
2. **拉帘（Swipe）**：图片使用同一画布和变换，A 位于左侧、B 位于右侧，由可拖动的竖直分割线控制显示区域。
3. **叠图（Overlay / Onion skin）**：图片使用同一画布和变换，通过线性的 A/B 混合比例检查位移、比例、姿态和局部差异。

A/B 单图显示是辅助动作，不占用主模式。点击 A 或 B 暂时只看对应图片，再次点击返回当前主模式。窗口宽度、应用窗口尺寸和创作分栏宽度的变化不得改变用户选择的主模式、拉帘位置或叠图比例。

缩放和平移在 A、B 间共享。适合画布会同时将缩放恢复为 100%，并把共享平移恢复到中心。

## 控制约束

### 拉帘

- 默认分割位置为 50%。
- 分割线必须在图片画布内持续可见；视觉线可以较细，但命中区域应更宽。
- 拖动位置采用从 0% 到 100% 的一比一线性映射，不根据指针速度或当前位置动态改变灵敏度。
- 方向键每次移动 1%，Page Up / Page Down 每次移动 10%，Home / End 到达两端。
- 双击分割线恢复 50%。

### 叠图

- 默认比例为 A 50% / B 50%。
- B 的图层透明度直接等于滑杆数值；A 为不透明底图，因此视觉结果遵循 `result = (1 - alpha) × A + alpha × B`。
- 滑杆采用 0–100 的线性百分比，不使用中央减速、速度加速或其他隐藏的非线性传递曲线。
- 界面持续显示 A、B 的精确权重和 50% 中点刻度。
- 方向键使用 1% 步进，Page Up / Page Down 使用 10% 步进，双击滑杆恢复 50%。

## 依据

### 成熟产品模式

- GitHub 图片差异固定提供 2-up、Swipe 和 Onion Skin。Swipe 用分割线逐区域比较像素和颜色；Onion Skin 用透明度发现轻微位移。这是本产品三个主模式的直接基准。  
  <https://docs.github.com/en/repositories/working-with-files/using-files/working-with-non-code-files>
- Capture One 的 Split View Slider 默认位于画面中央，Before 在左、After 在右，并允许在编辑期间实时更新。  
  <https://support.captureone.com/hc/en-us/articles/360008828758-Comparing-images-with-the-Before-After-feature>
- Lightroom Classic 分开提供完整并排和左右/上下分割，并在两张图片间同步缩放和平移。它还通过临时 Before 视图支持单图核对。  
  <https://helpx.adobe.com/lightroom-classic/desktop/process-and-develop-photos/develop-module-tools.html>

### A/B 交替的有效范围

- 一项包含 286 名参与者的美容术前/术后照片研究发现，交替显示相比静态布局有更高的变化检出趋势；45 岁以下参与者的提升达到统计显著。因此 A/B 交替值得保留，但它是细微变化检查的辅助动作，不替代拉帘。  
  <https://ohiostate.elsevierpure.com/en/publications/changing-in-a-gif-graphics-interchange-format-innovations-in-befo/>
- 重合位置交替显示在轻微错位的照片比较中比并排平均快约 6 秒发现差异；错位增大时优势下降。该结果要求 A/B 使用同一空间变换，也说明它不适合作为所有图片的默认模式。  
  <https://pmc.ncbi.nlm.nih.gov/articles/PMC4690818/>
- 自动持续闪烁会引入可访问性和注意力风险。本产品不自动播放闪烁；如果以后增加自动交替，必须由用户主动启动、可立即停止，并遵守每秒不超过三次闪烁的限制。  
  <https://www.w3.org/WAI/WCAG22/Understanding/three-flashes.html>

### 线性控制

- 标准 alpha 混合使用 `(1 - alpha) × A + alpha × B`，50% 具有明确的等权语义。  
  <https://docs.opencv.org/4.0.0/d0/d86/tutorial_py_image_arithmetics.html>
- Apple 的 Slider 指南要求百分比使用熟悉的最小端到最大端方向；需要精确控制时应显示准确值、刻度或步进。非线性滑杆需要额外标注，而不应隐藏映射规则。  
  <https://developer.apple.com/design/human-interface-guidelines/sliders>
- WAI-ARIA Slider Pattern 规定方向键小步调整、Home / End 到两端，并允许 Page Up / Page Down 做大步调整。本产品的拉帘和叠图都遵循该键盘模型。  
  <https://www.w3.org/WAI/ARIA/apg/patterns/slider/>

## 验收标准

- 选择拉帘后，画布中央立即出现竖直分割线，拖动时 A/B 边界跟随指针。
- 选择叠图后，默认显示 A 50 / 50 B；滑杆每个位置都对应真实线性权重。
- A、B 单图按钮不改变当前主模式，再次关闭单图后恢复原模式及其数值。
- 缩放和平移对 A、B 完全同步；交换 A/B 不改变画布变换。
- 调整窗口或创作分栏宽度不会改变主模式、50% 控制值或用户已经设置的控制值。
- 所有滑杆均可通过键盘完成小步、大步和端点操作，并向辅助技术暴露名称、范围与当前值。
