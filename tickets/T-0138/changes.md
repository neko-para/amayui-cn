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

---

## 变更 2（2026-09-23）· 跑通 acceptance 7 的执行器：修 3 处**假红**、把宿主日志补成可判读

`float-e2e.cjs` 落盘后第一跑就暴露了三个问题，**全是"判据口径"的问题，不是实现的问题**（实现一次都没改）。
本节的每一条都是**先出证据、再改断言**，且三处改动都**只让判据更贴性质**，没有一处是"为了让红变绿"。

### 2.1 驱动侧的三个 bug（各自独立）

| # | 症状 | 真因 | 修法 |
|---|---|---|---|
| 1 | 第二跑直接 `ERR_UNSUPPORTED_ESM_URL_SCHEME … protocol 'e:'` 崩在 `import()` | Windows 上 `import('E:\\…\\index.js')` **不认盘符路径**（必须 `file://` URL） | `pathToFileURL(...).href`（本工程跨平台，这一条对 darwin/linux 是 no-op） |
| 2 | `每个启动链标记只出现一段` / `第一条 TITLE 之后没有任何启动链标记` **假红** | 这两条对**正常启动**就不成立：① 数据表 INIT 段本来就重复进入一次（`… WDINIT, IMINIT, EBINIT, WDINIT, SKINIT, EBINIT, CGINIT, SKINIT, …`）；② 正常启动的尾部就是 `… INIT2, TITLE, INIT2, TITLE` ⇒ `INIT2.BIN` 必然落在第一条 `TITLE` 之后 | 换成**直接抓性质**的判据：把「基线时刻已发生的启动链」（`TITLE` 之前的段序列）当 needle，在基线**之后**新产生的段里找**连续重现**；重现长度 > 0 ⇒ 页面被重载 |
| 3 | `切换前后 bin 段序列完全一致` **假红** | **基线取早了**：`bin === 'TITLE.BIN'` 只说明"到过标题"，而启动**尾部**（`… INIT2 → TITLE`）在那之后才落进日志 | 加 `settle()`：连续 2.5s 没有新段才取基线；断言放宽为「基线序列**逐字保留**」+ 上面那条 0 重现（仍比原来更贴性质） |

> 三跑的证据（同一份驱动，三种结果）：第一跑 2 项假红（#2）→ 第二跑 1 项假红（#3，`before`/`after` 只差尾部一条 `INIT2→TITLE`）
> → 第三跑 **0 项假红**（但见 2.3 的 frames 污染）。

### 2.2 宿主侧：`[web] status` 把 `frames` 截掉了（本票新增）

`cases 'renderer-status'` 里那行 `log(\`[web] status ${JSON.stringify(...).slice(0, 200)}\`)` 会把 `frames` **截掉**
（它在 `perf` 里，位置靠后）⇒ 排查"frames 会不会回零"时日志里**没有这个数**，只能靠注册表每 5s 的心跳去猜。
改成 `[web] status frames=N {…}`（`frames` 顶到最前，其余仍截 200）。这是本票排查绕远路的一个直接原因。

### 2.3 ★一条真发现：`frames` 曲线会被**第二个观察者**污染

第四跑出现 `frames: … → 402 → 35`。**先做对照，再下结论**：

| 实验 | 驱动 | 结果 |
|---|---|---|
| 完全不动面板 60s | `idle-probe.cjs`（新增） | `frames` **单调上升** 53 → 2711，**0 次回落**；iframe 节点身份自始至终一个 |
| 只收起 25s（再展开 15s） | `collapse-probe.cjs`（新增） | 三个阶段 A/B/C **全部 0 次回落**（607→1923→2795）；节点身份一个 |

⇒ "收起/切换会不会让 frames 掉"**被证伪**。那 402→35 是什么？**宿主日志自己回答了**（靠 2.2 的新格式）：

```
[web] ⚠ 第二渲染者：同一实例 e2e 现有 2 个 SSE 观察者 ⇒ 多个 VM 会抢同一份 overlay/log…
[web] status frames=708 {"bin":"TITLE.BIN",…
[web] status frames=35  {"bin":"TITLE.BIN",…      ← 另一个页面自己的计数器（它刚起步）
[web] status frames=724 {"bin":"TITLE.BIN",…
```

