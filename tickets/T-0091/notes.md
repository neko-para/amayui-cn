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

## 2026-09-23

## 轮 15（T-0103 交接链审计的副产物）

按 `tickets/T-0103/evidence/chain-audit-instructions-capabilities.md` 的 D2/D3/D4，本票新增两条验收（到期帧合成 / 区间项屏幕排除），并把 D4（类别 3 的源=本帧屏幕、核=累积近似）与 U3 的关系记在上面。★E4 通道本轮已可用：`node .agents/skills/amayui-remote-debug/scripts/load-slot.mjs --slot 78` （一条命令到读档完成的 `[slot-load]` 判据）+ `capture`；**但先修 `T-0144`**（0x1F6/0x1F7 未清 572B 表），否则残留立绘会污染转场像素对照。

## 2026-09-23

## 2026-09-24 · D2/D3/D4 落地（T-0103 轮 15 的审计结论）

**⑤ 到期帧交付终值（D2）**：`scTransitionTick` 现在返回 `render` 快照（`{id, rec, rt}`，`rt.t = 1` + 终值通道），pixi 宿主存进 `#pendingTransitionRender` 并交给 `present()`（`#compositeTransitions` 优先用快照、其次查表）；`scTransitionsPending` 仍只算**在窗内**（对齐引擎「到期分支不置 `46516`」），交付那一帧靠 tick 置 `scene.dirty` 保证被合成一次；清表时序不变（帧尾、门 = 池挂起）。
**⑥ 区间项从屏幕 pass 排除（D3）**：`scTransitionMarkedHandles`（活动转场的两条区间并集 + tick 交付快照那几条）在 `presenter.present` 里过滤 DrawItem/Mesh/572B 节点，对齐引擎 `(flags & 0x10001) == 1`（raw 136905/136915/136926/136936 与 137210/137220/137252）。★仍未复刻：引擎的 `bit16` 跨帧粘住 ⇒ 36/37 是**首帧冻结快照**，emulator 每帧重渲。
**① 类别 3 的核（D4）**：按验收给的**替代路线**收口 —— 把引擎 CPU 回退核的体读事实（`sub_4A0120`：33×33 旋转方格 + 亚像素双线性；`a1==0` 平坦+中心 3 / `a1!=0` 三角斜坡）与**不复刻的理由**（1089 采样/帧不可行 + 真机有 effect 时走 shader）写成一份披露（`TransitionBlurPlan` 的偏差披露 ①②，含 asm 判据 `0x4B3187: cmp eax,3 / jnz`），守卫 `test/sc-transition-window.test.ts` 的 D4 例钉住"两份口径不许并存"。
**④ E4 可达路径**：`.agents/skills/amayui-remote-debug/scripts/load-slot.mjs --slot 78` 让"读档到 SN0000 末页 → 下一步就是切章"变成一条命令（判据 = 日志 `[slot-load]`）。
**② `[4]` 指向非 `create-texture` 槽**：仍**未做**（本票剩余项）。

## 2026-09-26 · ② 收口 + **重开条件与发现路径**（用户提问追补）

**收口内容**（与 `acceptance` 第 ② 条对应）：读体 `sub_4A50C0`（raw 124819-124920）确认两条路 —— `a2 > 0x3E7`（unsigned ⇒ 含 `-1`）走**后台缓冲**（raw 124839-124861，转场直接画到屏幕、记 `Scene+46456 = -1`），
`0..999` 才查槽表 `Scene[4*slot + 42456]`。emulator 只建模「`0..999` 且该槽有 `create-texture` 表面」这一种 ⇒ 判据抽成纯函数 `transitionTargetKind(slot)`，
宿主对后台缓冲分支**只登记不假装**（`#compositeTransitions` 打一条点明 raw 的日志并跳过本帧合成）；守卫 = `test/transition-render-wiring.test.ts` 的 8 例单元 + 源棘轮。

**★重开条件（原文在第二层 `clock-read-transition-window` 的 `note` 里，此处只回链）**：

- ① 出现 `[4] = -1` ／ `> 999` 的**语料现场**或 E4 采样；
- ② 宿主引入**真实离屏渲染目标**。

**★怎么发现（2026-09-26 用户提问：「这个要如何发现？目前这个单已经关掉了」）**：今天**没有任何机械检查**会亮灯（`--validate`/`--list`/看板都不读 capability 的散文），
所以下面的三条就是答案，制度化的工作单 = `tickets/T-0186`：

1. **静态（条件 ① 的普查版）**：语料扫描 —— `tickets/T-0186/evidence/transition-target-scan.txt`（262 个写端 / 181 个文件；今天**越界 0 处**，183 处 `(local-ptr 2)` 静态不可界定）；
2. **运行期（条件 ① 的实时版）**：跑一遍复现链后 `grep 走后台缓冲 <实例日志>` **必须 0 命中** —— 日志行已存在，不需要新代码；
3. **制度化**：`T-0186` 要把 ①② 做成守卫棘轮 + 文档化检查，并给出**重开手册**（命中时：本票 done → doing、evidence 加现场、补 E4/E3 判据、同步 capability note 与 `analysis/opcode-gaps.json`）。

⇒ 本票保持 `done`（判据/守卫/缺口登记三件都在），但**它的缺口在票层是隐形的**（181 张票里只有本节的固定措辞「重开条件」），这正是 `T-0186` 存在的理由。
