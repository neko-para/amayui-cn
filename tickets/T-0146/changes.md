# T-0146 变更记录 —— 3 条基线红全部消除（测试侧判据）

> 范围：**只改 `app/amayui-emulator/test/**`**（5 个文件），不动任何 `src/**`、台账、`docs-new/`。
> 收口轮次：`T-0179` 第 70 轮（2026-09-25）。判绿实测：`npm run verify` **exit 0**（含 `typecheck` / `typecheck:test` / `test:all` / `check:dead-writes` 全链），`check:dead-writes` 另跑一次亦「★ 无新增死写」。

## 第 1 次变更（2026-09-25）：三条红的判据重写

### ① `engine-slot.test.ts` + `save-slot.test.ts` —— 真槽 SAVE70/71

- **原失败输出**
  ```
  ✖ ★E4：本机真槽全部解出，且每帧记录的落点 opcode 与语义自洽
    AssertionError: 真槽解析/落点自洽性检查失败：
      SAVE70.DAT: storedDwords=2069342 超出文件（2069662 字节）
      SAVE71.DAT: storedDwords=2068813 超出文件（2069133 字节）
  ✖ E4：真存档槽的头 → 0x1A0 的六个 u16 …
    AssertionError: SAVE70.DAT 的 format（≥3 = 模幂混淆 + 压缩） 0 !== 3
  ```
