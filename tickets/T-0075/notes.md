# T-0075 · 过程文档（notes.md）

## 2026-09-20

### 轮 7 复核：`op-1/0x100-push-return-point` = **stale（已修复），勿再当待办**

`docs-new/99-records/2026-09-audit/audit-2026-09-opcodes.md` 的 `### op-1/0x100-push-return-point` 条在**审计当时**成立，但已在更早一轮落地（`tickets/T-0077/notes.md` §「B4 第三条」）：`app/amayui-emulator/src/vm/handlers/input.ts` 现在按两条分支**不对称**实现 —— `pushReturn(plusOne)`（现 `:163-167`），掩码分支 `pushReturn(false)`（现 `:186`，`ret` 回到 0x100 继续扫下一个键）、默认键分支 `pushReturn(true)`（现 `:196`）；扫描游标 `ENGINE_FIELD.keyScanCursor`（`Engine[cur+122287]`，写 `b+1`）也已建模（现 `:181`）。

已在审计正文该条下加 **★订正（轮 7 复核）** 段说明「已落地 + 旧行号已漂 + 残留近似是扫描游标复位没有帧泵钩子」。

⇒ 本票的剩余清单里**不要**再列这一条；同类「审计条已被后续轮次修掉」的条目应继续按此法逐条标注（这是本票 P1 的一部分价值：审计本身也会陈旧）。

## 2026-09-20

## 轮 8 追加批：一处「文档自相矛盾」（典型凭空点形态）

- `app/amayui-emulator/src/vm/msgwin.ts:75` 注释：「`background` ← `sub_43B070(dd, 表面, 色)`（op `0x70` 之后引擎用窗口底色填面）」。
- `analysis/engine-capabilities.json` 的 `text-glyph-coverage-alpha` 条目 note（★T-0035 第 10 轮订正）：「`sub_43B070` 是"**设色键**"不是"填底色"；填面是 `sub_43E260`」。

两者不可能同时成立。轮 8 追加批另确证：宿主端 `src/renderer/text/raster.ts:326` 的填面注释引的是 raw **74261-74265**（= `sub_43E260` 的调用点，与台账一致），而 `msgwin.ts:75` 引的是 `sub_43B070`（与台账矛盾）。
⇒ **初判 `msgwin.ts:75` 的括号说明是凭空点**（被引函数名错），但 `.lst` 逐字节复核未做 ⇒ 待 `T-0102` 的白底取证结论落定后一并订正（订正时同时核对 `docs-new/03-engine/adv-text-rendering.md` 是否复述了同一句）。

## 2026-09-20

### 轮 8 追加批：上一条矛盾**已定案并订正**

取证用 `.lst` 复核完毕（`T-0102` 的白底取证）：`sub_43B070` 的错误串是 `"関数：ddSetColor エラー：不正なsurface"`、尾调用 `mov eax,[ecx+74h]` = 表面 vtable+0x74 = **SetColorKey**（参 8 = `DDCKEY_SRCBLT`），`.lst:97104` 起；`ddFillSurface` 是 `sub_43E260`（`.lst:102245` 起）。
⇒ **能力台账对，`app/amayui-emulator/src/vm/msgwin.ts` 的注释是凭空点**。已订正两处（都在本批）：`src/vm/msgwin.ts` 的 `WinGeom.background`（原「← `sub_43B070`…用窗口底色填面」）与 `src/renderer/text/raster.ts` 的填面分支（原「引擎 dd 路径 `ddFillSurface(surfaces[20+win], 底色)`」）；两处都补了 `.lst` 级证据与「该字段恒 `null`、全 `src/` 无写入点、分支是死码」的结论。
★顺带一条**同类风险的提醒**：`Scene+1560` 曾被当成"窗底色缓存"，实际是**像素格式掩码**（`sub_43B260` `.lst:97339` 写 `0x00FF0000/0x0000FF00/0x000000FF` 到 `+1556/+1560/+1564`）⇒ **引擎没有"窗自己的底色字段"**。凡是把"某个 Scene/Font 偏移"直接命名成语义字段的地方，都该按这个教训复核一遍（正是本票的活）。

## 从 ticket.json 的 `notes` 字段迁入（2026-09 文档模型）