**两个页面 = 两个 VM = 两套 `frames` 计数器**，交错写进同一份日志 ⇒ 看起来就像"一个 VM 的 frames 掉回 35"。
原因是本跑的宿主被**两个观察者**附着（本驱动 harness 的 iframe + 另一个页面；后者通常是**人在 DSH 面板里开着的那个**）。

处置（**不是**把断言删掉当没看见）：
* 驱动每次采样都读 `/health.viewers` 并落进证据表；`viewers > 1` ⇒ frames 单调性判据标成
  **「不可判读」并判 FAIL**（宁可红，也不假装通过，也不谎报实现有问题）；
* 新增观察者序号：宿主在 SSE 首帧下发 `observer#N`，日志里每次接入/断开都带序号 ⇒ 下一个人能直接归因。

### 2.4 本轮判据

| 判据 | 结果 |
|---|---|
| `smoke-client.mjs` | **196 ✓ / 0 ✗**（主 agent 复跑） |
| `smoke.mjs` | 14 ✓ 全过 |
| `float-e2e.cjs`（四次迭代后） | 见 `evidence/no-reboot-e2e.txt`：**无重引导**（基线启动链 0 重现）、基线逐字保留、`iframe` 恒 1 且同一节点、`pid`/`startedAt` 不变、页面 0 异常 |
| `idle-probe.cjs` / `collapse-probe.cjs` | 两个对照实验的原始数据在 `.tmp/idle-probe/trace.txt`、`.tmp/collapse-probe/raw.json`（**对照实验是方法论证据，不落票据**） |
| `tsc --noEmit` | OK（宿主新增 `viewers` / `viewersWarn` / 观察者序号后） |

### 2.5 仍未完成

1. **frames 单调性的干净复跑**：~~需要在**只有 harness 一个观察者**时跑一次~~ ⇒ **已由 `T-0140`
   的 `--attach-headless` 实测补上**：宿主自持一个无头页的实例在**只有一个观察者**的情况下，
   `frames` 从 `1` 单调爬到 `1570`（0 次回落），见 `tickets/T-0140/evidence/headless-e2e.txt`。
   本驱动自身也在**多观察者**下给出了按来源拆开的单调性判据（见 §2.3 与最终证据文件的
   「frames 按观察者拆开」表）。
2. **用户目视确认**（变更 1 §五.2 那条仍然有效）。
3. 之后接 `T-0141`（干净环境重做 Option → ADV设定）。

### 2.6 驱动自身的两个"证据不落盘"坑（都出在 `finally` 的顺序上）

症状极具误导性：**日志上全绿，`tickets/T-0138/evidence/` 里却什么都没有**，而退出码显示 0。
两次都是"`finally` 里的顺序"问题，且第二次浮出来的是第一次掩盖着的错：

| # | 症状 | 真因 | 修法 |
|---|---|---|---|
| 1 | 证据文件从来没落盘（截图却在，因为它运行中就写了） | `finally` 里先 `win.destroy()` —— **本驱动跑在 Electron 里**，窗口是最后一个 ⇒ 销毁即触发 `window-all-closed` ⇒ Electron **立刻退出进程**，后面的 `writeFileSync` 根本没机会跑 | 把写证据提到销毁窗口**之前**；销毁窗口挪到最后 |
| 2 | 修了 #1 后仍然空白，只多一条 `UnhandledPromiseRejectionWarning: Cannot access 'baseLen2' before initialization` | 证据块里 `baseLen2` 被写在了**使用它的那行之后**（`const` 的 TDZ）—— 这个错在 #1 修好之前**根本跑不到** | 声明提到使用之前 |

★顺带钉住一条**给调用方的**约束（写进 `finally` 的注释）：本驱动不能用管道接（`… | Select-String …`）——
pwsh 在管道 EOS 时会 tree-kill Electron，正好落在收尾阶段 ⇒ 同样"证据不落盘 + 退出码 0"。

---

## 变更 3（2026-09-23）· ★用户报的两条几何缺陷：画面框"悬空一段" + 点「放大」后"压住模态自己那行"

### 3.1 用户原话与真因

> 「右下角的调试界面和渲染的窗口中间隔了一段距离（悬空的）；如果点放大的话，调试界面移动到了中心，
> 又和渲染的窗口重叠了」

两条**都是同一个根因**：画面框（承载唯一 iframe 的容器）是 chrome 的**兄弟节点**，它只能由 chrome 的
**真实边界**推算 —— 而实现用的是**猜的常量**。实测（1440×900、scale 0.5、一条实例）：

