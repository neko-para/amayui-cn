# T-0104 过程文档（轮 8 收口）

## 本轮做了什么（「只保证不硬停」，**不是**实现）

1. 登记 `STUB_NATIVE_OPS`：`app/amayui-emulator/src/vm/handlers/stubs.ts` 的 `[0x82, op_stub_unhandled]`
   （先例 `0x308`：记录后放行、不阻塞 VM）。体证据与缺口说明都写在该条目上方的注释里。
2. `test/opcode-operands.test.ts` 的 `ALLOW_UNDERRUN` 补 `'0x82'` 条目（理由：桩**不读操作数** ⇒
   操作数纪律守卫必须放行，否则会误报"未读满 argc"）。
3. 新增守卫 `test/op-0104-gdi-repaint-stub.test.ts`（4 条，`mkEngine` + `instr/loc/im`）：
   - ① 走**静态表**放行（`e.unknownOpStubs.size === 0` 前提下 `handlerKind === 'native'`、ip +1）——
     证明不是靠用户桩绕过；
   - ② **记录后**放行：宿主 `StubNative` 必须收到一次 `unhandled(0x82)`（ADR-010 §10.2 的记录义务）；
   - ③ 放行**不写 VM 态**：操作数引用的局部/全局槽快照逐槽不变；
   - ④ 连续三条逐条放行 + 逐条各记一条（设置界面反复重画的形状）。
4. `test/harness.ts` 的 `mkEngine` 增可选第 3 参 `native?: NativeBridge`（默认仍是静默 `StubNative`），
   这样"要断言宿主收到了忽略"的守卫不必再抄一遍 `ScriptBinary` 构造。

## 鉴别力验证（守卫必须证明自己会红）

工具：`.tmp/t0104/revert-check.mjs`（`off` = 注释掉表项、`on` = 还原、`sha` = 打印摘要）。

| 步骤 | 结果 |
| --- | --- |
| 原状 sha256 | `da1cff5b7d5aec339a407da2245d89a604b6f490dc0848b23a0e6e98727fee0e` |
| 注释掉 `[0x82, op_stub_unhandled]` 后跑守卫 | **4/4 红**（pass 0 / fail 4） |
| 还原后跑守卫 | 4/4 绿，sha256 **逐字节回到** `da1cff5b…` |

⚠还原脚本第一版有 bug：`off` 把行首两空格并进 `  // ` 前缀，`on` 再 `slice(i+5)` 把这两空格一起吃掉
⇒ 行首缩进丢失（sha 对不上）。已修脚本，并已把 `stubs.ts` 第 319 行缩进修回、核对 sha 一致后才继续。
（教训：**"还原后 sha 必须等于原值"这一步不能省** —— 否则"验证完的树"已经不是验证前那棵树。）

## 仍未做（本票保持 open 的原因）

- `sub_466000`（raw 79319 起）**没有读体定性**：它把什么文本重绘到哪里、op1..op5 各自语义。
- emulator 的等价物没有确定：最可能是「把相应文本窗重新发布」（`scMsgWinSync`/`emitWin`），但
  「哪个窗」没定；若需要新宿主缝，按先例五处同步并登记能力台账。
- 因此判据 ③ 的后半（真实 `CONFIG` 路径上"文本窗被重新发布"的场景级不变量）、判据 ④
  （`analysis/opcode-gaps.json` 的 disposition 改成 `implemented` + `opcode-table.md` 的 0x82 行同步）、
  判据 ⑤（E4 用户口径：界面文字正确）**都还没满足**。

## 与 T-0102 的关系

用户同时报的「白色背景没修复」有可能与这次 GDI 重绘同源（都是"文本/背景该被重画却没重画"），
但**没有证据**支持这个联系 —— 不要在 T-0102 里当结论用；两边各自查。

## 2026-09-21

## 轮 8 追加批二：`0x82` 与「ADV 文字色残留」是**同一段代码**（重要）

用户第二次复验后逆向出的「回 ADV」路径 = `src/CONFIG.txt:225-269`：

```
226-257  按当前消息号（global 3f37/3f38）重派生角色号 14acda（旁白 ⇒ 0；否则按 52a49c/14b0c4 查表）
260      call label_00001ae8        ← CONFIG.txt:372-407：重算 f807b/f807c，并在 :403-404 用 i076/i077 **应用**回全局
265      i071 2
266      call label_00001d38        ← 文本/文案设置
269      i082 (local-int 5) (local-int 6) 2 (global-int f807b) (global-int f807c)   ← ★本票的指令
```

⇒ 用户的「右键退出设置界面命中 i082」**就是这条路径的最后一笔**；而这一笔在引擎里带的是
`f807b`/`f807c`（**刚重算过的**文字色），即 `0x82` 的可见语义很可能是「用给定颜色把这页文本重绘一遍」。

