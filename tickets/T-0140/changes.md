# T-0140 · 变更记录

---

## 变更 1（2026-09-23）· `--attach-headless`（宿主自持无头渲染页）+ 第二渲染者防护 + 观察者归因

### 一、为什么做这一步（本票的病根）

`T-0136` 钉住的架构事实：**web 形态下 VM 跑在页面里** ⇒ 没有渲染页附着的实例，`/health` 正常、
注册表心跳正常，但 agent 的 `debug-query` **必然 503**（`e2e-shot.cjs` 的端到端断言就是钉这条的）。
后果：想让 agent 自己调、人不用盯着看，就必须先有"人或什么东西"附一个渲染页。

修法：让**宿主自己**附一个隐藏的渲染页（哑窗，`show:false`），于是 `--attach-headless` 一开，
实例就是"agent 可直接驱动"的。

### 二、实现（`src/web/host.ts` + 新脚本）

| 文件 | 改动 |
|---|---|
| `src/web/host.ts` | ① `WebHostOptions.attachHeadless?` / `electronPath?`；② `attachHeadless(port)`：在 `listen()` **成功之后**才附（要连的是真实端口，`--port 0` 时端口只有那时才知道）；③ `detachHeadless()`（同步收尾，供 `process.on('exit')` 兜底）；④ SSE 观察者计数/序号（见下）；⑤ `[web] status` 重新排版（见 §四） |
| `tools/attach-headless.cjs`（新增） | 隐藏 Electron 窗口（`show:false` + 三个 `disable-*-throttling/backgrounding` + `--no-sandbox`）加载实例根 URL；`SIGTERM`/`window-all-closed`/渲染进程崩溃都 `app.exit`，**不留孤儿** |
| CLI | `--attach-headless`（存在即真）或 env `AMAYUI_ATTACH_HEADLESS=1`；缺省**关** ⇒ 行为与今天完全一致 |

**为什么是"隐藏窗口"而不是真无头**：`capture` 要的是**像素**（`FrameHost.capture` 走的 Pixi stage
canvas），离屏/无窗口拿不到合成结果（`T-0133` 的"形态 C vs B 撇"之分）。隐藏窗口既不抢焦点、
也不打扰人，但画面是真的 —— 这就是 `e2e-shot.cjs` 哑窗手法的正式化。

### 三、第二渲染者：**明确策略 = 允许 + 显著告警**（不是拒绝）

web 形态下**一个页面 = 一个 VM** ⇒ 同一实例被第二个页面附着就是**第二个 VM**，两个 VM 抢同一份
overlay/log。可选策略是"拒绝第二个"或"允许但显著告警"，本票**选后者**，理由写在代码注释里：

* 浏览器**刷新**时新旧 SSE 会短暂并存 ⇒ 硬拒会把正常刷新打成失败（把一个无害的瞬时重叠变成故障）；
* 真正要防的是"**长期**两个 VM 在抢"，而那件事**必须留痕**才可查 ⇒ 告警 + 可机读字段足够，
  且不牺牲刷新路径。

落点：

| 落点 | 内容 |
|---|---|
| 宿主日志 | 接入/断开各一条（带观察者序号）；`外部渲染页 > 1` 时一条 `⚠ 第二渲染者…` |
| `GET /health` | 新增 `viewers`（当前 SSE 观察者数）与 `viewersWarn`（`viewers > 1`）——**可机读** |
| 面板 | `T-0138` 已在显示 `viewers` 并告警（数据来自插件的 `/api/__instances`），本票不重复实现 |

**"自持的无头页"不算外部渲染者**：它与实例 1:1、宿主退出时一起收；计数时减掉它
（`headlessClients`），告警口径是"**除了我自己的无头页之外**还有几个外部页面"。

### 四、★观察者归因（排查 `T-0138` 的 `frames` 之谜的必要工具）

两条诊断改进，都是"先被坑、再加"：

1. **`[web] status` 把 `frames` 与来源顶到最前**：原实现把整条 payload `slice(0,200)`，
   而 `frames` 窝在 `perf` 里 ⇒ 排查"frames 会不会回零"时**日志里没有这个数**。
   现在每条都是 `[web] status obs=#<N> frames=<M> {…}`。
2. **观察者序号**：宿主在 SSE 首帧下发 `{channel:'observer', args:[{id, hostStartedAt, self}]}`，
   `webBridge` 认领后在 `renderer-status` 里回带 `observer=<id>`（宿主重启后序号会从头再发，
   靠 `hostStartedAt` 判断"不是同一个宿主了"）。

**它换来了什么**：`T-0138` 第四跑出现 `frames: … → 402 → 35`，一度被当成"切换把实例搞坏了"。
按来源拆开之后一目了然：

```
obs=#0（本驱动的 harness）  30 条   2,3,4,…,31,32          ← 单调，没回零
obs=#1（第二个页面）        38 条   1,2,…,478              ← 它自己的计数器
```

⇒ **注册表心跳里的 `frames` 是"最后一个上报者"的值**，两套计数器交错 ⇒ 那条曲线不能当作
单个 VM 的进度曲线。`T-0138` 的 frames 判据因此改成"**按观察者拆开看单调性**"（见那张票的变更记录）。

