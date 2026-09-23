# T-0133 · 可行性评估：把 emulator 的渲染面桥接进 DSH（**调试观察宿主**）

> 需求原文（第一轮，2026-09-23）：*「了解目前 emulator 项目的架构，评估能否允许其将界面部分（electron render）
> 桥接到 dsh（当前环境）中，作为一个小 iframe？这可能会涉及到将原 IPC 可选的替换为 ws based。请先评估这个改造的可行性。」*
>
> **需求背景更新（第二轮，同日）**：*「因为目前已经提供了远程调试功能，我希望当之后 agent 在调试时，
> 我能看到大致的情况（以及可以真正不实际出现 electron 窗口，而不是像现在将其移动到屏幕外）。
> 为此，我希望可以考虑实现更强的 isolation，例如 instance 隔离的 log/saves 之类的。
> 以及，由于是调试用，像 audio 就可以直接忽略（仅记录 side effects）。
> 不过 setSystemCursor 我理解本来就是 node 侧通过原生实现的，不应该存在 gap？不过这里也应该和 audio 一样忽略。」*
>
> 本文件是**两轮评估报告**（纯分析，不改任何语义代码）：
> **第一轮**（§1–§9）回答"通用 UI 桥接"；**第二轮**（§0 + Part B）按"调试观察宿主"重做结论，
> 并**订正第一轮的三处判断**（§0.9）。§0-A 保留第一轮结论作背景。

---

## 0. 结论（第二轮 · 以「调试观察宿主」为目标；**覆盖 §0-A**）

### 0.1 目标重述（把"评估"钉在真正的用途上）

| 维度 | 第一轮我默认的读法 | 第二轮的实际用途 |
|---|---|---|
| 谁看 | 玩家/人，交互式玩游戏 | **人（你）看 agent 调试**，看个"大致情况" |
| 主驱动者 | 人的鼠标键盘 | **agent**（走 `T-0114` 的远程调试通道） |
| 是否要窗口 | 小 iframe 即可 | **绝对不能出现 Electron 窗口**（不是"挪到屏幕外"这种权宜） |
| 音频 | 要出声 | **不要**，只要引擎侧 side effects 不漂移 |
| 光标 | 要真挪 | **不要**，同 audio |
| 隔离 | 没提 | **要 instance 级**：log / saves 各自独立 |

这个重述**大幅降低了工程量**：第一轮评估里最贵的三项（音频流协议、真光标能力、单会话排他）**全部消失或被更强的方案替代**；
同时暴露出**两件第一轮完全没看见**的事（§0.2 的 ★）。

### 0.2 结论：可行，而且比第一轮更省

| 第一轮以为要做的 | 第二轮的实际结论 |
|---|---|
| 把 `amayui-audio://` 改成 HTTP + Range | ❌ **不用改**：`audio.enabled=false` 静音模式已经就是"忽略声音、只记 side effects"；不给 `audioStreamBase` ⇒ `streamUrl()` 返回 undefined ⇒ 引擎退回 load+decode+（哑）play。**唯一的残留是字节通道**，见 §B.2 |
| 给 web 宿主实现真·系统光标 | ❌ **不用做**：原生能力本来就在 Node 侧（你说得对），按决定忽略。**但第一轮的说法要订正**（§0.9 订正 2） |
| 设计"单游戏会话排他" | 🔁 **换成 instance 隔离** —— 更强、且让"同时开两个调试会话"变安全而不是变错误（§B.3） |
| 桥 `window.api` 的资源/存档/控制面 | ✅ **仍要做**（这是真工作量），但可用 `plugins/uimap` 的 Host 半骨架 + `ticket-board` 的 `inject` 纪律照抄 |
| — | ★**新增**：**agent 的输入通道必须重铺** —— 现在靠 `webContents.sendInputEvent`（`tools/debugsrv.cjs` 的 `click`/`clickn`/`move`），web 宿主没有 webContents。好消息：共享层**已有**声明式输入词汇 `ScenarioEvent` + `applyScenarioEvent(input, ev)`（§B.4） |
| — | ★**新增**：**agent 的 `shot` 必须重铺** —— `capturePage()` 没了；改由渲染侧用已有的 `extract.canvas` 机制回传 PNG（§B.4） |

### 0.3 四种形态与推荐

| 形态 | 人看到的 | 有没有 Electron 窗口 | 工程量 | 备注 |
|---|---|---|---|---|
| **A 浏览器宿主 + DSH 同源 iframe** | 实时、可交互的画面 | **完全没有 Electron** | 大（本报告 §1–§9 全量） | 最彻底；同时把"agent 输入/截图"两条通道一起重铺 |
| **B offscreen Electron + 帧流进 DSH** | 帧流（1–5fps 足够） | 有 Electron 进程，但**无可见窗口** | 小（**只省渲染面**，不省 agent 通道） | ★调研已确证 macOS 可靠，三个硬前提见 §B.4.1（**绝不要 `disableHardwareAcceleration()`**、接受不可聚焦、机器要有已登录图形会话）。⚠️ `sendInputEvent` 在不可聚焦窗口上是否可用**待实验**（§B.4.1.1） |
| **C 隐藏窗口 + 定时 `capturePage`** | 帧流 | 同上 | 最小 | ⚠️【订正 4】macOS 上**其实能做**（`paintWhenInitiallyHidden` 默认 true + `NativeWidgetMac` headless，§B.4.2），但这条线密集回归（#42378 数分钟后整窗变白）且非官方推荐路径 ⇒ **技术可行、不选** |
| **D 无像素观察（digest/telemetry 面板）** | 文本化状态（帧 digest / 门 / 当前 BIN / 四张遥测清单） | 无 Electron（复用 headless 或现有上报） | **最小** | 现有 `ControlStatus`/`PerfTelemetry`/`FrameDigest`/`scene-trace.jsonl` 已经有素材；"大致情况"如果指"跑到哪、卡在什么门"，D 可能就够了 |

**推荐：先 D（半天级，立刻可用）→ 再 A。** 理由：D 能马上把"agent 调试时我看不见"这件事解决掉一大半
（而且与 A 完全共用同一份 telemetry），而 A 是唯一能把"没有 Electron 窗口"和"实时画面"同时拿满的形态。

**B 的定位（调研落定后）**：macOS 上可靠（§B.4.1），但它**只省"渲染面 + 资源宿主"**——
agent 输入通道那时**仍然要铺**（不可聚焦窗口上的 `sendInputEvent` 待实验，§B.4.1.1），
而这条路 A 无论如何也要铺。⇒ B 适合当**"先让眼睛用上、agent 通道后补"的过渡**：
想看画面就立刻能看，不必等整条 web 宿主做完。但**不要把 B 当成"省掉 A"**。

---

## 0.9 本轮订正（四条 —— 明确了第一轮/上一稿哪里说错或说窄）

> 纪律：订正不删旧文（§0-A 与 §4 的原文保留），只在这里与对应段落加指针。

**订正 1（指向 §0-A 硬结论 2、§4 前言、§5 的 C 方案）——"唯一必须改的资源通道是音频流"是错的。**
调试用途下音频**根本不用碰**：静音模式（`emulator.config.json` 的 `audio.enabled=false` / `AMAYUI_AUDIO_ENABLED=0`，
`T-0103`）本来就是"出声全关、引擎侧规则照跑"；`webAudioHost` 在静音下 `streamUrl()` 直接返回 undefined
（`webAudioHost.ts:260`），所以 **web 桥接只要不提供 `audioStreamBase` 就自动走 load+decode+哑 play**，
连自定义 scheme 都不用替换。⚠️ 但**不能把音频通道整个删掉**：静音 `decode` 仍需**原始字节**来算时长
（`webAudioHost.ts:206-217` 调 `audioDurationSec(bytes)`），而时长是引擎判"语音占线/SE 释放"的输入 ——
删了它就从"静音"变成"解码失败"，**引擎侧会漂移**，恰恰违背"仅记录 side effects"的要求。详见 §B.2。

**订正 2（指向 §0-A 硬结论 3 与 §4.1）——`setSystemCursor` 不是能力缺口；你说得对。**
第一轮把"**坐标映射**在 iframe 里不好做"误写成了"**能力**在浏览器里做不到"。事实：
① `native/host-input` 是**纯 Node 的 CJS 门面**（`native/host-input/index.js` 文件头原话：
"主进程（esbuild→CJS）与测试都能直接 require"），加载链 5 步全在 `node:fs/path` 上，**零 Electron 依赖**；
② 独立跑的证据就在仓库里：`node native/host-input/tools/smoke.cjs`（`T-0118` 的验收命令之一）不加载 Electron 也能 `setCursorPos`；
③ Electron 只出现在**坐标换算**那一步：`electron/nativeAddon.ts:130-136`（`BrowserWindow.getContentBounds()` + Windows 的 `screen.dipToScreenPoint()`）。
⇒ 正确的说法是"能力在 Node 侧、随时可用；缺的只是 iframe 在屏幕上的位置"，
而同源 iframe 连这个都能补（子文档可读 `window.frameElement.getBoundingClientRect()` + `window.screenX/Y`；
Windows 还差 DIP→物理一跳，macOS 不需要）。**按你的决定：忽略它，但要登记成"可做、故意不做"，不是"做不到"**（§B.5）。

**订正 3（指向 §4.4）——"单会话排他"换成 instance 隔离。**
第一轮把多标签页并存当成风险、要"拒绝第二个连接"；有了 instance 级 log/saves 隔离之后，
多会话并存是**特性**（可以并行跑两个调试实例做对照），设计从"闸门"变成"命名空间"。详见 §B.3。

