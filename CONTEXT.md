# CONTEXT —— 工程现状快照（2026-09-22 · 本会话更新）

> ★**本会话（2026-09-22）的完整中间状态 / 已证未证 / 收尾待办**见
> `docs-new/99-records/2026-09-t0114-debugger/session-state-2026-09-22.md`（交接件）。
> 下面 §2/§5.2 里**已被本会话推翻**的结论已就地标注，但细节以那份交接件为准。

> **本文件只记「状态 / 结论 / 待办」**；流程、纪律、schema、命令清单**一律不在这里重述** —— 见 §1 的落点。
> 凡推断都写明"候选/未证"；凡结论都带可复算的落点（文件:行 / 命令）。

## 1. 该读哪里（本文件不重述这些）

| 你要做什么 | 读它（权威在你/技能那边，本文件不复制） |
|---|---|
| 开票 / 改票 / 收尾 | 技能 **`amayui-ticket-ledger`**（存储模型、硬约束、状态流转、收尾三连、并行纪律） |
| 读引擎 / 落三层数据层 | 技能 **`amayui-engine-analysis`**（目录与工具、schema、分析流程、状态判定） |
| 分析 `src/*.txt` 脚本 | 技能 **`amayui-script-analysis`**（先读文档→再读脚本→落台账→同步文档、同步矩阵） |
| 文档模型（真源/生成物/沿革/状态机） | `docs-new/00-overview/authority.md` 附录 **A1–A6**（含"沿革只留三处"） |
| 证据等级 **E0–E4** | `docs-new/03-engine/engine-capabilities.md` 头部说明 + 台账 schema 的 `evidenceEnum` |
| 改指令助记符 | 技能 **`amayui-mnemonic-rename`** |
| UI 图片文字（AGF/PNG/注入） | 技能 **`amayui-ui-text-render`** |
| 翻译 / 已译脚本更新 | 技能 **`amayui-script-translate`** / **`amayui-script-update`** |

**本会话期间用户明确要求（仅此一条，属于本文件该记的范围）**：**不要 `git add` 任何东西**。

## 2. 台账现状（快照）

```
票据 114 张：✅done 98  ⬜open 10  🔜doing 5  🚫dropped 1
优先级：P0 7 / P1 41 / P2 34 / P3 32
```

**doing（5）**

| 票 | 级别 | 状态一句话 |
|---|---|---|
| `T-0102` | P1 | ADV 窗口白底：★**根因已改判**（见 §5.2 与交接件）—— **不是占位块**，而是 `global 0` 被章节推进链 `SCJUMP` 覆盖成 1；**未修** |
| `T-0114` | P2 | 控制面板 → 调试器：第 1/2 步**已交付**（查询 + 条件/事件断点 + 命令台 + adb 式守护进程）；**未做 E4** |
| `T-0067` | P2 | 存档页闪一下：机制已定位（§5.3），缺一次真界面 trace |
| `T-0091` | P3 | 转场渲染剩余四项（类别 3 精确核 / `[4]` 非 create-texture 槽 / 三标志本身 / E4 可达路径） |
| `T-0111` | P3 | `opcode-table` 行同步 + `0x308` 触摸注册 + `0x1F5→sub_40FB60` 接线（`0x304` 已统一） |

**open（10）**：`T-0103`（**用户要求最后做**：SN0000→SC0000 转场不一致）、`T-0107`（INFOEN L2D 资产 id 表真源）、
`T-0108`（数据层 146 处沿革话术 → `journal[]`）、`T-0109`（阅读链路：回看页表/滚轮 + 断行注音）、
`T-0112`（B7-B 残余：逐格核 raw 5 项）、**`T-0115`（verify 太慢：四个 E3 文件占大半）**、
`T-0019`/`T-0020`（重构）、`T-0051`（E4 待验证清单）、`T-0088`（AGERC 宿主缝）。

## 3. **上一次会话**（goal 40 轮）的产出（★注意：不是本次会话）

**关闭 5 张**

