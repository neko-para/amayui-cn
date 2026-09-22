# T-0102 · ADV 窗口"白底"：**当前权威状态**（2026-09-22）

> **本文件是 T-0102 的当前结论。**下面的 §A–§F 是**权威**；§G 是**已作废**的中间结论（留档防重犯）。
> 详细原始取证按主题分散在三份文件里，本文件给入口与索引。
> 规矩：凡推断都写明"候选/未证"；凡结论都带可复算落点（文件:行 / 日志行 / 命令）。

---

## A. 一句话结论

**ADV 窗口的"白底" = 窗口模式选择子 `global 0` 被覆盖成 1。**
`SC0000` 已经把它**正确写成 6**，随后 `SN0000` 结尾的**章节推进链**（`ALLMAP` → `SETADVFLAG` → `SCJUMP`）
在 `SCJUMP` 里执行了 `mov (global-int 0) 1`，把 6 盖成 1 ⇒ 窗口例程走"白纸窗"支。

**不是渲染 bug、不是纹理 bug、不是 `0x259`。** 这三者都有实测证据排除（§C）。

---

## B. 现象的判定点（脚本侧，可靠）

`src/SN0000.txt:3075-3099` 与 `src/SC0000.txt:32662-32686`（同型）：ADV 窗口例程按 `global 0` 二选一：

| `global 0` | 支 | 画面 |
|---|---|---|
| `== 6` | `draw-texture 19640 11 0 0 43e 95 5d 22c`（槽 0x11 = 17） | **白纸窗**（`SO001.AGF` 的窗户图） |
| `!= 6` | `create-mesh 19640 …` + `set-vertex-color 19640 0 (global f807d) 0` | **半透明黑幕**（玩家预期） |

⇒ 用户看到的"白"= 走了 `== 6` 支。而**真机是黑** ⇒ 真机那一刻 `!= 6`。

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

`src/$1$SCJUMP.txt:38-53`（`global 3f3d == 1` 进入 `label_00000390`）：

```
eq local1, global 1dd7, 1
eq local2, global 3318, 1
and local3, local1, local2
ne local4, global 1521, 1
and local5, local3, local4
ne local6, global 2f3c, 1
and local7, local5, local6
jcc local7, ffffffff, label_000004e4    ← 第一道门：local7 真 ⇒ 跳走（跳过下面三行）
gr  local1, global f8080, a
jcc local1, ffffffff, label_000004e4    ← 第二道门：local1 真 ⇒ 跳走
mov (global-int 0) 1                    ← ★只有两道门都「假」才执行（= 元凶）
mov (global-int 3f3c) 14a
mov (global-int f8080) a
```

`jcc` 级诊断（日志 4089-4093）实测：

| 命中 | 诊断 | 含义 |
|---|---|---|
| `SCJUMP ip=1` | `local1=1 ⇒ 跳 op2=0xffffffff` | `3f3d == 1` ⇒ 进本支 ✔ |
| `SCJUMP ip=32` | `local1=0 ⇒ 跳 op3=0x0` | 第一道门前置（`ne 5079`）落下句 |
| `SCJUMP ip=39` | `local1=1 ⇒ 跳 op2=0x12b` | 第二串前置跳走 |
| `SCJUMP ip=41` | `local1=1 ⇒ 跳 op2=0x12b` | 第二道门（`gr f8080`）**跳走** |
| — | `写 global0 ← 1 @SCJUMP ip=42` | **但仍落到了这一行** |

★`ip` 与数组下标差 1（诊断显示 `ip=N` = 下标 `N-1`，已用 BIN 实解核对）。

**四个门量的实测值**：`1dd7 = 0`、`3318 = 0`、`1521 = 0`、`2f3c = 0`（两份真槽池 + 运行期诊断一致）
⇒ `local7 = 0 && 0 && 1 && 1 = 0` ⇒ 第一道门**落下句**；
`f8080` 被 `src/SETADVFLAG.txt:24`（`mov (global-int f8080) 7fffffff` = INT_MAX）抬满
⇒ 第二道门**也放行**（`INT_MAX > 10`）⇒ 元凶写执行。

---

## F. 未决（下一轮要判死的唯一问题）

**这条链在此时会不会被真机执行？** 三种可能，各有明确判据：

| # | 假设 | 判据 |
|---|---|---|
| **(a)** `SCJUMP` 本就不该跑 | 查触发者：`ALLMAP` 的 `b22a` 门（`src/ALLMAP.txt:35`，`b22a == 0` 才置 `3f3d = 1`）与 `SN0000:2227` 那一带的分支 | 
| **(b)** 链该跑，但第一道门的四个量在真机上取值不同 | 需要**真机 oracle**：真机走到同一帧，看 `1dd7`/`3318`/`1521`/`2f3c` 是几；或看窗口黑/白反推 | 
| **(c)** 链该跑、门也确实没挡住，但真机有**更晚**的一步把 6 写回 | 全语料只有 `src/SC0000.txt:1292` 写 `mov (global-int 0) 6`，已实测**在本链之前**执行 ⇒ 除非真机之后还会再跑它 | 

★**关键分叉**：`1dd7` 的唯一写点在 `src/SC2560.txt:1282`（很后面的章），`3318` 的唯一写点在
`src/GAMESTART.txt:1018-1030`（ゲーム開始 支，下标 701）。两者在 emulator 里都没执行
⇒ **需要真机对照才能确定"真机此刻是否也是 0"**。

已就位的诊断（临时件，见 §I）能一次给出：`b22a` / `3f3d` / `3f53` / `3f3c` 的取值与分支。

---

## G. ★已作废的中间结论（留档，勿再用）

| 轮次 | 曾经的结论 | 为什么作废 |
|---|---|---|
| §7（13:11） | "读档续跑**重跑了场景初始化**，把 `global 0` 从 6 改成 1" | 诊断实测 `global 0` **全程是 1**、没有 6→1 的过程；且 `[slot-load]`/`0xAE` 的真实顺序证伪 |
| §10（13:28） | "`SCJUMP` 的门被 `f8080` 放行 ⇒ 元凶" | 方向对了一半，但**漏了第一道门**（它才是关键） |
| §11（13:34） | "`3318` 该是 **1**（'已开始过新游戏'标志）" | **门的方向说反了**：`local7` 真 ⇒ **跳走** ⇒ 要跳过元凶写，第一道门必须为**真** |
| §11 续 | 把 `GAMESTART` 扯进因果链 | 日志里 `GAMESTART` 在"载入存档"那次**一次都没执行**；而"从 GAMESTART 启动"那次两条路表现又一样 ⇒ 它不是必要条件 |

★**两条真 bug 不因上述作废而回退**：`0x259` 的口径纠错（imgid 不该清、标志位该清）是**独立成立**的
（引擎逐位复核），只是**不是白底的成因**。

---

## H. 产出索引

| 文件 | 内容 |
|---|---|
| `evidence/texture-slot-identity.md` | 槽号身份判决（`11`=0x11=槽17）、564 个 BIN 直方图、SAVE78 的 `records[17]` |
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