### 五、判据（本票 acceptance 逐条）

| # | 判据 | 结果 |
|---|---|---|
| 1 | `--attach-headless` 让实例**不依赖人**就能被 agent 驱动 | ✅ 见下 §六 的实测 |
| 2 | 开关关闭时行为与今天完全一致（默认关） | ✅ 缺省 `undefined`；只有 `listen()` 成功后才有 `if (opts.attachHeadless)` 一个分支 |
| 3 | 第二渲染者防护：告警 + 策略 + 写清理由 | ✅ 策略=允许+告警（理由见 §三）；日志 + `/health.viewers`/`viewersWarn` 可查 |
| 4 | 面板 viewers 显示与宿主策略一致 | ✅ 面板取插件 `/api/__instances` 的 `viewers`（宿主侧计数口径与之同为"活 SSE 连接数"） |
| 5 | 端到端：① 只带开关起实例（**不开面板**）⇒ `move`/`capture` 都成功；② 再开页面 ⇒ 观察告警/拒绝，并证明 overlay/log 没被两个 VM 同时写 | ✅ ①见 §六；②`viewers 1→2→1` + `⚠ 第二渲染者` 日志 + 断开后回 1 |
| 6 | `npm run verify` 全绿；两条插件冒烟不回归；插件 README 与 `host.ts` 用法写清开关与策略 | ✅ `smoke.mjs` 全过、`smoke-client.mjs` 196 ✓；`tsc --noEmit` OK；README 已写（见 §七） |

### 六、★端到端实测（原始输出）

```bash
cd app/amayui-emulator
node --import tsx src/web/host.ts --instance hl-a --port 0 --attach-headless
```

宿主侧（关键几行）：

```text
[web] 已附无头渲染页：http://127.0.0.1:55311/（pid=16544；agent 现在可以直接 debug-query）
[web] 就绪 http://127.0.0.1:55311/（实例 hl-a；已开 --attach-headless；Ctrl-C 收工）
[web] 观察者 #0 接入（现共 1 个；这个是无头自持页）
[web] status obs=#0 frames=1   {"bin":"INITCONFIG4.BIN",…
[web] status obs=#0 frames=12  {"bin":"TITLE.BIN",…
[web] status obs=#0 frames=1570 {"bin":"TITLE.BIN",…        ← 全程单调，无一次回零
```

agent 侧（**全程没有打开任何面板**，经 DSH 插件的每实例路由）：

```text
POST /dsh-emulator/hl-a/api/debug-query  {"args":["move 640 360"]}
  → HTTP 200 {"query":"move 640 360","ok":true,"lines":["已注入 1 个输入事件（cursor）"]}
POST /dsh-emulator/hl-a/api/debug-query  {"args":["focus on"]}
  → HTTP 200 {"query":"focus on","ok":true,"lines":["hostFocus=on"]}
POST /dsh-emulator/hl-a/api/debug-query  {"args":["capture"]}
  → HTTP 200  png=2395144 字符（base64）⇒ 落盘 1796356B 的 **1280×720** PNG
```

截图 `.tmp/hl-a/agent-capture.png` 目视 = **真·标题画面**（天結いキャッスルマイスター 标题 +
Game Start / Load Data / Eushully-chan Room / Option / Quit）⇒ 不是黑屏、不是空帧，
证明"宿主自持的无头页里 VM 真的在跑、真的在合成"。

第二渲染者（另开一条真 SSE 长连模拟第二个页面）：

```text
before : {"viewers":1,"viewersWarn":false}
after  : {"viewers":2,"viewersWarn":true}
日志   : [web] 观察者 #1 接入（现共 2 个）
         [web] ⚠ 第二渲染者：实例 hl-a 现在有 2 个**外部**渲染页（另有无头自持页 1 个）⇒ 多个 VM 会抢同一份 overlay/log。…
断开后 : {"viewers":1,"viewersWarn":false}   +  [web] 观察者 #1 断开（现共 1 个）
```

### 七、实测抓到的两个自己的坑（已修）

1. **Windows 上 `spawn` 一个 `.cmd` 直接 `Error: spawn EINVAL`**（node 24 起 `.cmd` 不再被隐式套 shell）
   ⇒ `resolveElectron()` 改成**优先真 exe**（`node_modules/electron/dist/electron.exe`），
   `.cmd/.bat` 才走 `shell: true`；并且 `spawn` 的**同步**抛与**异步** `'error'` 都接住 ——
   **附页失败不能把宿主带走**（宿主的主职责是服务渲染页）。
2. **告警文案把无头页数报成 0**：认领第一个 SSE 时用一个布尔量，报文案时它已经被消费掉了
   ⇒ 改成 `headlessClients` 计数（接入 +1、断开 -1、子进程退出直接归 0），文案与"外部"计数都可信。

### 八、没做的（不属于本票）

* 没有把 `--attach-headless` 设成默认开：起一个 Electron 渲染进程是要付代价的，本票只要求"默认关、
  开了才不依赖人"。
* 没有做"拒绝第二个渲染者"：策略选了允许+告警（理由见 §三），如果以后要改成拒绝，
  要把"刷新时的瞬时并存"单独放行（否则会把刷新打成故障）。
