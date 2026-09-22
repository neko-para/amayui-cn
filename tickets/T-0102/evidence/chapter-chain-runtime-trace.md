# T-0102 · 章节推进链的**运行期**取证（2026-09-23，用 T-0114 的远程调试器）

> 本文件是 T-0102 §E（「两道门都没挡住 ⇒ 元凶」）的**订正**，依据是**在真运行上**（不是读脚本）
> 拿到的值。取证手段是 `tickets/T-0114` 的调试守护进程（`tools/debugsrv.cjs` + `tools/dbg.cjs`），
> 全程**没有改源码、没有重编**——这正是 T-0114 存在的理由。
>
> 窗口截图：`evidence/e4-sc0000-g0001-paper-window.png`
> （sha256 `8CD3654E2A4B49AA64DB923A1B458E20264B8C9026152F6B08B42D1FE84F7D38`）。

---

## 0. 一句话

`SCJUMP` 的 `mov (global-int 0) 1` **不是"被盖掉"，是"选中下一个还没演过的节"** —— 它是章节进度机的
正常动作（设计如此）。白底来自它**之后**的事：`global 0` 停在 `1`，而窗口例程要 `== 6` 才画半透明黑幕。

---

## 1. 怎么跑起来的（可复现）

```powershell
# 起守护（默认静音；音频开关见 T-0114）
$env:AMAYUI_WINDOW_EDGE='1'; .\node_modules\.bin\electron.cmd tools/debugsrv.cjs
# 另一个终端：TITLE → Load Data → 存档 071 → LOAD → 是
node tools/dbg.cjs click 1070 480                       # TITLE「Load Data」（输入坐标）
node tools/dbg.cjs clickimg 677 181                     # 存档列表第 071 行（图像坐标）
node tools/dbg.cjs clickimg 190 865                     # 左下 LOAD
node tools/dbg.cjs clickimg 802 400                     # 确认框「是」
# ★断点：任何写 global 0 都停（这是 §E 当年缺的那件工具）
node tools/dbg.cjs 'b event global-int-write idx == 0'
node tools/dbg.cjs click 640 300                        # 推进一页（重复到命中）
node tools/dbg.cjs bl ; node tools/dbg.cjs frame        # 看命中次数 + 帧栈
node tools/dbg.cjs global 13d7 / 13d8 / 3f3c / 3f3d / f8080 / b22a / 1394
```

---

## 2. 两次写 `global 0`（事件断点实测，**全程只有这两次**）

| # | 命中时暂停在 | 写的值 | 帧栈（`frame` 输出，自顶向下 = 调用链） |
|---|---|---|---|
| 1 | `SN0000.BIN ip=2224` | `2` | `SYSTEM4 → NOVEL.BIN(0x5268) → SN0000.BIN(0x74) → DRAWCHARM` |
| 2 | `SCJUMP.BIN ip=43` | `1` | `SYSTEM4 → ALLMAP.BIN(0x5265) → SCJUMP.BIN(0x5224) → $5$READY` |

★**帧栈就是"跑的是哪个文件"的铁证**：运行期跑的是 **`SCJUMP.BIN`（16059 条指令）**，
对应 `src/SCJUMP.txt`（18152 行）；**不是** `src/$1$SCJUMP.txt`（698 行，包 1 变体）。
T-0102 §E 当年逐行引用的是**后者**。

`ip=43` = 「写发生在 idx 42」：`src/SCJUMP.txt:43` 正是 `mov (global-int 0) 1`。

---

## 3. 门量实测（就在第 2 次命中那一刻）

| 量 | 值 | 说明 |
|---|---|---|
| `13d7` | **1** | ★序章 G0000 **已演**（写点：`src/SC0000.txt:1282`） |
| `13d8` | **0**（未写过） | G0001（序章：遺跡に入る）**还没演** |
| `13d9` | 0（未写过） | |
| `3f3c` | 0 →（紧接的下一条）1 | 节号：本次被写成 1 |
| `3f3d` | **1** | 章号（`ALLMAP` 置的） |
| `b22a` | **0**（未写过） | ★`ALLMAP` 的门：`b22a == 0` ⇒ 置 `3f3d = 1` |
| `f8080` | **0x7fffffff**（INT_MAX） | `SETADVFLAG` 抬满 ⇒ `gr f8080, 10` 放行 |
| `1394` | `0x74` | 场景脚本 id（SC0000 的 G0000 段写的） |
| `1397` | 1（截图那一刻） | ADV 显示态 |

**⇒ `SCJUMP` 的两道门产出 `local7 = 0`、`local1 = 1`（f8080 > 10）—— 完全按脚本设计放行。**

---

## 4. 订正：`SCJUMP` 的门读的是 `13d7`，不是 `1dd7`

`src/SCJUMP.txt:38-45`（真源）：

```
label_00000390
ne (local-int 1) (global-int 13d7) 1     ← ★13d7（不是 1dd7）
jcc (local-int 1) ffffffff label_0000043c
gr (local-int 1) (global-int f8080) a
jcc (local-int 1) ffffffff label_0000043c
mov (global-int 0) 1                     ← idx 35（G0000 支）
mov (global-int 3f3c) 0
mov (global-int f8080) a
label_0000043c
ne (local-int 1) (global-int 13d8) 1     ← G0001 支
jcc (local-int 1) ffffffff label_000004e8
gr (local-int 1) (global-int f8080) a
jcc (local-int 1) ffffffff label_000004e8
mov (global-int 0) 1                     ← ★idx 42（实测命中的那一条）
mov (global-int 3f3c) 1
mov (global-int f8080) a
```

