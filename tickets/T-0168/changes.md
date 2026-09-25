# T-0168 · 滚轮上滚链的追查结论（2026-09-24）

## 一、结论（一段话）

引擎里**没有**「滚轮 ⇒ 打开 HISTORY」这条引擎内链（`engine/天结_unpacked.exe_utf8.c` 里 `HISTORY` 字面串 **0 命中**）；
`HISTORY.BIN` 全语料只有一个入口 = **`call-script 31`**（669 处 / 335 文件，全在 ADV 菜单的 action 分发表里，
action id = 6）。滚轮是**可赋值的按键**：WndProc 把上/下滚折算成掩码位 `1 << Conf(set:WheelKeyUp/Down)`
（raw 141563-141606），ADV 脚本再用 `0x97` 把这些位绑到**离屏 1×1 热点**的 labelC 上。
`src/SN0000.txt:94-114` 绑了位 0/1/2/3/8/7，其中 **位 8 → `label_00002f84` → `call-script 31 // HISTORY`**（`:831/:836`）。
本机生效配置 `WheelKeyUp=3 / WheelKeyDown=1`（= ←/→）⇒ **默认滚轮在 ADV 走的是"菜单导航"那条 label**
（实测 `lastDispatch={label:2817,kind:"key"}` = 位 3 的 `label_00002c40`，它建/展开侧边栏菜单）
—— 这正是用户实测「滚轮上滚打开侧边栏并停在第一个按钮」的机制，**真机默认同样如此**（不是 emulator 独有的分叉）。
把 `set:WheelKeyUp` 改成 8 再滚一次，脚本**真的进了 `HISTORY.BIN`**，随后停在 **`0x1D1` 未实现**
（回想页渲染器 `sub_4675A0`，唯一调用点 `src/HISTORY.txt:1314`）⇒ **画面看不见的最后一环是 `0x1D1`**。

## 二、本轮已完成（记录在案）

1. **输入掩码那一段已修**（`tickets/T-0167` 的收尾）：wheelKeyBits/wheelKeyPolicy，守卫 `test/wheel-as-key.test.ts`（9 例）。
2. 台账三处订正 + 补记（`analysis/opcodes.json` 的 `0x7B` 语料 1097 处；capabilities 两条 note 的
   `0x4000000`→`0x40000000` 与"滚轮⇒回想"的条件化；`analysis/scripts.json` 的 SN0000/SC0330）。
3. 脚本台账新增两段 layout（`SN0000` 的键位绑定表 76-114、`SC0330` 的菜单派发 466-505）⇒ `docs-new/05-scripts/`。

## 三、待办（按依赖排序）

1. **实现 `0x1D1`**（`sub_420310` → `sub_4675A0`，raw 29353-29375 / 80312-81522）：回想页渲染入口。
   `opcode-gaps.json` 里它已是 `deferred`（note 已写清语义：op1=窗号、op2=记录表下标、op3=绘制标志、op4/op5=填充/描边）。
   emulator 的页表/记录表（`vm/textItems.ts`）与 `0x1D0/0x1D3` 已就位；`0x1D1` 在 `src/**` **0 命中**（命中即 `NotImplementedOp`）。
   实测打桩后 `HISTORY.BIN` 能空闲在 ip=101（4000 帧内无其它未实现 opcode）⇒ 它是"可见性"的关键。
2. **守卫（E3）**：`TITLE → GameStart → GAMESTART → SN0000 首文案 → set:wheelkeyup=8 → addWheel(120) → 跑帧`，
   断言 `curScript().name === 'HISTORY.BIN'` 且 `lastDispatch = {label:3026,kind:'key'}`（探针已验证可复现）。
3. **不要**在滚轮插件里加"滚轮 ⇒ 打开回想"的捷径（引擎无此链）；④（`#textRewindWheel`）不负责开画面。
4. ~~未验证项（留给后续）~~ ★**2026-09-24 已全部查清**（只读查证全文见 `tickets/T-0168/notes.md`）：
   - **谁写 `set:WheelKeyUp/Down`** —— 默认 3/1 由引擎 `Reg` 构造函数 `sub_491880` **写死**（raw 111736-111739）；
     **唯一**覆盖写者 = `Reg` vtable+0x2C 的 ini 载入器 `sub_494220`（读 `WHEELKEYUP=` 行，raw 112705-112718）；
     **游戏内设置界面改不了它**（6 条 SetConfig opcode 的键名全是常量、键位类 opcode 只在 `SYSTEM4.txt`）；
     随包数据/真机 ini/注册表里都没有这个键；读端**零上界校验**。★我们 overlay 里那行 `WheelKeyUp=3` 是
     **自己 `renderIni` 全量输出**的，不是随包默认。
   - **bit8 = PageUp** —— 证实且口径更正：`0xC9` **不是 VK，是 DirectInput 扫描码 DIK_PRIOR**；引擎键码表
     `sub_476AA0` raw **91413** `_this[1633] = 33` ⇒ `Input[1432+0xC9] = 33 = VK_PRIOR`（emulator 的 93 条表逐条一致）。
   - **回想画面内翻页** —— 证实：泵里翻页**只**由 `1 << Conf(set:WheelKeyUp)` 触发（raw 20343-20348，门 `0x40000000`），
     下滚位没有单独判（raw 20355 走 else），翻页**本身不是 opcode**（直接 `sub_459770`）；HISTORY 自己的链 =
     `0x10D`/`joy-callback` → `0x1D0`（带符号步数）→ `0x1D3` → `0x1D1`。
   - **`0x1D1` 是否唯一缺口** —— 在**限定态**下证实（records 6→72、进 HISTORY 后 4000 帧 + 周期喂输入、VM 45 步/帧且
     4000/4000 帧都有执行 ⇒ 唯一"未实现 opcode"就是 `0x1D1`），但带 4 条折扣：**`0x84` 三表皆无且缺口台账里
     连条目都没有**（语料 0 ⇒ 命中即硬停而棘轮看不见）、同链还有 7 条 `partial`、2 条 engine-internal、2 类宿主丢弃。
     ⇒ 已开票处理 `0x84` 的登记与 `T-0170` 的结算（见 `notes.md` §四）。

