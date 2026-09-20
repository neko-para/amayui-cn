# T-0091 · 过程文档（notes.md）

## 2026-09-20

### 轮 7 顺带观察（**未定论**，给第③项当线索）

`Scene+46508·46512·46516` = dword 下标 `[11627]`/`[11628]`/`[11629]`。本轮在 T-0097④ 的 scope 订正中偶然扫到：

- `_this[11627] = 1`（= +46508 置 1）全库约 **90 处**，且**几乎全部落在绘制项/场景图 setter 里** —— 形态高度一致，像「**改动即置脏**」的脏旗标。
- 清理点：raw **130768/130769** `v1[11627] = 0; v1[11628] = 0;`（`[11628]` = +46512 与它成对清 0）。
- `_this[11629] = 1`（+46516）常与 `[11627]` **成对**置 1（如 raw 131977/131978、132014/132015、132680/132681、133138/133139）。
- 读点候选：raw **16022** `if ( _this[11627] )`、raw **12776** `… || _this[11628] == 1`、raw **12781** `if ( (_this[11632] & 0x10000) != 0 && !_this[11629] )`、raw **12783** `return _this[11629];`、raw **137181** `if ( !v35[11629] )`、raw **117055-117177** 一批 `v5[11627] = 1; v5[11629] = 1;`。

★**但 `_this[11627]` 出现在极大量函数里，scope 并不统一** —— 必须先**逐函数**确认 `_this` 到底是 Scene / Layer / 消息窗对象，再谈语义（这正是本票第③项要做的事）。本轮已确证的两个点：`sub_4ACF60`（raw 131881）与 `sub_4AD0C0`（raw 131977/131978）的 `_this` 是 **Scene**（证据与判据见 `tickets/T-0097/changes.md` 的「scope 判据」段）。

## 2026-09-20

### 轮 8 · G1/G2 的**独立复核**（主 agent 自己回体核过，不是复述规格）+ 一个实现陷阱

**体证据（我自己 grep 定义头后读的原文）**
- 引擎的清表门**两处**，都是「`Scene+46516 == 0` 才清 `Scene+1048`」：
  ```
  136840:            if ( !*(_DWORD *)(_this + 46516) )
  136841:              result = sub_4A9BE0((_DWORD *)(_this + 1048));      // sub_4B4040 帧末
  137181:              if ( !v35[11629] )                                    // v35+262 dword = +1048 字节；11629 = 46516
  137182:                result = sub_4A9BE0(v35 + 262);                     // sub_4B4460 帧末
  ```
- `46516` 是**全场景**的池挂起位，由多处置 1（不只是转场）：转场遍在途 ⇒ raw **134941-134944** `if (… 未到点 …) *(_DWORD *)(_this + 46516) = 1;`；绘制项求值器 ⇒ raw 117844；mesh 求值器 ⇒ raw 133528；离屏槽占用 ⇒ raw 136695/136701；清 0 只在帧首（136793/137036）与复位（130428）。
⇒ **G2 前提成立**：emulator `transition.ts:574` 的 `transitions.size > 0 && active.length === 0` 只看转场自己，比引擎的「全场景」窄。

**G1 前提也成立**（我自己核过）：`scTransitionWindow(rec, clock, rt.start, **false**)` 硬编码在 `transition.ts:557`；`scAdvance`/`scAnimationsPending`/`scTransitionTick` 都没有 freeze 形参；`loop.ts:362` 调 `advanceModel(nowMs)` 不带 opts，且 `loop.ts:367-368` 在同帧 `sceneFreeze = false` ⇒ 冻结**永远传不到窗模型**。

**★实现陷阱（本主 agent 新发现，动手前必读）：G2 不能直接 import**
- `ops.ts` **已经** `import { scTransitionsPending } from './transition.js'`（`ops.ts:51`），而 `transition.ts` 目前只 `import type { SceneState } from './state.js'`（无值导入）。
- ⇒ 若在 `transition.ts` 里 `import { scPoolPending } from './ops.js'`，就会造出 **`ops.ts ↔ transition.ts` 的模块环**（本工程已有前例 `T-0089`：`handlers/save-slot → vm/ops → handlers/index → handlers/save-slot` 直接先 import 会踩 TDZ）。
- **可行的两条路**（按代价排序，下一轮择一）：
  1. **注入判据**：给 `scTransitionTick(s, clock, poolPending = () => false)` 加第三参，由**两个宿主**（`headlessScene.ts:750`、`pixiBackend.ts:1315`，它们本来就 import ops.ts）传入 `scPoolPending`。代价：改 2 个宿主 + 改 `test/transition-render-wiring.test.ts:139` 的**源码文本断言**（它断言宿主里那行恰好是 `scTransitionTick(this.scene, nowMs)`）。
  2. **把 `scPoolPending` 移到中立模块**（如 `scene/pending.ts`）再由 `ops.ts` re-export（保持既有 import 不破），`transition.ts` 从新模块 import。代价：动 `ops.ts` 一行。
- ★**两条路的注意点**：清表判据必须在 `scAdvance` **之后**求值（与引擎「本帧绘制期置 46516、帧末读它」同序），否则会拿上一帧的状态判。
- ★**与 T-0096 的冲突**：`T-0096` 要改 `renderer/scene/ops.ts`（`scL2dTick`），路线 2 会碰同一个文件 ⇒ **G2 必须等 T-0096 落地后再动**（本轮就因此没开工）。
