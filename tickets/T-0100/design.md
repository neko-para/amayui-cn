# T-0100 诊断报告（ANALYSIS-ONLY / 只读）

> 范围声明：本次**没有修改任何仓库文件**（`analysis/`、`tickets/`、`docs-new/`、`app/`、`src/`、`scripts/` 全部原样）；
> 只读了仓库与 `engine/天结_unpacked.exe_utf8.c`，中间物只写本文件（`.tmp/t0100/`）。
> 没有跑 `npm run verify` / `npm run shot`（按任务书留给主 agent）。
> 引擎结论一律给 `//----- (XXXXXXXX)` 所在的 raw 行号或 listing 锚点；emulator 结论给 `file:line`。

---

## 0. 结论摘要

| 问题 | 判定 |
|---|---|
| **「SN0000 中心的文字」是谁画的** | ADV **消息窗 8 的正文**（`show-text` 0x6E + 显现泵），不是被跳过带里的背景绘制，也不是 72B 文本项账本。**最后一页** = `src/SN0000.txt:2983/2986`「这个故事，始于一位技术人员为参与调查而来到此」/「地的那一刻。」= **2 行 28 字**（与日志 `[msgwin] win=8 2 行 28 字` 逐字吻合） |
| **载体（引擎 / emulator）** | 引擎：**`Scene+0x408` 里的「正文行 DrawItem」**（key = `行号 + win+104`，raw 72325-72335）；emulator：`MsgWindow.slots`（`src/vm/msgwin.ts`）→ `SceneState.msgWins`（宿主文本层） |
| **引擎在哪里清** | **脚本自己清**：`detach-texture 19a28 1f4`（NOVEL.txt:415 —— 进/出场景两侧各一次；同型副本 SN0000.txt:3799/3814、SYSTEM4.txt:628）。它删的就是 win1/win8 的正文行项区间 `[0x19A28,0x19C1C)`。引擎**每帧泵只泵「当前窗」或「`0x300` 闸门窗」**（raw 13838-13888 / 13907-13962），SN0000 之后没有任何指令会重画窗 8 ⇒ **引擎不会残留** |
| **emulator 缺哪一步** | ① `src/vm/engine.ts:744-746`（`serviceRevealAdvanceInput`）遍历 **所有** `msgwin.reveal` 键并逐个发布 —— 把 SN0000 残留的 `reveal[8]` 重新发布成画面上的字；引擎只泵 `Engine[489484] = _this[122371]`（当前窗）。② 同类：`engine.ts:765-768`（`tickReveal` 全窗发布）、③ `handlers/msgwin.ts:1160`（`0x70` → `emitAllWins` 全槽发布，引擎 0x70 落点 raw 73133-73193 **不重画任何文本**）。**不是** DrawItem 残留（它已被清干净） |
| **H1 宿主文本层/消息窗侧残留** | ✅ **成立**（证据见 §1.3、§5.1：日志 8655/8658 的 `win=8` 再发布 + 代码路径逐条对齐） |
| **H2 `0x308` 缺步** | ❌ **不成立**（raw 33808-33815 + 12579-12618：体是 `RegisterTouchWindow`/`UnregisterTouchWindow(USER32.DLL)` + 写 `_this[1954]`；`_this[1954]` 全文件 **3 处写、0 处读**；不碰任何文本/绘制/存档表） |
| **H3 误判（看到的是 SC0000 自己的字）** | ❌ 就本例而言**排除**（残留是窗 **8**、满屏 1280×720 @(0,0)、文本起点 ≈(140,300) ⇒ 屏中央；SC0000 自己的对白在窗 **1**、880×148 @(190,557) ⇒ 屏幕下方。判据见 §6.4） |

**最短因果链（一句话）**：SN0000 的最后一页停留在窗 8 的文本槽里（引擎也保留，这不是 bug）→ 场景切换时脚本 `detach-texture 19a28 1f4` 删掉了「屏上的正文行项」，emulator 忠实地把 `scene.msgWins` 清了（日志 7680/9273 `文本窗清=8`）→ 但 emulator 的**发布路径**没按引擎收敛到「当前窗」，于是 SC0000 第一页逐字期间**一次点击**就把 `slots[8]/reveal[8]` 重新发布成画面上的字（日志 8655→8658），此后每次「逐字中点击」都会重新贴一遍（9259、9323、9373、9404、9436）。

---

## 1. 现场事实（会话日志 `.tmp/amayui-emulator.log`，2 个会话：1..9457 / 9458..13668）

### 1.1 边界（会话 1，行 7951-7969）

