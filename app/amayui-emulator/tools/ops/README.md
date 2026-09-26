# `ops/` —— 模拟器操作脚本索引（一个用例一个文件）

> **这一层只放「从某个界面做某件事」的固定流程**；与实例对话的原语（点击/等条件/读态/起停）都在上一层
> `../emu.mjs`（核心驱动）。**新增用例照抄 `_template.mjs`（或让工具 `action=op-create` 生成），并在这张表加一行。**
>
> ★**位置**：`app/amayui-emulator/tools/ops/`（2026-09-26 从技能目录搬来，见 `tickets/T-0191`）——
> 这些是**工程脚本**，不依赖 DSH：任何终端、任何 agent 都能跑。

## 怎么跑（两条等价入口）

```bash
# ① CLI（纯 node，脱离 DSH 也能跑）
node app/amayui-emulator/tools/emu.mjs reset --instance sn187                          # 回到干净状态（TITLE）
node app/amayui-emulator/tools/ops/load-from-title.mjs --instance sn187 --slot 79
node app/amayui-emulator/tools/ops/load-from-adv.mjs   --instance sn187 --slot 78
node app/amayui-emulator/tools/load-slot.mjs --instance sn187 --slot 78                # 旧入口（兼容壳）

# ② DSH 工具 `amayui_emulator`（一次调用；查询/执行/创建三件事都在工具面上）
#    action=ops        → 列出本目录里有哪些 op（名字/前置/判据/状态，不跑任何东西）
#    action=op         → 执行一条：{"action":"op","name":"load-from-title","args":["--slot","79","--expect","SN0000.BIN"]}
#    action=op-create  → 用 _template.mjs 生成一条新用例（名字 + 用途），并回执「还必须补哪三样」
```

`--instance` 是实例 id（`node app/amayui-emulator/tools/emu.mjs status` 看活实例）。

| 脚本 | 用例（从哪个界面、做什么） | 前置 | 判据 | 副作用（★必读） | 状态 |
|---|---|---|---|---|---|
| `load-from-title.mjs` | **TITLE → Load Data → 槽 N**（标题画面读档） | 实例在 `TITLE.BIN` 或已在存档列表 | `cur = SAVE.BIN` → 日志 `[slot-load]` →（可选 `--expect BIN`）帧链到该脚本 | 无（不动任何配置） | ✅ 实测 2026-09-26（槽 78 / 79） |
| `load-from-adv.mjs` | **ADV 界面（游戏内）右侧侧栏 → LOAD → 槽 N** | 实例已在带 ADV 侧栏的场景（SN0000/SC0000/NOVEL 族） | 侧栏表校验通过（或退回扫描命中）→ `cur = SAVE.BIN` **且 `f7ff0 == 1`（读档模式，安全断言）** → 日志 `[slot-load]` → 槽指纹对账 | ★★**会修改 ADV 侧栏配置**（运行期把 charm 表 `global 13b0` 写死为 `[0xd 0xe 1 0xb 0xc 2 3 4 5]`，SAVE/LOAD 放第 0/1 格）；**只改内存、不写回 `SAVE.DAT`**；`--keep-sidebar` 可关（改走候选扫描） | ✅ 实测 2026-09-26（槽 78，见 `tickets/T-0189/evidence/e2e-load-from-adv.log`） |
| `_template.mjs` | 新用例的模板（不是可跑的用例；`action=op-create` 就用它） | — | — | — | 模板 |

> ★**副作用的规矩**：一个 op 若要改"配置类"状态（侧栏排布、渲染开关…），必须
> ① 在**文件头 + 本表**里写明改什么、改到哪、怎么恢复；② 尽量只改**运行期内存**（`emu.setGlobal/setArray`
> → `debug-query` 的 `set-global`/`set-array`，按 ENC 写脚本全局池），**不许**写回玩家数据（`SAVE.DAT`）；
> ③ 给一个**关掉它的开关**（如 `--keep-sidebar`）。

## 新增一条 op 的三步