★因此本票与 `T-0102` 的紫色那条**强相关**：若 emulator 不实现这一笔（只"记录后放行"），
"退出设置界面后 ADV 文字色没被刷新"就**可能是残留紫的可见原因之一**（`T-0102/changes.md` §丁-3 的候选 2）。
⇒ 实施本票时**必须先跑** `T-0102` §丁-3 的判据（链路扩到"右键退出 → 回 ADV 首帧"并 dump
`Engine[21664]`/`f807b`/`14acda`），以区分「`14acda` 重派生算错」（候选 1）与「这一笔没实现」（候选 2），
再决定 `0x82` 到底是"重绘"还是别的语义。**不要**在没跑那条判据前照推测实现。

## 2026-09-21

## 轮 9：`0x82` 的体已读定性（`sub_466000` 读完了「重绘哪个窗」这一半）

### 1. handler 只做转发（`sub_41F720` raw 28808-28826，argc 5）

```c
v7 = _this + 21032;                       // ← 第 6 个实参 = 文本对象 +21032（记录表/容器）
_this[30 * cur + 95805] = 11;             // arity 槽 ⇒ argc 5
v6 = sub_41BF50(_this, 5); v5 = sub_41BF50(4); v4 = (char)sub_41BF50(3);
v3 = sub_41BF50(2); v2 = sub_41BF50(1);
sub_466000(_this + 21324, v2, v3, v4, v5, v6, v7);   // ← `_this+21324` = GDI 文本对象
```

⇒ `op1..op5` 全部是 **int**（`sub_41BF50`，**没有** `sub_41C300` 的 float）⇒ `a2=op1`、`a3=op2`、`a4=(char)op3`、`a5=op4`、`a6=op5`。

### 2. ★`sub_466000`（raw **79319-80311**，993 行）的前 20 行就定死了语义

```c
v8 = (*(_DWORD *)(_this + 3368) - *(_DWORD *)(_this + 3364)) / 72;   // = 该窗的 72B 文本项记录条数
v175 = a2;
if ( v8 > a3 && a3 >= 0 ) {                       // ★门：a3 = 记录下标，越界 ⇒ 什么都不做
  if ( *(_DWORD *)(*(_DWORD *)(_this + 4 * a2 + 1044) + 112) == 1 ) {  // a2 = 窗索引
    sub_462040(_this, a2, a3, a4, a5, a6, a7);    // ← 该窗的专用路径
    return;
  }
  ... // 否则按记录走 GDI：sub_45BBF0 取记录字段 + SelectObject×12 / GetTextExtent×2 + 按 a5/a6 设色后绘制
}
```

⇒ **语义 = 「用给定颜色把『窗 `op1` 的第 `op2` 条文本项记录』重新画一遍」**：

- `op1` = **窗索引**（`_this + 4*a2 + 1044` 取该窗对象）；
- `op2` = **该窗文本项记录表的下标**（`(end-begin)/72` 条，72 B/条 —— 与 `T-0095` 的 `textItems.ts` 同一张表的量纲）；
- `op3` = 模式选择子（CONFIG 站点传常量 `2`；`1` 走 `sub_462040` 专用路径）；
- `op4`/`op5` = **填充色 / 描边色**（int）—— 正是 `CONFIG.txt:269` 刚由 `label_00001ae8` 重算出来的 `f807b`/`f807c`。

### 3. ★与 `T-0102`（紫色）的关系：**候选 2 的具体形态**

- `i082` **不改变** `Engine[21664]` —— 那一步已经由 `label_00001ae8` 的 `i076`（`:403`）做过了；
  `i082` 做的是**把已经排好的那条文本记录按新颜色重画**。
- ⇒ emulator 把它当 stub（只记录后放行）⇒ **画面上已有的旧颜色文本不会被刷新** ⇒ 与用户「退出设置后 ADV 文字仍是紫」**自洽**。
  （与「新入队的文本会继承全局色」是两件事；两者可能同时存在。）

### 4. emulator 的等价物（**建议，未实施；实施前先跑 `T-0102` §「轮 9」§5 的判决实验**）

- `T-0095` 刚给 `vm/textItems.ts` 加了 `pages`/`pageAt` + 文本项记录表 ⇒ `0x82` 大概率 =
  「取窗 `op1` 的记录 `op2`，用 `op4`/`op5` 作为填充/描边色，**重新发布/重光栅化**那一条」。
- 实现前必须先确认：ADV 的文本项记录表与 `msgwin` 的对应关系（哪一个是「画到屏上」的那份），
  以及 `emitWin`/`scMsgWinSync` 能否按「单条记录 + 指定颜色」重发布（若不能，需要新的宿主缝 —— 按先例五处同步）。
- 判据 ③（票面）：真实 `CONFIG` 路径上「文本窗被重新发布」的场景级不变量；判据 ④：`analysis/opcode-gaps.json`
  的 disposition 改 `implemented` + `opcode-table.md` 的 `0x82` 行同步；判据 ⑤：E4 用户口径。

