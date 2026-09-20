# T-0077 剩余条目 · IMPLEMENTATION 子代理工作记录（`.tmp/t77/`，临时区，不入库）

任务：T1 `0x12E` 悬停命中 / T2 `0x347`·`0x348`·`0x34B`（扩到同族 7 条）/ T3 `0x203` clamp+回退。

## 引擎证据（`engine/天结_unpacked.exe_utf8.c`，汇编对照 `engine/天结_unpacked.exe.lst`）

- `0x12E` = `sub_42F230` raw 39199-39252（lst 0x42F230 起）：arity 17 ⇒ argc 8；op2 = 4 连续 int(margin)、
  op5 = 16B/记录盒表、op6/7 = x/y 平面（首项 op1+1、按记录下标 j +4B 步进）、op3/op4 = x/y、op8 = count。
  两道边界门 raw 39231-32 / 39248-49；四点判据 raw 39242（`(A|B|C|D)>=0` 展开）；
  `margin 基址 == 记录基址 ⇒ 跳过该记录` raw 39239-44；命中返回记录下标 raw 39251。
- `0x347` = `sub_427E10` 34567-34580 → `sub_4AFE20` 134035-134053（`D3DXMatrixScaling(rec+80,sx,sy,sz)`，÷100=`dbl_5201F0` 4430）
- `0x348` = `sub_427EA0` 34583-34599 → `sub_4AFE90` 134058-134100（轴 +464/468/472、角 +488、`D3DXMatrixRotationAxis(+208)`，π/180 = 4713/4637）
- `0x349` = `sub_427F30` 34602-34615 → `sub_4AFF80` 134106-134125（`D3DXMatrixTranslation(+336)`）
- `0x34A` = `sub_427FB0` 34618-34631 → `sub_4AFFF0` 134129-134140（`rec[2..4]`）
- `0x34B` = `sub_428030` 34633-34651 → `sub_4B0030` 134143-134177（delay `+32`、dur `+52`、`D3DXMatrixScaling(+144)`，门 `*rec&1`）
- `0x34C` = `sub_4280D0` 34655-34674 → `sub_4B0110` 134181-134234（delay `+36`、dur `+56`、轴 `+476..484`、角 `+492`）
- `0x34D` = `sub_428170` 34677-34694 → `sub_4B0280` 134240-134274（delay `+40`、dur `+60`、`D3DXMatrixTranslation(+400)`）
- `0x203` = `sub_4232C0` 31419-31451；`sub_4ADD60` 132579-132588（查不到 ⇒ −1，否则 `DrawItem+0x60` = 本工程 `Item.from`）
- `sub_4AACA0` 130129-130146（取不到就建，`sub_49CA10` 118402-118513 ⇒ flags=0）/ `sub_4AFBF0` 133938-133947（`|=1`）
- `sub_4A07F0` 121131-121520 = **未实现的节点矩阵合成器**（`0x346`-`0x34D` 的消费端）

## 改了什么

| 文件 | before → after |
|---|---|
| `src/vm/handlers/input.ts` | `op_hover_hittest` 恒扫 count 条、无 op1/无门/无 margin/平面 4i → 按体：首项 op1+1、两道门、四点判据、平面按 j、margin 基址==记录基址则跳过；未写槽按 `enc_zero` 读 0 |
| `src/live2d/runtime.ts` | `scale: number` → `[number,number,number]`；新增**即时** `rotation`；`wins.scale.value` → 三分量；新增 `ensureNode`/`winGate`；0x347/348/349/34A/34B/34C/34D 写入函数签名/门/落点按体 |
| `src/vm/handlers/live2d.ts` | 0x348 单独注册为旋转（不再复用缩放 handler）；7 条改 float 读 + 正确的 delay/dur/分量顺序 |
| `src/live2d/render.ts` | `l2dNodeTransform` 注释：把"语料 0 次"扩写成"`sub_4A07F0` 未实现 = 已知缺口" |
| `src/vm/handlers/gfx-item.ts` | `0x203` 补 `α>255⇒255`、`α<0⇒当前 α`、`color<0⇒当前 ARGB`（在写入前读） |
| `src/vm/native.ts` | 新增 `getDrawItemColor?(handle)`（`sub_4ADD60` 宿主缝） |
| `src/renderer/headlessScene.ts` / `pixiBackend.ts` | 各实现 `getDrawItemColor`（`scene.drawItems.get(h)?.from ?? -1`） |
| `src/vm/stubNative.ts` | 桩实现（恒 −1） |
| `src/vm/nativeTap.ts` | `BRIDGE_METHODS` 加 `getDrawItemColor`（编译期穷尽检查要求） |
| `test/opcode-operands.test.ts` | 删 `0x12e`、`0x347`、`0x348`、`0x34b` 四条 ALLOW_UNDERRUN |

## 测试（单独跑，全绿）

- `test/op-12e-hover-hittest.test.ts` 8 pass / 0 fail
- `test/l2d-node-transform-ops.test.ts` 10 pass / 0 fail
- `test/op-203-draw-color-alpha.test.ts` 9 pass / 0 fail
- `test/opcode-operands.test.ts` 1 pass / 0 fail（0x12e 条目已删仍绿）
- 回归：input/config1-chain/save-slot-chain/title-exit 21 pass；live2d-chain/render/deform/moc/slot-load/capability-gap/control-telemetry/engine-config 36 pass；native-tap/blend-mode/draw-item-*/op-223/op-214/scene-report/headless-needs-render/transition-render-wiring 61 pass；game-start-chain/menu/panel/frame-loop/exit-script 29 pass；no-dead-writes 3 pass
- `npx tsx src/tools/deadWrites.ts`：48 字段、0 死写、无新增
- `npx tsc --noEmit`：干净

## 未做 / 风险

- 节点矩阵合成 `sub_4A07F0` 未实现 ⇒ `L2dNode` 的变换字段无消费端（`l2dNodeTransform` 恒单位）；语料只有 0x349(7)/0x34D(12) 命中，且没有 0x344 建节点时整块不出画。
- `0x33f`（写 `Scene+1264`）仍缺消费端（T-0017），本次未动。
- `readIntOperand` 对未写过槽给 `dec(key,0)`（key≠0 即垃圾）是 `operand.ts` 的既有口径；`0x12E` 已在本地按 `enc_zero` 修正，其它指令未动。
- `test/ticket-ledger.test.ts` 的「看板与真源同步」在本次运行中红（`['T-0091','T-0092']`）：是别的 agent 新增票据后没跑 `build-tickets.mjs`，与本改动无关（证据锚点棘轮一条通过）。