| 票 | 结论 |
|---|---|
| `T-0062` P1 | 存档缩略图全黑：`0x20D` 渲染目标窗口里的 `0x20C` 必须把整帧画进该槽 |
| `T-0082` P1 | RF-A 操作数计划层：可覆盖 **347/347**，覆盖账 `375 = 347 + A13 + B12 + C3` 由守卫恒等校验 |
| `T-0080` P1 | 修复总计划：**B7（218 条审计残留）拆账** ⇒ 204 条已消化（结构性守卫兜底）+ 14 条拆 `T-0109/T-0110/T-0111`；分类全文 `tickets/T-0080/evidence/b7-coverage.md` |
| `T-0105` P3 | 文档模型收尾：叙述去重 + 新增 `copyright-effect` 台账条目 + **守卫 I9**（A4① 首次可机检）；数据层 146 处沿革转 `T-0108` |
| `T-0110` P3 | B7-B 机制文档残留 **18 处**逐条订正（清单见 §5.5）；残余 5 项转 `T-0112` |

**推进 / 新建**：`T-0102`（判据 3 关闭 + **判据 4/5 关闭并修真根因** §5.1；白底待修）、
`T-0111`（`0x304` 四方口径统一 + 补 `operandPlan` 声明 —— **不补会顶红 T-0082 的覆盖账守卫**）、
新建 `T-0108` / `T-0109` / `T-0110` / `T-0111` / `T-0112`。

## 4. 验证基线（上一次会话的全绿记录；本次实测见 §0 交接件）

```
npm run verify → tests 1033 / pass 1032 / fail 0 / skipped 1 + typecheck ×3 + check:dead-writes 0
四份台账 --validate 绿：tickets 112 / capabilities 138 / scripts 30 / opcode-gaps 无问题
专项：doc-model 8/8（含 I9）、ticket-ledger 6/6、capability-ledger、operand-plan、opcode-arity、msg-text-range 2/2
```
> 数字会随功能增长，**以实测为准**；每次收尾按技能里的"收尾三连"重跑。

## 5. 已验证的技术结论（**上一次会话**新增；这些**不在**任何技能里）

### 5.1 角色名颜色：字段是 COLORREF，取用时要再翻一次（**已修**）
- 链：`3f37`（消息号）→ `14acdc[3f37]` → `14b0c4[via]` → `14acda` → `adcd[14acda]` → `f807b` → `i076` → `Font+1360`。
- 数据源：`src/CVINIT.txt` 用**逐元素名**写角色数据（阿瓦罗 `14a8f5=ffe100` + `14b0c5=4`；菲亚 `14b0c6=5`）；
  `adcd` 由 `INITCONFIG4` 从 `14a8f1[i]` 推导（`adcd[i] = 14a8f1[i]!=0 ? 14a8f1[i] : adcd[i]-1`）。
- **判决证据**：`0x76` 的 handler `sub_41F390`（raw **28663-28671**）读脚本原值、**只翻一次**字节序存 `Font+1360`；
  raw **79241** 把它原样交给 `sub_455ED0` → raw **68093/68127 `SetTextColor(hdc, *(Font+1360))`**（GDI 收 **COLORREF 0x00BBGGRR**）
  ⇒ 屏幕色 = `bgrToRgb(字段)` = 脚本原值。
- **修复**：`src/vm/handlers/msgwin.ts` 的 `globalTextStyle()`（文本样式唯一来源）改为
  `fill/outline = hex6(bgrToRgb(v(21664/21665,…)))`；**字段语义不变**；两个诊断探针同口径改为报告"渲染用色"。
- 期望值变更：`test/text-style-snapshot.test.ts` 4 例、`test/config1-chain.test.ts` 3 处（`#b690ff`→`#ff90b6`，语义不变）。
- 守卫：`test/adv-name-color-chain.test.ts`（`CVINIT` 独立 oracle + 派生链/渲染色自洽 + 判据 4 定点；突变已证明）。

### 5.2 ADV "白底" = **占位块**（已复现，根因已定位，**未修**）
- 复现：**只在 SN0000 → SC0000 切章后**出现 ⇒ `--load 78` → **点一下** → 等过场 ~15 s。
  归档帧 `tickets/T-0102/evidence/e4-sc0000-white-panel.png`（sha256 `613105E9…F243`）；
  像素：窗口本体 **`#E3E3E3`**（= 本项目记录的文字白电平）、白字 `#FFFFFF`、黄字 `#E1C700`。
