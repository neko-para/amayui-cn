# T-0066 · 过程文档（notes.md）

## 2026-09-19

.

## 2026-09-20


## 2026-09-20（轮 5 收尾）★源码级订正：真槽 body **带**绘制项清单

原判（本票 `why` 的第一段）「真槽的容器里没有绘制项（只有 100 个解码图槽 + 1000 条 20B 纹记录）」**是错的**：

- body 末段就是绘制项清单 `{u32 740, u32 count, (u32 handle + 740 B DrawItem 记录) × count}`；
- 引擎装载段 `sub_410160` raw 19810-19820 先清 `Scene+0x408` 容器（销毁整棵树 + 复位哨兵/计数），
  raw 19822-19832 再逐条 `sub_49A300`（740 B 记录默认初始化）+ `memcpy` + `sub_40C910`/`sub_40C310` 插回；
- emulator 早把它解析出来了（`src/vm/engineSlot.ts` 的 `imageReload`），但**只留 handle（`ids`）把 740 B 记录丢掉，而且没有任何消费者** ⇒ 这才是「背景/ADV 窗不再出现」的根因。

同时订正两条假设：

1. 「引擎靠续跑后的脚本重画」（本票原 `why` 的末段、`save-slot.ts:319-322` 的括注）：`0xAE`（`sub_4192F0` raw 24634-24731）把帧 ip **直接置**成记录落点 ⇒ 帧的 `i0ae` 与落点之间**被跳过**；SN0000 的场景起始背景绘制（指令 757/758，line 1027）正在被跳过带 738..793 内 ⇒ 不会被重跑。
2. 「背景绘制点 = NOVEL `draw-texture 186a0`（line 55）」：那条在 `global 3f90 != 0` 门后，而 `3f90` 全语料只被写成 0（`grep -rn 'mov (global-int 3f90)' src/*.txt` 全为 0）⇒ 正式脚本里**从不执行**（handle 0x186A0 从未被画出）。

⇒ 本票与 `T-0083` 的解法一致：**还原 body 的绘制项清单**（+ 装载点清上一屏的项）。判定与锚点见 `T-0083/notes.md` 的同日段与 `analysis/engine-capabilities.json` 的 `save-load-drawitem-clear-and-restore`。

## 从 ticket.json 的 `notes` 字段迁入（2026-09 文档模型）

探针（已删）：读档后逐帧打印模型计数与所有 configureDrawItem 调用；200 帧内只有 DRAWCHARM.BIN 的侧栏项。