```
7951: detachTexture h=0x19258 count=1 REMOVE (drawItems=0, meshes=0)
7952: [frame-hold] clearDrawContainer → 继续留帧（最多 60 帧，等新内容）
7953: clearDrawContainer: 释放 drawItems=0 meshes=0 文本窗=1→0（保留纹理槽）
7958:   [call-script] 0x3a -> SETCHARM.BIN (14 instr)
7959-7967: detachTexture h=0x19640/0x19834/0x19708/0x1976c/0x19a28/0x1a9c8 …（9 条，含
           7963/7966: h=0x19a28 count=500 RANGE-REMOVE [0x19a28,0x19c1c) (drawItems=0)）
7968: unhandled 0x308 i308
7969:   [call-script] 0x73 -> SC0000.BIN (24501 instr)
```

- `0x73` = SC0000 的脚本索引；`0xAE`/`SCINIT`/`SCJUMP` 见证据摘录（`tickets/T-0100/evidence/sn0000-sc0000-boundary.md`）。
- 边界前最后一个 `[present]`（7873，t=74129ms）items 含 `104500..104524`（= `0x19834..0x1984C`，25 项，其中的 104501-104506 已 `a0`）。
  该批在 **7886** 被删（`detachTexture h=0x19834 count=25 … (drawItems=25)`）。
- 边界后第一个 `[present]`（8007，t=76649ms）items 只剩 `101120 101122 101140 101142`（= 新场景的 `AE910AA/AB`）。
  ⇒ **DrawItem 侧确实被清干净了**（与会话摘录的判断一致），残留不可能来自 `Scene+0x408`。

### 1.2 被清过又"活"过来的对照（同一会话，SC0000 内）

```
9272: detachTexture h=0x1976c count=3   … 文本窗清=1
9273: detachTexture h=0x19a28 count=500 … 文本窗清=8      ← 残留被清掉了
9274: detachTexture h=0x1a9c8 count=100 … 文本窗清=2
…
9323: [msgwin] win=8 2 行 28 字 竖排 30px                ← 又一次（点击后）
9326: [text] win=8 layer=105000 2 行 28 字 → 纹理 1600×900 @(0,0) 已显示=28
```

⇒ 这不是"一次没清"，而是**每次触发都会复活**（`slots[8]` 里的文本记录始终在）。

### 1.3 残留复活的第一个决定性证据（SC0000 第一页）

```
8638: [msgwin] win=2 1 行 0 字 …   ← SC0000.txt:1682 i071 2（ADV 分支）
8639: [msgwin] win=1 1 行 0 字 …   ← SC0000.txt:1683 i071 1
8646: [msgwin] win=1 1 行 22 字 …  ← SC0000.txt:1699 show-text（"「好厉害，真是年代久远的遗迹。接下维修委托算"）
8647: [text] win=1 layer=105000 1 行 22 字 → 纹理 1100×185 @(190,557) 已显示=0
8650: [msgwin] win=1 1 行 22 字 …  ← end-text-line
8651: [msgwin] win=1 2 行 27 字 …  ← SC0000.txt:1701 show-text（"是选对了」"）⇒ 27 字 = SC0000 自己的页
8654: [input-state] … edge=0x1     ← ★有一次待处理点击（逐字尚未显完）
8655: [msgwin] win=8 2 行 28 字 竖排 30px   ← ★★SN0000 残留被重新发布（28 字 = SN0000 最后一页）
8656: [msgwin] win=1 2 行 27 字 …
8657: [reveal] win=1 27/27
8658: [text] win=8 layer=105000 2 行 28 字 → 纹理 1600×900 @(0,0) 已显示=28  ← ★画上屏（整页）
8659: [cell] win=1 槽=12 k=0 源=(0,0,35x35) 目标=(1080,667)
```

- 发布顺序 `win=8` → `win=1` **正是 `Map` 的插入序**：`reveal` 里窗 8 的条目建于 SN0000 最后一页，窗 1 的条目建于 SC0000 ⇒ 与会话 §1.4 的 `for (const win of [...reveal.keys()])` 循环逐字对应。
- 之后 **9506-9521 起的 `win=1..8 全 0 字/横排` 不是"清场"**：那是会话 2 的 boot（9464 `[options] boot.showLogo=…` / 9458 boot 行）产生的全新空窗，别把它当证据。

---

## 2. Q1：那批"中心的文字"是谁画的

**结论：是 `show-text`（0x6E）写进消息窗 8 的 ADV 正文，由引擎的显现泵逐行变成 `Scene+0x408` 里的 DrawItem；与《被跳过带》无关。**

