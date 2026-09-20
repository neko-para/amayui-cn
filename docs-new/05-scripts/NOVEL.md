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
| `32-58` | `draw-texture 186a0 48 0 0 500 2d0 0 0` | 「恢复上一屏背景」块（画在 handle 0x186A0、槽 0x48）：门是 `(global-int 3f90) != 0`（见 invariants ⇒ 恒不执行）；3f90==0 时 `jcc label_0000088c` 整段跳过 |
| `119-147` | `call-script (global-int 1394)` | `label_0000088c`：场景装配路径（字体/`i1f5`/`loadmesskip advset`）→ `call-script SN0000`（`global 1394` = 0x74） |
| `174-191` | `detach-texture 109a0 1` | ADV 收场：3f90 != 0 时 `i259`（清两张槽记录镜像）+ 区间 detach + `i1f6` |

## 关键槽 / 局部量

| 名字 | 含义 |
|---|---|
| `global 1394` | 要 call 的场景脚本 id（本机 = 0x74 = SN0000） |
| `global 3f90` | 「上一屏背景要不要恢复」门；全语料只被写成 0 |
| `global 708ada / 708ad6` | 池外全局：记住的背景图 id / 其相关门（真槽装载不还原） |

## 不变量（拿它做回归断言）

- `global 3f90` 在整个语料里只被写成 0（`grep -rn 'mov (global-int 3f90)' src/*.txt` 全为 0）⇒ line 32-58 那条「恢复背景」路径在正式脚本里恒不执行（handle 0x186A0 从未被真正画出）

## 坑（踩过一次，别再踩）

- ★`i0ae`（line 29）**早于**背景块（line 32-58）⇒ 读档续跑时那一块被跳过；「读档后背景由 NOVEL 重画」这个说法是**错的**（app/amayui-emulator/src/vm/handlers/save-slot.ts:319-322 的括注就是这么错的，见 tickets/T-0083）

## 缺口

- `label_00001160`/`label_000013fc`/`label_000016a0`/`label_00001db4`/`label_00001e8c`/`label_00001eb4` 未逐段读

## 相关

- 引擎常态能力：`save-load-drawitem-clear-and-restore`（见 `docs-new/03-engine/engine-capabilities.md`）
- 函数结论：`0x4192F0`（见 `analysis/functions.json`）
- 主题文档：`docs-new/03-engine/opcode-table.md`

## 证据与备注

- 证据：src/NOVEL.txt 的行区间见 layout；帧链/落点见 emulator 的 [slot-load] 与 0xAE 日志（0xAE: 续跑走栈 1 → 2）
- 备注：未读：gaps 列的子程序；`i073` 九宫格的参数逐项未核。