**订正 4（指向 §B.4.2 的上一稿）——"隐藏窗口抓帧在 macOS 上大概率不成立"也是错的。**
Electron 的 `paintWhenInitiallyHidden` 默认 `true`，且 [PR #49938](https://github.com/electron/electron/pull/49938) 明说
**macOS 恰恰是"隐藏窗口有帧可拷"的幸运平台**（`NativeWidgetMac` 在这个场景跑 headless 模式），
Win/Linux 才没有帧。我上一稿把 Win/Linux 的知名现象当成了普遍结论。
**但结论仍是"不选它"** —— 理由换成了有确证的脆弱性（#42378 数分钟后整窗变白等）与
"官方唯一推荐的取帧路径是 offscreen + `paint`"，而不是"做不到"。详见 §B.4.2。

---

### 0.10 第三轮：用户的三条决定（2026-09-23，**且它们互相咬合**）

| 决定 | 它一次性消掉了哪类问题 | 落到哪一节 |
|---|---|---|
| ① **focus/blur 改为纯手动、由调试器控制** | "窗口能不能聚焦"整类问题：offscreen 不可聚焦、iframe 失焦、DSH 抢焦点、DOM blur 把按住态清掉 | **§B.4.5** |
| ② **输入与截图改为纯 VM 外层桥接**（不再用 Electron 的 `sendInputEvent` / `capturePage`） | 桥变成**宿主无关**的一份实现：Electron（可见/贴边）/ offscreen Electron / 浏览器三种宿主共用；§B.4.1.1 那条实测项随之**作废** | §B.4.3、§B.4.4 |
| ③ 可忽略"真实 DOM 事件"这条路（保真差异留给你手动体验排查） | 输入注入**只保留一条**（`InputManager` 直写），省掉"虚拟→客户区"逆变换 + DOM 合成事件 | §B.4.3 |

**咬合关系**：②让③成为自然结果（VM 外层桥接本来就不产生 DOM 事件）；①又把②里最后一块"宿主相关"（焦点）搬进了调试器控制面。
⇒ 三条合起来：**输入 / 截图 / 焦点三件事全部落到共享层**，宿主只剩两个职责 —— **提供像素**、**提供资源**。

**第三轮后的形态重估**（B 的风险显著缩小，见 §B.4.1）：

| 形态 | 第三轮后的变化 |
|---|---|
| **A** 浏览器宿主 | agent 通道与 B **共用同一份桥**（不再各自实现）⇒ A 相比 B 的**额外**成本只剩"`window.api` 的 web 实现 + 把 Pixi 页面跑在浏览器" |
| **B** offscreen Electron | ① `sendInputEvent` 的焦点疑云作废（不再用它）；② 若 **B′**（§B.4.4）成立，连 OSR 的 `paint`/NativeImage 都不需要 ⇒ 只剩"GPU 加速不能关 + 要有 GUI 会话 + 隐藏窗口仍出帧"三条 |
| **C** 隐藏窗口 + capturePage | 仍然不选（#42378 白屏史），但**它的问题域与 B′ 高度重叠** —— B′ 就是"C 的窗口策略 + 我们自己的 capture"，值得先做 10 分钟实验区分二者 |
| **D** 无像素面板 | 不变（仍是第 0 步），且与上面三者共用 digest/telemetry |

## 0.11 订正 5 · **hover 能模拟 —— 我错了**（用户当场质询，第三轮内）

> 指向 §B.4.3 的"决定 ③"与 §B.5 的 hover 行。

用户质询：*"输入我理解能够模拟 hover 变化？毕竟 hover 从 electron 投递进 VM 时，应该也就是若干个 move 事件，本身远程调试想模拟也应该是可以做到的？"*
—— **完全正确**，而且比"能模拟"更强：**调试器注入光标走的就是引擎自己的命中测试路径**。证据链（四处）：

| 位置 | 事实 |
|---|---|
| `src/vm/input.ts:230-239` | `setCursor(x,y,valid)` 在位置**变化**时置 `mouseMoved` + `hitTestPending`，**并立即回调 `onCursorMove(x,y)`** |
| `src/vm/engine.ts:731-733` | `onCursorMove = (x,y) => this.routes.hitTest(x,y)` —— 回调体就是**引擎 WM_MOUSEMOVE 里的 `sub_403C50` 命中测试** |
| `src/vm/route.ts:222` | `hitTest` 的文档标题即 "`sub_403C50`（raw 9787-9824）：**按坐标命中测试**"，命中即把游标设为该项 ⇒ 这就是 hover 的 `routes.cursor` / `panel.cursor` |
| `src/vm/handlers/input.ts:386-389` | 明写："`setCursor` 触发 `onCursorMove` = 引擎 WM_MOUSEMOVE 里的 `sub_403C50` 命中测试 —— 而**引擎的 `SetCursorPos` 正是靠 WM_MOUSEMOVE 让脚本看见这次移动**；位置没变则不重算（引擎同样不会产生移动消息）" |

**我误读的来源**：`src/frame/scenario.ts` 文件头的 "…且等待门走 `forceAdvance` 旁路，**根本不经过命中测试/悬停**" ——
那整段是**改造前（B3 之前）的问题陈述**："修前输入分两套…于是 headless 的 `routes.cursor` 恒 −1，
'悬停展开/收起侧栏'这条对外可见行为在 headless 里从不发生"。也就是说，**Scenario 这套东西存在的理由恰恰是修好悬停**，
而我把它描述病因的句子当成了它的性质。⇒ 这是本轮最该记住的一条教训：**读"为什么要有它"的文档时，别把"修前如何"当成"修后如何"。**

**订正后的真实差异（只剩这三条小项，且都不是"悬停不工作"）**：

| # | 真实差异 | 性质 / 处置 |
|---|---|---|
| a | **表达不了"光标出窗"**：`applyScenarioEvent` 的 `cursor` case 恒传 `valid=true`（`scenario.ts:182`），而 `inputAttach` 的 `mouseleave` 走 `setCursor(-100000,-100000,false)` | **真缺口**（一行级）：给 `ScenarioEvent` 加 `valid?: boolean` 或加一个 `leave` kind。有意义 —— 侧栏展开/收起与"光标在不在"相关（`T-0051` 的 `0x10A 侧栏钉光标`） |
| b | 真实 mousemove 额外做 `syncButtons(e.buttons)`（按住态真值重同步） | 对显式 press/release 的调试器**等价**；"卡住"场景由 §B.4.5 的 `focus off` 覆盖 |
| c | **位置没变不重算**、`hitTestPending` 在非等待态会挂到下次等待态才消费 | **这是引擎语义，不是模拟缺陷**（`sub_403C50` 只在移动时/面板首次显示时调；`engine.ts:1145/1161`、`gameStartChain.ts:615` 都记过）⇒ 要写进**给 agent 的用法说明**：*hover 靠"位置变化"触发，且建议在等待态里发 move* |

⇒ 净结论：**决定 ③ 几乎是免费的** —— 相对 Electron/DOM 路径唯一实质损失是 (a) 一个字段；
而在保真度上，注入光标其实**比 DOM 路径更贴引擎**（DOM 路径经 `inputAttach` 会附加一个宿主特有的 `syncButtons`）。

---

## 0-A. 第一轮结论（通用 UI 桥接读法；部分已被 §0/§0.9/§0.10 覆盖，保留作背景）

**可行，而且比预期低风险。** 理由不是"能硬塞"，而是 **Electron 耦合面已经被这个工程自己收敛成了两层薄接口**：

| 层 | 现状 | 换成 web 宿主要做什么 |
|---|---|---|
| 宿主能力面 | 渲染进程对外的**唯一**接口是 preload 经 contextBridge 暴露的 `window.api`（51 个成员，全部声明在 `src/renderer/ipcProtocol.ts`） | 新写一个**同形对象**：`invoke`→`fetch`、`send`→WS、`on`→WS 订阅。VM / 场景 / Pixi 代码 **零改动** |
| 文件访问 | VM 只认 `FileSource` 抽象（`src/arch/fileSource.ts`）；Electron 侧 `IpcFileSource`、Node 侧 `NodeFileSource` | 加**第三个实现**（HTTP 版本）。而 Electron 的 IPC handler 体本来就只是 `NodeFileSource + OverlayDir + decodeAgfRgba` 的薄转发 —— 这三者都是 Node 代码，HTTP 宿主**直接复用** |
| 渲染 | Pixi v8 browser bundle（`dist/renderer/renderer.js`，2.6MB），esbuild `platform:'browser'` 打包成功 ⇒ **零 Node import**（无 `node:`、无 `Buffer`、无 `process`） | 原样在 iframe 里跑 |

DSH 侧同样有现成承载点（**已确证**，非推测）：

* `webServer.register({kind,path,handler})` —— handler **拥有完整响应生命周期（明确允许 SSE 长挂）**；
* `webServer.registerUpgrade({path,handler})` —— **exact-path WebSocket 升级**，DSH 自己的 `/api/remote.mux` 就是这么挂的；
* 仓库里已经有**三个同构的静态 bundle 插件**（`plugins/uimap`、`plugins/ticket-board`、`plugins/htmlcard`），
  其中 `uimap` 正是「Host 半在 GUI 的 webServer 上挂 `/dsh-uimap` 前缀路由（二进制 + JSON API）、Client 半在 GUI 里渲染」——
  **这就是桥接方案的同构样板**；
* **可以同源**：iframe 指 `/dsh-emulator/`（3080 上的插件路由）⇒ 没有 CORS、没有跨源 CSP、cookie 直接可用。

⇒ **推荐方案**：新增 `plugins/amayui-emulator` 静态 bundle（Host 半 = HTTP+WS 宿主，Client 半 = GUI 内小 iframe 模态）。
**WS 不是必须的**——请求/应答用 `fetch(POST)`、推送用 WS（或 SSE）即可；WS 值不值得用取决于要不要做控制面双向推送，见 §5。

三条硬结论先说：

1. **改的是"宿主"，不是"引擎"**：不动 `src/vm/**`、`src/frame/**`、`src/scene/**` 的任何语义；`FileSource` 与 `window.api` 就是为这件事预留的缝（`fileSource.ts` 文件头原话："将来 VM 跑在 Electron renderer 时换成 IpcFileSource，接口不变，VM 代码零改动"）。
2. ⚠️**【订正 1：作废】** ~~**唯一必须改的资源通道是音频流**~~ `amayui-audio://<id>` → 同源 HTTP + Range。而且**这是改进**：现在因为页面是 `file://`、自定义 scheme 是另一个源，Chromium 把 `<audio>` 判为 tainted ⇒ 作者主动**绕开** Web Audio 图（只用 `el.volume`，代码里有实测教训注释）；同源 HTTP 之后这个限制消失。→ 调试用途下音频根本不碰，见 §0.9 订正 1 与 §B.2。
3. ⚠️**【订正 2、订正 3】** ~~**有四项能力在 iframe 里做不到或语义变了**（0x10A 真光标 / autoplay 策略 / `logLineSync` 同步落盘 / 单会话排他）~~ ⇒ 重新分类：**可做但故意不做**（0x10A 真光标 —— 能力在 Node 侧，§0.9 订正 2）；**已无意义**（autoplay 策略 —— 音频整个忽略）；**降级**（`logLineSync` 同步落盘）；**换成隔离**（单会话排他 → instance 隔离，§0.9 订正 3）。见 §4 与 Part B。

---

## 1. 现状：宿主面到底有多宽

### 1.1 三层结构（`app/amayui-emulator/`）

```
electron/            壳：main.ts(仅装配) / windows.ts / preload.ts / ipc/{files,control}.ts / logging.ts / nativeAddon.ts
src/renderer/        浏览器侧宿主：pixiBackend.ts + app/{boot,session}.ts + ipcFileSource.ts + ipcProtocol.ts
src/{vm,frame,scene,audio,save,arch,text}/   与宿主无关的共享层（VM/帧驱动/场景语义/音频规则/存档/文件抽象）
src/renderer/headlessScene.ts + headlessFrameHost.ts   ★ Node 侧的无渲染宿主（同一份场景语义）
dist/renderer/renderer.js    esbuild browser IIFE（含 Pixi）
dist/control/control.js      控制窗（同样 browser IIFE）
```

关键事实：**`src/renderer/**` 与 `control/**` 里没有一处 `require(`、没有 `node:` import、没有 `process.env`**
（唯一的 `process.env` 读取在 `electron/preload.ts` 的 `record/recordScenario/recordScript` 三个数据属性里）。
先前 grep `from 'node:` 在 `src/` 下的命中全部落在 Node 侧文件（`arch/nodeFileSource.ts`、`arch/overlay.ts`、
`arch/resourceDir.ts`、`arch/systemPaths.ts`、`emulatorOptionsFile.ts`、`report.ts`、`run.ts`），
且 `build-electron.mjs` 用 `platform:'browser'` 打包 `src/renderer/renderer.ts` 能成功 —— 两重独立证据。

### 1.2 唯一的宿主契约 = `window.api`

* 声明：`src/renderer/ipcProtocol.ts:11` 的 `declare global { interface Window { api: {...} } }`；
* 实现：`electron/preload.ts:11` 的 `contextBridge.exposeInMainWorld('api', {...})`。

形态只有 **4 种**（这一条决定了桥接的机械性）：

| preload 形态 | 出现处 | web 侧等价物 |
|---|---|---|
| `ipcRenderer.invoke(...)` → Promise | 资源读取/存档（约 20 条） | `fetch('/dsh-emulator/api/<m>', {method:'POST', body})` |
| `ipcRenderer.send(...)` 单向 | 日志/trace/状态上报/光标/关窗 | `ws.send(...)` 或 `fetch(..., {keepalive:true})` / `sendBeacon` |
| `ipcRenderer.sendSync(...)` **同步** | **只有 `logLineSync` 一条** | ❌ 无同步等价物 → 异步化（见 §4.3） |
| `ipcRenderer.on(channel, cb)` 订阅 | traceAll/filter/skipOp/debugQuery/breakCommand | WS 订阅（或 SSE） |

### 1.3 文件层已经是可替换实现（§0 表格第 2 行的证据）

* 接口：`src/arch/fileSource.ts:36` `export interface FileSource`（含 `readScript/readFile/readScriptByName?/appendPackNumbers?/readSaveData/...`），文件头明说这是"跨平台"的隔离点；
* Electron 侧：`src/renderer/ipcFileSource.ts:13` `export class IpcFileSource implements FileSource`（纯转发）；
* Node 侧：`src/arch/nodeFileSource.ts`；
* **Electron 主进程的 IPC handler 体**（`electron/ipc/files.ts:30` `const fileSource = new NodeFileSource(...)`）已经只是
  `NodeFileSource`（安装目录 + ALF 切片 + `*.AAI` 扫描）/ `OverlayDir`（玩家数据 base+overlay）/ `decodeAgfRgba`（主进程解码 AGF）
  的**薄转发**。这三者**没有一处依赖 `electron`** ⇒ HTTP 宿主可以把 `registerFileIpc()` 的函数体抽出来直接调，
  **不需要重写资源层**（这是本评估里最关键的一条"省事"结论）。

### 1.4 headless 先例：第三个宿主不是新架构

`src/frame/host.ts:18` 定义了 `FrameHost`（`now/yield/advanceModel/present/needsRender/poolPending/texturesIdle/audio/digest*`），
`src/renderer/headlessFrameHost.ts` 把无渲染宿主接成 `FrameHost`。
即：**"同一份 VM/场景语义 + 多个宿主实现"是这个工程既有的分层**（Electron Pixi 宿主 / headless 宿主），
web 宿主是**并列的第三个**，不是另起炉灶。

---

## 2. DSH 侧的承载能力（确证）

> 证据来自已安装的 npm 包 `@deepseek-ai/dsh@0.1.5-rc.1` 及其 `node_modules/@deepseek-ai/*`。
> ⚠️ 这些路径**不在本仓库内**（不进 `evidence[]` 锚点），且会随 DSH 版本漂移；升级 DSH 后需重新核对。

### 2.1 扩展点：`webServer`（HTTP）与 `registerUpgrade`（WebSocket）

`dsh-host-webserver`（`lib/types/index.d.ts`）的公开面：

```ts
register(route: { kind:'exact'|'prefix'; path: string;
                  handler:(req: IncomingMessage, res: ServerResponse) => void|Promise<void> }): () => void
//   ↑ 注释原文：Owns the full response lifecycle (may hold the response open, e.g. SSE)
registerUpgrade(route: { path: string;
                  handler:(req: IncomingMessage, socket: Duplex, head: Buffer) => void|Promise<void> }): () => void
//   ↑ 注释原文：Owns protocol negotiation and the upgraded socket after dispatch —— WebSocket 完全可用
```

* **WS 先例（同仓外，但同进程）**：`dsh-api-gateway/lib/index.js:471` 用 `webServer.registerUpgrade({path:'/api/remote.mux', ...})`
  挂自己的 WebSocket，并先调 `connection.requestRejection(req)` 做 Host/Origin 信任栅栏，
  再交给 `RemoteStreamMuxServer.handleUpgrade(req, socket, head)`；其依赖里就有 `ws@^8.21.0`。
  ⇒ **我们也可以 `registerUpgrade('/dsh-emulator/ws')` + `ws` 的 `noServer`/`handleUpgrade`**（或手写 RFC6455 握手，~60 行，uimap 就是"零运行时依赖"的风格）。
* **`connection.requestRejection(request)`** 可复用同一套 Host/Origin 栅栏（可选，同源时天然通过）。
* ⚠️ **gzip 与 Range 的交互已经处理好了**：`dsh-host-webserver/lib/index.js:111` —— 响应带 `content-range` 头就**不压缩**
  ⇒ 音频 Range 走这条路由是安全的（README 也写明 "range responses, SSE ... remain unchanged"）。

### 2.2 可以同源（这是"小 iframe"最省事的前提）

DSH GUI 是同一个 `node:http` server 服务：SPA dist 走 fallback 路由，插件路由走 `register`。
⇒ iframe 指 `http://127.0.0.1:3080/dsh-emulator/` 与父页**同源**：无 CORS、无第三方 cookie 问题、
音频 `<audio src="/dsh-emulator/audio/31">` 也不需要 CORS 头。

### 2.3 CSP / 帧策略：**没有拦**

* `dsh-web-frontend/dist/index.html`（SPA 外壳）**没有** `<meta http-equiv="Content-Security-Policy">`；
* 全 `@deepseek-ai/*` 包里 grep `X-Frame-Options` / `frame-ancestors` **零命中**；
* GUI 里用 iframe 也已有先例：`plugins/htmlcard/lib/client.js:90/123` 用 `react.createElement('iframe', {sandbox, srcDoc})`。
  ⚠️ 注意它的 `sandboxProp` 默认是 `sandbox: ''`（禁脚本）；**我们要嵌的是游戏页，必须给 `allow-scripts allow-same-origin`**
  （否则源变成不透明源，`fetch('/dsh-emulator/api')` 会变跨源且拿不到 cookie）；更稳的做法是**不要 srcdoc，直接用
  `<iframe src="/dsh-emulator/">`**，让它是一个正常的同源文档。
* 父页若要**反向**被嵌（DSH 嵌到别处）才需要关心 `frame-ancestors`；本需求不涉及。

### 2.4 仓库内先例（这就是方案的骨架）

| 插件 | 给了什么可复用的东西 |
|---|---|
| `plugins/uimap/lib/index.js:325` | `ctx.effect(() => webServer.register({kind:'prefix', path:'/dsh-uimap', handler}))`：**前缀路由同时服务二进制（PNG）与 `/api/*` JSON** |
| `plugins/ticket-board/lib/index.js:186-188` | ⚠️`webServer.register` 会拼 `prefix + '/'` ⇒ **path 不能带尾斜杠** |
| `plugins/ticket-board/README.md` | ⚠️**必须把 `webServer` 放进 `inject`**，否则在 base 阶段挂载、`ctx.get('webServer')` 为 `undefined`、路由**静默跳过**（作者踩过并记录的坑） |
| `plugins/htmlcard/lib/client.js` | GUI 内 iframe + `shell.overlay` 全屏模态 + `tool.call.toolview` 工具卡的写法 |
| `plugins/ticket-board/lib/index.js` | 工作区根目录怎么拿：`ctx.get('sandboxPolicy')?.workspaceRoot`（HTTP 请求没有 session 上下文） |

> 结论：**承载方式不需要发明**，把 `uimap` 的 Host 半 + `htmlcard` 的 Client 半拼起来就是骨架。

### 2.5 运行时实测（对正在跑的本机 3080 只读 GET；由只读子代理独立复核）

| 探测 | 结果 | 推论 |
|---|---|---|
| `curl /dsh-uimap/api/state` | `200 {"ready":false}`，**无需任何 cookie** | `webServer.register` 的普通路由**不走** `connection` 的 Host/Origin 栅栏与 cookie 认证（⚠️见 §4.6 加固） |
| `curl -N /plugins/events` | 立即吐 `data: {"type":"graph",…}` | **SSE 长挂在这台 server 上是活的**（`dsh-client-hmr` 就是活例）⇒ §5 里"用 SSE 代替 WS"不是纸上方案 |
| `curl -i /favicon.svg`、`curl -i /` | 响应头只有 `content-type`/`cache-control` 类；`/` 无 cookie 时 **401** | 无 CSP / 无 XFO；**SPA index 需要鉴权，但插件路由与静态资源不需要** ⇒ iframe 文档走插件路由即可 |
| 全 `@deepseek-ai/*` 树 grep CSP / frame 相关 | **0 命中** | 两个方向都不被 DSH 拦 |
| `dsh-web-app/lib/startup.js:40` | 明确拒绝 `--host 0.0.0.0` | 这套路由默认只绑 loopback；我们的游戏页随之**天然只在本机可达** |

另外两条发布包内的 iframe 先例（补 §2.3）：
`@deepseek-ai/dsh-client-ui-sidebar-documentpreview/lib/client.js` 用 **blob URL + `sandbox="allow-scripts"`**；
`plugins/htmlcard/lib/client.js` 用 **srcdoc**。⇒ 两种形态都跑得通，**但都不是我们要的**：
游戏页要 `fetch/WS/WebGL`，所以应当用**正常的同源 `src="/dsh-emulator/"`**，而不是 srcdoc/blob（后者在不加
`allow-same-origin` 时是不透明源，`fetch('/dsh-emulator/api')` 会变跨源且拿不到 cookie）。

---

## 3. 通道映射表（`window.api` 全 51 个成员 × web 替代）

来源：`src/renderer/ipcProtocol.ts` 的全局声明（逐一可核）。`?` 表示声明为可选、调用点用 `?.` 降级。

### 3.1 游戏窗：请求-应答（→ `POST /dsh-emulator/api/<m>`，二进制用 `application/octet-stream`）

| # | 成员 | 现在的语义 | web 替代 |
|---|---|---|---|
| 1 | `readScript(index)` | 脚本字节（`{index,name,data:number[]}`） | POST → JSON（或二进制 + 头） |
| 2 | `readScriptByName?(name)` | 读档时装 `CALLBACK_LOAD.BIN` | 同上 |
| 3 | `readFile(path)` | 任意文件原始字节 | 同上 |
| 4 | `appendPacks?()` | 已装载扩展包包号 | 同上 |
| 5 | `readConfigIni()` | `SYS4REG.INI` 文本（overlay→base） | 同上 |
| 6 | `saveConfigIni?(text)` | 写回（只写 overlay） | POST |
| 7 | `readEmulatorOptions?()` | `emulator.config.json` 文本 + 环境变量覆盖 | POST（env 覆盖由 Host 半注入） |
| 8 | `readSaveData?()` | `SAVE.DAT` 字节 | POST → 二进制 |
| 9 | `writeSaveData?(data)` | 写 `SAVE.DAT`（只写 overlay） | POST ← 二进制 |
| 10 | `readSaveFlags?()` | 两侧并集的「已使用文件」 | POST → JSON |
| 11 | `readSaveDataBoth?()` | 两侧原始字节 | POST → 多段二进制 |
| 12 | `readSaveSlot?(slot)` | 槽 `.DAT` 字节 | POST → 二进制 |
| 13 | `writeSaveSlot?(slot,data)` | 写槽（只写 overlay） | POST ← 二进制 |
| 14 | `deleteSaveSlot?(slot)` | 删 `.DAT`+`.STH` | POST |
| 15 | `copySaveSlot?(from,to)` | 复制槽 | POST |
| 16 | `readSlotThumb?(slot)` | `.STH` 字节 | POST → 二进制 |
| 17 | `writeSlotThumb?(slot,data)` | 写 `.STH` | POST ← 二进制 |
| 18 | `image(id)` | AGF 解码后的 RGBA + 尺寸 | POST → 二进制（或 `GET /image/<id>` 可缓存） |
| 19 | `readById?(id)` | 原始字节（Live2D `.MOC`/`.MTN`/PNG） | 同上 |
| 20 | `audio?(key)` | SE/语音字节（≤~350KB） | `GET /audio/<key>`（**可带 Range，直接统一到流式通道**） |
| 21 | `musicTable?()` | 曲号表 | POST → JSON |
| 22 | `font(file)` | 内置字体字节（**CJK 最大 24MB**） | `GET /font/<name>`（可缓存 + Range；比 POST 更合适） |
| 23 | `debugQuery(payload)`（控制面 invoke） | 要回答案 | POST（或 WS req/res） |

### 3.2 游戏窗：单向（→ WS 帧，或 `sendBeacon`/`keepalive` fetch）

| # | 成员 | web 替代 | 备注 |
|---|---|---|---|
| 24 | `logLine(text)` | WS 单向 | 高频，必须非阻塞 |
| 25 | `logLineSync(text)` | ❌→ 异步 | **唯一同步通道**，见 §4.3 |
| 26 | `appendTraceLine(line)` | WS 单向 | 定向 trace（`.tmp/scene-trace.jsonl`） |
| 27 | `appendReplayLine?(line)` | WS 单向 | `--record` 回放轨迹（gzip） |
| 28 | `sendRendererStatus(s)` | WS 单向 | → 控制面 |
| 29 | `sendDebugQueryResult(payload)` | WS 单向 | 调试查询回执 |
| 30 | `sendBreakPaused(payload)` | WS 单向 | 断点暂停持续态 |
| 31 | `sendBreakList(payload)` | WS 单向 | 断点表快照 |
| 32 | `closeWindow()` | WS 单向 | **语义要重定义**：服务端关会话 / 请父页卸载 iframe |
| 33 | `setSystemCursor?(x,y)` | WS 单向（Host 尽力而为） | **iframe 里做不到**，见 §4.1 |
| 34 | `controlBreakCommand(cmd)`（控制面） | WS 单向 | |

### 3.3 游戏窗：订阅（← WS 下行）

| # | 成员 | 触发者 |
|---|---|---|
| 35 | `onTraceAll(cb)` | 控制面切「全量指令日志」 |
| 36 | `onTraceFilter(cb)` | 控制面设定向 trace 白名单 |
| 37 | `onControlSkipOp(cb)` | 控制面点「作为桩函数跳过」 |
| 38 | `onDebugQuery(cb)` | 调试台/`tools/dbg.cjs` 发命令 |
| 39 | `onBreakCommand(cb)` | 断点指令 set/clear/list/continue |

### 3.4 数据属性（不是函数，preload 里直接给的常量/环境变量）

| # | 成员 | 现状来源 | web 替代 |
|---|---|---|---|
| 40 | `audioStreamBase` | 常量 `'amayui-audio://audio/'` | 常量 `'/dsh-emulator/audio/'`（或 `location.origin + ...`） |
| 41 | `record` | `process.env.AMAYUI_RECORD === '1'` | URL query（`?record=1`）/ `/api/session` 首帧配置 |
| 42 | `recordScenario` | `AMAYUI_SCENARIO_NAME` | 同上 |
| 43 | `recordScript` | `AMAYUI_SCENARIO_SCRIPT` | 同上 |

### 3.5 控制窗（`control/**`，同样 browser IIFE，同样只认 `window.api`）

| # | 成员 | web 替代 |
|---|---|---|
| 44 | `controlRestart()` | WS 单向（服务端重启会话） |
| 45 | `controlSetTraceAll(enabled)` | WS 单向 |
| 46 | `controlSetTraceFilter(ops)` | WS 单向 |
| 47 | `controlForceClose()` | WS 单向 → **服务端语义**：结束会话 / 杀 worker（网页没法"销毁窗口"） |
| 48 | `controlSkipOp(opcode)` | WS 单向 |
| 49 | `onControlStatus(cb)` | WS 订阅 |
| 50 | `onBreakPaused(cb)` | WS 订阅 |
| 51 | `onBreakList(cb)` | WS 订阅 |

> **归类结论**：51 个成员里 **23 个请求-应答、12 个单向、8 个订阅、4 个数据属性、4 个控制窗订阅/单向**，
> 全部可用 `fetch(POST)` + WS（或 SSE）表达；**唯一"没有等价物"的是 `logLineSync`（同步）**。
> ⇒ 用户说的"把 IPC 可选地换成 ws based"在**机制上成立**，但**最优解是混合**（请求/应答走 HTTP、推送走 WS、大二进制走 HTTP+Range），
> 理由见 §5。

---

## 4. 做不到 / 必须降级（⚠️ 本节已被 §0.9 订正：**只剩 4.3 是"被迫降级"，4.1 是"可做但故意不做"，4.2 已无意义，4.4 换成隔离**）

### 4.1 ⚠️【订正 2】`0x10A` 真·系统光标（`setSystemCursor`）——**不是能力缺口；按决定忽略**

* 现状：渲染侧"虚拟 1280×720 → 客户区 CSS 像素"（`pixiBackend.ts` 的 `setSystemCursor`，用 `canvas.getBoundingClientRect()`），
  主进程补"客户区 → 屏幕"（`BrowserWindow.getContentBounds()`）+ Windows 的 DIP→物理（`electron/nativeAddon.ts`），
  最后落到原生模块 `native/host-input` 的 `setCursorPos`。
* 浏览器里**两道都断**：① 网页不能挪 OS 光标；② 就算 Host 半（Node）加载同一个原生模块，也**不知道 iframe 在屏幕上的位置**
  （`window.screenX/screenY` 给的是浏览器窗口，拿不到 iframe 在父页里的偏移，跨文档只能靠父页 postMessage 协助，脆弱）。
* **降级（已现成）**：`pixiBackend.ts` 的调用点写的是 `window.api?.setSystemCursor?.(...)` ——
  通道缺失即**静默 no-op**，引擎侧坐标照旧生效，脚本逻辑不受影响，玩家看不到的只是"光标被挪过去"。
* **要做的**：不改代码；在 `analysis/engine-capabilities.json#host-cursor-warp` 的宿主矩阵里登记
  "web 宿主 = 不支持（静默降级）"，并回链 `T-0053`（该能力的实现票）与 `T-0118`（darwin x86_64 实跑票）。

### 4.2 ⚠️【订正 1】自动播放策略（BGM/语音）——**已无意义**（调试用途下音频整个忽略；§B.2）

* 现状：`electron/main.ts:24` 在 app ready **之前** `app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required')`，
  这正是"TITLE 一起就有 BGM"的前提。
* 浏览器里 `AudioContext` 必须由用户手势解锁。
* **降级（已现成）**：`webAudioHost.ts` 文件头写了兜底 —— "构造即尝试 `resume()`，并在首次 `keydown/pointerdown` 上也 resume 一次"。
  ⇒ 表现是"点一下之后声音正常"，不是"永远没声"。
* **要做的**：文档登记这条差异；若想要更好，可在 Client 半把"打开游戏模态"本身当成手势先 `resume()`（模态由点击打开 ⇒ 天然是手势）。

### 4.3 `logLineSync`（唯一同步通道）——**降级为异步 flush**

* 现状：`ipcRenderer.sendSync('log-line-sync')`，调用点只有 `src/renderer/app/traceLog.ts:49`（关窗/卸载路径的落尾），
  **返回值被忽略**（`if (window?.api?.logLineSync) window.api.logLineSync(batch);`）。
* web 侧没有同步 RPC（`fetch` 全异步；Chrome 也禁止卸载期同步 XHR）。
* **降级**：改成 `ws.send` / `navigator.sendBeacon('/dsh-emulator/api/log-flush', batch)` —— 返回值本来就没人用，
  语义损失仅"极端情况下尾部几行日志可能丢"，且 `logging.ts` 的落盘本来就允许丢（非阻塞 write stream）。
* **要做的**：新 bridge 里把它实现成异步 + Beacon；**调用点不用改**（保持 `window.api.logLineSync` 这个键存在即可）。

### 4.4 ⚠️【订正 3】单游戏会话排他——**换成 instance 隔离**（§B.3；隔离之后多会话是特性不是风险）

* 现状：Electron 只 `windows.createGame()` 一个游戏窗（`electron/windows.ts:99`），天然单实例；
  overlay 写（`SAVE.DAT` / 槽 `.DAT` / `SYS4REG.INI`）只有一路写者。
* web 宿主可以被**两个标签页/两个 iframe** 同时打开 ⇒ 两个 VM 同时跑、同时写同一份 overlay（存档互踩）。
* **要做的**（新增，不可省）：Host 半维护"活动会话"单例 —— 第二个连接要么被拒绝，要么以**只读观察者**身份接入
  （后者更好：正好和 `T-0114` 调试台的"长期进程 + 短连接客户端"同形）。这条要在实现票里写进 acceptance。

### 4.5 两条"听起来致命但实际不咬"的浏览器约束（已核，记下来免得下轮重新恐慌）

| 约束 | 会不会咬 | 依据 |
|---|---|---|
| iframe 里 `SharedArrayBuffer` 不可用（DSH 不发 COOP/COEP ⇒ 顶层不可能 cross-origin isolated，同源 iframe 也一样） | **不咬** | `grep -rn "SharedArrayBuffer\|crossOriginIsolated" app/amayui-emulator/src/renderer control` → **零命中**。渲染面是单线程 Pixi + Web Audio，不用 SAB |
| Chrome 第三方存储分区（iframe 的 `localStorage`/`IndexedDB`/`CacheStorage` 按顶层 site 分区，与"直接打开"不共享） | **不咬** | `grep -rn "localStorage\|sessionStorage\|indexedDB\|caches\." app/amayui-emulator/src/renderer control` → **零命中**。所有持久化都在服务端（`SAVE.DAT`/槽/`SYS4REG.INI`），走 IPC/HTTP 而非浏览器存储 |

⇒ iframe 方案**没有**隐藏的浏览器级拦路虎；剩下的都是本报告已列的显式取舍。

### 4.6 加固项（不是阻塞，但实现票里必须写）

`webServer.register` 的普通路由**不经认证、也不校验 Host**（§2.5 实测无 cookie 200）。而本桥接要暴露的是
**整个游戏资源目录 + 存档写入**，比 uimap 的只读 PNG 敏感得多。实现时应：
① 在 handler 里调 `ctx.connection.requestRejection(req)`（DSH 现成的 Host/Origin 栅栏，api-gateway 就这么用），
或自己校验 `Host`/`Origin` 必须是 `127.0.0.1:3080`；
② 写类方法（`writeSaveData`/`writeSaveSlot`/`saveConfigIni`）只接受同源请求；
③ 保持 loopback 绑定（DSH 已拒绝 `--host 0.0.0.0`，不要绕过）。

---

## 5. 候选方案对比与推荐

| 方案 | 形态 | 优点 | 代价 / 风险 |
|---|---|---|---|
| **A（推荐）同源 bundle 插件** | `plugins/amayui-emulator`：Host 半在 3080 上注册 `/dsh-emulator` 路由 + `/dsh-emulator/ws` 升级；Client 半在 GUI 里放小 iframe（模态/工具卡） | **同源**（无 CORS/CSP/cookie 问题）；随 DSH 启动；复用 uimap 的 Host 半骨架与工作区根解析；控制面可做成 GUI 面板 | 依赖 DSH 插件体系（`inject:['fs','shell','webServer','sandboxPolicy']`）；路由与 webServer 版本绑定 |
| B 独立进程 + 跨源 iframe | `npm run web`（Node 起 HTTP+WS，无 Electron）；iframe 指 `http://127.0.0.1:8899/` | 与 DSH 解耦（浏览器直接开也能用；便于当原型跑通）；进程边界清晰（崩溃不拖 GUI） | **跨源**：父页要放行（当前 DSH 无 CSP，暂时不拦，但改了 DSH 前端就得跟）、服务端要加 CORS 头、音频要 CORS、cookie/`sec-fetch-site` 要自己处理；生命期要自己管 |
| C 全 WS（含资源与音频） | 一切走一条 WS | 概念最简（"把 IPC 换成 WS"字面实现） | ❌ 不推荐：大二进制（RGBA 图 ~3.7MB/张、字体 24MB、BGM 2–6MB）在 WS 上要自己做分块/背压；音频丢掉浏览器原生 `Range/seek/loop/<audio>` 能力（现在正是靠它避免 30–50MB PCM 解码）；且 DSH 的 gzip 对 range 不压缩这个便利也用不上 |

**推荐 A，并把 B 当作 A 的"第 1 步"。** 理由：A 是唯一能同时拿到"同源 + 复用现有资产 + 随 GUI 启动"的形态；
而 A 的 Host 半与 B 的 server 逻辑**是同一份代码**（只是挂载方式不同：`webServer.register` vs `http.createServer`），
所以先把 server 写成传输无关的一份、再决定挂在哪，是最省的路径。

### 关于"IPC → WS"的取舍（回答用户那句"可选地替换为 ws based"）

* **请求-应答**：`fetch(POST)` 比 WS 更好 —— 天然有 HTTP 状态码/错误语义、可被 devtools 看见、无状态、易并发。
* **推送**：WS 比 SSE 好一点点（双向、无需第二条连接），但 SSE 的实现成本更低（`res.write` 就行，webServer 的 handler 明确支持长挂）。
* **大二进制**：必须走 HTTP（Range + 可缓存），不要进 WS。
* ⇒ "ws based"应当理解为**控制面走 WS**，而不是"所有 IPC 都塞进 WS"。

---

## 6. 若要落地：分步与"第一刀"

> 本票只评估；下面是给后续实现票的边界建议（**不在此建票**，等用户决定）。

**第 1 步（零行为变更，可上守卫）**：把 `electron/ipc/files.ts` 里 `ipcMain.handle(...)` 的**函数体**抽成传输无关的
`host/service.ts`（输入 = 参数对象，输出 = 纯数据 / 二进制 / 抛错），`registerFileIpc()` 与未来的 HTTP 路由都调它。
判据：`npm run verify` 全绿 + 现有 Electron 路径行为不变。

**第 2 步（原型）**：独立进程版 web 宿主（方案 B 的 server）+ `src/renderer/webBridge.ts`（构造 `window.api` 同形对象）
+ `/audio` Range 端点 + CSP 调整。判据：浏览器里能跑到 TITLE、能进菜单、BGM 出声、存档写得进 overlay。

**第 3 步（产品形态）**：包成 `plugins/amayui-emulator` bundle（Host 半路由 + WS 升级；Client 半头部按钮 + 模态 iframe），
并把控制窗/调试台浏览器化（第二个 iframe 或 GUI 面板）。

**第 4 步（收尾）**：单会话排他、能力降级登记（`host-cursor-warp`）、文档（`README.md` 的宿主章节 + `docs-new/04-app/*`）、
以及把"web 宿主"写进 `analysis/engine-capabilities.json` 的宿主矩阵口径。

**"小 iframe"要特别注意的一点**：内部视口是**写死的 1280×720**
（`src/renderer/viewport.ts` 的 `VIEW_W/VIEW_H` + `setupPixiStage` 里 `app.canvas.style.width/height`），
所以"小"必须靠外层 `transform: scale(s); transform-origin: top left` 缩放 iframe 元素实现 ——
`inputAttach.ts` 的 `toVirtual` 走 `canvas.getBoundingClientRect()`，缩放后坐标映射仍然自洽（不要改成压小 iframe 元素而后让 canvas 溢出裁剪）。

---

## 7. 未确认项 / 需要实测的点（诚实边界）

1. **未实跑**：本票是静态评估，**没有**真的起一个 web 宿主跑过。所有"能跑"的结论都基于
   "渲染 bundle 是 browser IIFE + 零 Node import + esbuild 打包成功"这三个静态证据，**不等于**跑起来没有运行时惊喜
   （最可能的两处：Live2D 的 `.MOC` 解码、Pixi 在 iframe 里的 WebGL 上下文与 `devicePixelRatio`）。
   DSH 侧的**承载能力**已做只读实测（§2.5）；**"emulator 在里头能不能跑到 TITLE"没有实测** —— 这是本报告最大的诚实边界。
2. **大二进制与 gzip 的交互已定性、未实测**：正在跑的 web profile **确实开了 gzip**
   （`dsh-web-app/cordis.patch.yml:141-143` `compression: gzip / level 1 / threshold 1024`；
   实测 `curl -H 'Accept-Encoding: gzip' /dsh-uimap/api/state` → `Content-Encoding: gzip`）。
   而 `compressible` 的判定是：`image/png` **false**（不会压）、`audio/ogg` **false**、
   **`application/octet-stream` true（会压）**、`font/ttf` true —— 也就是说**原始 RGBA / 字体 / `.MOC` 这类
   以 octet-stream 出去的二进制会被 level-1 gzip 白压一遍**（loopback 上带宽不值钱，CPU 才值钱）。
   规避手段已确证存在：`compression/index.js:43,296` 尊重 `Cache-Control: no-transform`，且 DSH 的 filter
   （`dsh-host-webserver/lib/index.js:105-112`）另外跳过 `content-range` 与 `text/event-stream`。
   ⇒ 实现时对二进制路由加 `Cache-Control: no-transform`（音频 Range 路由天然免疫）。**待实测**的只是开销大小。
3. **`ws` 依赖怎么进 profile**：DSH 自己的 `node_modules` 里有 `ws@8`，但我们自己的 bundle 插件应当**自己声明依赖**
   （`dsh plugin add` 会 `pnpm` 装进 profile）。是否会被 profile 的 `allowBuilds` 之类策略拦，需实测（uimap 是零依赖路线）。
4. **键盘/滚轮在"小 iframe"里的体验**：`inputAttach.ts` 只对映射表内的键 `preventDefault`，
   滚轮监听是 `{passive:true}` **且不 preventDefault** ⇒ 在父页里滚轮会冒泡去滚 DSH 的界面。这条要改（在游戏页里 `preventDefault`），
   但它属于实现票的范围；另外 iframe 需要先点一下拿焦点（方向键/回车才有用）。
5. **控制面的多客户端 → 已升级为"实例维"问题**：`T-0114` 的调试协议（`{id,text}` / `{op}`）默认单例；
   有了 instance 隔离之后，"哪个实例"必须成为协议的一等字段（§B.3.3 坑 3）。**是设计决策，不是未知事实**。
6. **反向嵌入不成立（与本需求无关，记下来防误判）**：别处页面嵌 DSH 会被打回 ——
   cookie 是 `HttpOnly; SameSite=Strict` ⇒ 跨站 iframe 带不上 cookie（401），`/api` 还会因 `sec-fetch-site: cross-site` / Origin 不等被 403。
   本需求是"DSH 嵌别人"，不受影响。
7. **WS 的 Origin**：iframe 内建 WS 时握手会带 `Origin: http://127.0.0.1:3080`。服务端**是我们自己写的**
   （Host 半），所以这是可控项而不是风险 —— 但要记得**别照抄一个只许自身端口的严格白名单**（那是"独立进程方案"才会踩的坑）。

### 第二轮新增的未知 / 待决策

8. **形态 B（offscreen Electron）的可靠性未定**：macOS 上 offscreen 能否持续出帧、WebGL2 是否可用、
   隐藏窗口的 `capturePage()` 到底给什么 —— 子代理调研中，结论到达后补进 §B.4.1。
   （仓库内**没有** offscreen 先例：`grep offscreen` 在 `electron/`、`tools/`、`src/` 零命中。）
9. **实例 base 的 seed 策略未定**（设计决策）：空目录 / 从真存档快照复制 / 专用测试存档模板？
   这直接决定调试会话的**可复现性**，也决定 `readSaveDataBoth` 并表出来的东西是什么（§B.3.3 坑 1）。
10. ~~**agent 输入注入的默认模式未定**~~ → **第三轮已决定（③）**：只保留 `applyScenarioEvent` 直写（不做 DOM 合成模式）。
    ⚠️**理由已在 §0.11 订正**：hover **不是**差异（注入光标走引擎 `sub_403C50` 同一路径）；
    按决定接受的只剩"光标出窗"（需加 `valid?`/`leave`，一行级）与 `syncButtons` 两条小项（§B.4.3）。
11. **"大致情况"够不够**：形态 D（digest/telemetry 面板）是否能满足你看调试的需求 —— 这是**你的主观判断**，
    不是技术未知。建议先做 D 再决定 A 的紧迫度（§B.6 第 0 步）。

### 第二轮·形态 B 专项（调研已落定，只剩这三条要实测/待查）

12. ~~**`sendInputEvent` 在不可聚焦的 offscreen 窗口上是否可用 —— 待 5 分钟实验**~~ → **第三轮作废（②）**：
    输入不再走 `sendInputEvent` ⇒ 与窗口焦点无关（§B.4.1.1）。
13. **"无窗口"是否等于"无 Dock 图标/无 app 激活"—— 未查**：调研没有读 `app.md`，
    `app.dock`/`activationPolicy`（即"无窗口但仍在 Dock 出现"）未确认 ⇒ **待查一项**。
14. **版本回归看门狗**：hidden/offscreen 这条线 2026-08~09 仍在密集修
    ⇒ 若做 B，必须**锁小版本**并加三项看门狗（出帧心跳 / 帧非空 / 帧尺寸），且知道
    44 的 `getSize()` 是像素、**46 起变 DIP**（`#53813`）。
15. **B 的隐含前提**：Electron 即便 offscreen 也**需要已登录的图形会话**（macOS 没有 xvfb 等价物）
    ⇒ 这只解决"不出现窗口"，不解决"无 GUI 跑得起来"。

### 第三轮新增（两个待做实验 + 一个待定）

16. ★**B′ 判据实验（10 分钟，决定 A vs B 的走向）**：`show:false` + `backgroundThrottling:false` 的窗口里，
    跑到 TITLE 后连续 10 次 `#captureStageCanvas()` 是否都拿到**非空、1280×720** 的图（§B.4.4）。
    成立 ⇒ 形态 B 不需要 OSR，坑少一半；不成立 ⇒ 退回 §B.4.1 的 `offscreen:true` + `paint`。
17. **焦点 latch 的落点未定（小设计决策）**：`hostFocus` 状态放 `InputManager`（跟输入状态同处，可进快照/回放）
    还是放桥自己的状态（不污染共享对象）？`focus auto/on/off` 三值是否够用（§B.4.5）。
18. **`focus off` 的语义要写进守卫**：它必须等价于现在的 DOM blur 路径（`releaseAllMouse` + `releaseAllKeys`），
    否则"失焦路径可测"这条承诺是空的 —— 需要一条测试断言两者产生同一个 `InputSnapshot`。

---

## 8. 证据索引

**仓库内（= `ticket.json` 的 `evidence[]`，受锚点棘轮约束）**

| 文件 | 锚点 | 说明 |
|---|---|---|
| `app/amayui-emulator/src/renderer/ipcProtocol.ts:11` | `declare global {` | 宿主契约 = `window.api`（51 个成员全在这） |
| `app/amayui-emulator/electron/preload.ts:11` | `contextBridge.exposeInMainWorld('api'` | Electron 侧实现，只有 4 种形态 |
| `app/amayui-emulator/src/arch/fileSource.ts:35` | `export interface FileSource` | VM 只认这个接口 ⇒ 换宿主不动 VM |
| `app/amayui-emulator/electron/ipc/files.ts:30` | `const fileSource = new NodeFileSource` | handler 体已是 Node 侧薄转发 ⇒ HTTP 宿主可复用（…但它是**模块级单例**，见 §B.3.3 坑 2） |
| `app/amayui-emulator/src/renderer/audio/webAudioHost.ts:11` | `amayui-audio://` | ⚠️【订正 1】不是"必须改的通道"：静音模式下不给 `audioStreamBase` 即可；真正要留的是 `audio` 字节通道（见下两行） |
| `app/amayui-emulator/src/audio/nodeAudioHost.ts:60` | `export function audioDurationSec` | 静音 `decode` 用它算时长，**需要原始字节** ⇒ 音频通道不能整个删 |
| `app/amayui-emulator/src/renderer/index.html:10` | `media-src 'self' amayui-audio:` | CSP 需按 web 宿主改写（可去掉 `amayui-audio:`） |
| `plugins/uimap/lib/index.js:325` | `ctx.effect(() => webServer.register({` | 同仓先例：插件在 GUI 的 webServer 上挂前缀路由 |
| `plugins/ticket-board/README.md:53` | ``必须 `inject` `webServer` `` | DSH 侧硬约束：不 inject 则路由静默跳过 |
| `native/host-input/index.js:3` | `与测试都能直接 require` | 【订正 2】真光标能力是**纯 Node** 的 ⇒ 不是缺口；`node native/host-input/tools/smoke.cjs` 可独立跑 |
| `app/amayui-emulator/src/frame/scenario.ts:177` | `export function applyScenarioEvent` | 【新增】agent 输入重铺的现成缝（声明式 `ScenarioEvent`，宿主无关）；⚠️不经过命中测试/悬停 |
| `app/amayui-emulator/src/arch/systemPaths.ts:88` | `export function resolveSystemPaths` | 【新增】env 是**参数** ⇒ instance 存档隔离今天就能做 |
| `app/amayui-emulator/electron/paths.ts:54` | `export const LOG_PATH` | 【新增】log/trace 是模块级常量、未参数化 ⇒ 实例隔离唯一要新增的落点 |
| `app/amayui-emulator/tools/debugsrv.cjs:153` | `webContents.sendInputEvent` | 【新增】agent 输入现状（主进程直接注入）；配合"三条驱动零 `.focus()`"的负面证据 ⇒ offscreen 上要实测（§B.4.1.1） |
| `app/amayui-emulator/src/frame/host.ts:18` | `export interface FrameHost` | 【第三轮】"VM 外层桥接"的落点：`capture?()` 加在这个共享接口上（§B.4.4） |
| `app/amayui-emulator/src/renderer/pixiBackend.ts:1140` | `#captureStageCanvas` | 【第三轮】整帧抓取**已经存在**（转场在用，同一条 `extract.canvas`）⇒ 截图桥是"提公开 + 接缝"的个位数行改动 |
| `app/amayui-emulator/src/vm/debugCommand.ts:20` | `export type DebugAction` | 【第三轮】命令词汇表唯一收口点（T-0127）⇒ `focus auto/on/off` 加在这里（§B.4.5） |
| `app/amayui-emulator/src/vm/input.ts:275` | `releaseAllMouse(): void` | 【第三轮】现状：本工程"焦点"的唯一作用就是这次兜底释放（配 `releaseAllKeys`）⇒ 提升为调试器控制的成本很小 |
| `engine/天结_unpacked.exe_utf8.c:141419` | `GetForegroundWindow() == hWnd` | 【第三轮】引擎侧 `GetForegroundWindow` **全份只出现一次**，且在"从最小化恢复"分支里、不是输入轮询门 ⇒ "焦点"不必建模成引擎态 |
| `app/amayui-emulator/src/vm/input.ts:233` | `this.hitTestPending = true; // 等待泵消费它时做一次 sub_403C50` | 【订正 5】`setCursor` 位置变化即置命中测试待办 |
| `app/amayui-emulator/src/vm/engine.ts:731` | `this.input.onCursorMove = (x, y) => {` | 【订正 5】回调体 = `routes.hitTest(x,y)` ⇒ 注入光标直接触发引擎命中测试 |
| `app/amayui-emulator/src/vm/route.ts:222` | `sub_403C50`（raw 9787-9824） | 【订正 5】命中测试语义（按坐标逐项判矩形）⇒ 这就是 hover 的 `routes.cursor` |
| `app/amayui-emulator/src/frame/scenario.ts:182` | `input.setCursor(x, y, true);` | 【订正 5】`cursor` case 恒 `valid=true` ⇒ **真缺口**：表达不了"光标出窗"（`mouseleave`） |

**仓库外（DSH npm 包，随版本漂移，不进 `evidence[]`）**

| 位置 | 事实 |
|---|---|
| `@deepseek-ai/dsh-host-webserver/lib/types/index.d.ts` | `register`（允许长挂 SSE）/ `registerUpgrade`（exact-path WebSocket）/ `registerFallback` |
| `@deepseek-ai/dsh-host-webserver/README.md` | 路由匹配顺序、fallback 单座、gzip 与 range/SSE 的关系 |
| `@deepseek-ai/dsh-host-webserver/lib/index.js:111` | 带 `content-range` 的响应**不压缩** |
| `@deepseek-ai/dsh-api-gateway/lib/index.js:471` | `webServer.registerUpgrade` 的真实用法（`/api/remote.mux`，配 `connection.requestRejection`） |
| `@deepseek-ai/dsh-api-gateway/package.json` | 依赖 `ws@^8.21.0` |
| `@deepseek-ai/dsh-web-frontend/dist/index.html` | SPA 外壳**没有 CSP meta**；全包无 `X-Frame-Options` |
| `@deepseek-ai/dsh-host-frontend-static/README.md` | SPA 走 fallback 座、index 需 cookie/token 鉴权、**静态资源公开**（我们的插件路由自管策略） |
| `@deepseek-ai/dsh-client-connection/README.md` | `/api` 的 Host/Origin 栅栏与 `sec-fetch-site: cross-site` 拒绝（**只作用于 connection 自己的路由**；插件路由可选择性调用 `requestRejection`） |
| `@deepseek-ai/dsh-client-hmr/lib/index.js:5,114-158` | SSE 活例：`/plugins/events`（实测能长挂输出） |
| `@deepseek-ai/dsh-client-ui-sidebar-documentpreview/lib/client.js:2389-2395` | 发布包内的 iframe 先例（blob URL + `sandbox="allow-scripts"`） |
| `@deepseek-ai/dsh-web-app/cordis.patch.yml:139-143` | web profile 的 webserver 配置：`127.0.0.1:3080` + gzip level 1 / 1024B 阈值 |
| `@deepseek-ai/dsh-web-app/lib/startup.js:40` | 明确拒绝 `--host 0.0.0.0` ⇒ 这套路由只在本机可达 |
| `compression/index.js:43,296`（DSH 依赖） | `Cache-Control: no-transform` 会跳过压缩（大二进制的规避手段） |

---

## 9. 复现本评估的命令

```bash
# ① 宿主契约面（51 个成员）
grep -n "declare global" -A 200 app/amayui-emulator/src/renderer/ipcProtocol.ts | grep -E "^\s*[0-9]+[-:]\s+[a-zA-Z]+\??\("

# ② 渲染进程零 Node 依赖（应只剩 Node 侧文件）
grep -rn "from 'node:" app/amayui-emulator/src | awk -F: '{print $1}' | sort -u

# ③ 浏览器 bundle 能打包（platform:'browser'）
cd app/amayui-emulator && npm run build:electron && ls -la dist/renderer/

# ④ 同仓先例：插件在 GUI 的 webServer 上挂路由
grep -n "webServer.register" plugins/*/lib/index.js

# ⑤ DSH 侧扩展点（包外；版本漂移时重核）
DSH=$(npm root -g)/@deepseek-ai/dsh/node_modules/@deepseek-ai
grep -n "registerUpgrade" $DSH/dsh-api-gateway/lib/index.js
grep -rn "Content-Security-Policy\|X-Frame-Options" $DSH --include=*.js --include=*.html | head

# ⑥ 第二轮：agent 输入现状 + "零 focus"负面证据 + 两条"不能踩"的开关
grep -rn "sendInputEvent" app/amayui-emulator/tools/*.cjs
grep -rn "\.focus()\|isFocused" app/amayui-emulator/tools/*.cjs app/amayui-emulator/electron/*.ts   # 期望：零命中
grep -rn "disableHardwareAcceleration\|transparent" app/amayui-emulator/electron app/amayui-emulator/src  # 期望：零命中（形态 B 的硬前提）

# ⑦ 第二轮：instance 隔离写盘点 / 参数化现状
grep -rn "writeFile\|createWriteStream\|\.write(" app/amayui-emulator/src app/amayui-emulator/electron --include=*.ts | grep -v "^app/amayui-emulator/src/tools"
grep -n "export function resolveSystemPaths" app/amayui-emulator/src/arch/systemPaths.ts
grep -n "export const LOG_PATH\|export const TRACE_PATH\|export const REPLAY_PATH" app/amayui-emulator/electron/paths.ts

# ⑧ 第三轮：VM 外层桥接的三处接口（输入 / 截图 / 焦点）
grep -n "export function applyScenarioEvent" app/amayui-emulator/src/frame/scenario.ts
grep -n "#captureStageCanvas" app/amayui-emulator/src/renderer/pixiBackend.ts        # 整帧抓取已存在（私有）
grep -n "export interface FrameHost" app/amayui-emulator/src/frame/host.ts           # capture?() 要加的缝
grep -n "export type DebugAction" app/amayui-emulator/src/vm/debugCommand.ts         # focus 命令的落点
grep -n "releaseAllMouse(): void\|releaseAllKeys(): void" app/amayui-emulator/src/vm/input.ts
# 引擎侧"几乎没有 foreground 门"的证据（全份只此一处）
grep -n "GetForegroundWindow" engine/天结_unpacked.exe_utf8.c

# ⑨ 订正 5：hover 的注入路径（四处连成一条链）
grep -n "hitTestPending = true" app/amayui-emulator/src/vm/input.ts          # setCursor 置待办
grep -n "onCursorMove = " app/amayui-emulator/src/vm/engine.ts               # 回调 = 命中测试
grep -n "sub_403C50" app/amayui-emulator/src/vm/route.ts                     # 命中测试语义 = WM_MOUSEMOVE
grep -n "引擎 WM_MOUSEMOVE 里的" app/amayui-emulator/src/vm/handlers/input.ts # 0x10A 靠它让脚本看见移动
grep -n "input.setCursor(x, y, true);" app/amayui-emulator/src/frame/scenario.ts  # 恒 valid=true（真缺口）
```

---
---

# Part B · 第二轮：**调试观察宿主**（按 2026-09-23 补充背景重做）

> 触发：§0 的"需求背景更新"。Part B 只写**与第一轮不同**或**第一轮没看见**的东西；
> §1–§9 里没被 §0.9 订正的部分（宿主面宽度、通道映射、DSH 承载能力、证据索引）继续有效。

## B.1 形态 A 的最小形态（比第一轮更小）

第一轮把"音频协议改造 + 真光标 + 单会话闸"算进了成本；第二轮这三项**全部出局**（§0.9），
于是形态 A（浏览器宿主 + DSH 同源 iframe）的真实工作量收敛成**四件事**：

1. **Host 半**：`/dsh-emulator` 前缀路由（`register`）+ `/dsh-emulator/ws`（`registerUpgrade`）——
   照抄 `plugins/uimap/lib/index.js` 与 `plugins/ticket-board/lib/index.js` 的骨架；
2. **桥**：`window.api` 同形对象（第一轮 §3 的映射表），其中**音频只要 `audio` 一条**（§B.2）、
   `audioStreamBase`/`setSystemCursor` 直接不提供；
3. **实例化**：把现有模块级单例（`paths.ts` / `files.ts`）改成**按实例传参**，log/trace 路径参数化（§B.3）；
4. **agent 两条通道重铺**：输入注入 + `shot`（§B.4）——**这是第一轮完全漏掉的工作量**。

**"小 iframe"这一条仍成立**，但要按第二轮的用途降级要求：既然是"看个大致情况"，就不必追求 1:1 像素，
可以直接把 iframe 缩到 640×360（外层 `transform: scale(0.5)`，`toVirtual` 仍自洽）。

## B.2 音频：怎么"忽略"才是对的（**静音模式不是零通道**）

**沿用现成开关，不要新写音频路径。** `audio.enabled=false`（`emulator.config.json`）或
`AMAYUI_AUDIO_ENABLED=0` 就是"忽略声音、引擎侧规则照跑"的正式形态（`T-0103`），
`tools/debugsrv.cjs` 也已经把它当默认（"调试会话是无人值守跑几分钟，出声只会引入噪声"）。

静音模式的实际行为（`src/renderer/audio/webAudioHost.ts`）：

| 环节 | 静音下做什么 | 行号 |
|---|---|---|
| 建 `AudioContext` | **禁止**（会抛错），一次性事件/手势 resume 全部跳过 | `:159-160`、`:177` |
| `decode` | **从容器头读精确时长** —— `audioDurationSec(bytes)`，**需要原始字节** | `:206-217` |
| `play` | 只记账：回一个按墙钟推进 `positionSec()` 的哑句柄（`SilentPlayback`） | `:232-250` |
| `streamUrl` | 返回 `undefined` ⇒ 引擎退回 `load+decode+play` | `:260` |
| `playStream` | 防御性兜底（正常到不了） | `:268` |

⇒ **两条结论**：

1. **`amayui-audio://` 完全不用碰**：web 桥接**不提供 `audioStreamBase`**，`#streamBase` 就是空串
   ⇒ 自动禁用流式（`webAudioHost.ts:94-99`）。第一轮 §5 的"方案 C（全 WS，含音频）"随之失去讨论价值。
2. **但 `audio(key)` 字节通道必须留着**：`decode` 要用它算时长，而时长是引擎判"语音占线 / SE 通道何时释放"的输入
   —— 删掉它不是"静音"，是"解码失败"，**引擎侧状态会漂移**，恰好违背"仅记录 side effects"。两种实现：

| 方案 | 做法 | 代价 |
|---|---|---|
| **@1 保留字节通道（推荐）** | `POST /dsh-emulator/api/audio`（key = 数字 id 或 `BGM031.OGG`），Host 半读本地文件回 `Uint8Array` | BGM 每次起播传 2–6MB（本机磁盘 + loopback），Host 半可缓存；SE ≤350KB |
| @2 桥内合成 WAV 头（省字节） | Host 半用**同一个** `audioDurationSec` 算出时长，桥里合成 ~44B 的假 RIFF（`fmt`/`data` 的 byteRate+dataSize 编码出目标时长）⇒ `decode` 得到时长正确、`bytes` 极小的 clip | 是"骗过纯函数"的 trick：`AudioClip.bytes` 变成假值（只进诊断）。**若用**，必须写清注释 + 加守卫断言"合成头的 `audioDurationSec` == Host 给的时长" |
| @3 新增宿主缝 `AudioHost.durationSec?()` | 最干净 | **要动共享代码**（`audioEngine` 的解码路径）⇒ 违背"零语义改动"，不推荐 |

> ★顺带一条**正面**结论：静音模式下音频**不再需要任何浏览器权限/手势** —— 第一轮 §4.2 的 autoplay 问题整条消失。
>
> 📌**旁注（调研顺手带出的，与调试宿主无关但会污染第一轮的因果叙述）**：Electron 的
> `webPreferences.autoplayPolicy` **默认就是 `no-user-gesture-required`**，而 `--autoplay-policy` **不在**
> v44.4.5 的官方 CLI 开关表里 ⇒ `electron/main.ts:24` 那行 `appendSwitch('autoplay-policy', ...)`
> 很可能是**冗余**的（"TITLE 一起就有 BGM"未必靠它）。这是**待实测**的小结论（删掉那行看 BGM 是否照常），
> 与仲裁无关，记在这里免得以后有人拿它当第一轮的证据。

## B.3 instance 隔离：盘点 + 设计（含三个坑）

### B.3.1 全 emulator 的写盘点（grep 实证：除下述外**没有别的落盘**）

| # | 写什么 | 现状落点 | 参数化现状 |
|---|---|---|---|
| 1 | `SYS4REG.INI` 回写 | `OverlayDir.write(INI_FILE)`（`nodeFileSource.ts:113`、`files.ts:102`） | overlay 目录 —— **可 per-instance** |
| 2 | `SAVE\SAVE.DAT` | `nodeFileSource.ts:172`、`files.ts:143` | 同上 |
| 3 | 存档槽 `SAVE%02d.DAT` | `nodeFileSource.ts:189` | 同上 |
| 4 | 槽 `.STH` | `nodeFileSource.ts:216` | 同上 |
| 5 | 诊断日志 | `LOG_PATH = <repo>/.tmp/amayui-emulator.log`（`electron/paths.ts`） | ★**模块级常量，未参数化** |
| 6 | 定向 trace | `TRACE_PATH = <repo>/.tmp/scene-trace.jsonl` | ★**模块级常量，未参数化** |
| 7 | 回放轨迹 | `REPLAY_PATH` | **已 env 化**（`AMAYUI_REPLAY_PATH`，`paths.ts`；`logging.ts:106`） |

另：`cache/`、AGF 解码、字体、Live2D 资产**全是只读**（grep 未发现 emulator 写 `cache/`；AGF 在内存里解）。

### B.3.2 好消息：存档隔离**今天就能做**，不用改共享代码

`resolveSystemPaths(repoRoot, env)` 把 **env 当参数**而不是直接读 `process.env`（`src/arch/systemPaths.ts:88`）
⇒ 多实例**不必改 `process.env`**，每个实例传自己那份 env 对象即可：`AMAYUI_SYSTEM_DIR`（base）/
`AMAYUI_OVERLAY_DIR`（overlay）/ 兼容 `AMAYUI_SAVE_DIR`。

### B.3.3 三个坑（都必须写进实现票）

1. ★**base 也必须 per-instance**：`readSaveDataBoth` / `readSaveFlags` 会**并上 base**（`electron/ipc/files.ts:154-186`）
   ⇒ 若 base 仍指向真游戏的 `%LOCALAPPDATA%\Eushully\天結…`，调试实例会**继承玩家的真实存档**
   （既不可复现，也与"隔离"矛盾）。⇒ 实例的 base 应指向实例目录里的**干净副本**（按需从模板 seed）或空目录。
2. ★**现有 Electron 宿主是模块级单例**：`files.ts` 的 `fileSource`/`systemFiles`、`paths.ts` 的
   `EMULATOR_OPTIONS`/`SYSTEM_PATHS`/`LOG_PATH`/`TRACE_PATH`/`REPLAY_PATH` 全是模块级常量
   ⇒ 同一进程里跑两个实例会共用它们。所以第一轮 §6 第 1 步的"抽 `host/service.ts`"必须**升级为"抽 + 实例化"**
   （实例对象作为参数贯穿），而不是照搬单例。
3. ★**协议里没有"实例"这一维**：`T-0114` 的调试协议（`{id, text}` / `{op:'quit'|'ping'}`）默认单例。
   多实例并存后，"哪个实例"要成为**一等字段**（否则 agent 的命令会打到错误的会话上）。

建议布局（示例，最终命名由实现票定）：

```
.tmp/instances/<id>/
  base/        # 从模板 seed（或空）—— 见坑 1
  overlay/     # 所有写盘只落这里
  log/amayui-emulator.log
  log/scene-trace.jsonl
  log/replay.jsonl.gz
```

> 顺带：隔离做好之后，"多会话并存"从**风险**变成**特性**（可并行跑两个实例做对照），
> 第一轮 §4.4 的"拒绝第二个连接"据此作废（§0.9 订正 3）。

## B.4 "不出现 Electron 窗口"的其它路 + **agent 侧两条通道必须重铺**

### B.4.1 形态 B：offscreen Electron（渲染面零改动）—— **结论：macOS 上可靠，但有三个硬前提**

> 调研已落定（Electron 44.x；仓库 devDependencies 是 `electron ^44.2.0`，调研基线 44.4.5 / Chromium 152）。
> 下面每条都标了来源；**"确证"= 官方文档或 PR 原文，"推测"= 我的判断**。

**做法**：`new BrowserWindow({ show: false, webPreferences: { offscreen: { useSharedTexture: false, deviceScaleFactor: 1 }, backgroundThrottling: false } })`
+ `webContents.setFrameRate(1..5)` + 监听 `paint(details, dirtyRect, image)` → `image.toPNG()` → 推给 DSH。
⇒ **渲染面 / `window.api` / IPC 一行不改**，`AMAYUI_WINDOW_EDGE` 的"挪出屏幕"权宜退休。
（[offscreen 教程](https://www.electronjs.org/docs/latest/tutorial/offscreen-rendering)、[webPreferences.offscreen](https://www.electronjs.org/docs/latest/api/structures/web-preferences)）

**三个硬前提（缺一不可）**：

1. ★**绝不能调 `app.disableHardwareAcceleration()`** —— 那会切到 software output device，而 **Chromium M139 起取消了 WebGL 的 SwiftShader 自动回退**（`EnableUnsafeSwiftShader` 默认 false，只是过渡策略），Electron 44 = Chromium 152 > 139
   ⇒ **PixiJS v8 的 WebGL2 会直接创建失败**。offscreen 的 GPU 模式官方卖点正是 "WebGL and 3D CSS animations are supported"。
   （[EnableUnsafeSwiftShader.yaml](https://chromium.googlesource.com/chromium/src/+/main/components/policy/resources/templates/policy_definitions/Miscellaneous/EnableUnsafeSwiftShader.yaml)、[issue #16961](https://github.com/electron/electron/issues/16961)）
   ✅ **本仓库不受此坑威胁**：`grep disableHardwareAcceleration electron tools src` **零命中** —— 现在没关，将来也别关。
2. **接受"无窗口 / 不可聚焦 / 没有真 `visibilitychange`"**：offscreen 窗口永远 frameless、`isFocused()` 恒 false。
3. **机器要有已登录的图形会话**：Electron 即便 offscreen 也"requires a display driver to function"，
   而 **macOS 没有 xvfb 等价物**（`xvfb-maybe` 在 macOS 上是 no-op）
   ⇒ "不出窗口" ≠ "不需要 GUI session"。（[headless CI 教程](https://www.electronjs.org/docs/latest/tutorial/testing-on-headless-ci)）

**必须写进实现计划的坑**（全部来自调研，标注来源）：

| 坑 | 处置 |
|---|---|
| 页面静止时**不出帧**（官方原文 "When nothing is happening on a webpage, no frames are generated"） | 需要心跳：定期 `webContents.invalidate()` |
| paint 早期可能给**全 0 位图**，且官方没有"渲染完成"信号（[#48955](https://github.com/electron/electron/issues/48955)） | 首帧守卫：连续 N 帧非空 / 时间+非空双判定后再开始推流 |
| `toBitmap()` 字节序**平台相关**（`createFromBitmap` 原文只说 platform-dependent） | 用 `toPNG()`；不用 JPEG（透明会被压成黑底，[#39368](https://github.com/electron/electron/issues/39368)） |
| `useSharedTexture:false` = 每帧一次 **GPU→CPU 拷贝**（官方明说比 software 模式慢） | 1–5fps 无压力（推测）；要 30–60fps 再迁 `useSharedTexture:true` + IOSurface（帧池容量 10，必须逐帧 release） |
| 44 的 `getSize()` 是**像素**；**46 起**会变成 DIP（[#53813](https://github.com/electron/electron/pull/53813)） | 记一条升级注意 |
| `beginFrameSubscription` 不建议（[#42996](https://github.com/electron/electron/pull/42996)、[#54033](https://github.com/electron/electron/pull/54033)） | 用 `paint` |
| hidden/offscreen 这条线 2026-08~09 还在密集修（#54090/#54025/#52844/#54033/#53813） | **锁小版本 + 加看门狗**（出帧心跳 / 帧非空 / 帧尺寸） |
| `sendInputEvent` 官方注释要求窗口 focused，而 offscreen **永远不可聚焦** | ⚠️见下 |

#### B.4.1.1 ⚠️【第三轮：本条作废】原"B 不保住 agent 输入通道"的顾虑

**上一稿我写的是**：`sendInputEvent` 官方要求窗口 focused，offscreen 窗口永远不可聚焦 ⇒ 这个实验必须做。
（当时的仓库观察仍然有效、也仍然有意思：三条输入驱动 `tools/debugsrv.cjs:153-165`、`tools/shot.cjs:141-152`、
`tools/record.cjs:98-112` **全都只用 `sendInputEvent`、全都没有任何 `.focus()` 调用**，而现网 `showInactive()` 也能点。）

**但按用户决定 ②（输入改纯 VM 外层桥接），这条实测项不再需要**：
既然输入不再走 `webContents.sendInputEvent`，窗口聚焦与否就与输入无关了 ——
`InputManager` 是共享层对象，谁写它都一样（§B.4.3）。
⇒ **B 在输入这一侧的顾虑清零**；`sendInputEvent` 只剩"老的可见窗口流程"还在用（那部分不动）。
配合决定 ①（焦点手动控制，§B.4.5），连"游戏以为窗口失焦了"这件事也由调试器说了算。

### B.4.2 ⚠️【订正 4】形态 C：隐藏窗口（`show:false`）+ 定时 `capturePage`

**我上一稿写"大概率不成立"——对 macOS 是错的。** 调研确证：
`paintWhenInitiallyHidden` **默认 true**（`show:false` 时 renderer 仍被视为 visible 并绘制），
而 [PR #49938](https://github.com/electron/electron/pull/49938) 的正文写得很直白：
Win/Linux 上"renderer 在 tick rAF 但**没有帧被 present**，`capturePage()` 无帧可拷"，
而 **"macOS doesn't have this problem because `NativeWidgetMac` runs in headless mode for this case"**
⇒ 那些"hidden window 抓不到帧/黑帧"的知名报告（如 [#30666](https://github.com/electron/electron/issues/30666)）主要在 Win/Linux。
`capturePage(undefined, { stayHidden: true })` 也有官方语义说明（隐藏 + capturer count 非零会被视为 visible）。

**但仍然不推荐它当主方案**（这些是确证，不是猜测）：

* 这条路在**密集回归**：[#42378](https://github.com/electron/electron/issues/42378)（隐藏 + 关 `backgroundThrottling` **数分钟后整窗变白**，FrameEvictor 5 分钟驱逐）、
  [#52844](https://github.com/electron/electron/pull/52844)/[#52863](https://github.com/electron/electron/pull/52863)、[#54090](https://github.com/electron/electron/pull/54090)、[#54025](https://github.com/electron/electron/issues/54025)；
* 官方**唯一推荐的取帧路径是 offscreen + `paint`**；`capturePage` 定时轮询是"可见窗口"时代的老办法；
* "移出屏幕 / `setOpacity(0)` / `moveTop` + capturePage"**零条被验证的做法**（GitHub 搜 `"setOpacity"+paint` 命中 0），
  而且你们自己的 `T-0040` 注释就记了"macOS 会丢弃隐藏窗口上的 `setPosition`"
  —— 与官方"别在隐藏窗口上玩 geometry"（[#50572](https://github.com/electron/electron/pull/50572)）同向。
  （`tools/verify-cursor.cjs:46` 用 `show:false` 没问题 —— 它只需要窗口对象，不需要像素。）

⇒ 形态 C 的定性从"大概率不成立"改成：**技术上 macOS 能做，但脆且非官方推荐路径 ⇒ 不选**。
仓库侧的另一条间接证据保留：`electron/windows.ts:30` 只在构造时 `show:false`、随后**必须** `showInactive()`
—— 说明这套代码从未依赖"隐藏窗口出帧"。

### B.4.3 ★agent 的**输入**通道：改成**纯 VM 外层桥接**（决定 ②③）

* 现状（Electron-based，将被取代）：`tools/debugsrv.cjs` 的 `click/clickn/move` **不经过渲染窗** —— 主进程直接
  `webContents.sendInputEvent`（脚本注释原话）。
* **新方案（决定 ②）**：输入注入不再碰任何 Electron API，直接在**共享层的 `InputManager`** 上写 ——
  也就是"VM 外层"：VM 只从 `InputManager` 读，谁写它都一样。
  共享层**已经有**声明式输入词汇与执行器：

  | 位置 | 内容 |
  |---|---|
  | `src/frame/scenario.ts:141` | `ScenarioEvent.kind = 'cursor' \| 'press' \| 'release' \| 'wheel' \| 'keydown' \| 'keyup' \| 'note'`（+ `x/y/button/delta/vk/atFrame/atMs`） |
  | `src/frame/scenario.ts:177` | `applyScenarioEvent(input: InputManager, ev: ScenarioEvent): void` —— **导出的、宿主无关的**执行器 |

  ⇒ 桥把 agent 的 `click x y` 翻成 `{kind:'press',x,y,button:0}` + `{kind:'release',button:0}`，`move` → `{kind:'cursor',x,y}`，
  在**拥有 `InputManager` 的那一侧**（浏览器渲染半 / Electron 渲染半，同一份代码）调 `applyScenarioEvent`。
  **零新词汇**，坐标本来就是**引擎虚拟 1280×720** ⇒ 顺带绕开"客户区/图像/虚拟"三套坐标的换算坑。
* **决定 ③：砍掉"高保真 DOM 合成"那条路。** 上一稿建议留两条（直写 + `window.dispatchEvent(new MouseEvent(...))`），
  现已不需要：**只保留 `applyScenarioEvent` 直写**。
  ⚠️**但上一稿给的理由是错的（已订正，见 §0.11）**：我当时写"它不经过命中测试/悬停" ——
  那是把 `scenario.ts` 文件头**描述改造前问题**的句子当成了实现性质。
  **实际上 `{kind:'cursor',x,y}` 走的正是引擎自己的命中测试路径**：
  `setCursor` 位置变化 → 置 `mouseMoved`/`hitTestPending` 并回调 `onCursorMove`（`input.ts:230-239`）
  → `engine.ts:731-733` 的 `routes.hitTest(x,y)` = 引擎 WM_MOUSEMOVE 里的 `sub_403C50`（`route.ts:222`）
  ⇒ **hover / `routes.cursor` / 侧栏展开收起的悬停，都能被调试器注入**。
  所以决定 ③ 省掉的只是"合成 DOM 事件"这个**多余**通道，没有牺牲 hover 保真度
  （反倒更贴引擎：DOM 路径经 `inputAttach` 会附加一个宿主特有的 `syncButtons`）。
* **订正后剩下的真实差异（只有这三条，都不影响 hover）**：
  1. **表达不了"光标出窗"**（真缺口，一行级）：`cursor` case 恒传 `valid=true`（`scenario.ts:182`）⇒
     模拟 `mouseleave`（`inputAttach` 的 `setCursor(-100000,-100000,false)`）需要给 `ScenarioEvent` 加
     `valid?: boolean` 或一个 `leave` kind。与 `T-0051`（`0x10A` 侧栏钉光标）相关，值得加。
  2. `syncButtons`（按住态真值重同步）不在直写路径里 —— 对显式 press/release 等价；"卡住"由 §B.4.5 的 `focus off` 覆盖。
  3. **引擎语义、要写进给 agent 的用法说明**：`setCursor` **只在位置变化时**才重算命中测试，
     且 `hitTestPending` 在非等待态会挂到下次等待态才消费（`engine.ts:1145/1161`、`gameStartChain.ts:615`）
     ⇒ *hover 靠"位置变化"触发；脚本里建议在等待态发 move*。（这两条真机同样成立，不是模拟缺陷。）
* **收益（比"少写一个模式"更大）**：这条桥**与宿主无关** ⇒ Electron 可见窗口 / offscreen Electron / 浏览器
  三种形态**共用同一份输入桥**；老的 `sendInputEvent` 驱动（`shot.cjs` / `record.cjs` / `debugsrv.cjs`）
  只保留给"老的可见窗口流程"，不必为每种宿主各写一份。
* 与决定 ①的接口点：焦点不再由 DOM 决定，而由调试器下发 —— 见 §B.4.5。

### B.4.4 ★agent 的**截图**通道：改成**帧宿主缝上的抓帧**（决定 ②）—— 顺带可能省掉 OSR

**做法**：把"抓一帧"变成**帧宿主（`FrameHost`）的一个可选能力**，而不是 Electron 的 `capturePage()`。
`src/frame/host.ts:18` 的 `FrameHost` 已经是"驱动 ↔ 渲染宿主"的共享接口（`present`/`needsRender`/`digestState`…），
往里加一个**可选** `capture?(): Promise<Uint8Array>`（PNG）即可；headless 宿主不实现（= 没有像素，与它的语义一致）。

**实现几乎是现成的**：`PixiBackend` 里已经有一个**私有的整帧抓取**
`#captureStageCanvas()`（`pixiBackend.ts:1140`）—— "抓一帧**当前舞台的合成结果**（转场的新/旧帧来源；与 `frameTick` 同一条 `extract.canvas`）"，
另有存档缩略图/转场帧两处在用同一条 `extract.canvas`（`:1119`、`:1175`）。
⇒ 把它提成公开的一点、`toBlob/toDataURL` 成 PNG、接到 `FrameHost.capture` 上就是完整实现（**个位数行**）。
`extract` 是"渲染进临时纹理再读像素"，**不依赖 `preserveDrawingBuffer`**，所以不踩"`toDataURL` 抓空白"那个经典坑。

**两个副产品**：

1. **agent 的 `shot` 与"人类看的帧流"变成同一条路径** —— 都是"向帧宿主要一张 PNG"。
   `tools/debugsrv.cjs` 的 `shot` 从 `capturePage()` 换成它即可（并且因此**宿主无关**）。
2. ★**可能因此不需要 OSR**（记为 **B′**，待 10 分钟实验）：若"隐藏窗口（`show:false` + `backgroundThrottling:false`）"
   里的 Pixi 页面仍能跑我们的帧循环、`extract.canvas` 仍能出图，那么形态 B 就**不需要 `webPreferences.offscreen`**，
   从而绕开 §B.4.1 里那一串 OSR 专属的坑（`paint` 只在变化时出帧、NativeImage 的 GPU→CPU 拷贝、
   首帧全 0、46 起 `getSize()` 变 DIP、`useSharedTexture` 池纪律）。
   此时"人类看的 1–5fps"= 桥定时调 `capture()`（**拉**模式），比 OSR 的 `paint`（**推**模式）更简单、且与 agent 的 `shot` 同源。
   **实验判据**：`show:false` 窗口里跑到 TITLE 后，连续 10 次 `#captureStageCanvas()` 都拿到非空且尺寸为 1280×720 的图。
   （判据失败则退回 §B.4.1 的 OSR 方案。）
   ⚠️ 注意区分：**B′ 不是形态 C** —— 形态 C 用 `webContents.capturePage()`（走 Electron 的窗口截图管线，有 #42378 白屏史），
   B′ 用**页面内** `extract.canvas`（走 WebGL 读回，不经过窗口截图管线）。这 10 分钟实验正是用来区分二者的。

### B.4.5 ★focus/blur：改成**调试器显式控制的输入**（决定 ①）

**先说清现状（这决定了改造有多小）**：emulator 里**没有**"窗口是否激活"这个引擎态 ——
`InputManager` 的字段里没有它（`src/vm/input.ts` 的 `InputSnapshot` 只有光标/按钮/滚轮/边沿/按住态），
"焦点"在这个工程里的唯一作用就是**宿主侧的兜底释放**：
`window.blur` / `visibilitychange` → `input.releaseAllMouse()`（`input.ts:275`）与 `releaseAllKeys()`（`:159`），
即"怕丢 `mouseup`，干脆全清"（`T-0027` 的产物）。

**引擎侧也几乎没有 foreground 门**（这是新查的，很关键）：整份反编译里 `GetForegroundWindow` **只出现一次**，
在 `engine/天结_unpacked.exe_utf8.c:141419`，且是在 `WM_SYSCOMMAND` 的"从最小化恢复"分支里
（`... && GetForegroundWindow() == hWnd ) SendMessageA(hWnd, 0x1Cu /*WM_ACTIVATEAPP*/, 1u, 0)`）——
**不是输入轮询的全局门**（`sub_4770A0` 那套 `GetAsyncKeyState` 轮询不看它）。
⇒ 所以"焦点"在本工程**不需要建模成引擎态**，它只是一个**输入生命周期的控制开关**。

**新设计**：把它提升为**调试命令**（与 `T-0127` 的命令台同一张词汇表，落点 `src/vm/debugCommand.ts:20` 的 `DebugAction`）：

```
focus on       # 视为窗口激活（默认；忽略 DOM 的 blur/visibilitychange）
focus off      # 视为窗口失焦：按当前语义释放全部按住态，并**持续忽略**后续 DOM 焦点事件
```

* **`focus off` 模拟的正是现在 DOM blur 的语义**（`releaseAllMouse` + `releaseAllKeys`）——
  于是"失焦路径"仍然**可测**，但**由调试器决定何时发生**，而不是被 DSH 抢焦点/iframe 失焦/offscreen 无焦点这些
  宿主噪声随机触发。
* 实现是"一个 latch + 一处门"：latch 存在宿主侧（`InputManager` 上加 `hostFocus` 字段或桥自己的状态），
  `inputAttach` 的 blur/visibilitychange 处理器在 **manual 模式**下直接不管；
  `focus off` 时主动调那两个 `releaseAll*`。
* ★**它同时消掉了三处宿主噪声**：① offscreen 窗口永远不聚焦（形态 B）；② iframe 点一下 DSH 的 UI 就失焦（形态 A）；
  ③ 真人在浏览器里玩时窗口被遮挡/切走（形态 A 的手动模式）。
* **与人类真实操作的边界**：默认仍是"跟随真实焦点"（`focus auto`），只有调试会话显式切到 manual 才忽略 DOM 事件
  —— 这样"你手动体验排查特殊 bug"（决定 ③）时，键盘/鼠标行为不会因为调试器插手而变样。
  ⇒ 建议三个值：`auto`（默认，现状）/ `on` / `off`（manual）。


## B.5 登记表（第二轮口径：**可做但故意不做 ≠ 做不到**）

| 项 | 第二轮分类 | 依据 / 落点 |
|---|---|---|
| `0x10A` 真·系统光标 | **可做，故意不做**（调试用途） | 能力在 Node 侧：`native/host-input/index.js` 门面（"主进程与测试都能直接 require"）+ 独立跑法 `node native/host-input/tools/smoke.cjs`；Electron 只在 `electron/nativeAddon.ts:130-136` 做"客户区→屏幕"；同源 iframe 还可用 `window.frameElement` + `window.screenX/Y` 补回 iframe 屏幕矩形。登记：`analysis/engine-capabilities.json#host-cursor-warp` 的宿主矩阵加一列 `web(debug) = ignored` |
| audio（BGM/SE/语音） | **已按静音模式忽略**（不是失败） | `audio.enabled=false`（`T-0103`）；引擎侧规则照跑；仍需字节管道算时长（§B.2） |
| `amayui-audio://` 流式协议 | **已无意义** | 不给 `audioStreamBase` ⇒ `streamUrl()` undefined |
| browser autoplay 策略 | **已无意义** | 静音模式不建 `AudioContext` |
| `logLineSync` 同步落盘 | **被迫降级**（唯一真降级） | §4.3 |
| 单会话排他 | **换成 instance 隔离** | §B.3 |
| Electron 窗口 | **形态 A 完全消除** / 形态 B 进程在但不可见 / 若 B′ 成立则连 OSR 都不需要 | §B.4.1、§B.4.4 |
| agent 输入的 hover 保真度 | **不是差异：hover 可注入**（`setCursor` → `onCursorMove` → `routes.hitTest` = 引擎 `sub_403C50` 同一路径）；真差异只剩"光标出窗（`valid=false`）"与 `syncButtons` | §B.4.3、§0.11（订正 5） |
| 宿主焦点（activate/deactivate） | **提升为调试器显式控制**（`focus auto/on/off`） | §B.4.5（决定 ①） |
| Electron 的 `sendInputEvent` / `capturePage` | **在调试通道上退役**（换纯 VM 外层桥接；老的可见窗口流程不动） | §B.4.3、§B.4.4（决定 ②） |

## B.6 分步建议（第三轮版）

| 步 | 做什么 | 为什么这个顺序 |
|---|---|---|
| **0** | **先做形态 D**：把现有 `ControlStatus` / `PerfTelemetry` / `FrameDigest` / `scene-trace.jsonl` 接进一个 DSH 面板 | 半天级就能缓解"看不见"；且这份 telemetry 与形态 A **完全共用**，不是白做 |
| **0′** | **两个 10 分钟实验**（都不写产品代码）：① §B.4.4 的 **B′ 判据**（`show:false` 窗口里 `#captureStageCanvas()` 连拿 10 张非空 1280×720）；② §B.4.5 的焦点 latch 是否已够（blur 处理器加一个开关就能停） | 这两个实验的结果决定后面走 A 还是 B，**先花 20 分钟省掉几天的错路** |
| 1 | 抽 `host/service.ts` **并实例化**（`paths.ts`/`files.ts` 的单例 → 按实例传参；log/trace 路径参数化） | 这一刀**同时**服务"隔离"与"多实例"，且可零行为变更 |
| 2 | **纯 VM 外层桥**（决定 ②）：输入用 `applyScenarioEvent` 直写（只有这一条，决定 ③）；截图把 `#captureStageCanvas` 提成公开 + 加 `FrameHost.capture?`；焦点加 latch（决定 ①） | 三件事都落在**共享层** ⇒ 三种宿主共用；先做它，后面无论 A 还是 B 都不返工 |
| 3 | 独立进程 web 宿主原型：浏览器里跑到 TITLE + 静音 + 实例目录 + 桥接上第 2 步 | 验证渲染面真的能在浏览器跑（第一轮 §7.1 的最大诚实边界） |
| 4 | 包成 `plugins/amayui-emulator`（Host 路由 + WS upgrade + Client iframe 模态/头部按钮） | 复用 uimap/ticket-board 骨架 |
| 5 | （可选）**形态 B/B′** 当过渡：若 0′① 成立走 B′（隐藏窗口 + 桥拉帧，**不需要 OSR**）；否则走 §B.4.1 的 OSR 方案（`offscreen:true` + `paint` + `setFrameRate(1..5)` → `toPNG()`，**绝不要 `disableHardwareAcceleration()`**，静止 `invalidate()` 打心跳，首帧空帧守卫） | 因为第 2 步已经把输入/截图/焦点桥做好了，B/B′ 只剩"换个窗口策略"——这就是决定 ② 的最大红利 |
