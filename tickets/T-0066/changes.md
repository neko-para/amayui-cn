# T-0066 · 过程文档（changes.md）

## 2026-09-20

2026-09 轮 5：`T-0090` 的 E4 把"读档画面错乱"里的一条**已排除** —— 它不是 Live2D（Live2D 那条已修）。剩下的大片旧画面来自**祖先帧绘制项**（层 10..308，TITLE/SYSTEM4）与/或屏上残留像素 ⇒ 与本票的"背景只能来自载荷项 / 层序"是同一条线。对照截图：`tickets/T-0090/evidence/`。

## 2026-09-20

2026-09 轮 5（源码级判定，用户要求不依赖真机）：`T-0083` 的判定已改成以体为准 —— 结论是**装载点不清任何绘制项**（清的是两套点击热点表 + 游标：`virtual_display_a/b` = `Engine+0x55D8`/`0xCAC0`），主 Scene 的项由 `CALLBACK_LOAD.BIN` 按四个**显式 handle 区间**删并由 `LOADCHARM`/`DRAWCHARM` 重建；引擎靠**层序（key 升序）后画盖前画**处理重合。⇒ 本票的"背景只能来自载荷项 / 层序"这条**得到源码支持**，下一步是**列 key 对表**（SN0000 737-794 与落点之后 vs TITLE 的 `6e/c8/12c` 段），而不是 A/B。详见 `T-0083/notes.md` 的订正段。

## 2026-09-20


## 2026-09-20 收口（与 `T-0083` 同一次改动）

- **解析**：`src/vm/engineSlot.ts` 的清单改名 `drawItems` 并修正步长（`1 + size` dword = 2964 B）；`src/vm/engineDrawItem.ts`（新）把 740 B 记录解成 `Item`。
- **应用**：装载点新宿主缝 `native.restoreDrawItems(items)`（两个宿主对称）= 清上一屏 + 装存档清单。
- **真槽 79 自洽**：解出 **69** 条 —— 0x18A88（背景；flags=3、tex=4、src (0,0)-(2048,1152)、pos (−768,−272)）、0x19835..0x19840（ADV 侧栏，tex=17）、0x19A28..0x19A62（消息窗字格，tex=28）。这正是「本票症状」的正解：背景来自**这份清单**，不是脚本重画。
- **守卫**：`test/engine-slot.test.ts`（含真槽解码断言）+ `test/slot-load-screen.test.ts`（A/B：正常走到同一句话 vs 读档到它，还原项与实画项逐字段相等）。
- **E4**：`npm run shot -- --load 79` 日志 `restoreDrawItems: 清掉上一屏 172 项、按存档装回 69 项`；截图 `tickets/T-0083/evidence/after-itemrestore-*.png`。
- **仍未做（有据缺口）**：`animStart` 的引擎绝对时钟无法换算（还原后各窗判「未开始」= 冻结在存档当时的 work 矩阵）；旋转通道未还原；body 尾部 `{2 dword + 740 B}` 未解析。