1. **不是被跳过带里的背景绘制。** `i0ae`（指令 737，`src/SN0000.txt:1003`）与落点 794（`:1068 i071 8`）之间的 738..793 被跳过，带内唯一场景起始背景绘制 = 指令 756/757/758（`:1025-1027` = `mov f801d 0` / `mov f8006 b37` / `call label_0000e24c`，后者体在 `:3667-3730`，写出点 `set-texture`(`:3703`)/`draw-texture`(`:3720`)，键 `0x18A88`、图 `f8006` = `BG050ABL.AGF`）。那是**全屏背景图元**（layer 101000 量级），不是"中心的文字"。
2. **不是 `draw-texture` 文本。** SN0000 里所有 `draw-texture` 站点（`659/3028/3095/3098/3154/3158/3604/3607/3618/3634/3637/3648/3652/3655/3720`）都是图元/幕布/网格，没有一处画正文。
3. **是消息窗文本**（唯一候选）。行号锚点：
   - 页结构（每条 `show-text` 都写默认窗）：`src/SN0000.txt:2983`（22 字）+ `:2986`（6 字）= 28 字 2 行，页括号 `i304`(`:2974`)/`i305`(`:2989`)，`wait-for-input 0`(`:2993`)；
   - 窗 8 的几何/对齐：`SYSTEM4.txt:30 i070 8 500 2d0 0 0`（1280×720 @(0,0)）、`SYSTEM4.txt:70 i303 8 1 1f4`（居中对齐、行宽 0x1f4=500）；
   - 文本起点：`SN0000.txt:2867 i07a 8 8c (local-int 1)`（x=0x8c=140，y=0x171-2*0x17=0x143=323）⇒ 屏水平中央、垂直中部 =「中心的文字」；
   - 窗 8 的**正文项区间登记**：`SYSTEM4.txt:69 i213 8 19a28 1f4`（= 引擎 `win+104/+108`，见 §3）；
   - 序章为什么走窗 8：`NOVEL.txt:31 i080 8`（进入场景前设默认窗 8），场景返回后 `NOVEL.txt:262 i080 1` ⇒ **SC0000 的正文进窗 1，SN0000 的正文进窗 8**（日志 8646 `win=1` / 8655 `win=8` 完全对应）。

> ★与历史结论的关系：`T-0066`/`T-0083` 说的"被跳过带里的背景绘制"是**背景**这一批；"中心的文字"是**另一批**（消息窗正文）。两者都在 SN0000，但不是同一批指令。

---

## 3. Q2：文字的载体是什么

| 层 | 载体 | 证据 |
|---|---|---|
| **引擎（真源）** | **`Scene+0x408` 绘制项容器里的「正文行 DrawItem」**：key = **行号 + `win+104`**、层序 = `win+20`，源矩形 = 该窗 24B 行记录 | `sub_45BE20` raw **72325-72335**：`sub_4ACE50(Scene, v12 + win[104], v2+20, …)`（`v12` = `win+132` 行游标）；注音/第二组 = `win+276`（raw **72394**）；行游标自增与写回 raw **72368-72370** |
| 引擎·项的删除 | `0x1F7 detach-texture` → `sub_4ABB60`（`count>1` 区间删）/ `0x1F6` → `sub_4AB7A0` 整批 / `0x301` → `sub_404F80` | raw **10752-10760**（见 §4.2） |
| 引擎·文本记录（**不是**屏上真源） | `win+208` 的 120B/条 向量（`0x71`/`sub_45EC60` 截断为 0） | `handlers/msgwin.ts:459-515` 的注释 + `vm/msgwin.ts:663-691`（`beginNewMessage`） |
| **emulator** | `MsgWindow.slots`（`app/amayui-emulator/src/vm/msgwin.ts:384`）→ `emitWin` → `native.msgWinSync` → **`SceneState.msgWins`**（`src/renderer/scene/state.ts`，`scMsgWinSync` `src/renderer/scene/ops.ts:817-827`）→ `renderer/pixi/textLayer.ts`（每个窗一张纹理精灵） | `src/vm/handlers/msgwin.ts:235-250`（`emitWin`）、`pixiBackend.msgWinSync` `src/renderer/pixiBackend.ts:942-946` |
| emulator·"哪个窗被清了" | `SceneState.msgRanges`（`0x213`/`0x25D` 登记）+ `scDetachTexture` 的区间相交判定 | `src/renderer/scene/ops.ts:138-145`，日志 `文本窗清=8` |

**不是** 72B 文本项记录表（`Font+3364` / `src/vm/textItems.ts`）：那张表是**回想/语音账本**（`0x1D2` push、`0x1D3/0x1D4/0x2F3` 查询），清它的是 `0x85`（§4.3），与"屏上有没有字"无关。
**不是** `Font = Engine+85296` 本身：那是文本对象（`FontVWindow` 数组在 `Font+1044+4*win`），正文内容的屏上落点仍是 DrawItem（raw 72325）。

---

## 4. Q3：引擎在哪一步把上一屏（SN0000）的文字清掉 —— 逐条体证据