| 形态 | chrome 实测 | 旧实现据以摆放的常量 | 后果 |
|---|---|---|---|
| 展开 | 面板 `x=762 y=740 → bottom=888`（高 **148**） | `CHROME_H + LIST_H = 46+118 = 164` | 画面框被摆到 `bottom=714` ⇒ 与面板之间**空出 26px**（用户看到的"悬空一段"） |
| 模态 | 模态 `x=194 y=232 → bottom=330`（高 **98**） | `MODAL_PAD + CHROME_H = 12+46 = 58` | 画面框从模态**内部** 58px 处起画（`y=290`）⇒ **压住模态自己的实例行**（`232+98=330 > 290`） |

模态那条更严重：画面框（`z-index 1310`）盖在模态 chrome（也是 1310，但**后画的在上面**）之上，
把实例列表那一行挡掉了 —— 而列表正是"选哪个实例"的唯一入口。

### 3.2 修法：量真实边界，不再猜

| 位置 | 改动 |
|---|---|
| `lib/client.js` 新增 `useChromeSizes(s)` | `ResizeObserver` 观察面板与模态两个 chrome，把**实测** `panelX/Y/W/H`、`modalX/Y/W/H` 进 state（量不到就退回常量 ⇒ 首帧 / SSR / 无 `ResizeObserver` 的环境照旧能画） |
| `viewportStyle(s, vp, chrome)` | 展开态：`left = 面板左缘 + (面板宽−画面宽)/2`（**横向居中**，对称分掉面板左右 padding）、`top = 面板顶边 − 2 − 画面高`（**纵向贴合**，只留边框余量）；模态态：`left/top = 模态实测盒子的 x / (y+高)`，即排在**整块模态之下** |
| `modalBox` / `modalOrigin` | 宽度与位置都改成实测优先（面板与模态共用同一个宽度真源，不再两个 chrome 各算一份） |

实测复核（同一驱动，改前 → 改后）：

```text
展开态：画面框 x=772 → 774（与面板 762+664 的左右 padding **对称**）
        画面框 bottom=730 → 738，面板 top=740  ⇒ 缝 10px → **2px**（视觉上贴住）
模态态：画面框 y=290 → **330**，模态 bottom=**330** ⇒ 从"压住实例行"变成"正好接在模态下方"
        画面框 x=596 → **194**，与模态左缘对齐
```

### 3.3 为什么"量"能一次修掉两条

两条缺陷其实是"猜的常量"在两个形态上各错一次：`CHROME_H + LIST_H` 把展开面板算**高**了 16px，
`MODAL_PAD + CHROME_H` 把模态算**矮**了 40px。用实测之后**两者的口径统一**成一句话：
*画面框永远排在对应 chrome 的真实边界之外* —— 展开是"面板顶边 − 2"，模态是"模态底边"。
chrome 内容高度以后再怎么变（`viewerWarn` 告警条出现、标题栏换行、实例行增多），画面框都自动让位。

### 3.4 顺带修掉的工具债（本票排查时发现）

`plugins/amayui-emulator/float-shot.cjs` 还在 `getElementById('amayui-emulator-viewbox')` ——
那是 `T-0138` 变更 1 **已经改名**的 id（现为 `-viewport`）⇒ 该探针的 `viewbox` 恒为 null、
依赖它的"画面框 640×360"断言**静默空转**。已改成新 id。

### 3.5 守卫

`smoke-client.mjs` 新增 `[19] ★布局贴合` 五条：`ResizeObserver` 在用、展开态用了 `chrome.panelH`、
模态态是 `oy + bb.h`（**不是**从模态内部按常量起画）、模态位置来自 `modalX/modalY`，
外加一条**反向棘轮**（禁止再出现 `o.x + MODAL_PAD + MODAL_LIST_W` 那个老写法）。

★判据：`smoke-client.mjs` **201 ✓ / 0 ✗**（新增 5 条）、`smoke.mjs` 全过、
`tsc --noEmit` OK、真浏览器实测截图与矩形见 `.tmp/probe-layout/s2b-selected.png` 与 `s3-modal.png`
（**注意**：`client.js` 是插件 bundle 成员 ⇒ 需要重启 `dsh web` 才生效）。