## 四、证据

- 探针与原始日志：`.tmp/wheel-hist-probe/{probe.ts,probe2.ts,probe3.ts,paths.ts,*.out.txt}`
  （决定性：`npx tsx ../../.tmp/wheel-hist-probe/probe2.ts`，workdir `app/amayui-emulator`）。
- 引擎锚点：`case 0x20Au`（WndProc）、`sub_411BC0` raw 20242/20341-20360、`sub_411590` raw 20003-20065、
  `sub_412290` raw 20859-20885 / 21158 / 21224、`sub_41F790` raw 28829-28942、`sub_403D70` raw 9847-9863、
  `sub_459770` raw 70574-70627、`sub_4675A0` raw 80312-81522。
- 语料锚点：`src/SN0000.txt:42/79-114/831/836`、`src/$1$SC0330.txt:477-513`、`src/SYSTEM4.txt:87-97`、
  `src/HISTORY.txt:300/321/961/1314`。

## 五、`CALLBACK_TEXT.BIN` 这个名字的出处（2026-09-24 补，回答"哪里搞出来的"）

**它不是从资源里翻出来的文件名，是引擎自己的字符串常量**：

- 定义：`engine/天结_unpacked.exe_utf8.c:4344` → `char aCallbackTextBi[] = "CALLBACK_TEXT.BIN"; // idb`；
  反汇编同址 `engine/天结_unpacked.exe.lst:427230` → `.data:0051F1F8 aCallbackTextBi db 'CALLBACK_TEXT.BIN',0`。
  它与 `String2 = "CALLBACK_LOAD.BIN"`（raw 4342）、`CALLBACK_SETTING/LOST/WINDOW.BIN`（4345/4350/4355）
  同处一块硬编码资源名常量区 ⇒ 这几个名字是引擎写死的，不来自脚本或数据表。
- 使用点（exe 内 5 处，**全部**是 `sub_411560(Engine, aCallbackTextBi)` = 按名取 id + 入队 + 立即派发）：

  | raw（.c） | .lst | 所在 |
  |---|---|---|
  | 20044 | 0041178D | ADV 推进/等待泵 `sub_411BC0`：回看「落回」支（`*v9 = 0` 之后） |
  | 20065 | 004117FE | 同一泵的滚轮键分支（`v10 & 0xA`，`489816` 写完 -1/1/0 之后） |
  | 20351 | 00411E52 | 本票追的那格（`#textRewindWheel` 的对应处） |
  | 28852 | 0041F921 | 回想翻页函数（raw 28836+；`_this[122454]`=textRewind、`_this[21324]`=回看环），`LABEL_26` 收口 |
  | 28905 | 0041F9ED | 同上另一支（`_this[174801] \|= 0x100000` 之后 `return`） |

- "缺失/no-op"结论的来路（三步实测，不是"曾经有、后来丢了"）：
  ① 引擎按**完整名字**查表（`analysis/functions.json:6342`；扩展包条目带 `$n$` 前缀 ⇒ 普通名永远查不到扩展包）；
  ② 本资源树 `install/SYS4INI.BIN` 的 21109 条 / 565 个 `.BIN` 无此名，`raw-parts/DATA1/` 抽取结果同样没有；
  ③ ⇒ `sub_455000` 返回 **-1**，`sub_40FC90(Engine, -1)` 体首早退（raw 19021-19026）⇒ 这 5 跳在本树下都是 no-op。
  旁证：`src/` 下只有 `CALLBACK_LOAD/SETTING/WINDOW.txt` 三个回调脚本源，无 `CALLBACK_TEXT.txt`（脚本源缺失只是旁证，
  结论只依赖 ② 的 BIN 索引）。
- **边界**：以上是"本资源树 / 本版本"的结论。该名字是 Eushully 这套引擎的通用常量，换版本或装资料片后该文件**可能**出现
  ⇒ 台账留重开条件，而不是写成"引擎不需要它"。
