# T-0137 · 变更记录

---

## 变更 1（2026-09-23）· 面板形态：常驻浮窗（PiP）+ 模态降级为「放大」

### 0. 需求与形态选择

用户原话：「希望渲染可以固定在外面, 例如 float 在对话流里面, 而不是现在必须模态」。
两个已确认的选择（2026-09-23）：形态 = **F 浮窗（PiP）**；默认 = **收成小胶囊**。
槽位依据见 `notes.md` §1（`shell.overlay` 的官方语义：frame-wide、在滚动容器之外、layer 本身点击穿透）。

### 1. 实现（子代理执行，主 agent 复核）

| 文件 | 改动 |
|---|---|
| `lib/client.js` | `shell.overlay` 的组件改成**三态**：`open`→全屏背板模态；`collapsed`（默认）→`position:fixed; right:16; bottom:16` 的**小胶囊**（「🖥」+ 活实例数徽标，`pointerEvents:'auto'`）；否则→**常驻面板**（标题栏可拖 + 实例列表 + 640×360/320×180 画面框 + 收起/尺寸档/放大/新标签/刷新）。两个 slot 的 id 与 order（36/160）原样保留；loader 契约与 `{cache:'no-store'}` 数据契约不变；`pointerEvents:'auto'` **只在自有三个容器上**（不改 slot 层的点击穿透）；`localStorage` 全部 try/catch 包裹（键 `@amayui/emulator-view.panel.v1`，存 `{collapsed,x,y,scale,selectedId}`，坏数据/无 storage 一律退默认）；**全程无启动/停止控件** |
| `smoke-client.mjs` | 由 53 条扩到 **140 条**（15 个 section）：新增"未开模态时也渲染胶囊且带徽标""pointerEvents 只在自己容器""两档尺寸（320×180/0.25×、640×360/0.5×）""拖动处理器存在 + mouseup 摘监听 + clamp""localStorage 读/写/5 种坏数据/getItem 抛异常/完全无 storage""模态经放大可达、关闭回浮窗、收起回胶囊"；保留结尾 `✓ 全部通过` 与非零退出 |
| `README.md` | 新增「形态：常驻浮窗（PiP）+ 模态作放大」节 + 验证清单加入两条冒烟命令 + 变更历史 |

### 2. 判据与证据

| 判据 | 结果 |
|---|---|
| 客户端渲染守卫 | `node plugins/amayui-emulator/smoke-client.mjs` → **140 ✓ / 0 ✗**，exit 0（**主 agent 独立复跑**） |
| Host 半冒烟（未改，回归） | `node plugins/amayui-emulator/smoke.mjs` → **14 ✓**，`[smoke] 全部通过 ✅`（**主 agent 独立复跑**） |
| 语法 | `node --check` 四个 js 文件全 OK |
| ★对抗性验证 | 子代理用 `module.register` + `data:` URL 把 `client.js` **在内存里改坏 28 种**（pointerEvents→none、砍尺寸档、默认不收起、胶囊坐标、删 onMouseDown、mouseup 不摘监听、按钮改「启动」、去 `cache:'no-store'`、origin、order、slot id、错槽注册、去 `--instance`、模态不可达、去 clamp、不兜底存储、closeModal 空实现、不显示端口、POLL_MS 改 30s、去按钮集断言……）⇒ **28/28 全被抓、零漏网** |
| ★它抓出的真 bug | `writeStore` 误读 `state.selectedId`（内存态字段名是 `selected`）⇒ **`selectedId` 永远写不进 localStorage**。已修，并补"写入的 selectedId = 当前选中实例"与"点行切换选中"两条断言 |
| 真浏览器三态 | `npx electron ../../plugins/amayui-emulator/float-shot.cjs` → exit 0，三态截图见 `evidence/` |
| 全量回归 | `npm run verify` → **EXIT=0**（`app/` 侧本票未改文件，1152 tests / 1150 pass / 0 fail） |

### 3. ✅ 验收第 9 条：真浏览器三态实拍（已完成）

执行器 `plugins/amayui-emulator/float-shot.cjs`（新）：把 `lib/client.js` 的 `shell.overlay` 组件在一个
**独立 harness 页**里用真 React 挂起来（本地 React 18 UMD + `window.__ModuleLoader__` 桩 +
假 `/dsh-emulator/api/__instances` + 假对话正文），在**隐藏 Electron 窗**（1280×800）里截三态。
**插件源码零改动**（harness 里的 `client.js` 与仓库里那份逐字节相同，diff 为空）。

```bash
cd app/amayui-emulator && npx electron ../../plugins/amayui-emulator/float-shot.cjs
```

实跑（三次一致，exit 0）：两个 slot 都注册（id/order 36 与 160）· 轮询打了 2 次 `__instances` ·
页面 0 个 JS 异常 · **默认态＝收起胶囊** · 胶囊固定在右下 (1197,753) 67×31（视口 1280×800，right/bottom 各 16）·
三态截图 153196 / 209577 / 123570 B（均 >20KB）· 画面框内容区**正好 640×360**（含 1px 边框 642×362）·
**关模态回到浮窗**（`{panel:true,modal:false,pill:false}`）。

证据：`evidence/panel-1-collapsed.png`（默认胶囊：**浮在假对话正文之上、正文一条都没被推挤**）、
`evidence/panel-2-expanded.png`（展开：标题栏 + 收起/尺寸档 0.5×/放大/新标签/刷新，列表 `dbg-a` 选中金框、
`dbg-b` 心跳 5s 前，下方 640×360 画面框）、`evidence/panel-3-modal.png`（模态）、
`evidence/float-panel-e2e.txt`（完整输出与目视核对表）。

**另一处只能靠真框架语义推定的**：*"切会话/滚对话时浮窗不消失、不随滚动"* —— 那是 `shell.overlay` 的框架行为
（文档原话：above every column and **outside their scroll containers**）+ `position:fixed`；离线冒烟无法验，重启后在 GUI 里一眼可确认。

### 4. 一个由子代理做、但你可以一句话翻掉的决定

头部按钮「🖥 调试画面」的点击语义从"直接开模态"改成了"**展开浮窗**"（「放大」才是模态入口）。
理由：既然形态是常驻浮窗，点按钮最自然的期待是"把它叫出来/收起来"。
若你更想"点按钮直接进模态"，改一行即可（`onClick` 里 `setShared({open:true})`）。