### 4.1 ★**场景起始/收场脚本自己清**（本次的真实路径）

| 位置 | 体 |
|---|---|
| `NOVEL.txt:140 call label_00001e8c` → `:429-433` → `:430 call label_00001db4` → **`:413-416`** | `detach-texture 1976c 3` / **`detach-texture 19a28 1f4`** / `detach-texture 1a9c8 64`（进入场景前） |
| `NOVEL.txt:178-180 call label_000013fc / label_000016a0 / label_00001db4` | `:308-309 detach-texture 19640 2 / 19834 19`（+幕布+DRAWCHARM）；`:343 detach-texture 19708 6`；**`:415 detach-texture 19a28 1f4`**（离开场景时） |
| 同型副本 | `SN0000.txt:3797-3800`（`label_0000ea6c`）、`:3813-3815`（`label_0000eb44`）、`SYSTEM4.txt:626-629`（`label_00002b60`） |

`19a28 1f4` 删的就是 `SYSTEM4.txt:58/69`（`i213 1 19a28 1f4` / `i213 8 19a28 1f4`）登记的区间 = `[0x19A28, 0x19C1C)`：
按 §3 的 key 公式，**窗 1 与窗 8 的正文行 DrawItem 都在这个区间里**（两窗共用同一区间登记）⇒ 一条 `detach-texture` 把 SN0000 屏上的正文整段删掉。
日志锚点：7883-7890（离开 SN0000 的那一轮，含 7889 `h=0x19a28 count=500`）与 7959-7967（进入 SC0000 的那一轮）。

> 遗留的 minor 不确定项：7959-7967 那 9 条与 NOVEL 两种调用的组合**逐条**对应关系没有完全钉死（见 §7），但**两条路径都含 `detach-texture 19a28 1f4`**，不影响结论。

### 4.2 `0x301` / `sub_404F80`（本次未触发，但回答任务书候选）

raw **10741-10763**：

```c
if ( *(_DWORD *)(_this + 4 * v2 + 1044) ) {
  *(_DWORD *)(*(_DWORD *)(_this + 4*v2 + 1044) + 132) = 0;                 // 行游标归零
  sub_4ABB60(*(_DWORD **)(_this + 1040), win[104], win[108]);              // 删正文行项区间
  return sub_4ABB60(*(_DWORD **)(_this + 1040), win[276], win[280]);       // 删第二组区间
}
```

⇒ 语义 = 「游标归零 + 删该窗两段绘制项」。emulator 侧对应 `op_msgwin_slot_clear`（`handlers/msgwin.ts:1444-1460`：`msgWinClear` + 闸门在时重新武装），**与体一致**。

### 4.3 `0x85` = `sub_418F50` → `sub_45EBE0`：清的是**账本**，不是屏上的字

raw **24471-24476**（`0x85` 的体）+ raw **74182-74194**：

```c
sub_45EBE0(Font):
  sub_45DA10(_this + 841, &v4, _this[841], _this[842]);   // Font[841]/[842] = 72B/条 文本项向量
  sub_45E730(_this + 841, 0);
  v2 = _this[845]; if (v2 != _this[846]) _this[846] = v2;
  return sub_45D1B0(_this + 845, 0);                       // Font[845]/[846] = 回看页向量
```

⇒ 任务书候选「`0x85` 清场」= 清**文本项记录表 + 回看页表**（= emulator 的 `TextItemTable`，`0x85` 已实现：`handlers/text-items.ts:158 op_text_tables_clear`），**与屏上文本无关**。
（★顺带订正一处注释：`src/renderer/scene/ops.ts:829` 把 `0x85` 写成"清行队列"，与体不符 —— `0x85` 不碰 `win+208`。）

### 4.4 装载点的行内清 + 从 body 还原（任务书候选 1）

raw **19797-19833**（在 `sub_410160` 内，函数头 raw 19276）：
`19801-19808` delete-walk 释放 `Scene+323868`(= Scene+0x408) 的树 → `19811-19814` 复位哨兵/`Engine+323872 = 0` → `19815-19832` 对 body 末段清单逐条 `sub_49A300` + `memcpy` + `sub_40C910`/`sub_40C310` 插回。
⇒ 这是**读档装载点**的语义（`T-0066`/`T-0083` 已确证），**只碰绘制项容器**，与本次"正常进 SC 场景"无关（但它是任务书要求核对的候选，此处给出 raw 锚点）。

### 4.5 ★每帧泵：引擎只会重画「当前窗」或「`0x300` 闸门窗」——所以 SN0000 之后窗 8 不可能复活

raw **13834-13888**（`sub_409400` 第一循环，`v2 = 1..9` 逐窗）：

