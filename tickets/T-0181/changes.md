# T-0181 过程记录：DSH web 形态页面堆 1.7GB → OOM

## 0. 用户给的两条线索

1. 接入 emu in DSH 之后**两次 `out of memory` 崩溃**；
2. 在 ~500MB 时采样过一次，**Pixi 的 `ImageSource` 占 300MB+**。

## 1. 本轮做了什么（只做到「能测」，如实划界）

### 1.1 先让内存**可观测**（否则只能猜）

| 层 | 改动 |
|---|---|
| `pixi/textureCache.ts` | 新增 `stats(reachableSlots?)`（文件图/槽表面各自的**项数 + 像素数**，以及"仍被绘制项引用"的那部分）+ `slotNodeCount` + `imgIds()`/`imgSize()` |
| `pixiBackend.ts` | 新增**只读** `memStats()`（JS 堆 + 上面两份账 + 槽账 + 本帧绘制对象数）；`readJsHeap()` 读 `performance.memory` |
| `vm/debugCommand.ts` | 新增 `mem` 命令（裸命令；带参数按既有口径"当查询回报"，不抛错） |
| `renderer/app/session.ts` | `mem` 的派发 + 一行 `[mem] …` 进 trace |
| `test/mem-accounting-t0181.test.ts` | 守卫：解析、计账算术（含畸形源不许出 NaN）、**只读纪律**、接线棘轮 |

★为什么必须报**像素数**而不只是条目数：一条 AGF 可以是 16×16 也可以是 1280×720
（实测 TITLE 的 5 张图 = 6,008,794 像素 ≈ 22.9MB RGBA）——"缓存了 200 张"这种数字对内存毫无信息量。

### 1.2 量到的关键事实

同一台机、同一份真资源、**同一游戏状态**（`bin=TITLE.BIN`、`live=85` 个绘制对象、`img=5` 张）：

| 形态 | JS 堆 used | 堆 limit |
|---|---|---|
| **Electron 默认形态**（`npm run dbg:srv`，可见游戏窗） | **104.0MB**（total 149.7MB） | 3585.8MB |
| **DSH web 形态**（`web/host.ts --attach-headless`） | **1673~1936MB** | 4192.0MB |

⇒ **同一份页面代码，web 形态的堆是 Electron 形态的 16 倍**，而且还在涨。

时间曲线（实例 `mem2`，每 4s 一次 `mem`，原始数据 `.tmp/t0181/mem2-boot.jsonl`）：

```text
  6224ms  heap=1732.0MB  img=1张/12250px    live=0     ← 还没有任何纹理就 1.7GB
 18330ms  heap=1830.0MB  img=5张/6008794px  live=0
 22349ms  heap=1871.1MB  img=5张/6008794px  live=85
 62558ms  heap=1936.2MB  img=5张/6008794px  live=85
 74582ms  HTTP 504（8s 超时）  ← 之后每一轮都是 504/503：**这个页面没了**
```

两条要点：
* **基线 1.7GB 与纹理无关**（6.2s 时 `img` 只有 1 张 / 12250 像素）；
* **70s 后页面消失**（504 是"连了 SSE 但不答"、503 是"没有渲染页"）⇒ 与会话里反复出现的
  「前端 crash」是同一件事，而且**可以复现**。

### 1.3 已排除的

**我们自己的缓存不是主因**（同一份 `mem` 实测）：文件图 **5 张 / 22.9MB**、槽表面 **0 个**、
L2D 已载图 3、待销毁 0。
⇒ 用户看到的「`ImageSource` 300MB+」在 **TITLE 这个状态**下量不出来 —— 它是**另一笔**、
随游戏推进增长的账（本票 acceptance ③要单独答）。

### 1.4 没做完的（不许含糊收口）

**基线归因没做完。** 要指名道姓说出"那 1.7GB 是谁"，需要堆归因
（`performance.measureUserAgentSpecificMemory()` 或 `HeapProfiler.takeHeapSnapshot`），
而这两条都要 CDP。本轮写了探针（独立 Electron 加载同一个页面 URL + 自开 `--remote-debugging-port`），
但**在本会话的环境里跑不起来**：`npx electron tools/page-loader-probe.cjs …` 静默退出（exit 1、无输出），
`npx electron --version` 也会挂住。探针文件已删（不留半成品工具），做法记在这里，下次环境允许时按它走。

★可以立刻接上的下一步（按性价比排序）：
1. **二分**：宿主自持页用 `--attach-headless`，而 Electron 形态是宿主自己开窗 ⇒ 先试
   "同一个 web 页面 URL 用**独立窗口**加载（非宿主自持）"与"宿主自持"两条路的堆差；
2. **CDP 归因**（上面那条路）；
3. **按模块二分**：临时关掉 L2D / 文本层 / 字体加载各测一次 TITLE 的堆（`mem` 已能报）。

## 2. 与本票无关但同期落地的东西

