# T-0102 · ADV 窗口"白底"：**当前权威状态**（2026-09-22）

> ★★**2026-09-23 重大订正 —— 先读 `evidence/chapter-chain-runtime-trace.md`。**
> 轮 19 用 `tickets/T-0114` 的远程调试器在**真运行**上取证，推翻了本文件 §B 的分支表、§E 的门方向、
> 以及"跑的是 `$1$SCJUMP.txt`"这个底稿：
> ① 运行期跑的是 **`src/SCJUMP.txt`**（16059 条指令），**不是** `src/$1$SCJUMP.txt`（698 行）；
> ② 门的变量是 **`13d7`/`13d8`/…（逐节「已演过」标志）**，**不是 `1dd7`**；
> ③ `mov (global-int 0) 1` 是**选中下一个还没演过的节**（章节进度机的正常动作），**不是"被盖掉"**；
> ④ 白底 = 进入 G0001 后 `g0` 停在 **1**，窗口例程要 `== 6` 才画半透明黑幕 ⇒ 走 `draw-texture` 纸窗支
> （截图 `evidence/e4-sc0000-g0001-paper-window.png`）。
> 本文件以下各节的**极性叙述按下表订正**后仍然有用（时间线、已排除项、诊断清单都还有效）。

> **本文件是 T-0102 在 2026-09-22 的结论。**下面的 §A–§F 是**权威**；§G 是**已作废**的中间结论（留档防重犯）。
> 详细原始取证按主题分散在三份文件里，本文件给入口与索引。
> 规矩：凡推断都写明"候选/未证"；凡结论都带可复算落点（文件:行 / 日志行 / 命令）。

---

## A. 一句话结论

**ADV 窗口的"白底" = 窗口模式选择子 `global 0` 被章节推进链改成 1（= 选中下一节），而窗口例程要 `== 6`。**

`SC0000` 已经把 6 写进池（`src/SC0000.txt:1292`，G0000/序章段的段设置），随后 `SN0000` 结尾的章节推进链
（`ALLMAP` → `SETADVFLAG` → `SCJUMP`）在 `SCJUMP` 里执行了 `mov (global-int 0) 1`。
★**轮 19 订正**：那一句是脚本**设计**的动作（"选中还没演过的 G0001，进 ADV 模式"），
不是异常覆盖；见 `evidence/chapter-chain-runtime-trace.md`。

**不是渲染 bug、不是纹理 bug、不是 `0x259`。** 这三者都有实测证据排除（§C）。

---

## B. 现象的判定点（脚本侧，可靠）

★**分支标签在 2026-09-23 被订正（原表是反的）**：`src/SN0000.txt:3075-3099` 与
`src/SC0000.txt:32662-32686`（同型）的判据确实是 `eq local0, global0, 6`，但两个分支谁是谁要按
`jcc cond, op2, op3`（cond 真 → **op2**，`op2 = 0xFFFFFFFF` = **落下句**）读：

| `global 0` | 走向 | 画面 |
|---|---|---|
| `== 6` | **落下句** → `create-mesh 19640 …` + `set-vertex-color 19640 0 (global f807d) 0` | **半透明黑幕**（玩家预期，SN0000 阶段实测走的就是这支） |
| `!= 6` | 跳 `label_…348` → `draw-texture 19640 11 0 0 43e 95 5d 22c` + `set-draw-color-alpha` | **纸窗**（带银框的窗图，用户看到的"白"） |

⇒ 用户看到的"白"= `g0 != 6`（实测 `g0 = 1`）。而**真机那一刻是几仍未证**（§F）。

★`src/*.txt` 的裸数字**全是十六进制**（`disassembler.mjs` 走 `age-shared.mjs:335` 的 `(v>>>0).toString(16)`）
⇒ `11` = 0x11 = 槽 **17**（不是槽 11）。详见 `evidence/texture-slot-identity.md`。

---

## C. 已彻底排除的三项（各有实测证据）

| 项 | 结论 | 证据 |
|---|---|---|
| **纹理槽配置** | 槽 `0x11` 全程 = `0x5260`（`SO001.AGF`，1280×1792，已解码）；`set-texture 5260 11`（`src/SYSTEM4.txt:123`）开机绑定；两份真槽的 `records[17]` 也是 `0x5260` | `evidence/texture-slot-identity.md`；全库 564 个 BIN 直方图：`draw-texture` 引用槽 17 共 2670 次、十进制 11 共 **0** 次 |
| **占位块**（1×1 `Texture.WHITE`） | 日志里 `未绑定纹理槽 → 占位块` / `纹理未就位` **各 0 条**；`slotTex 自愈` **0 条** | 三份现场日志 |
| **`0x259` 清槽记录** | 它清的**不是** imgid 而是**标志两位**（`Scene/0x750`/`0x754` = `0x258` 的写入点）；emulator 曾**清反**（多清 imgid、漏清标志）—— 已修 + 上锁 | `evidence/clear-slot-records-root-cause.md` §1.5/§2/§5 |