方法学副产品（对后续审计有用）：① 判断「某字段是不是死写」必须自己 grep 全文件的读写点 —— 本次一个 P0 与一个 P1 都源自旧文档把「有读者的字段」写成死写（0x238 / 0xD9 的 0x1000 位）；② 台账/文档里的「已实现/未实现」不能互相信任，必须打开代码与测试（本次实证：台账说「两宿主没接线」实际每帧都在消费；说「完全没接」实际 7 条参数面 + 面名映射都已落地）。③ opcode-table.md 里「已核对但无 raw 引用」的 37 行是历史遗留（算术族 0x50-0x5F 等），多数语义正确但没有行号锚点。

## 2026-09-21

## 轮 9：交付物自包含性收尾（本票结算）

审计明细本身早已落地（三份报告 + 总览），本轮补的是**"报告自包含"这一条验收**：

1. ★**总览引用了一个不存在的节**：§5 写「执行状态见 §6」，而 `audit-2026-09.md` 只有 §5 与 §7
   —— 对下一个读报告的人，"执行状态"等于不存在。已补 **§6 执行状态**（B0..B7 逐批：票号 / 内容 / 状态 /
   出口判据与守卫；副表记"审计自身陈旧"的处理法（`op-1/0x100-push-return-point` 就地加★订正））。
2. ★**机器可读清单只住在 `.tmp/`**（gitignore）⇒ 报告正文引用的"数据清单"别人拿不到。
   已归档为票据证据：`tickets/T-0075/evidence/audit-final-{opcodes,capabilities,docs}.json`
   （kept/dropped/unclear = 95/9/0、84/9/6、67/13/2，与三份报告的统计一致 —— 由守卫核对）。
3. 新增守卫 `app/amayui-emulator/test/audit-report-completeness.test.ts`（3 条）：
   ① 三份明细各自含「方法 / 覆盖 / 统计 / 误报」四件套 + 复核分布；
   ② §6 存在且 B0..B7 各有归属票（钉住上面第 1 条，防它再次腐烂）；
   ③ 归档清单存在且 kept/dropped/unclear 与报告口径一致（钉住上面第 2 条）。
   意义：这类"报告必须自包含"的要求**不写进守卫必然腐化** —— 本轮的第一条缺陷就是它腐化的实证。

### 判据
- `npx tsx --test test/audit-report-completeness.test.ts` ⇒ 3/3 绿。
- 全量 `npm test` 绿（见 changes 记录）。
- 未改动任何被锚定的报告正文行（只在总览里**新增** §6；§5 的引用句与三份明细原样保留）。

## 2026-09-21

## 轮 10：Live2D 那一簇 8 条 finding 的**逐条标注**（按轮 7 的"审计也会陈旧"纪律）

`audit-final-capabilities.json`（已归档 `tickets/T-0075/evidence/`）里与 Live2D 有关的 finding 共 **8 条**；
本轮把仍未修的按 `analysis/engine-capabilities.json` 的**实际状态**逐条修掉或收窄（改数据层 → `--recount`
→ `capabilities.js --validate` → `build-capabilities.mjs`），结果如下（`finding id | 类型 | 处置`）：