```c
if ( (*v3 & 1) == 0 ) { if ( (result & 0x10000) == 0 ) goto LABEL_17;   // 闸门关且没被泵接管 ⇒ 跳过该窗
                        while ( !sub_45BE20(_this + 85296, v2) ); … }
```

raw **13931-13946**（逐字期间点击 ⇒ 把整页贴完）：

```c
if ( (*(_BYTE *)v6 & 0x10) != 0 || … ) { … do result = sub_45BE20(_this + 85296, *(_DWORD *)(_this + 489484)); while ( !result ); }
```

raw **13907/13920/13962** 同型：**只有 `Engine[489484]`**。而 `489484 / 4 = 122371`：

- `_this[122371]` 的写入点：`0x6E show-text` raw **28365 / 28381**（= op1 解析后的窗号）、`0x71` raw **28545**、`0x72` raw **28545**（随后 28565/28575 读它算自动消息时长）；
- ⇒ `Engine[489484]` = **当前消息窗**。SC0000 的 `show-text 0` 在 `i080 1` 之后 ⇒ `122371 = 1`；窗 8 既不是当前窗、也没有 `0x300` 闸门（`0x300` 语料仅 `CONFIG.txt:171 i300 9 1 3e8`）⇒ **引擎不会重建窗 8 的行项**。
- 脚本侧也没有"清窗 8"的必要：SC0000 的页模板在 ADV 分支只 `i071 2` + `i071 1`（`SC0000.txt:1677-1683`、`:1707-1713` …），**从不碰窗 8**；`i071 8` 在 SC0000 只出现在 `global 0 != 6` 的另一支。

### 4.6 小结（回答"引擎清的是哪一张表、在第几步"）

1. **屏上的字 = `Scene+0x408` 的正文行 DrawItem**（key `行号+win+104`，raw 72325-72335）；
2. **清它的那一步 = 场景起始/收场脚本的 `detach-texture 19a28 1f4`**（NOVEL.txt:415 / SN0000.txt:3799,3814 / SYSTEM4.txt:628），**不是**装载点行内清、不是 `0x85`、不是 `sub_404F80`；
3. **"中心的文字"正是被清的那一样**（窗 8 的正文行就在 `[0x19A28,0x19C1C)` 里）⇒ 引擎清干净了；残留是 emulator 的**发布模型**问题。

---

## 5. Q4：emulator 缺了哪一步（逐点 file:line + 依据）

### 5.1 缺口 ①（**直接原因**）：`serviceRevealAdvanceInput` 发布了**所有**有 reveal 记录的窗

`app/amayui-emulator/src/vm/engine.ts:740-752`：

```ts
if ((mask & 0x10) === 0 && !wheelKeyHit && !wheelDown) return false;
// ★自旋到整页贴完（`do sub_45BE20 while (!done)` 的等价物）：把每个还有余量的窗一次贴满。
for (const win of [...this.msgwin.reveal.keys()]) {   // ★这里遍历的是"所有还有 reveal 状态的窗"
  this.msgwin.finishReveal(win);
  this.#publishReveal(win);                            // → emitWin(win) → 宿主画出来
}
```

- 引擎同行只泵**当前窗**：raw 13943-13945 `do result = sub_45BE20(_this + 85296, *(_DWORD *)(_this + 489484)); while (!result);`，`489484 = 4*122371`。
- `msgwin.reveal` 里窗 8 的条目是 SN0000 最后一页 `0x72 wait-for-input`（`SN0000.txt:2993`）建的（`handlers/msgwin.ts` 的 `op_wait_for_input` → `beginReveal`），SN0000 结束后**没有任何东西删它**（`beginNewMessage` 只删被 `0x71` 点名的窗；SN0000 最后一次 `i071 8` 在 `:2848`，在最后一页**之前**）。
- ⇒ 日志 8654（有待处理点击）→ **8655 `win=8`** 正是这一行；`reveal` 的 Map 插入序（8 先于 1）解释了 8655→8656 的顺序。
- 复现频率：此后每次"逐字中点击"都会复发（9258→9259、9322→9323、9372→9373、9403→9404、9435→9436）。

### 5.2 缺口 ②（同类，潜伏）：`serviceTextReveal` 发布所有 dirty 窗

`engine.ts:765-768`：

```ts
const dirty = this.msgwin.tickReveal(nowMs, speed);
for (const win of dirty) this.#publishReveal(win);
```

引擎每帧的两条路（raw 13838-13888 闸门窗 / raw 13907-13962 当前窗）都不含"任何有 reveal 状态的窗"。本例里窗 8 的条目 `active=false`（已被点击收尾），所以这条**这次没有开火**；但只要有一个跨场景残留的 `active` 条目（例如页没显完就切场景），它会**每帧**把旧文本贴回屏上。

