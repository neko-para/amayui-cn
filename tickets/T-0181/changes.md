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
