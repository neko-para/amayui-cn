---
kind: generated
state: live
home: analysis/scripts.json
generated_by: scripts/build-scripts.mjs
---

# 脚本台账 · `NOVEL`

> 由 `analysis/scripts.json` 生成（`node scripts/build-scripts.mjs`）—— **勿手改本文件**。

| 项 | 值 |
|---|---|
| 脚本 | `NOVEL.BIN`（真源 `src/NOVEL.txt`） |
| 状态 | 🟠 部分 |
| 是什么 | **ADV/NOVEL 场景的包装脚本**（SYSTEM4 的 mode 6 分支）：登记 ADV 消息窗图（槽 0xC）、画消息窗九宫格，再 `call-script (global-int 1394)` 进真正的场景脚本（本机 = SN0000）。 |
| 怎么进/出 | `src/SYSTEM4.txt:447 call-script 5268`（`global 0 == 6` 的 mode 分支）；本机真槽 79 的帧链 0=SYSTEM4 / 1=NOVEL / 2=SN0000（`0xAE` 走栈）。 |

## 结构（读了哪些段）

| 行区间 | 锚点（必须出现在该区间内） | 职责 |
|---|---|---|
| `6-11` | `set-texture 5190 c (local-int 0)` | 入口：登记消息窗图到槽 0xC + `i1b1 1` + `i073 8 0 (local-int 0) c 0 (local-int 1) 38 38 8 64`（消息窗九宫格） |
| `28-34` | `label_00000208` | ★帧续跑门：命中 0x3 call 表 ⇒ 落到「调用点的下一条」；命中 0x71 消息表 ⇒ 重放该消息。`i0ae` 在 line 29，**背景块在它之后** |
| `32-58` | `draw-texture 186a0 48 0 0 500 2d0 0 0` | 「恢复上一屏背景」块（画在 handle 0x186A0、槽 0x48）：门 = `eq local0,(global 3f90),0` + `jcc local0 ffffffff label_0000088c` ⇒ **`3f90 == 0` ⇒ 落下句、整块执行**；`3f90 != 0` ⇒ 跳 `label_0000088c` 跳过（★原写「门是 3f90 != 0」「3f90==0 时整段跳过」两处都反了 —— `jcc` 口径见 `analysis/opcodes.json` 的 `0xA0` 行 / `tickets/T-0145`） |
| `119-147` | `call-script (global-int 1394)` | `label_0000088c`：场景装配路径（字体/`i1f5`/`loadmesskip advset`）→ `call-script SN0000`（`global 1394` = 0x74） |
| `174-191` | `detach-texture 109a0 1` | ADV 收场：`3f90 == 0` 时 `i259`（清两张槽记录镜像）+ `call label_000013fc/000016a0/00001db4` + 后续按 `4fd9` 分叉（`4fd9 == 0` ⇒ 跳 `label_00000c18` 走 `i1f6`）—— ★原写「3f90 != 0 时」是**反的**（见 `tickets/T-0145`） |
| `119-126` | `mov (global-int f807b) ffffff` | ★ADV 场景入口 `label_0000088c` 的**颜色复位**：`mov f807b ffffff` + `mov f807c 0` + `i075 1e` + `i076 (global-int f807b)` / `i077 (global-int f807c)` ⇒ 正文填充色=白、描边色=黑；`jcc … label_000009c4` 之后是 `comment "loadmesskip advset"` 与 `call-script (global-int 1394)`（line 147 = 进场景脚本 SN0000）。★这一段在 `i0ae`(line 29) **之后** ⇒ 读档续跑不重跑它 |

## 关键槽 / 局部量