### 5.3 缺口 ③（同类，范围最大）：`0x70` 的落点用 `emitAllWins`

`app/amayui-emulator/src/vm/handlers/msgwin.ts:1139-1161`（`op_window_geometry`）末尾：

```ts
e.textItems.pushPage(win);
e.textItems.markGroupStart(win);
emitAllWins(e);            // ← 发布 slots ∪ wins ∪ defaultWin 的【全部】窗
```

而引擎 `0x70` 的落点 `sub_45D660`（raw **73133-73193**）**只写几何 + 回看页**：
`win+12/+16 = x/y`（73154-73155）、`win+20/+24 = w/h`、`win+124/+128`、`win+36/+40`、`sub_4A7170`(DrawMode=1)/`sub_43C8D0`+`sub_43B070`（GDI 铺底色），末尾 73181-73191 push 回看页 + 组首标记 —— **没有任何 `sub_4ACE50`/`sub_45BE20`（不重画正文行）**。
⇒ `emitAllWins` 会把"文本记录还在、但屏上项目已被 detach 掉"的窗重新画出来（本次没触发到 SC0000 的开头，但它是同一类缺陷，且日志里有过 `win=1..8` 连发的签名，9250 段与 9506 段各一次）。
（`emitAllWins` 的唯一两个调用点：`handlers/msgwin.ts:1160`；`:1339` 的注释说明 `0x74` 那条已经因此被去掉 —— 同一理由适用于 `0x70`。）

### 5.4 缺口 ④（小口径漂移，会让"按当前窗修"落地时踩坑）：`lastArg` 存的是**原始操作数**

`handlers/msgwin.ts:407-409`（`show-text`）`m.lastArg = slot;`（原始 op1，0 = 默认窗），真正解析发生在每次 `resolveWin()` 调用时。
引擎的 `_this[122371]` 存的是**解析后的窗号**（raw 28365/28381：`v8/v6 = sub_41BF50(_this, 1)` 后再写）。
本例后果：SN0000 的最后一页 `lastArg = 0` 在 SN0000 期解析成 8、在 SC0000 期解析成 1（因为 `NOVEL.txt:31 i080 8` → `:262 i080 1`）⇒ 若把 §5.1 改成 `resolveWin(lastArg)`，得到的正好是 **1**（对），但要意识到这个字段的语义与引擎不同名同义。

### 5.5 已经做对的部分（**不要动**）

- 区间相交清视图：`scDetachTexture`（`src/renderer/scene/ops.ts:138-145`）→ `scMsgWinClear` ⇒ 日志 7680/9272-9274 的 `文本窗清=1/8/2` 是正确的引擎等价物；
- `scClearDrawContainer`（`ops.ts:262-272`）清 `drawItems+meshes+msgWins`；
- `TextLayer.sync`（`src/renderer/pixi/textLayer.ts:74-95`）会 `#dispose` 不在 `scene.msgWins` 里的窗 ⇒ 视图一旦被清，精灵会消失；
- `msgwin.reset()` 只在 `0x9 exit-script`（`handlers/control.ts:498`）与读档点（`vm/save-slot.ts:62,349,453`）调用 —— 这解释了"读档路径正常"。
  ★**但 `0x2 exit`（SN0000 → NOVEL → SC0000）不 reset**：这是刻意的、也与引擎一致（引擎保留 `win+208` 记录与 `win+132` 游标）⇒ **不要用"在场景边界清 slots/reveal"来修**，那会与体不符（会伤到 `0x1D3` 回想、`0x20A` 重排、`0x305` 文本块等）。

---

## 6. Q5：E3/E4 复现路径 + 修好后的场景级不变量

### 6.1 用户口径（E4）

`SN0000` 读档续跑（真槽 79 或本工程槽）→ 连点走完 12 页 → 出现章头/转场（`AE910AA/AB`）后进 `SC0000` → **在第一页逐字未显完时点一下** ⇒ 屏中央出现 SN0000 最后一页（「这个故事，始于一位技术人员为参与调查而来到此地的那一刻。」）。

### 6.2 headless 最小确定性复现（两条，任选）

- **(a) 半合成（E2，最便宜、最快、CI 可跑）**：两个合成脚本 + `runFrameLoop`：
  1. 脚本 A：`i080 8` → `show-text 0 "A"` → `end-text-line 0` → `i71 8`?（不需要）→ `wait-for-input 0` → `exit`；
  2. 切到脚本 B（`i080 1`）→ `show-text 0 "B"` → `wait-for-input 0`；
  3. 在 B 的逐字期间注入一次左键（`input.pressMouse(0)`），让驱动走 `text-reveal` 支（`frame/loop.ts:300-308` → `e.serviceRevealAdvanceInput()`）；
  4. 断言 native 收到的 `msgWinSync` 里 **没有 win=8**（或 `scene.msgWins.has(8) === false`）。
     这直接钉住 §5.1 那一行。harness 见 `app/amayui-emulator/test/harness.ts`（`mkEngine`/`instr`/`im`/`str`）。
