# T-0138 · 变更记录

---

## 变更 1（2026-09-23）· 单一 iframe（消除"切形态=重启实例"）+ 几何/形态修复 + 守卫加固

### 一、P0 根因与修法

三态（收起胶囊 / 展开浮窗 / 模态）原是**三个 JSX 分支各挂一个 `src` 相同的 `<iframe>`** ⇒ 状态切换时 React
卸载旧节点、挂新节点；而 web 形态下 **VM 活在页面里** ⇒ 卸载＝实例的 VM 死、重挂＝从 `ALINIT` 重跑
（取证：`evidence/iframe-reload-forensics.txt`，一条 status 流 + 一条完整重引导链）。

| 文件 | 改动 |
|---|---|
| `lib/client.js` | ① 全树**只有一个** `createElement('iframe'`（无 `key`，`src` 只在用户换选中实例时变）；三态差异**全部落在容器 style** 上；② `viewEl` 接上 `viewportStyle`（此前该函数**定义了却从未被调用** ⇒ 容器退回静态位置＝**无条件画在左上角**，且收起时不会隐藏）—— 这是用户报的「监视器被无条件渲染到左上角」的直接原因；③ 模态打开时不再渲染浮窗面板（`if (s.open) return null`，面板里没有 iframe ⇒ 卸载安全），修掉"两个 chrome 叠着、按钮串台"；④ 收起＝`visibility:hidden` + `pointer-events:none`（**不 unmount、不用 `display:none`**，后者会挂起页面）；⑤ 新增观察者数显示与 `viewers>1` 告警；「新标签打开」的 `title` 写明"再开一个标签页＝第二个 VM（会抢同一份 overlay/log）" |
| `lib/index.js` | 按实例统计 **SSE 观察者数**（代理 `/events` 时计数、连接关闭时递减），在 `__instances` 每项里带上 `viewers` |

### 二、几何修复（实测发现，主 agent 做）

`viewportStyle` 的**默认位置**分支（没拖过）旧实现用常量假想"面板高 440"往下叠，而面板按
`panelStyle` 锚在**右下角**且高度自适应 ⇒ 1440×900 下算出 `top=634`、画面框底边 **994 > 900**
（有一半在屏幕外）。改为：默认位置时画面框排在**面板上方**（面板的 `right/bottom:16` 锚定不变）。

越界自检（4 视口 × 2 档尺寸，全部落在屏内）：

```
✓ 1440x900 scale=0.5 → top=350 底边=710   ✓ 1440x900 scale=0.25 → 底边=710
✓ 1280x800 scale=0.5 → 底边=610           ✓ 1024x768 scale=0.5 → 底边=578
✓  800x600 scale=0.5 → 底边=410           （右边界亦均未越界）
```

### 三、★守卫加固：把"假通过"改成"真执行"

原冒烟有**两处探针缺陷**，导致 **约 27 条断言静默空转**（看起来绿）：

1. `expand()` 只展开根链，而 `Overlay` 返回的是**函数组件树** ⇒ 按 id 驱动的断言（实例行切换、
   收起/放大/关闭、拖动、尺寸档、空态刷新、viewers title…）全部 `if (x) x.onClick()` 空转；
2. fake DOM 不足以挂 `react-dom/client`（`createRoot`/commit 抛 TypeError），而异常被
   `catch(e){mounted=false}` 吞掉 ⇒ `[17]` 那条"真挂载 + 四步同一 iframe 节点"永远红着却没人知道。

修法（**只加强，不放松**）：递归展开函数组件（克隆 `Object.freeze` 的 element 再替换 `props.children`）；
补齐 3 个最小 DOM API（`textContent` setter、`ownerDocument`、`HTMLIFrameElement` 空类，逐个实测过必要性）；
源码棘轮改为**剥掉注释**后再计数（此前把文件头注释里合法出现的 `createElement('iframe'` 也算进去 ⇒
对**正确**实现也报红）。断言文本一字未改、无一删除、无 `t.skip()`。

### 四、判据

| 判据 | 结果 |
|---|---|
| 客户端渲染守卫 | `node plugins/amayui-emulator/smoke-client.mjs` → **196 ✓ / 0 ✗**，末行 `✓ 全部通过`（主 agent 独立复跑） |
| Host 半冒烟 | `node plugins/amayui-emulator/smoke.mjs` → **14 ✓**，`[smoke] 全部通过 ✅` |
| 三态几何 | 展开 `left/top` 落在持久化位置、收起 `visibility:hidden`+`pointer-events:none`、模态 `z-index=1310` 且**恒为 1 个 iframe**、无 `display:none` |
| 越界自检 | 见 §二（4×2 全过） |

### 五、未完成（本票仍 `doing`）

1. **日志级端到端**（acceptance 7）：真浏览器里来回切 收起↔展开↔放大↔关闭 ≥2 轮，断言宿主日志里
   **只出现一条启动链**、`frames` **不回零**。执行器 `plugins/amayui-emulator/float-e2e.cjs` 由子代理产出中
   （证据将落 `evidence/no-reboot-e2e.txt`）；**不需要重启 DSH**（它把插件 handler 挂在本地 server 上）。
2. **需要用户重启一次 `dsh web`**（客户端半区是启动时载入的）后目视确认：左上角那个框消失、
   收起正确隐藏、切「放大/收起」不再重启实例。
3. 之后接 `T-0141`：用干净环境重做「Option → ADV设定 → 关闭」（本轮那次被本票的 P0 污染了观测）。