## 从 ticket.json 的 `notes` 字段迁入（2026-09 文档模型）

来源 = 用户轮 8 实测（硬停）。★临时处置只保证不硬停，**不是**实现 —— 别把 STUB 当完成。

## 轮 11（收尾）：判据 3 / 4 / 5 逐条核对 —— 票可以结了

### 1. 判据 3（数据层 + 生成物）**逐项复核：已全绿**

| 项 | 现状（本轮实测） |
|---|---|
| `analysis/opcode-gaps.json` 的 `0x82` | `disposition: "implemented"` + note 写明「已真实现（`MSGWIN_OPS` 的 `op_gdi_repaint_window`）」，旧 STUB 记录降级为「旧记录（保留对照）」 |
| `node scripts/build-opcode-gaps.mjs` | ✓ 校验通过：**未实现 0 / unjustified no-op 0 / 有据 no-op 13 / 已实现 39 / deferred 19**（`opcode-gaps.md` 无漂移） |
| `docs-new/03-engine/opcode-table.md` 的 `0x82` 行 | 已是完整行（**不是** 原来的「仅映射」空行）：argc 5 / handler `sub_41F720` / 状态**已核对** / `sub_466000` 的语义 + emulator 实现口径 + 登记的近似 + 守卫名 |

### 2. 判据 3 后半（场景级正向用例）**：已在 `T-0102` 轮 13/23 落地，本条因此关闭

原文登记的缺口是「要造出非空记录表的场景级正向用例，需要在链路里先显示一条 ADV 消息（本轮未做）」。
`test/config1-chain.test.ts` 的「★T-0102 判据 3 收尾：真路径实测值（`g0=6` + 旁白 + 记录表非空）」
正是它：`advReturnProbe: { g0: 6, g1397: 1, msg: -1, seedRecords: 3 }` ⇒ **真实 `CONFIG` 退出链**上
`sawI082 = true`、`after.fill = #ffffff`、**`republishByI082 == 1`**（恰好一次）、
`restyleByI082.fill == #ffffff`（用**重派生后的实时色**重画，不是入队快照）⇒
「文本窗被重新发布」这条场景级不变量在**记录表非空**（= 真 ADV 路径的实测形态）时成立。

### 3. 判据 4（E4）**拆成两半**：可自动化那一半本轮补守卫，目视那一半写明为什么不能自动化

- **可自动化的一半（硬停必须彻底消失）**：用户实测的原话是「ADV → 设置界面 → 右键退出 ⇒
  命中未知指令 `i082` 而**硬停**」。这条退出链跑的**就是** `CONFIG.txt:269` 那一笔
  （`sawI082`）⇒ "不再硬停" 等价于 **该链的未实现指令清单为空**。
  ⇒ `test/config1-chain.test.ts` 的同一用例新增断言
  `assert.deepEqual(real.unimplemented, [], '★ADV 语境的退出链不得有未实现指令 …')`。
  ★辨别力已机械证明：把 `MSGWIN_OPS` 里的 `[0x82, op_gdi_repaint_window]` 注释掉（退回未注册）
  ⇒ 该用例 3 条断言红，其中就有这一条（点名 `T-0104 判据 4`）；还原后 19/19 绿
  （`config1-chain` 13 + `op-0104-gdi-repaint` 6）。
- **目视的一半（为什么不能自动化）**：用户那条路的入口是 **`SC0000` 的侧边栏**（`src/SC0000.txt:604-611`
  的 `lookup-array 13b0[f8019] == 0xf → call-script 34 // CONFIG`），而 headless 从 `SN0000` 走到
  `SC0000` **需要交互式导航**（advance:force 会停在 `CHARMEDIT` 这类菜单上；实测 205 230 帧仍未进
  `SC0000`）—— 那正是 `T-0103`（按用户要求**留到最后**）的题目。⇒ 本票不把"用户目视一次"当作
  可自动化判据，只钉"机制上不可能再硬停 + 重画用的是正确颜色"，目视确认留给 `T-0103` 打通后的
  同一份导航 + 用户复验。

### 4. 判据 5：四份台账 + 全量 verify

- `tickets.js --validate` ✅ / `capabilities.js --validate` ✅（137 条）/ `scripts.js --validate` ✅（30 条）
  / `build-opcode-gaps.mjs` ✅（覆盖 + 处置纪律）。
- `npm run verify`（typecheck ×3 + 全量 test + `check:dead-writes`）✅。

### 5. 仍未建模（**登记在案、不再阻塞本票**）

`op2` 的重画粒度（emulator 是"整窗从模型重排"）、`op3` 的其它位（bit0 组首 / bit2-3 记录过滤 /
bit4-5）、`mode == 1` 走 `sub_462040` 的专用路径。三者都写在 handler 注释、`opcode-gaps.json`
的 note 与 `opcode-table.md` 的 0x82 行里。