★另：`GAMESTART`/`3318` 那条假设也已作废（见 §G）。

---

## D. `global 0` 的完整时间线（从 GAMESTART 启动那次，日志 13:45）

```
2800  写 global0 ← 1   @GAMESTART.BIN ip=933     ← GAMESTART 自己设的
2827  写 global0 ← 6   @SC0000.BIN  ip=972      ← ★SC0000 写对了（= 序章窗口模式）
3988  写 global0 ← 2   @SN0000.BIN  ip=2227     ← SN0000 结尾改成 2
4093  写 global0 ← 1   @SCJUMP.BIN  ip=42       ← ★章节推进链盖成 1
4760  draw-texture … global0(解码)=1            ← 白纸窗
```

**全日志只有这四处写 `global0`**（诊断实测），**再没有任何地方写回 6**。

两条路（`载入 078 → 推进` / `从 GAMESTART 开始 → 推进`）**日志形态完全一致**，都收敛到 `SCJUMP` 写 1
—— 与用户实测"两种走法表现一样"吻合。

---

## E. 章节推进链：为什么两道门都没挡住

> ★★**本节已于 2026-09-23 订正 —— 原文引用的是 `src/$1$SCJUMP.txt`（包 1 变体），
> 而运行期跑的是 `src/SCJUMP.txt`；门量也从 `1dd7` 改成 `13d7`。见
> `evidence/chapter-chain-runtime-trace.md` §4。下面是可复算的原文，**极性按该文件读**。**

`src/SCJUMP.txt:38-54`（`global 3f3d == 1` 进入 `label_00000390`；★**这是运行的那一份**）：

```
label_00000390
ne (local-int 1) (global-int 13d7) 1          ← ★13d7 = 「序章 G0000 已演」
jcc (local-int 1) ffffffff label_0000043c     ← 13d7==1 ⇒ local1=0 ⇒ 跳走（跳过下面三行）
gr (local-int 1) (global-int f8080) a
jcc (local-int 1) ffffffff label_0000043c
mov (global-int 0) 1                          ← idx 35：选中 G0000
mov (global-int 3f3c) 0
mov (global-int f8080) a

label_0000043c
ne (local-int 1) (global-int 13d8) 1          ← ★13d8 = 「G0001 已演」
jcc (local-int 1) ffffffff label_000004e8     ← 13d8==0 ⇒ local1≠0 ⇒ 落下句
gr (local-int 1) (global-int f8080) a         ← INT_MAX > 10 ⇒ 落下句
jcc (local-int 1) ffffffff label_000004e8
mov (global-int 0) 1                          ← ★idx 42：实测命中的那一条
mov (global-int 3f3c) 1
mov (global-int f8080) a
```

★**订正（轮 19 实测）**：`13d7 = 1`、`13d8 = 0`、`b22a = 0`、`f8080 = INT_MAX`
⇒ 脚本**必然**选中 G0001 并写 `g0 = 1`、`3f3c = 1`、`f8080 = 10`（再入锁）。
所以这不是"门没挡住"，而是**门按设计放行**：链该跑，`g0 = 1` 就是它的输出。

`jcc` 极性的权威依据：引擎 `sub_4209B0`（raw 29615-29639）—— `op1≠0 → op2`；`op1==0 → op3`；
目标 `0xFFFFFFFF` = 落下句。与 `analysis/opcodes.json` 一致。

---

## F. 未决（下一轮要判死的唯一问题）—— ★轮 19 收窄

> 旧的"三选一"（链该不该跑 / 门量是否不同 / 是否有更晚一步写回 6）**已作废**：它建立在读错文件
> （`$1$SCJUMP.txt`）之上。轮 19 实测：链**该跑**，`g0 = 1` **是设计**（选中 G0001）。

**唯一未决**：**真机在同一个存档点进 G0001 时，`global 0` 是 6 还是 1？**

| # | 情形 | 后果与判据 |
|---|---|---|
| **(a)** | 真机**也是 1** | 真机也画纸窗 ⇒ "真机是黑"这条前提本身要重估（用户看到的黑来自**开合侧边栏后的重绘**，那条线归宿主侧重画载荷 / `T-0104`） |
| **(b)** | 真机是 **6** | 必有一步在 `SCJUMP` 之后把 6 写回；而**全语料只有 `SC0000.txt:1292` 写 6** ⇒ 只能是"重新进入 G0000 段"，即真机此刻 `13d7 == 0` |

**判据（可直接查）**：dump 真槽池的 `13d7`/`13d8` 与 `int[0]`（= `global 0`）。
★若真槽 `13d7 = 1` 而真机画面是黑，则 (b) 被排除 ⇒ 剩下 (a)。
另：`13d7`/`13d8` **在保存池里**（随存档持久化），`f8080` **不在**（进程内裸量）。