`T-0180` §10 的**宿主阶段计时**（`profile` 的 `stage/stageSync/count`）与本票的 `mem` 是同一批
"先把观测面做出来"的工作，验收在各自票里。

## 3. 第二轮：泄漏实例清理 + 「推流/通信」假设的实测

### 3.1 那个"关不掉的实例"= 我起的一个测试实例（已清掉）

`instances` 列表里唯一**活着**的是 `mem2`（port=64026、pid=6608、`frames=17935`、心跳 0s 前）
—— 它是本轮做内存曲线时的采样实例，宿主还在、心跳还在刷，所以"关不掉"（它本来就在跑）。
已 `Stop-Process -Force`，并确认：pid 不在、端口 64026 关闭、插件端点 `live=0`。
**这不是历史遗留的旧会话，是本轮产生的**（如实说明）。

### 3.2 DSH **服务端**不是 2GB 的持有者（实测）

| 观测量 | 值 |
|---|---|
| DSH web node 进程（pid 12740）工作集 | **335MB**（不是 2GB） |
| 它的 TCP 连接 | 15 条（1 listen / 10 established / 4 bound） |
| 它的句柄数 | 345 |

⇒ 用户看到的"dsh 侧 2GB"是**浏览器前端**的堆（DSH GUI 页面）。本机浏览器没开远程调试端口
（`9222` 拒绝连接、各浏览器 profile 下也没有 `DevToolsActivePort`）⇒ **我这边没法直接读它的堆**。

### 3.3 「推流/通信」假设：**不成立**（实测）

直接连**面板 iframe 用的那条路**（插件反向代理）量 SSE：

```text
GET http://127.0.0.1:3080/dsh-emulator/<id>/events
合计 110 B（0.00 MB）· 3 帧 · 速率 0.0 KB/s = 0.02 MB/h
  observer 91B   ← 只有宿主下发的观察者序号
```

20 秒里这条流**只吐了 110 字节**。原因在代码里也对得上：宿主向页面推送的**只有**
`renderer-debug-query` / 断点 / trace 开关那几条；而页面往宿主的**所有**上报（`log-line`、
`renderer-status`）走的是**另一条腿**（`POST /api/event`），**根本不进 SSE**。
⇒ "SSE 推流把前端堆撑爆"这条可以**排除**。

（顺带量到的真实量级，供参考：单个实例的宿主日志写入 **≈7 KB/s**（`gate sleep cleared` 那类行），
而这些行是经 `POST /api/event` 一条一条上报的 —— 量不小，但**不累积**：宿主侧一次写盘就丢。）

### 3.4 代码侧能排除的（都读过一遍）

| 嫌疑 | 结论 |
|---|---|
| 插件 `lib/client.js` 的两个轮询 | `useEffect` 里都 `clearInterval`（15s 徽标轮询 / `POLL_MS` 面板轮询）⇒ 有清理，不泄漏 |
| 反向代理的 SSE | `upRes.pipe(res)`（有背压）+ `res.on('close')` 里 `up.destroy()` ⇒ 上游连接会被收掉 |
| 宿主 `waiters`（debug-query 配对表） | 回执到达与超时**两条路都 `delete`** ⇒ 不累积 |
| `renderer-status` 的载荷 | 是**有界**的台账（不在 opcode 表里的忽略项 / 缺口表 / 丢弃表）⇒ 不会长成 MB 级 |
| L2D 纹理库（唯一"永不驱逐"的缓存） | 只放"**已就绪**的 PNG"（复刻引擎的同步语义）；失败**不进表**（`#failed` 只存 id）⇒ 在 TITLE 上只有 3 张 |

⇒ 剩下的可能都在**浏览器主页面**那一侧（DSH GUI 自己的会话/附件/日志视图），**不在插件与 iframe 里**。

### 3.5 下一步：读浏览器前端堆（我做不了这一步，方法给出）

1. **最快**：在 DSH 页面按 `F12` → Console 输入 `performance.memory`，看 `usedJSHeapSize`
   （Chromium 才有）——先确认它是不是真的在涨、涨多快；
2. **指名**：Memory 面板 → **Heap snapshot** → 在快照里按 `Retained Size` 排序；重点看
   DSH 自己的会话/事件/日志容器（而不是 `amayui*` 那些）；
3. 若要**不打开 DevTools 也能看**：给浏览器加 `--remote-debugging-port=9222` 起一次，然后我这边
   就能用 CDP 读 `Performance.getMetrics` / 取堆快照（`.tmp/t0181/` 已有取样脚本可改）。

## 4. 第三轮：**根因找到并修复**（决定性证据来自用户的 heap timeline）

用户用 DevTools 的 heap timeline 录到一处明显不合理的东西：

> `pixi` 里 `ImageSource` 的 `resize` 的 `_events` 有 **540000+** 个元素。

### 4.1 机制（Pixi v8 源码逐行核过）