`13d7`/`13d8`/`13d9`… 是**「该节已演过」标志**，由各节的段设置写（`SC0000.txt:1282` 写 `13d7`、
`:1297` 写 `13d8`）。⇒ `SCJUMP` = **「跳到第一个还没演过的节」的进度机**：

```
13d7=1 → 跳过 G0000（已演）
13d8=0 → 选中 G0001，把 g0 设成 1（= SYSTEM4 的「ADV シナリオ実行」模式）、3f3c=1、f8080=10（再入锁）
```

`mov (global-int 0) 1` 因此**不是异常**，是"切进 ADV 模式"的标准动作。

### `jcc` 极性的独立依据（不是靠 emulator）

`analysis/opcodes.json` 的 `jcc`（0xA0 / `sub_4209B0`）语义，与反编译 `raw 29615-29639` 逐字一致：

```c
if ( sub_41BF50(_this, 1) ) { result = sub_41BF50(_this, 2); if (result == -1) return result; ... }
else                        { result = sub_41BF50(_this, 3); if (result == -1) return result; ... }
```

⇒ `op1≠0 → 跳 op2`；`op1==0 → 跳 op3`；目标 `0xFFFFFFFF` = **落下句**。
⇒ §E 表里「第一道门：local7 真 ⇒ 跳走」「local1=1 ⇒ 跳走 ⇒ 跳过 mov」都是**读反了**。

---

## 5. 白底是怎么来的（同一份运行实测）

暂停放行后（`c`），20 秒后的状态：

| 量 | 值 |
|---|---|
| 当前脚本 | `SC0000.BIN ip=1330/24501`（帧栈：`SYSTEM4 → SC0000 → DRAWCHARM`） |
| `global 0` | **1**（再无第三次写） |
| `3f3c` | 1 |
| `1397` | 1（ADV 显示态） |

⇒ 窗口例程（`src/SC0000.txt:32664-32684` / `src/SN0000.txt:3078-3098` / `src/SYSTEM4.txt:523-543`）
的判据是 `eq local0, g0, 6`：

- `g0 == 6`（NOVEL 模式）⇒ **落下句** ⇒ `create-mesh` + `set-vertex-color` = **半透明黑幕**（正确形态；
  §13 的日志实测：载入后 SN0000 阶段 `g0 = 6`，走的就是 createMesh 支，用户当时也说窗口是**对的**）
- `g0 != 6` ⇒ 跳 `label_…348` ⇒ `draw-texture 19640 11 …` = **纸窗**（用户报的白底）

**截图实证**：`e4-sc0000-g0001-paper-window.png` —— 阿瓦罗在遗迹里的对话，窗口是带银框的**纸窗**，
`global 0 = 1`。

★**`mov (global-int 0) 6` 全语料只出现一次**：`src/SC0000.txt:1292`，属于 **G0000（序章）段**
（`label_000049f4`）。**G0001 段一处都不写 `global 0`**（`label_00004ab8` 起到下一个 `comment "▼` 为止，
守卫 `test/t0102-chapter-chain.test.ts` 钉住）。

---

## 6. 收窄后的**唯一未决问题**

链是**该跑**的（脚本设计如此），写 `1` 也**是设计**。剩下的分叉只有一条：

> **真机在同一个存档点进 G0001 时，`global 0` 是 6 还是 1？**

- 若真机**也是 1** ⇒ 真机也画纸窗 ⇒ 用户报的"白底"不是分歧，而 §B 那套"真机是黑"的假设本身要重估
  （用户观察到的"黑色"来自**开合侧边栏后的重绘**，那条线归宿主侧重画载荷，见 `T-0104`）。
- 若真机是 **6** ⇒ 一定有一步在 `SCJUMP` 之后把 6 写回；而**全语料只有 `SC0000.txt:1292` 写 6**
  ⇒ 那一步只能是"**重新进入 G0000 段**"，即真机此刻 `13d7 == 0`（G0000 判定为"还没演"）。

**判据（下一轮直接可查）**：在真机上取那一刻的 `13d7`/`13d8` + `global 0`（存档池里有 `13d7`/`13d8`，
可直接 dump 真槽；`global 0` 在池的 `int[0]`）。若真槽里 `13d7 = 1` 而真机画面是黑，则 §B 的分支假设要废。

---

## 7. 本轮顺带的两个**独立**结论（与白底无关但都要留档）

1. **`global 0` 是 SYSTEM4 的「実行モード分派键」**（不是"窗口模式"这么窄）：
   `src/SYSTEM4.txt:170-171` `g0 == 1 ⇒ 内联 ADV 管线`；`:427-460` `2=ALLMAP / 3=REIGN / 4=FIELD /
   6=NOVEL / 7=STUDIO / 8=DEAL`，其余走 `不正な実行モード` + `abort`。
   ⇒ 读 `g0` 时先想"现在是哪个模式"，再想"窗口画哪一支"。
2. **`jcc` 的极性**在 T-0102 的旧叙述里被读反过两次（§B 的分支表、§E 的门方向）。
   `analysis/opcodes.json` 与引擎 raw 都没错 —— 错的是叙述。守卫
   `test/t0102-chapter-chain.test.ts` 用真 BIN 把极性钉住（突变：交换 `op2`/`op3` ⇒ 2 例红）。
