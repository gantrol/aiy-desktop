# 应用导航与前进后退输入

## 决策

前进、后退操作应用于 AIY 自己的页面历史，不调用 Chromium 页面历史。标题栏按钮、键盘、系统导航命令和鼠标侧键统一转换为 `back` / `forward`，再经过同一份导航守卫与历史栈。

页面历史保存完整的 `AppLocation` 快照，当前实现最多保留 100 项且只存在于应用内存中：

- `push` 在当前位置后追加快照，并清除已有的前进分支；
- 与当前位置完全相同的快照不重复入栈；
- `replace` 用于规范化当前页面，不新增历史项；若目标等于上一项，可以直接折叠当前项；
- `back` / `forward` 只移动当前索引，由各业务页面根据恢复后的 location 同步界面。

## 页面边界

是否进入历史由 typed location 决定，不根据组件层级、视觉尺寸或 `useState` 自动推断。

应进入历史：

- 主模块切换；
- 有稳定身份、可独立恢复的完整页面或检查器；
- 标签页、集合、词条、创作、分类节点等用户预期可通过前进后退重新定位的选择。

不进入历史：

- 对话框、Popover、确认流程；
- 搜索词、筛选、排序、滚动位置、树展开状态；
- 面板宽度、折叠、全屏和批量选择等瞬时工作状态；
- 表单草稿本身，未保存内容通过导航守卫处理。

页面首次加载后自动选择默认项、删除或合并后修正失效目标时使用 `replace`。用户主动切换具有稳定身份的子页面时使用 `push`。业务页面内标为“返回”或“关闭”的按钮必须明确选择语义：需要保留前进分支时执行历史后退；属于新的页面选择时以 `push` 提交父级 location，使刚离开的稳定子页面仍可通过后退恢复；只有关闭不具备稳定身份的临时状态时才使用 `replace` 折叠当前项。

具体映射：素材库检查器的素材键、词条详情与编辑页、创作输出的素材 ID 都是稳定页面选择。打开素材检查器、进入词条编辑、在创作输出中切换图片使用 `push`；素材检查器的关闭和词条编辑的返回执行历史后退，而不是用 `replace` 删除子页。因此页面自身离开稳定子页后，可用全局前进恢复刚才的检查器或编辑页；切换输出图片后可用后退/前进逐项恢复。创作输出使用 `{ surface: 'existing-creation', seriesId, assetId }` 恢复选图；画廊展开、面板折叠、预览/标注显示模式等仍为局部瞬时状态。

词典分类管理采用 `{ surface: 'classifications', classificationId }`：进入管理页和主动切换分类进入历史；首次默认分类、失效分类和合并后的目标分类使用 `replace`；搜索与树展开状态保持为局部状态。

输入默认映射：

- `Alt+Left`、`BrowserBack`、Electron `browser-backward`、Mouse4/X1 → `back`
- `Alt+Right`、`BrowserForward`、Electron `browser-forward`、Mouse5/X2 → `forward`

Mouse4/Mouse5 是 Chromium 在鼠标驱动处理后交给应用的逻辑 XButton 输入，不是 Raw Input 或物理按键探测。默认绑定必须集中定义，以便后续设置页采用“替换绑定”而非叠加隐藏兜底。

## 输入边界

- 保留 Electron `app-command`，但不能单独依赖它。Windows 仅在相应消息交给 `DefWindowProc` 等路径下生成 `WM_APPCOMMAND`；Chromium 也可能直接消费 XButton 并产生 Web 鼠标事件。
- 厂商软件把侧键替换为键盘键或宏后，应用遵循其最终输出，不反推原物理按钮。
- 若驱动被明确配置为同时发送 XButton 和宏，两种行为都是真实输入，应用无法猜测用户意图；应通过可配置绑定关闭或替换 Mouse4/Mouse5 默认映射。
- 不使用 Raw Input、`WH_MOUSE_LL` 或全局鼠标钩子实现窗口内导航，避免绕过驱动改键语义。

## 依据

- Electron `app-command` 与鼠标 Back 示例：<https://www.electronjs.org/docs/latest/api/browser-window#event-app-command-windows-linux>
- Windows XButton 消息：<https://learn.microsoft.com/en-us/windows/win32/inputdev/wm-xbuttonup>
- Windows `WM_APPCOMMAND` 生成规则：<https://learn.microsoft.com/en-us/windows/win32/inputdev/wm-appcommand>
- W3C 对 X1/X2 的 `MouseEvent.button` 编号：<https://www.w3.org/TR/uievents/event-algo.html>
- Chromium 扩展鼠标按钮事件设计：<https://groups.google.com/a/chromium.org/g/blink-dev/c/MrKpBV26ik4/m/D_zmoAJrAQAJ>
- 厂商替换式改键示例（Back → P）：<https://help.corsair.com/hc/en-us/articles/360027751872-Assigning-Mouse-Buttons-with-iCUE>

## 验收

- 默认 Mouse4/Mouse5 分别触发应用后退/前进，且不会触发 Chromium 自身导航。
- 改键软件将侧键替换为普通键时，只执行改后的键行为。
- 同一次输入经多个标准通道到达时，短时间去重只消除同方向重复命令。
- 对话框和未保存内容继续服从统一导航守卫。
- 从词典进入分类管理、切换分类、打开词条后，前进后退可以恢复准确页面和分类节点。
- 素材检查器关闭、词条编辑返回后，全局后退可以恢复刚离开的子页面，前进也不会因 `replace` 被提前折叠。
- 在同一创作中切换输出图片后，前进后退可以按顺序恢复 `assetId`；面板折叠与显示模式不产生历史项。
- 默认项解析和失效目标修正不会制造空白或重复历史项。