1. `amayui_emulator action=op-create {name, purpose}`（或手工 `cp _template.mjs <名字>.mjs`）；
2. 填**三样缺一不可**的东西：① **开屏手势**（点哪/悬停哪/要先展开什么；坐标一律从 `src/<脚本>.txt` 的
   `i090 <x> <y> <w> <h>` 热点或 `capture` 图上量，**不许**套别的场景的坐标）；② **机器可读的开屏判据**
   （首选 `cur` 变 `*.BIN`，其次全局如 `f7ff0`，再其次日志行；**`sleep` 不算判据**）；③ **该场景特有的坑**；
3. 在本文件上面的表里加一行（工具 `action=ops` 读的就是这张表 + 各文件头）。

## 待登记（**未实测，别直接拿坐标硬上**）

写在这里是为了"一眼看到还缺哪些"，而不是说它们能用。每个都要按上面三步补齐：

| 待登记用例 | 已知信息 | 缺什么 |
|---|---|---|
| `load-from-battle.mjs`（战斗界面读档） | 战斗由 `$n$BT*.BIN`/`BATTLE` 一族驱动 | 战斗界面里读档的入口脚本/hotspot；读档后**战斗状态是否要复位** |
| `load-from-workshop.mjs`（工房界面读档） | 工房 = `ALCHEMY`/`SHOP` 一族 | 入口 hotspot；开屏后是否需要先退出当前子界面 |
| `load-from-field.mjs`（地图/探索） | 地图 = `$n$SC*.BIN` + `SELSTAGE` | 入口 hotspot；与"场景切换转场进行中"的互斥 |
| `load-from-guild.mjs`（組合/公会） | — | 全部 |

## 已实测钉死的六条通用纪律（两个已登记 op 都靠它们）

1. ★**菜单/侧栏/底部按钮要"两帧点击"**：一次注入 `cursor+press+release` **不激活**
   ⇒ 用 `emu.tap()`（`move → press → 停 ≥120ms → release`）。TITLE 的第 1 层菜单用普通 `click` 也行。
2. ★**悬停靠"位置变化"**：`InputManager` 只在坐标真的变了才命中测试 ⇒ 同一点重复 `move` 无效。
3. ★**ADV 侧栏"视觉展开 ≠ 逻辑展开"**（`T-0028`）：必须先悬停**折叠条**（1230,233–1280,493）
   让展开 label 重登记热点，再点按钮；否则点了什么也不发生。
4. ★**序章也有侧栏，但必须等它的渐变动画跑完**（用户口径 2026-09-26）：动画期间热点尚未重登记 ⇒
   点/悬停全落空（实测：序章第一页直接点按钮 ⇒ 9 格扫描全落空，会误判成"这个场景没有侧栏"）。
   判据用 `emu.waitSidebarReady()`：悬停折叠条后等**路由项数**从折叠态（2~3）涨到 ≥10 并**连续两次稳定**。
   ★别用 `global 1399`（动画**开始**就置 2）或 `bin`（动画前后同名）当判据。
5. ★**存档列表：点一行就会弹「要读取吗？」确认框**（不是"先选中再点 LOAD"）⇒
   `pickSlotInSaveScreen` 现在是"点行 → 点「是」（最多 3 次）→ 失败则重来一轮"，
   **不再**点左下角那个 LOAD 按钮（实测那一步会把对话框流程带偏 ⇒ 之后点「是」落空）。
   ★`global 138e` 是 `SAVE.DAT` 里**上一次读档**留下的陈旧值、**不随选行变化** ⇒ 拿它核对选中行会**假阴性**；
   选行对不对改由**载入后的槽指纹对账**（`emu.slotFingerprint` vs 日志 `真槽装载…savedCur=/帧记录 N 条`）。
   ★★**列表画出来是"慢"的：`cur = SAVE.BIN` 不等于可以点**。每页要**同步**读 10 个槽头
   （引擎 `0x1A0` 一处 84–117ms ⇒ 一页可到数秒），这段阻塞期注入的点击**会丢**
   （用户实测原话：「加载存档界面比预期慢，导致点 79 的动作过快丢失了」）⇒ 点行/点页**之前**先
   `emu.waitIdle()`（判据 = `debug-query` 往返 < 600ms 连续两次 = 页面不被 JS 阻塞）。
6. ★**读档画面有模式**：`global f7ff0`（0=存档 / 1=读档）——**在存档画面里点槽位会覆盖存档**，
   所以 `load-from-adv.mjs` 把它当**安全断言**（不是提示）。