- **(b) 真语料（E3）**：从 `tools/scenarios/gamestart.json` 扩展（它已经跑到 SN0000 首文案）：
  SN0000 共 **12 页**（`grep -c i305 src/SN0000.txt` 口径），每页 `wait-for-input` 后一次 press/release；页间 `settleMs` 取 `max(message:MessageSpeed, 一帧) × 行数`（`vm/msgwin.ts:232-237`）再加余量；
  进 `SC0000.BIN` 后再等它的第一页开始逐字，然后 press 一次。
  命令：`cd app/amayui-emulator && npm run scenario -- --scenario tools/scenarios/<新spec>.json --out .tmp/t0100/sc.jsonl`。
  ★注意 `ScenarioSpec.afterMarker` 对"同一脚本内多次触发"是从**首次进入该脚本**起算（`frame/scenario.ts:232-246`），所以多页推进要用 `atFrame`/`atMs`（`clock: {kind:'fixed', stepMs: 16.667}` 才确定）。
- **(c) 真槽路径（本机，E4/E3 兼可）**：真槽 79 只在 `%LOCALAPPDATA%\Eushully\天結いキャッスルマイスター\SAVE\` 有 ⇒ 测试里要沿用既有 `t.skip(...)` 的写法（见 `test/engine-slot.test.ts`、`test/save-data.test.ts:583-592`）。

### 6.3 修好后的断言（场景级不变量，具体到字段）

1. **主判据（与引擎同口径的"屏上有什么"）**：
   在任意 `e.curScript().name === 'SC0000.BIN'` 且 SN0000 已退出的帧上，**`SceneState.msgWins` 不含窗 8**：
   - headless：`native.scene.msgWins.has(8) === false`（`HeadlessScene.scene`，见 `src/renderer/headlessScene.ts`；日志里对应 `[msgwin] win=8 …` 不再出现）；
   - 或经快照：`DigestState.msgWins`（`src/frame/digest.ts:54,243`）里窗 8 缺席；
   - 且 **`[text] win=8`**（`pixiBackend`/`textLayer` 的发布日志）在 SC0000 段落里**一次都没有**。
2. **点击不复活（针对缺口 ① 的守卫）**：在 SC0000 第一页逐字期间 press 一次后，再取一次快照，窗 8 仍缺席。
3. **不许误伤（同一测试里一起断）**：同一帧窗 **1** 的文本在场（`msgWins.has(1) === true` 或行数/字数 = SC0000 该页），`scene.drawItems` 不被额外清空（`SC0000` 的章头项 `101120/101122/101140/101142` 在场）。
4. **VM 侧不变量的措辞**（走查/文档用）：`e.msgwin.reveal` **允许**保留窗 8（引擎 `win+132` 与 `win+208` 记录同样保留），但**不得被发布**（`msgWinSync(8)` 调用数 = 0）。把这句话写进守卫注释，免得后人又用"清 slots"去修。
5. 回归：`test/char-reveal.test.ts`、`test/adv-msgwin.test.ts`、`test/game-start-chain.test.ts`、`test/op-10-002-adv-sleep-order.test.ts`（`serviceRevealAdvanceInput` 的相关语义在这几处）必须仍绿。

### 6.4 H3 的可区分判据（给用户/下次实测用）

| | SN0000 残留（win 8） | SC0000 自己的对白（win 1） |
|---|---|---|
| 窗号 | **8** | **1** |
| 几何 | 满屏 1280×720 @(0,0)（`SYSTEM4.txt:30`） | 880×148 @(190,557)（`SYSTEM4.txt:24`） |
| 文本起点 / 对齐 | (140,300)~(140,323)、居中对齐行宽 500（`i07a 8` / `i303 8 1 1f4`）⇒ **屏中央** | 窗框内 ⇒ **屏幕下方** |
| 日志签名 | `[msgwin] win=8 … 2 行 28 字` / `[text] win=8 … @(0,0)` | `[msgwin] win=1 …` / `[text] win=1 … @(190,557)` |
| 本例文本 | 「这个故事，始于一位技术人员为参与调查而来到此地的那一刻。」 | 「「好厉害，真是年代久远的遗迹。接下维修委托算是选对了」」（`SC0000.txt:1699-1701`） |

⇒ 只要看到"屏中央那两行旧叙述 + 下方新对白"同时在场，就是本票的残留，不是 SC0000 自己该有的字。

---

## 7. 不确定项（没读到体/没确证的，明说）

1. **7959-7967 那 9 条 detach 与 NOVEL 具体调用点的逐条对应**未钉死：NOVEL 的进/出两侧各有一套同型清场（`:140→:429→:430→:413-416` 与 `:178-180`），日志顺序（19640/19834/19708 → 1976c/19a28/1a9c8 → 1976c/19a28/1a9c8）与"两侧各一次、其中一侧多出前三条"不完全逐字吻合。**不影响结论**（两套都含 `detach-texture 19a28 1f4`）。
2. **7892 `文本窗=7→0` 的那 7 个窗是哪些**没查（`clearDrawContainer` 只报数量）。与结论无关（该时刻窗 8 已不在 `msgWins` 里，见 4.1 日志）。
3. **SC0000（24501 条指令）没有逐段读完**：只读了页模板（`:1655-1724`）与两个子程序（`:33578-33627`）。因此"SC0000 内部是否还有别处会碰窗 8"只按日志证据判（会话 1 内窗 8 的发布全部带 SN0000 的 28 字内容，没有一次是 SC0000 自己的文本）。
4. **`0xDD`**：`docs-new/03-engine/opcode-table.md` 里没有该行，未查（任务书里带问号列出）。
5. **`Engine[1954]` 的"死写"判定**基于 `.c` 文本 grep（`_this[1954]` 3 处写 raw 12605/12610/12615、0 处读）。若 Hex-Rays 把该格渲染成指针算术形式，grep 会漏；本次按现有文本判"无读者"，并已在 §0 用它支撑 H2 不成立（另有一条独立证据：`sub_426B20` 体根本不碰文本/绘制表）。
6. **未验证"修完是否还有第二次弹回"**：本报告只给缺口与建议，实现与 E4 复测按任务书交给主 agent。
7. **没有跑**任何 `npm run verify` / `npm run shot`；没有改任何文件（本文件除外，位于 `.tmp/t0100/`）。

---

## 8. 修复说明书（给主 agent 的最小改动集 + 禁止事项）

**改动点（顺序即优先级）**

1. `app/amayui-emulator/src/vm/engine.ts:744-746` —— `serviceRevealAdvanceInput` 的循环收敛到**当前窗**：
   `const w = this.msgwin.resolveWin(this.msgwin.lastArg); this.msgwin.finishReveal(w); this.#publishReveal(w);`
   依据：raw 13943-13945（`sub_45BE20(Font, Engine[489484])`，`489484 = 4*122371`；`122371` 由 `show-text` raw 28365/28381、`0x71`/`0x72` raw 28545 写）。**这一条就能消掉用户看到的症状**。