| finding | 类型 | 处置（2026-09-21） |
|---|---|---|
| `l2d-node-draw-gate` | contradiction **P0** | **已修（更早轮次）**：emulator note 已订正为"两宿主每帧都在消费该判据"（Pixi `live2d/render.ts` → `presenter.ts:265/:348`；headless `scene/snapshot.ts:230`），status = `modeled-verified`/E3。本轮复核**确认**该条不再成立。 |
| `live2d-enabled-config-flag` | no-evidence P2 | **本轮修**：原 `engine.fns=[sub_4209B0]`/`raw=29615-29639` 引的是 **0xA0(jcc) handler**（`(676636-675996)/4 = 0xA0`），体内无 `a9d0/f8c46/f8c47` 读点 ⇒ 改为引**被门控的 L2D 装载入口** `0x341 → sub_427BA0`（派发表 raw 23249，`(679328-675996)/4 = 0x341`；体 **34460-34495**），并在 `trigger`/`whySilent` 写明这三个是**脚本 global（引擎 0 读点）**。 |
| `live2d-mesh-batches` | contradiction P2 | **本轮修**：`trigger` 原写「按纹理号分组成三角批次」，与同条 note（「按纹理号合并是**错的**」）和实现（一个网格一批）冲突 ⇒ 按体与实现改写，`engine.raw` 扩到 **134277-134416**，切批粒度的直接锚点 raw **148038-148068** 写进 trigger。 |
| `chained-3d-layer-commit` | contradiction P2 | **本轮修**：name/trigger/why 全改（本条对象是 `Scene+1096` 的 **572B 立绘节点表**，不是"3D 场景层"），`status: n/a-known → modeled-verified`/E3（guard `test/live2d-render.test.ts`），note 引四路归并 order=3 与 headless 同路径。 |
| `lazy-572b-node-map` | contradiction P3 | **本轮修**：`absent → partial` —— **立绘那一半已建模**（`Engine.l2dNodes` + `0x344` handler + 真实 TITLE 资产守卫），只剩**精灵/特效那一半**未建模（note 写清边界）。 |
| `lazy-live2d-slot` | no-evidence P3 | **本轮修**：`fns` 补 `sub_4785E0`（**释放**那一半，def 92745；调用点 121678/121753；原列的 `sub_478270` 其实是构造函数）与 `sub_4A1AF0`（**"10 槽"的硬依据**：raw 121784-121787 `if ( ++v1 >= 10 ) return 0;`），`raw: 121664-121700 → 121664-121790`，status → `modeled-verified`/E3。 |
| `chained-3d-layer-commit:callsites` | overreach P3 | **本轮修**：原 trigger 写"`sub_4B06D0` 的 **6** 个调用点"却列了 7 个行号、且漏了 `sub_4B4040@136937`/`sub_4B4460@137253` ⇒ 按 grep 全量写清（**9 处 = 定义 + 8 调用，跨 3 个函数**），`fns` 同步补齐。 |
| `scene-frame-commit` | cross-source-mismatch P2 | **本轮修**：原 `engine.raw=136742-136966` 只覆盖 `sub_4B4040`，而 `reads` 的 `+46500/+1056/+46676` 证实行在 `sub_4B06D0`（**134417-136740**）⇒ 区间内证据为零；`0x20C` 的 handler `sub_41A1A0`（派发表 raw 23051；体 25258-25275，25271 调 `sub_4B4040`）原先既不在 `fns` 也不在区间 ⇒ `raw` 扩为 **134417-136966**、`fns` 补 `sub_41A1A0`。 |
| `scene-frame-commit:guard` | no-evidence P2 | **本轮收窄（不是把话说圆）**：该 guard（`test/draw-item-slot-coverage.test.ts`）只断言"按槽绑定比例 ≥0.95"，不覆盖"四路归并"；原 note 的「MeshEntry 黑罩」是**已作废的旧近似**（presenter.ts:208-210 自述废弃）⇒ 已删，note 改为分层：①各路自己的出画**有**守卫（DrawItem/Mesh/Live2D 三处列名）；②**跨路提交次序**（`item → text → mesh → L2D`，raw 135560-135614）**只有源码注释、没有守卫**（排序键现在写在 Pixi 合成方法里，要可测需抽到共享层）⇒ 登记为未做的守卫。 |
| `live2d-offscreen-node-lifecycle` | unclear P2 | **仍 unclear（未动）**：该 id 只出现在对抗性复核输出的 id 清单里，`.tmp/audit2/cap-1..5.json` 五份原始 findings 中无对应条目 ⇒ 缺原始记录可比对；按轮 7 的口径**不猜**，保持 unclear 并在此登记。 |

★统计口径：修完后 `capabilities.js --validate` 绿、`--recount` 后台账为
**已核验 57 / 已建模未核验 6 / 部分 32 / 缺失 19 / n/a 23**（修前 55/7/31/20/24）。
★**方法学一条**（与轮 7 同源）：本轮 8 条里有 3 条（`l2d-node-draw-gate`、`live2d-mesh-batches`、
`lazy-live2d-slot`）是"**结论对、锚点/表述错**"——正是本票认定的最危险形态：读起来毫无异常，
拿 raw 去核才发现引的是别的函数（`sub_4209B0` = jcc 是最典型的一例）。
