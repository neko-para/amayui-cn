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
4. 未验证项（留给后续）：谁写 `set:WheelKeyUp/Down`（`src/*.txt` 里 `WheelKey` 0 命中，键位设置界面的回写路径未追）；
   bit8 = PageUp 只依 emulator 的键码→VK 表（未回引擎核对键码表本体）；回想画面内滚轮翻页未实测；
   `0x1D1` 是否**唯一**缺口（只证"4000 帧内唯一未实现 opcode"）。

## 四、证据

- 探针与原始日志：`.tmp/wheel-hist-probe/{probe.ts,probe2.ts,probe3.ts,paths.ts,*.out.txt}`
  （决定性：`npx tsx ../../.tmp/wheel-hist-probe/probe2.ts`，workdir `app/amayui-emulator`）。
- 引擎锚点：`case 0x20Au`（WndProc）、`sub_411BC0` raw 20242/20341-20360、`sub_411590` raw 20003-20065、
  `sub_412290` raw 20859-20885 / 21158 / 21224、`sub_41F790` raw 28829-28942、`sub_403D70` raw 9847-9863、
  `sub_459770` raw 70574-70627、`sub_4675A0` raw 80312-81522。
- 语料锚点：`src/SN0000.txt:42/79-114/831/836`、`src/$1$SC0330.txt:477-513`、`src/SYSTEM4.txt:87-97`、
  `src/HISTORY.txt:300/321/961/1314`。