- 链条（用户侧日志 `.tmp/amayui-emulator.log`）：面板是**片**拼的、**全取自同一个纹理槽**（`SC0000.txt:33237-33241`，
  `draw-texture 19708 11 …`）；`set-draw-color-alpha` **只给 19708 上色**（`0x1970b` 那一片从没被上色）。
- ★★**2026-09-22 订正（前一句的"槽 11"是错的）**：`src/*.txt` 里**所有裸数字字面量都是十六进制**
  （`scripts/asm/disassembler.mjs` 走 `age-shared.mjs:335` 的 `(v>>>0).toString(16)`；`rendering.md:48` 也这么写）
  ⇒ **`11` = 0x11 = 槽 17**，不是槽 11。`0x5260`（= `SO001.AGF` 的 ADV 窗口框）在开机由
  `set-texture 5260 11`（`src/SYSTEM4.txt:123`）**绑到槽 17**，读档也由存档的 `records[17]=0x5260` 装回。
  全库 **564 个 BIN** 里 `draw-texture` 引用槽 17 共 **2670** 次、引用十进制槽 11 **0** 次。
  ⇒ 「槽 11 从未绑定」**不成立**；`0x1970b` 也不是槽，是 `19708+3` 的 **handle**（十进制写法）。
  取证全文 `tickets/T-0102/evidence/texture-slot-identity.md`。
- **「占位块」语义**：`itemSprite` 里 `tex ? cropSprite(...) : this.#placeholder(it)`；`#placeholder` 用 `Texture.WHITE`
  （**1×1**，被拉伸到源矩形尺寸）铺一块，随后 `spr.tint = color & 0xffffff; spr.alpha = alpha/255;` **覆盖**占位块自己的调试色
  ⇒ 它的颜色 = **该项的 diffuse**（所以白占位块 × f807d ≈ `#E3E3E3`，与归档帧采样吻合）。
- **引擎口径**：`Scene+4*slot+42456`（`CTexture*` 表）为空时**直接不画**（raw **68478-68479**）。
- ★★**2026-09-22 本会话再改判（以交接件为准）**：`SCJUMP.BIN` 的门 `ne local1, global 3318, 1`
  / `gr local1, global f8080, 0xa` 都没能挡住它后面的 `mov (global-int 0) 1`（诊断实测两道门条件**全为 1、都该跳**，
  而 `mov` 仍执行）。已排除：纹理槽配置 / 占位块 / `0x259`。**判据与实测数字见交接件 §1。**
- **修法（已修正）**：① 渲染侧改成引擎口径"槽解析不到纹理 ⇒ 跳过不画"（保留日志）；
  ② 根治 —— **不要再查"谁填槽 11"**（那是个不存在的槽）；改为查宿主侧 `TextureCache` 为什么在
  `texSlots[17]=0x5260` 已就位时仍 `resolve(it)` 拿到空纹理（`bind` 的世代判据丢弃 / 在途未到 / 自愈未触发）。
  ★注意 `#missingTexLogged` 是**去重**的（上限 64、满了 `clear()`）⇒ 只发生一帧的占位块可能**一条日志都不留**，
  取证时要临时改成不去重（跑完即撤）。
- ★★**2026-09-22 根因已定（用户现场日志直证，`tickets/T-0102/evidence/clear-slot-records-root-cause.md`）**：
  **`0x259`（`i259`）被实现成清宿主 `TextureCache.#slotImgid`**。现场日志第 1862 行
  `clearSlotRecords：丢掉 8 条 槽→imgid 记录（保留纹理对象/画布）`，此后**整个日志再没有
  `bindTexture … slot=17`**；且 `slotTex 自愈` **0 条** —— 因为 `#healSlot` 的第三道门
  `if (imgid === undefined) return undefined;` 同样依赖 `#slotImgid` ⇒ **两条取纹理的路一起断**，
  `presenter.#placeholder`（1×1 `Texture.WHITE` 拉伸到源矩形）接管 ⇒ 白色窗口。
  **引擎口径相反**：`sub_41A3A0`（raw **25357-25374**）只清 `Engine+324704`（`_this+81176`）与
  `Engine+344704`（`_this+86176`）两张 1000×5-dword **记录表**，**不碰** `Scene+4*slot+42456` 的槽表
  ⇒ 引擎里槽 17 的 `CTexture*` 原样还在、窗口照常贴出。
  ⇒ **修法 = `0x259` 不得清 `#slotImgid`**（`textureCache.ts:701` 的 `clearSlotRecords`）；
  验收 = 合成单测「`bind(s)` ⇒ `clearSlotRecords()` ⇒ `resolve({tex:s})` 仍须给出纹理」+ 突变证明。
