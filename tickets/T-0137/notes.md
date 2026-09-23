# T-0137 · 面板形态：常驻浮窗（不再必须模态）—— 设计与槽位调研

> 由来（用户原话）：「我补充一下, 这里希望渲染可以固定在外面, 例如 float 在对话流里面,
> 而不是现在必须模态」。
> 现状：`T-0136` 的面板只在 `shell.overlay` 里渲染一个**全屏模态**（点按钮开、点关闭关）。

---

## 1. DSH 客户端槽位调研（**结论 + 原话**；从包内文档抽出）

`dsh-cordis-client-runner/lib/client.js` 里带一份 slot 目录（key + doc）。与"常驻"相关的 5 个：

| slot | 文档原话（截段） | 适不适合"常驻浮在对话流" |
|---|---|---|
| `shell.overlay` | *Frame-wide floating layer, above every column and **outside their scroll containers**. Deliberately generic and unowned by any feature: a badge, a toast stack or a status pill all belong here… **The layer itself is click-through** — entries opt back into pointer events* | ✅✅ **这就是为浮层准备的**：在滚动容器**之外**（滚对话时它不动）、点击穿透（不挡对话） |
| `sidebar.right.pane.tab` / `….tab.title` | *One tab's body, dispatched with the `id` of the type in force for `tab.kind`… receives every tab of that kind, **in every pane, docked or floating*** | ✅ 真·**停靠**：与文档预览/指南并列的 tab；dock/float 由用户自己决定 |
| `conversation.input.dock` | *Full-width entries **above the composer card*** | ✅ 紧贴输入框上方的一条 —— *"在对话流里面"*最字面的解释 |
| `conversation.composer.bar` | *Resident composer body, including the no-Session inert state* | ⚠️ 属于输入卡片本体，塞画面会挤坏输入区 |
| `rightbar.session` | *Session content selected by the root-scoped right Sidebar controller* | ⚠️ 需要右栏控制器配合，最重 |

**同一条文档里还有一句对"根槽"的警告**（`shell` 根槽只有一个，注册进去会把整个框架顶掉）——
所以我们**绝不**碰根槽，只往上面这些 list slot 里加条目。

## 2. 候选形态（待用户选；可多选）

| 形态 | 落点 | 交互 | 代价 |
|---|---|---|---|
| **F 浮窗（PiP）** | `shell.overlay` + 自己的 `position:fixed` + `pointer-events:auto` | 默认右下；可拖、可缩放（0.25×/0.5× 两档）、可收成一枚小胶囊；状态存 `localStorage`；面板里留「放大」进现有模态 | 小（同一注册点改渲染） |
| **D 右栏停靠 tab** | `sidebar.right.pane.tab` + `.tab.title` | 与"文档预览/指南"并列的 tab；常驻、不遮挡对话；用户自己决定 dock/float | 中（要注册 title + body 两处，且要处理"没有选中实例"的空态） |
| **S 贴输入区** | `conversation.input.dock` | 输入框上方一条全宽常驻区（可折叠） | 小-中（会占垂直空间，画面只能是细条或缩略） |

## 3. 不论选哪个都要满足的（本票验收的共同项）

1. **常驻**：不点按钮也看得见（除非用户收起）；**切到别的会话/滚动对话时不消失、不跟着滚**；
2. **不挡操作**：浮层默认只占自己那块矩形（`pointer-events:auto` 只在自己容器上），其余区域点击穿透到对话；
3. 仍**没有**启动/停止按钮（`T-0136` 的形态不变）；
4. 实例列表 + 选中 + 每实例 URL + 「新标签打开」这些能力一个都不能少（只是换个壳）；
5. **状态持久化**：位置/尺寸/收起态/选中实例存 `localStorage`（刷新不回到默认）；
6. 现有**模态保留**（作为「放大」），因为它在大屏细看时仍然有用。

## 4. 不做什么

* 不注册 `shell` 根槽（会把整个 AppFrame 顶掉，文档明确警告）；
* 不改 `lib/index.js`（路由/代理与面板形态无关）；
* 不改 `T-0135`/`T-0136` 已验证的桥与宿主。