2. `engine.ts:765-768` —— `serviceTextReveal` 的发布同样收敛（当前窗 ∪ `0x300` 闸门窗），依据 raw 13838-13888 + 13962。否则任何一个跨场景残留的 `active` 条目会每帧把旧文本贴回屏上。
3. `app/amayui-emulator/src/vm/handlers/msgwin.ts:1160` —— `emitAllWins(e)` → `emitWin(e, win)`（只发布本指令点名的窗）。依据：raw 73133-73193（`0x70` 落点不重画正文行）；同页面 `:1339` 的注释已为 `0x74` 做过同样的删除，理由是同一个。
4. 可选（防回归、也顺手对齐口径）：把"当前窗"从 `lastArg`（原始操作数）改成**解析后的窗号**字段（见 §5.4），与 `_this[122371]` 同名同义；`lastArg` 保留给诊断。

**禁止事项**

- ❌ 不要在场景边界（`exit` 0x2 / `call-script` / `0x1F7`）去 `msgwin.reset()` 或清 `slots[8]`/`reveal[8]`：引擎保留 `win+208` 记录与 `win+132` 游标（raw 74277-74281 / 72370），清了会与体不符，且会伤 `0x1D3`/`0x20A`/`0x305`。
- ❌ 不要给 `#holdFrames` 打补丁（`T-0083` 已判它是自造机制；本次残留也不是留帧造成的：7976 已解除留帧，且 8658 那条 `[text] win=8` 是**新造的精灵**）。
- ❌ 不要动 `scDetachTexture` 的区间相交清（`ops.ts:138-145`）—— 它是对的，日志 7680/9272-9274 证明它按引擎口径工作。
- ❌ 不要用"清 DrawItem"修：边界两侧的 DrawItem 已经是干净的（7873 26 项 → 8007 4 项）。

**守卫建议**：新增 `test/` 用例（§6.2(a) 半合成 + §6.2(b) 真语料金路径），断言 §6.3 的 1/2/3 三条；并在注释里写下第 4 条措辞（"允许保留、不得发布"）。