7. ★**标题 = `TITLE.BIN`**；`SBUNKI`/`SBUNKIMOVE` 是**装载画面族**（`SAVE.BIN` 调出来的背景/动画，
   见 `[slot-load] 装载时的帧链`）⇒ 看到它们说明**还在装载流程里**，不是"回到了标题"。
   `emu.mjs reset` 与"从 TITLE 读档"的前置**只认 `TITLE.BIN`**（`emu.isLoadUiFamily()` 可判后者）。

## ★跑之前的硬前置：实例必须"可驱动"（有渲染页 **且** 帧循环在跑）

★**改了 `src/vm/debugCommand.ts` / `src/renderer/**` 之后要 `npm run build:electron` 再重启实例**：
渲染页跑的是**构建产物** `dist/renderer.js`，不重建的话"新命令在页面里不存在"
（实测回执：`未知查询：set-array` ⇒ 见 `lessons.md` #26）。

输入输出全走 `debug-query`，而 VM 活在渲染页里 ⇒ **页面不在/被节流，命令就不会被处理**。
每个 op 开跑时都会 `waitTicking()` 把这一关过掉，失败时给的是**分类诊断**（`emu.mjs status` 也会打）：

| 诊断 | 含义 | 修法（都在设备侧，不在脚本这层） |
|---|---|---|
| `no-viewer`（503） | 没有渲染页 | 用工具 `action=start` 重起（带 `--attach-headless`），或在 DSH 面板里选中该实例 |
| `stalled`（"没等到帧边界"） | 页面在，但帧循环停摆（面板被收起/切走 ⇒ Chromium 节流 rAF） | 把该实例的面板页**调回前台保持可见**，或重起该实例 |

本机实测（2026-09-26）：宿主自带的 `--attach-headless` 曾**起一个死一个**
（宿主日志 `无头渲染页退出 code=4294967295`）⇒ 实际在跑的渲染页常常就是**面板那一页**。
**不要**为此去起自己的浏览器页/用 playwright —— 那是设备侧的事，这一层只发命令读结果。

## 附：手驱动时的实测坐标（虚拟 1280×720，= `capture` 的 PNG 像素，1:1）

工具 `action=input` 与 `debug-query` 的 `click/move` 都用**引擎虚拟坐标**。`ops/*.mjs` 里已经量好的坐标以
`emu.mjs` 的 `XY` 表为准；下面是**还没固化成 op** 的那些（写在这里是为了不必回头翻票）：

| 界面 | 元素 | 坐标 / 公式 | 出处 |
|---|---|---|---|
| TITLE | Load Data | `(1070, 480)` | `emu.mjs` `XY.loadData` |
| TITLE | OPTION（第 3 项） | `(807, 621)` | `tickets/T-0141` |
| OPTION | 左侧分类第 i 项（1 基，i=1..6） | `(120, 119 + 50*(i-1))` | 同上：命中带 `y = 100+50i .. 149+50i`，**每项整 50 高、无缝隙**（`y=150` 已是第 2 项） |
| OPTION | 第 5 项「角色设定」（唯一进 `CONFIG2.BIN` 的页） | `(120, 319)` | 同上 |
| 存档列表 | 页号按钮「N0」 | `(606 + 42*N, 30)`（页 0 → x606、页 70 → x900） | `XY.pageButton` |
| 存档列表 | 第 i 行 | 用 `emu.calibrateRowY()` 探两点拟合，**别用公式死算** | `XY.rowY` 的注释（列表带滚动偏移） |
| 存档列表 | 确认框「是」 | `(636, 321)` | `XY.confirmYes`（★点一行就会弹它，**不必**点左下角 LOAD） |
| ADV | 折叠侧栏热点条 | `(1255, 363)`（矩形 1230,233–1280,493） | `XY.advSidebarStrip` |

★**两侧大箭头 `(1231,358)` 证据互相矛盾**（多次成功过，也多次点不动）⇒ 翻页优先用**页号按钮**，
并先 `capture` 现量落点、用 `wait`/`frame` 看脚本名有没有变来判"到底动没动"。
★**别用 `tools/shot.cjs --load N` 当"载入第 N 槽"**：它自陈只标记，实际载入列表当前行（`shot.cjs:254-256`）。