| 名字 | 含义 |
|---|---|
| `global 1394` | 要 call 的场景脚本 id（本机 = 0x74 = SN0000） |
| `global 3f90` | 「上一屏背景要不要恢复」门；全语料只被写成 0 |
| `global 708ada / 708ad6` | 池外全局：记住的背景图 id / 其相关门（真槽装载不还原） |
| `global f807b / f807c` | 正文填充色 / 描边色的**当前值**（池外全局：`0xF807B` = 1,015,931 > int 池长 1,015,792 ⇒ 读档不还原，沿用进程内旧值）。入口的 `i076/i077` 把它钉进字体；SC 族每行重算它（`CHECKCONFIG` / 各 SC 的行色例程），NOVEL/SN0000 都不重算 |

## 不变量（拿它做回归断言）

- `global 3f90` 在整个语料里只被写成 0（`grep -rn 'mov (global-int 3f90)' src/*.txt` 全为 0）⇒ **line 32-58 那条「恢复背景」路径恒执行**（★原写「恒不执行」是把 `jcc` 极性看反了，见 `tickets/T-0145`）；但决定画不画 `186A0` 的是下一道 `4fd9` 门：`4fd9 == 0`（本机真槽）⇒ 跳 `label_00000448` 走 `i1f6`/`i23d` 支，**handle 0x186A0 在本机从未被画出**
- `f807b` 的复位点只有各帧自己的「场景入口块」：`NOVEL.txt:121`、`SYSTEM4.txt:272`、每个 SC 脚本的 `1113` 一带；逐行重算色的是 SC 族的行色例程（`SC0000.txt:33927-33963` = `label_00072a3c`，与 `CHECKCONFIG.txt:52-82`、`CONFIG1.txt:3196-3213` 同源）——序章 `SN0000` 主路径**一处都没有**

## 坑（踩过一次，别再踩）

- ★`i0ae`（line 29）**早于**背景块（line 32-58）⇒ 读档续跑时那一块被跳过；「读档后背景由 NOVEL 重画」这个说法是**错的**（app/amayui-emulator/src/vm/handlers/save-slot.ts:319-322 的括注就是这么错的，见 tickets/T-0083）
- ★读档**不复位**正文颜色：入口的 `mov (global-int f807b) ffffff`(line 121) 在 `i0ae`(line 29) 之后 ⇒ 读档续跑不执行它，而子帧 SN0000 自己一处都不设色 ⇒ 从「上一场景最后一句是角色色」的存档读档进序章，旁白会带上一场景的角色色（`T-0187` ② 实测：存档 77 = SC0000 阿瓦罗黄 `#ffe100` → 游戏内读 78 ⇒ 序章旁白 `#ffe100`；同一槽从 TITLE 冷启动读 = 白）
- ★读档后正文变白的机制候选（T-0187 复核 2026-09-26）：Font+1360/+1364 **不在**读档恢复范围内（raw 19705/19747 只覆盖 int 池 0..count = 1,015,792，而 f807b = 1,015,931 在其外）；但引擎有**第三族写点** —— 72B 文本记录（sub_45F090 raw 74359-74400 在入队时把 Font+1360/+1364 快照进记录 +20/+24）在重绘时**回写** Font+1360（raw 76940-76962 / 77807-77809 / 78663-78665）⇒ 「读档后白」最可能来自 sub_45F1B0 恢复的那份记录（SAVE78 是白旁白期存的）。emulator 完全没实现 sub_45F1B0。

## 缺口

- `label_00001160`/`label_000013fc`/`label_000016a0`/`label_00001db4`/`label_00001e8c`/`label_00001eb4` 未逐段读

## 相关

- 引擎常态能力：`save-load-drawitem-clear-and-restore`（见 `docs-new/03-engine/engine-capabilities.md`）
- 函数结论：`0x4192F0`（见 `analysis/functions.json`）
- 主题文档：`docs-new/03-engine/opcode-table.md`

## 证据与备注

- 证据：src/NOVEL.txt 的行区间见 layout；帧链/落点见 emulator 的 [slot-load] 与 0xAE 日志（0xAE: 续跑走栈 1 → 2）
- 备注：未读：gaps 列的子程序；`i073` 九宫格的参数逐项未核。