- ⚠️ 验证需要**一次干净窗口**（用户实例关掉 ~2 min）：`shot` 与用户实例**共用** `.tmp/amayui-emulator.log` 与 overlay，会互相覆盖。

### 5.3 存档页闪一下（`T-0067`，未修）
- 复现配方（用户给的）：**载入 79 → 向 70 存档**。
- 已定位的不对称：`clearDrawContainer` **会**武装留帧；脚本清 UI 主力的 `detach-texture` 按区间删项
  **只在被删区间含"满屏覆盖幕"时**才武装 ⇒ "先拆 UI、后重画"的几帧被如实呈现。
- ADV 侧边栏热点（`src/SN0000.txt:52-66`，用于把"打开存档页"脚本化）：竖条 toggle `i090 49c 0 64 281`
  （x1180..1280, y0..641）；顶部方钮 `i090 4a5 13 3e 3e`；竖排 8 钮 `i090 49c 72|a4|…|202 50 2f`
  （x1180..1260, y114/164/…/514）；都经 `call label_0000b884` 分派（`f7ffb` = 2/4/5/6/7/8/9/a/b）。
  **哪个是「SAVE」还需点一次截图确认。**
- 下一步：拿到"ADV → 存档页 → 选槽 → 确认 → 写盘"的真界面 trace，再按判据修。

### 5.4 AGF 解压（本轮完成）
`node scripts/agf/cli.js extract raw-parts/DATA1 --out raw-parts/DATA1-png` ⇒ **2556/2556**（737.8 MB，
命名 = AGF 基名 + `.png`）；**原始 AGF 未改**。
“`install/` 下原有解压图目录被删”：`git status` 里**没有**被删除的跟踪文件、`install/` 现无子目录
⇒ 那是**未跟踪**产物，无法从仓库记录判断是谁删的。

### 5.5 `T-0110` 的 18 处订正（一句一条，均"先核真源再改"）
- `scene-start-flow.md`：GAMESTART `count` 3→**17**（`GAMESTART.txt:69` 全文件唯一一处直接写 `local 0`）+ `i12e` op8 口径；
  `0x1AD` 读者 = 引擎 raw 25698-25699（"唯一读者在存档序列化"是错的）、emulator **已建模写点**；
  §5 的 `#serviceAnimGate`/`scAnimationsDone` **在 `src/` 里不存在** ⇒ 改 `Engine.waitFlags` + `gatePending`。
- `rendering.md`：`369356` "从不设正" → **有置正点**（`0x238`/`sub_4248C0` raw 32303-32312）；
  逐帧求值 `sub_49A300`(115116) → **`sub_49AA30`**(117239 起)（前者只清零 `+52/+56` = 记录初始化）；
  `0x323` "静态遮罩" → 颜色窗（`sub_4AF1C0`+`sub_4A2050` 每帧求值）；"三路归并" → **四路**（另两路 572B 节点）。
- `engine-reset-mainloop.md`：`engine_bool_flag` 三处"未建模" → **已建模**（`engineFieldIds.engineBool=166965`；
  `0x21B`/`0x247` 见 `handlers/engine-fields.ts:149/295/512/521`）。
- `sound-system.md` §1：通道 **11 = BGM**；`adv-text-rendering.md`：`0x8B` = **行间距**；
  `save-data.md`：`0x1A1` **失败早返回会写操作数**（raw 38424-38425）；`instruction-directions.md`：
  `i0c0` = **读运行态当前曲 id `Music[259]`**；`flow-control.md`：`_this[N]` 一律**字节**偏移
  （`cur_script` 383104 = dword 95776；`387932` = 96983）；`message-config-gates.md`：取值 = **运行期生效的那一份**（overlay→base）。