已就位的工具（`tickets/T-0114`）：`tools/dbg.cjs` 可对运行中的引擎做只读查询 + 断点 + 输入驱动，
**不必再改源码加诊断**（本轮就是这样取到证的）。

---

## G. ★已作废的中间结论（留档，勿再用）

| 轮次 | 曾经的结论 | 为什么作废 |
|---|---|---|
| §B（2026-09-22） | "`== 6` ⇒ 白纸窗；`!= 6` ⇒ 黑幕" | ★**分支标签反了**（轮 19）：按 `jcc cond, op2, op3` 读，`== 6` 是**落下句** ⇒ 走 `create-mesh` = 黑幕；`!= 6` 才是 `draw-texture` 纸窗。旧表与"真机是黑 ⇒ 真机 `!= 6`"这句自相矛盾（实测 emulator 那一刻 `g0 = 1`） |
| §E（2026-09-22） | "两道门都没挡住 ⇒ `mov global0 1` 是元凶" | ★**引用了错的文件**（轮 19）：逐行引 `src/$1$SCJUMP.txt`（698 行，门读 `1dd7`），而运行期跑的是 `src/SCJUMP.txt`（16059 条指令，门读 `13d7`/`13d8`）。实测 `13d7=1 / 13d8=0` ⇒ 门**按设计放行**，那句 `mov` 是"选中 G0001" |
| §F（2026-09-22） | 三选一：(a) 链不该跑 / (b) 门量真机不同 / (c) 更晚写回 6 | 建立在 §E 的错文件上 ⇒ 已换成"真机那一刻 `global 0` 是几"这**一个**问题 |
| §7（13:11） | "读档续跑**重跑了场景初始化**，把 `global 0` 从 6 改成 1" | 诊断实测 `global 0` **全程是 1**、没有 6→1 的过程；且 `[slot-load]`/`0xAE` 的真实顺序证伪 |
| §10（13:28） | "`SCJUMP` 的门被 `f8080` 放行 ⇒ 元凶" | 方向对了一半，但**漏了第一道门**（它才是关键） |
| §11（13:34） | "`3318` 该是 **1**（'已开始过新游戏'标志）" | **门的方向说反了**（且 `3318` 本身不在运行的那支脚本的门里） |
| §11 续 | 把 `GAMESTART` 扯进因果链 | 日志里 `GAMESTART` 在"载入存档"那次**一次都没执行**；而"从 GAMESTART 启动"那次两条路表现又一样 ⇒ 它不是必要条件 |

★**两条真 bug 不因上述作废而回退**：`0x259` 的口径纠错（imgid 不该清、标志位该清）是**独立成立**的
（引擎逐位复核），只是**不是白底的成因**。

---

## H. 产出索引

| 文件 | 内容 |
|---|---|
| `evidence/texture-slot-identity.md` | 槽号身份判决（`11`=0x11=槽17）、564 个 BIN 直方图、SAVE78 的 `records[17]` |
| ★`evidence/chapter-chain-runtime-trace.md` | **轮 19 权威取证**（远程调试器实机）：跑的是哪个 SCJUMP、门量实测、白底截图实证、收窄后的未决问题、`global 0` = SYSTEM4 実行モード分派键 |
| ★`evidence/e4-sc0000-g0001-paper-window.png` | 白底实证帧（sha256 `8CD3654E…F7D38`） |
| `evidence/clear-slot-records-root-cause.md` | `0x259` 逐位复核 + 读档池还原 + `global 0` 时间线全记录（含 §10-13 的演进） |
| `evidence/e4-sc0000-white-panel.png` / `.md` | E4 归档帧（`#E3E3E3` 平铺）与像素打点 |
| `changes.md` | 实现级变更（`0x259` 修复 + 守卫 + 突变证明） |

第三层台账（`docs-new/05-scripts/`）：本票新增/补全 `SCJUMP`、`ALLMAP`、`SETADVFLAG` 三条。

---

## I. 当前源码里的**临时诊断**（跑完即撤）

| 文件 | 打点 | 作用 |
|---|---|---|
| `vm/handlers/arithmetic.ts` | `写 global0 ← V @脚本 ip=N` + `SCJUMP 门：…` | 谁写了 `global 0`；门量的值 |
| `vm/handlers/gfx-texture.ts` | `draw-texture … global0(原始/解码) texSlots[0x11]` | 窗口判决点 |
| `vm/handlers/save-slot.ts` | `池还原：int[0] 文件值=… key=… ⇒ raw=…` | 存档池怎么装进去 |
| `vm/handlers/control.ts` | `jcc cond=local1/local7=… ⇒ 跳 op2/op3=…` | 门的**实际去向**（公共汇合点） |

★已知瑕疵：`arithmetic.ts` 的 `SCJUMP 门` 打点会在**任何**写 `global0` 时触发（含 GAMESTART/SC0000），
以及 `ip` 显示与数组下标差 1 —— 都是显示问题，不影响判读。