`node_modules/pixi.js/dist/pixi.mjs` 的 `Texture`：

```js
// 构造 → set source(value) —— 无条件挂一条：
set source(value) {
  if (this._source) this._source.off('resize', this.update, this);
  this._source = value;
  value.on('resize', this.update, this);     // ★每个 Texture 对象一条
  this.emit('update', this);
}
// 而**只有 destroy 会摘**：
destroy(destroySource = false) {
  if (this._source) { this._source.off('resize', this.update, this); ... }
}
```

而我们 `ScenePresenter.#buildItemSprite` 里**每帧、每个绘制项**都在做：

```js
const cropped = new Texture({ source: tex.source, frame });  // ← 挂一条 resize
return new Sprite(cropped);                                   // ← 从不 destroy
```

TITLE/LOAD 上 ≈**165 项/帧** × 60fps ⇒ **≈1 万条/秒**；用户看到的 54 万条 ≈ **一分钟**游玩。
监听器还**钉住每个 `Texture` 对象**（连带它的 `Sprite`）⇒ 页面堆以 MB/s 涨、最后 OOM。
**这一个缺陷解释了全部现象**（也包括"DSH 侧 2GB"：那个 VM 页面就跑在 DSH 页面的 iframe 里，
算的是同一个渲染进程的堆）。

### 4.2 修法（`presenter.ts` 三处）

| 改动 | 说明 |
|---|---|
| `cropSprite()` 返回 `{ sprite, cropped }` | 让调用方拿得到那张临时纹理 |
| `#buildItemSprite` 把 `cropped` 推进 `#frameTextures` | 本帧的临时裁剪纹理登记在册 |
| `present()` 帧末 `#disposeFrameTextures()` | 逐个 `destroy(false)`（**不碰共享 source** —— 它归图片缓存），并清空数组 |

★销毁放在**帧末**（`presenter.present()` 全部画完之后）：那之前舞台上的 Sprite 还引用着它。

### 4.3 红 → 绿

**守卫** `test/texture-listener-leak-t0181.test.ts`：连画 30 帧，断言**源上监听条数不随帧数增长**
（外加一条反面控制：没纹理的项仍然一笔不画）。先做**红测**（注掉 `#disposeFrameTextures()`）⇒ 该用例**失败**；
恢复 ⇒ **通过**（不是恒真断言）。

**实测（`tl3`，TITLE，用本轮新增的 `mem` 读数）**：

| | 修前 | 修后 |
|---|---|---|
| 源上监听条数（= 用户看到的 54 万条那一项） | 随帧数线性增长（≈1 万条/秒） | **恒定 2 条**（5 个源，最大一个 2） |
| 60~180 秒的堆走势 | 单调上涨（1.8~4 MB/s），最终 OOM | 稳定在 ~800MB **上下震荡**（V8 正常 GC），不再单调上涨 |

### 4.4 顺手修掉第二个高频源（同一类"每帧刷一行"）

`session.ts` 的 `#onGate` 里 `sleep` 门的 `cleared` 支**没看 `#sleeping` 闩锁**（它上面 `0x400`
的两支、以及本支的 WAIT 支都看了）⇒ TITLE 的 `sleep(1)` **每帧都到点** ⇒ **每帧印一行**
`=== gate sleep cleared ===`：实测 **3713 行/10 秒（≈370 行/秒）**，每行是一次
`window.api.logLine` ⇒ 一次 `POST /api/event`。修法 = 与孪生支同口径：**只在"睡着→醒了"这一次跳变上打**。
实测宿主日志写入 **4.1 KB/s → ≈1.6 KB/s**（剩下的是 500ms 节流过的 `[present]`/`[input-state]`）。

### 4.5 让泄漏**永远看得见**（新增读数）

`mem` 现在多报一行：

```text
源监听器：5 个源，最多的一个 2 条（#7：resize=2）
```

判据 = **与帧数无关**；一旦随帧数涨，就是又漏了临时纹理。实现：`TextureCache.srcListenerCounts()`
（读每个源 `_events` 里各事件的监听条数）。



## 2026-09-25

第 3 节：清理掉那个'关不掉的实例'（= 本轮采样用的 mem2，已 Stop-Process 并确认端口关闭/端点 live=0）；实测排除两件事：① DSH **服务端**只有 335MB / 15 条连接 / 345 句柄（2GB 在浏览器前端）；② **SSE 推流不成立**（面板那条流 20s 只吐 110B —— 页面的上报全走 POST /api/event，不进 SSE）。代码侧逐条排除：client.js 两个轮询都有 clearInterval、代理 res.on('close') 会 destroy 上游、宿主 waiters 两条路都 delete、renderer-status 载荷有界、L2D 只放已就绪的 PNG。下一步需在浏览器侧量（F12 → performance.memory / Heap snapshot），本机没开 CDP 端口故我读不到。