- 同批：`analysis/engine-capabilities.json` 的 `copyright-effect` 逐帧函数 `sub_49A300` → `sub_49AA30`（raw `117239-131501`）。

### 5.6 `tools/shot.cjs` 的改动（**上一次会话**）+ 两条危险提醒
- 新增 **`--burst <秒>`**（点完每 2 s 连拍，抓瞬时画面）与 **`--row <y>`**（在载入列表点行选槽；第 4 行≈325、第 8 行≈547）；
  **移除 `--key`**（曾用 `--key Up` 移光标，用户观察"Up 像一直被按着"）。
- ⚠️ **载入列表会记住上次光标**：`--load 78` 可能实际载入 **79**（用户实测踩过）⇒ 必须 `--row` 点行。
- ⚠️ `shot --load` 在**载入时也会回写槽**（日志 `save slot 78 -> …`，其中一次写的是 **base（真机目录）** 的 `SAVE78.DAT`）
  ⇒ 跑前保留备份。
- ★另一个本会话踩到的项目级坑：**渲染进程没有 Node 的 `process`** —— 在 `renderer/**` 里读 `process.env`
  会 `process is not defined` 直接把窗口打白（诊断开关请走"临时源码 + 跑完即撤"）。

## 6. 环境事实（本机）

| 项 | 路径 |
|---|---|
| 系统存档 base（真机） | `C:\Users\liaoh\AppData\Local\Eushully\天結いキャッスルマイスター\` |
| overlay（emulator 写的那份） | `C:\Users\liaoh\AppData\Local\Eushully\天結いキャッスルマイスター.overlay\` |
| 产品日志 | `E:\Games\Eushully\天結\.tmp\amayui-emulator.log` |
| E4 截图产物 / 一次性探针 | `E:\Games\Eushully\天結\.tmp\`（gitignored；会互相覆盖，跑前先确认没有别的实例在写） |

★本会话新增的**调试通路**（详见交接件 §2）：`npm run dbg:srv` 起 adb 式后台守护进程（TCP `127.0.0.1:39427`），
`node tools/dbg.cjs <命令>` 发命令（`global 0` / `b event global-int-write idx == 3318` / `c` …）。
另：`electron/windows.ts` 的贴边开窗在 **macOS 上已修**（先显示再摆位；交接件 §3）。

- `overlay/SAVE/SAVE.DAT` 头 = `S4SD / title=AmayuiEmulator / format=0`（**emulator 明文格式**；base 那份是引擎格式）；
  `adcd`（角色配色）两侧一致 = `CVINIT` 默认值。
- **git**：会话开始前已有 15 个文件在暂存区（音频开关那批），全程未 `git add`、未触碰。

## 7. 未决与下一步（**上一次会话**开的清单；本次的收尾待办见 §0 交接件 §7）

1. **`T-0102` 白底**（P1）：按 §5.2 两步走；**等用户给一次干净窗口**（关实例 ~2 min），
   跑 `npm run shot -- --load 78 --row 651 --centered --name fix1 --burst 34` + 临时逐项日志，
   看 `#E3E3E3` 是否消失、面板是"缺口"还是"正常半透明黑" ⇒ 判定第 2 步。
2. **`T-0067` 存档页闪一下**（P2）：需要"ADV → 存档页 → 选槽 70 → 确认"的真界面 trace（§5.3）。
3. **`T-0111`**（P3）：运行时三表与文档的**全量对账**；0 语料 8 条（`0x105/0x2CA/0x309/0x339/0x026/0x144/0x2FD/0x22E`）
   逐条"补语义/转 `deferred`"；`0x308`（语料 31279 处）与 `0x1F5→sub_40FB60`。
4. **`T-0103`**（P3，**最后做**）：SN0000→SC0000 章节切换演出的多处不一致。
5. 其余 P3：`T-0107` / `T-0108` / `T-0109` / `T-0112` / `T-0019` / `T-0020` / `T-0051` / `T-0088` / `T-0091`。
