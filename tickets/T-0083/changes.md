# T-0083 · 过程文档（changes.md）

## 2026-09-20

## 2026-09-20（轮 5 收尾）E3 级实测：SAVE79 的绘制项清单解出来了

用 `decodeEngineSlotContainer` 读 `.tmp` 环境里的真槽 79（body = 4,377,344 B），清单在 body+4091708：

```
{u32 size=740, u32 count=69, (u32 handle + 2960 B 记录区) × 69}   尾部 {0,0,+740B}
⇒ ★条目步长 = 1 + size = 741 dword = 2964 B（引擎 `v97 = &v67[4*hFile]`，raw 19828）
   —— `engineSlot.ts` 现在写的是 `1 + size/4` = 186，**错了**（第 2..69 条的 handle 全落在第 0 条的记录里 ⇒ 全是垃圾）
```

前 11 条（`flags`/`tex` 取自记录 dword 0/1；src 取 +8..+0x14；pos 取 +0x24/+0x28）：

| # | handle | flags | tex | src | pos |
|---|---|---|---|---|---|
| 0 | **0x18A88** | 3 | **4** | (0,0)-(2048,1152) | (−768,−272) |
| 1 | 0x19835 | 1 | 17 | (182,794)-(316,1530) | (1148,0) |
| 2..9 | 0x19836..0x19840 | 1 | 17 | 各 (x,794)… | (1180,10…514) |
| 10..68 | 0x19A28..0x19A62 | 1 | 28 | 31×35 的格子（138..667 × 298..425） | 同 src 左上 |

- 第 0 条 = **SN0000 的背景**（handle 0x18A88、槽 4 = 装载段刚重绑的 `BG050ABL`、src 全图 2048×1152）⇒ 引擎读档后画面上的背景就是**这条被还原的项**，不是脚本重画；
- 第 1..9 条 = ADV 右侧栏（槽 17，x=1148/1180 —— 截图里 SAVE/LOAD/変更設置 那一列）；
- 第 10..68 条 = 消息窗的**字格**（槽 28，31×35 的 5×12 网格，138..667 × 298..425）—— 正是「读档后只有消息窗与右侧栏」的那个窗口。

⇒ 与 `T-0066` 的现象完全对上：emulator 只看到消息窗+侧栏（那是**它自己**的模型），而**背景只能来自这份清单**。

**两处代码缺口（本轮同时确认）**：① 步长 `1 + size/4` → 应 `1 + size`；② 740 B 记录被丢弃且无消费者（`imageReload.ids`）。

## 2026-09-20


## 2026-09-20（轮 5 收尾）实现落地 —— `restoreDrawItems`（清上一屏 + 装存档清单）

**实现**（`app/amayui-emulator/`；本轮由子代理执行、我复核 + 独立重跑验证）：

| 文件 | 改动 |
|---|---|
| `src/vm/engineDrawItem.ts`（新） | 740 B 记录 → `Item`；偏移表以体为准；**4×4 矩阵按 D3DX 写入位置**取分量（缩放 = 对角线 `+0/+20/+40`、平移 = 第 4 行 `+48/+52/+56` —— 读取端自证 = `0x228`/`sub_4AA060` 的 `D3DXMatrixDecompose`）；B 层通道步长 4 |
| `src/vm/engineSlot.ts` | 清单解析改名 `drawItems`；**修正步长** `1 + size`（2964 B = `&v67[4*hFile]`），旧写法 `1 + size/4` 让第 2..69 条 handle 全成垃圾 |
| `src/vm/handlers/save-slot.ts` | 装载点改走新宿主缝 `native.restoreDrawItems(items)`（= 清上一屏 + 装存档清单）；`ownerFrame`/`dropFrameItems` 降级为回退 |
| `src/vm/native.ts` · `nativeTap.ts` · `stubNative.ts` · `pixiBackend.ts` · `headlessScene.ts` · `scene/ops.ts` | 新缝的声明/桩/两宿主对称实现（**不调** `clearDrawContainer`：它连网格一起清，而引擎的 clear 只走 `Scene+1032`） |
| 三处错注释 | `save-slot.ts` 的 ②c/(B) 段、`present.ts` 头注、`drawitem/model.ts` 的 `ownerFrame` 文档 —— 保留锚点串，追加「(B) 前提被推翻」的订正 |
| 测试 | 新 `test/engine-draw-item-decode.test.ts`(3)；`test/engine-slot.test.ts` +3（步长 / 结构不符 ⇒ null / 真槽 79 解出 1 槽 69 项）；`test/slot-load-screen.test.ts` 按新判据重写 |

**判据（复核通过）**：`npm run verify` = **787 tests / 775 pass / 12 skip / 0 fail**、死写 0；`capabilities.js --validate` 134 条 ✅；`scripts.js --validate` 30 条 ✅；`tickets.js --validate` 90 张 ✅。

**E4**（`npm run shot -- --load 79 --name itemrestore`，exit 0）：日志 `restoreDrawItems: 清掉上一屏 172 项、按存档装回 69 项（handle 0x18a88,0x19835,0x19836,…）`。
截图归档（已从 `.tmp/` 复制进本票 `evidence/`）：
- `evidence/after-itemrestore-load-right-after.png` —— 阶梯与灰块消失，满屏 = `BG050ABL` 的日落天空 + 右侧栏；
- `evidence/after-itemrestore-load-6s.png` —— 序章文字落在正确的背景上；
- `evidence/after-itemrestore-title.png` —— 同一次运行的标题画面（对照用）。
对照「修前」：`tickets/T-0090/evidence/after-l2d-fix-load-right-after.png`（同一位置仍有天空碎片阶梯 + 橄榄灰块）。

**仍未做（有据缺口，已登记）**：① `animStart` 是引擎绝对时钟（`timeGetTime` 族毫秒），body 里没有锚点可换算 ⇒ 还原后各窗判为「未开始」= 冻结在存档当时的 work 矩阵（模块头如实写明）；② 旋转通道（`+0xEC`/`+0x12C` 矩阵与 `+0x1EC..+0x208` 轴角）逐字段偏移未确证 ⇒ 未还原；③ body 尾部 `{2 dword + 740 B}`（`Scene+0x458/0x45C/0x460`，本机槽 79 全 0）未解析。