- **调查结论（★推翻票面 why 的猜测）**：SAVE70/71 **不是**「较新版本游戏/别的来源写出的槽」，而是**本工程 emulator 自己写进 overlay 的槽**。
  - 逐字段体检（58 个 `SAVE??.DAT`）：56 个 `magic=S4SD tag=460B format=3 play>0`；**SAVE70/71 位于 `…\天結いキャッスルマイスター.overlay\SAVE\`**（= 本工程唯一写目标），`format=0`、`h240 = size − 320 = payload 长度`、尾块解得**本工程状态块**（`AMYS1\n`，3 帧，int 表 5444/5454 条）。
  - `format = 0` 是什么：`src/save/saveSlot.ts:32` 原文「复用 `saveData.ts` 的容器（**`format = 0` = 本工程明文格式** ⇒ 与引擎的 1..3 **互不误读**）」。⇒ 引擎容器解码器把 payload 长度当成 dword 计数，于是报「超出文件」——**这不是解析缺陷**。
  - 来源铁证（票面内）：`tickets/T-0061/notes.md`「进第一个 ADV 场景 → 存档 → 槽文件写出成功（**SAVE70.DAT**）」、「E4 实证（用户那份 SAVE70，2026-09）… **`format=0`（本工程槽）**…`\cur=3\` 正是 SAVE.BIN（存档菜单）那个帧」。
- **改法**（不动 `src/`）
  - `test/realSlots.ts`：新增 `classifyRealSlot(bytes)` 与头注的**作者表** —— `f ∈ 1..3` ⇒ 引擎槽；`f === SAVE_FORMAT_PLAIN`（0）且尾块解得本工程状态块 ⇒ 本工程槽；**其余 ⇒ `unknown`**（一律判红）。
  - `save-slot.test.ts` / `engine-slot.test.ts`：按作者分派 —— **引擎槽仍然逐个必须解出**（头合法 / `format ∈ 1..3` / `play > 0` / 至少一个与 mtime 一致）；本工程槽按正向判据**显式跳过并打印判据**（`+284=0(SAVE_FORMAT_PLAIN) 且尾块解出本工程状态块（3 帧）`，且不查 `play > 0` —— 本工程槽的 `+280` 是 `SlotStateBlock.playSeconds`，刚开档为 0）；`unknown` 一律 `assert.deepEqual(unknown, [], …)`。
- **判据（写进测试注释）**：**跳过只允许由正向判据授权**（`format=0` **且** 尾块解得本工程状态块）；**看不懂的第三种作者一律失败** —— 这样「跳过」不会变成掩盖真回归的暗门；**引擎槽仍然逐个必须解出**。
- **红→绿**：`engine-slot` `tests 9 / pass 9 / fail 0`；`save-slot` `tests 10 / pass 10 / fail 0`。

### ② `scene-report.test.ts` —— 「可绘制项(24) 必须多于缺纹理项(26)」

- **原失败输出**：`AssertionError: 可绘制项(24) 必须多于缺纹理项(26)：这条路线不该以缺纹理为主`（`tests 4 / pass 3 / fail 1`）。
- **调查结论：路线本来就如此，且旧断言的前提事实上是错的。**
  - **何时变多**：`git log -S 'drawItems=32' -- test/scene-report.test.ts` ⇒ 只有 `dbd4b1b2`（2026-09-23，`T-0125` 补独立 oracle 时写下 32/24/8）；`git blame` 证实那 4 行全部出自该 commit。之后 **`24 drawable` 没变过**，变的是占位项。
  - **实测句柄清单**：`counts={"drawItems":50,"drawableItems":24,"visibleItems":2,"placeholderItems":26}`，占位句柄 = **`0xD8..0xF1`**（layer 216..241，全部 `tex=0 flags=0 src=0×0`）；可绘制 24 项全在 `tex=4` 且有真实源矩形。
  - **逐步归因**：这 26 项**唯一**来源 = `TITLE.BIN` 的 `0x202 set-draw-color` 打在**不存在的句柄 216..241** 上（`ip=0x210`，step 119552..119827）。**不是** `i23b`（票面猜测有误）。
  - **引擎逐字**：`sub_4AD0C0`（raw **131957-131980**，`0x202` 的调用目标）**先无条件 `sub_4AAA50(self, handle)`**（raw 130028-130050：map 里查不到就建全 0 元素再插入），**之后才** `if ((*(_BYTE*)result & 1) != 0)` 启动颜色窗 ⇒ **句柄不存在时引擎就是留一个 `flags=0` 的死项**。emulator 的 `scEnsureItem` + 门控与它同形 ⇒ **faithful，不是回归**。
  - **32/24/8 是「路线落点」不是不变量**：`steps=119000 ⇒ 0/0/0`、`119500 ⇒ 24/24/0`、`119560 ⇒ 25/24/1`、`120000 ⇒ 50/24/26`。
- **改法**：删掉 `drawable > placeholder` 这条**假不变量**，换成 5 条更强判据 —— ⓪ `counts` 必须能由逐项 `drawable` 字段**独立重算**；① 占位项必须是**全 0 空项**（`tex`/`flags`/源矩形全 0）；② 每个可绘制项必须有非 0 源矩形；③ 至少一项整屏底图。
- **红→绿 + 判别力**：改后 `tests 4 / pass 4 / fail 0`，诊断行 `[snapshot] drawItems=50 drawable=24 placeholder=26（占位句柄 0xd8..0xf1，全部 tex=0/flags=0/源矩形 0）`。定点变异实测：**Z2**（`drawable=[]`）⇒ 被下限抓住；**P1**（`drawable = drawItems.filter(d => !d.drawable)`，计数仍在量级内 26/24/50）⇒ 被新增的 ⓪ 抓住（`counts.drawableItems 必须等于逐项…`）；复原后回绿。

### ③ `host-registry.test.ts` —— `--idle-sec 1` 偶发超时

- **真正的退化形态**（`T-0177` 已修横幅竞态，但这条还在）：三条等待 60s + 30s + 60s（最多 **150s**）**大于**用例 `timeout: 120_000` ⇒ 慢机/并行时失败会从「某条判据红（带子进程输出）」变成「整个用例被 node 掐断（`test timed out`）」，与「真挂死」**无法区分**。
- **改法**：把三个等待提成常量，用例 timeout 写成**派生表达式** `IDLE_REGISTER + IDLE_BANNER + IDLE_EXIT + 60_000`；**判据一个字都没放松**（登记字段逐个对 + 横幅含真实端口 + 自停日志 + 记录被摘掉）。
- **判据（写进注释）**：「三条之和必须**严格小于**用例超时，否则失败形态会退化成 `test timed out`；这些是**上限**不是期望值（正常机器秒级）」。
- **真进程语义探针**（本沙箱不能跑该用例，用文件 fd 重定向起真 host 进程补齐语义验证）：`登记于 +144ms（port=64051, pid 真实, repoRoot 正确）` → `退出于 +1177ms code=0 signal=null`，日志含「闲置 1s 且无观察者 ⇒ 自停」，**登记项已被摘掉**，横幅行含真实端口 ⇒ 判据本身成立，剩下的风险确实只是等待上限。

## 判绿实测（2026-09-25，`T-0179` 第 70 轮，主会话）

```
cd app/amayui-emulator && npm run verify      ⇒ exit 0
  typecheck / typecheck:test / test:all / check:dead-writes 全链通过
npm run check:dead-writes（单跑）              ⇒ ★ 无新增死写，exit 0
```

## 改动文件清单（5 个，全在 `app/amayui-emulator/test/`）

`realSlots.ts`、`save-slot.test.ts`、`engine-slot.test.ts`、`scene-report.test.ts`、`host-registry.test.ts`。

## 被锚定文件的自查申报

`tickets.js --anchors-in <上述 5 个文件>` 只命中 **1 条**（`T-0132 evidence[3]` 的 `export function realSlotDirs`）—— **字符串原样保留**，仅行号漂移（31 → 51，已由 `fix-evidence-lines.js` 刷新）。
★**没有删掉任何被 evidence 锚定的字面串**：`0x1A0 的六个 u16` / `★E4：本机真槽全部解出…` / `可绘制项` / `缺纹理项` / `sleep 门真等满虚拟时钟` / `--idle-sec 1` 全部原样保留（`可绘制项`/`缺纹理项` 从「断言消息」移进注释与新的断言消息里，语义更明确）。
