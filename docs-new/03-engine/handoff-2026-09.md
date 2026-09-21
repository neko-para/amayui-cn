# 03-engine · 交接文档（2026-09，**轮 8 收口后 · 可续跑**）

> 用途：**新会话直接照此续跑**。真源与纪律都在这里；详细体实证在 `audit-2026-09.md` §6，
> 批次总账在 `repair-plan-2026-09.md` §2c（历史）、§2d（轮 47+）、§2e（轮 4）、§2f（轮 5）与 **§2g（轮 6，最新）**。
> ⏸ **本次暂停点见下面的「暂停点」节**（状态 / 下一位第一件事 / 半成品清单 / 纪律提醒）。
> **唯一权威 = 引擎反编译** `engine/天结_unpacked.exe_utf8.c`。
>
> **★怎么交接（只需这一份）**：新会话的提示里给一句
> 「读 `docs-new/03-engine/handoff-2026-09.md`，按它继续推进；开工前先看 §3.0 的会话级前置」即可 ——
> 三层数据层（`analysis/*.json`）、四份台账、票据、规格文档**全在仓库里**，不需要另外搬。
> **并发/多 agent 纪律也已经进仓库了**（三个技能各有一节「★多 agent 并行纪律」）；§3.0 只留「会话级」那两条：沙箱权限 + 点名加载技能。
> ★**给子代理（subagent）派活时**：它们**会**拿到同一份技能目录与 `skill` 工具（实测），照 §3.0-3 的三种 prompt 模板交代即可。

---

## ⏸ 暂停点（2026-09 · **轮 8 结束时 · 最新 —— 先读这一节**）

**现在的状态 = 干净可续跑，但★有两条用户可见缺陷在飞（`T-0102`，都**未**关单）** —— 详见 `tickets/T-0102/changes.md`：
- **`T-0102`① 白底（未修）**：进 `SC0000` 后 ADV 窗口背景**仍是白色**（用户第二次复验确认）。本轮已修掉一个**真实但非根因**的竞态
  （`TextureCache` 异步载入的陈旧回写）；真正的下一步是**现场日志**（判据见 `tickets/T-0102/changes.md` §丙/丁）。
- **`T-0102`② 紫色（未修，但已本机复现 + 定位到引擎路径）**：用户答「**真机不紫**」⇒ 这是**模拟器的偏离**
  （上一轮"与引擎同构"的结论**已被推翻**）。复现：角色设定页跑完时**全局** `Engine[21664]` 残留 `#b690ff`（紫），
  而样例窗 win 9 仍正确；引擎的「回 ADV」重派生路径 = `src/CONFIG.txt:225-269`（详见 `changes.md` §丁）。
- **`T-0104`**：`0x82` 已**记录后放行**（不再硬停，4 条守卫 + 判别力证明），但**真语义未实现**；
  ★新发现：`0x82` 就落在上面那条「回 ADV」路径的末尾（`CONFIG.txt:269`，带 `f807b`/`f807c`）⇒ 与紫色强相关，
  实施前必须先跑 §丁-3 的判据（见 `tickets/T-0104/notes.md`）。
- 四份台账与全部生成物**已同步并复核**：`gaps --check` ✓（**已实现 38 / deferred 20 / 有据 no-op 13 / 未实现 0**）、`capabilities --validate` ✓（**136 条**，已核验 **51**；新增 `texture-bind-async-stale-writeback`）、`scripts --validate` ✓（30 条）、`tickets --validate` ✓（**104 张**，done **79**）；看板已重建。
- 最后一次全量：`npm run verify` = **921 tests / 920 pass / 1 skip / 0 fail**，死写 **0**（≈45s）。

**★下一位的第一件事（与轮 6/7 相同）**：
```bash
cd app/amayui-emulator && npm run verify        # 必须全绿（≈45s）
cd ../.. && node scripts/build-opcode-gaps.mjs --check   # 缺口台账漂移（exit 1 = 有人直接改过 JSON）
node .agents/skills/amayui-ticket-ledger/scripts/tickets.js --root . --list --open | head -30
```

**本轮已落地（三张票 done）**

| 票 | 内容 |
|---|---|
| `T-0095` | `0x1d0` 回看页索引表 + 写端 `0x70`/`0x71` + 清表 `0x85`（**纯 VM、零宿主缝**）：`textItems.ts` 加 `pages` + 双游标 + `pageAt`/`moveCursor`/`pushPage`/`clearBacklog`；`0x70` 无门 push + 组首、`0x71` 把**恒真的** `textSlotArg >= 0` 换成真门 `Engine[97055] >= 0`。缺口台账 `deferred 22 → 20`、`已实现 36 → 38`；`opcode-table` 四行重写（★订正 `0x71` 的「读 op1 文本」→ **窗口槽号**）。★**实施者回体核出规格 3 处错**，其中 D1 实质性：`0x85` **不复位游标**（引擎保留 `Font[859]/[860]`、也不清组首）⇒ 测试把这个**不对称**显式钉住，**别顺手补全**。E3 = 真 `install/CONFIG.BIN`（426 条、`0x1d0` 下标 14、实参 `local-int 5/6/7`，含「无前奏 ⇒ 合理 `-1/-1`」的诚实对照）。 |
| `T-0096` | Live2D 节点矩阵合成器 `sub_4A07F0`：**新增 `src/live2d/nodeMatrix.ts`** + `runtime`/`render`/`scL2dTick` 接线。★**真身体 raw 121131-121655**（票面旧写的 121520 是截断的）。组合式 `a3 = T(−p)·M_base·S·R·T·T(+p)`（行向量 ⇒ 最左先作用）；★**`pivot` 不是不动点**（`q0 = p` 映到 `p + t`）。18 条新守卫（含 **E3 真 TITLE 资产零回归**）。★**验证强度新高度**：用**真实第三方 `d3dx9_43.dll`** 当 oracle 逐步重放组合链（探针 `.tmp/t0096b/`），据此把三条规格「未确证项」钉成实测：`dbl_51FB50 = 1000.0`、`a2[18] = 0xFFFFFFFF`（不是 NaN）、**D3DX 内部会归一化轴**。能力台账新增 `live2d-node-matrix-compose`。 |
| `T-0100` | ★**用户实测的症状本轮修好了**：序章 `SN0000`（正文在**窗 8**）切到 `SC0000`（正文在**窗 1**）后，逐字期间点一下鼠标 ⇒ 屏中央冒出序章最后一页。**根因**：帧泵发布了「所有已知窗」而引擎只泵**当前窗**（raw 13943-13945，`489484/4 = 122371`）。三处收敛：`serviceRevealAdvanceInput` / `serviceTextReveal` / `0x70` 的 `emitAllWins → emitWin(e, win)`。4 条新守卫（含「`reveal` 确实同时含残留窗与当前窗」的**辨别力证明**）。★**禁止的修法**已写进票面：不许在场景边界 `reset`、不许清 `slots[8]`/`reveal[8]`（引擎保留游标）、不许给 `#holdFrames` 打补丁、不许用「清 DrawItem」修。 |

**★下一轮的待办（按性价比）**

0. **★★ `T-0102`（P1，用户可见，唯一两条"在飞"）——先做这个**：
   - **白底**：判据见上文「追加③」丁-A（首选：dump `globals.int.get(0x708ada)`，看 `SC0000.txt:1037-1039` 走"填灰"还是"绑图"分支）。
   - **紫色**：**已本机复现**（探针命令见丁-B），下一步 = 把 `runConfig1Chain` 扩到"右键退出 CONFIG → 回 ADV 首帧"并 dump
     `Engine[21664]`/`f807b`/`14acda`；顺手补上丁-B 写明的**缺失守卫**。★它与 `T-0104` 是同一段代码（`CONFIG.txt:269`）。
0b. **`T-0104`（P2）**：`0x82` 的**真语义**（用给定 `f807b`/`f807c` 重绘哪一页文本）。★实施前先跑上面丁-B 的判据，
   否则分不清"`14acda` 重派生算错"与"`0x82` 这一笔缺失"。**不要**在没跑判据前照推测实现（`tickets/T-0104/notes.md`）。
1. **`T-0091`（P3）G1/G2** —— 规格 + **主 agent 已独立核过的体依据**都在 `tickets/T-0091/design.md` 与 `notes.md`：**G2** = 转场表清空门（引擎 `Scene+46516 == 0`，raw 136840-136841 / 137181；emulator 只看「没有活动转场」）；**G1** = `Scene+46512` 冻结没进窗模型（`scTransitionWindow(..., false)` 硬编码在 `transition.ts:557`）。★★**动手前必读 `notes.md` 的「模块环陷阱」**：`ops.ts` 已 `import transition.ts`（`ops.ts:51`）⇒ 不能反向 import `scPoolPending`（会成环，前例 `T-0089`）；两条可行路线（注入判据 / 把 `scPoolPending` 移到中立模块）与代价都写在里面。**现在可以动了**（`T-0096` 已收工、`ops.ts` 空闲）。
2. **`T-0098`（P3）** —— `0x2ED`（`message:MessageFade` 读侧）未注册 + `0x107`/`0x10B`/`0xFE` 的位号有符号口径。★**用户裁定**：那三条越界时**在控制面板展示 + 触发硬中断**（复用 `NotImplementedOp`/`observer.onUnknown` + `session.ts` 的 `controlErrorText` 错误横幅），**不新造机制**。★其 `notes.md` 里还有主 agent 关于 **`0x308` 登记为 `engine-internal` 有据 no-op** 的提案（体证据：`USER32` 触摸窗口 + `_this[1954]` 3 写 0 读）待点头。
3. **`T-0062`（P1，唯一还卡着的用户可见票）** —— 实现早已落地、**E4 已由用户目视通过**（ADV 加载界面缩略图正确），**只差一条守卫**：`0x20C`（`frameTick`）在 `renderTargetSlot >= 0` 时的捕获路径（验收①②）。要么为它做一层可测抽取，要么如实降级 —— **别造假守卫**。
4. **`T-0099`（P3）** —— sleep 门的帧粒度残差（40ms 档每处 66.7ms vs 引擎约 50ms；同一特征也作用于 `0x6E`）。票面要求**先判定是否值得改**。
5. **`T-0101`（P3）** —— D5 默认窗双真源（`msgwin.defaultWin`=1 vs `handlers/text-items.ts` 的 `?? 0`）+ D6 `textSlotArg` 死字段。
6. 更早的开放项：`T-0082`（B2 计划层）、`T-0054`（Live2D 路线）、`T-0075`（剩余 P3 审计条）。

**★本轮新增的纪律（实测教训）**
1. **新注册/改动任何 opcode 归属 ⇒ `docs-new/03-engine/opcode-gaps.md` 必陈旧**（它内含实时注册数）⇒ 结算必须跑 `node scripts/build-opcode-gaps.mjs`。本轮两个子代理各撞红一次。
2. **跨 agent 的「共享口径」类改动要在 prompt 里预先写死**：本轮 `T-0097`③ 与 `T-0093`② 撞在同一处 `hasRefValue` 上（已收口）。
3. **★外部 DLL/工具可以当 oracle**：`T-0096` 用真实 `d3dx9_43.dll` 逐步重放，把三条「文档推断」钉成实测结论 —— 比「读反编译猜约定」强得多，值得作为 `E2+` 的常规手段（探针留 `.tmp/<job>/`，结论与判据写进票据）。
4. **规格也会错，而且错得具体**：本轮两份规格（`T-0095`/`T-0096`）各有 3+ 处被实施者回体/实测推翻（`0x85` 复位游标、`pivot` 不动点、`dbl_51FB50` 量级）⇒ **照规格做，但每条都要回体核**。
5. **守卫要有「辨别力证明」**：`T-0100` 的守卫第一条专门断言「`reveal` 里确实同时含残留窗与当前窗」，从而证明后面三条不是空断言（比「先改回旧代码跑一遍」更安全 —— 不必在共享文件上制造临时错误态）。

### ★轮 8 追加（用户实测反馈批次 —— 4 条，先读这里）

用户在轮 8 收口后给了 4 条实测反馈，处理结果如下（**动手前必读，因为其中一条是我自己引入的回归**）：

| # | 用户原话 | 处置 |
|---|---|---|
| 1 | 「ADV 的逐字渲染逻辑坏了，必须等待逐字完成后才直接展示出来」 | ✅ **已修**（`tickets/T-0100`）：**根因是我在 T-0100 改动②里连带删掉了 `for (const win of dirty) #publishReveal(win)` 那一行** ⇒ 游标在 VM 里照常走、宿主却只在 `msgWinSync` 时才重绘。★同时修掉一处**引擎建模反了**的地方：主循环 raw **21176-21181** `if ((v35 & 0x20000000) != 0) { sub_409400(_this); … }` ⇒ **节流位置位时引擎是「调文本泵」，不是「空等」**，而 `frame/loop.ts` 的 `sleep` 分支修前什么都不做（`0x196` 把它带进 6341 处 `display-furigana` ⇒ 轮 7 后症状明显）。守卫 `test/adv-reveal-under-throttle.test.ts`（2 条，**判别力已机械证明**：撤销→红、还原→绿）。 |
| 2 | 「进 SC0000 后 ADV 窗口背景是**白色**，展开/收起侧边栏菜单刷新后才变成正确的**半透明黑色**」 | 📌 已开 **`T-0102`（P1）**。★**状态见下方「追加③」——本格的推测与首轮处置都已被用户第二次复验取代**（用户答「仍然白」）。 |
| 3 | 「阿瓦罗的角色颜色变成**青色**了，预期应该是**橘色**」 | 📌 同上并入 **`T-0102`**。★**状态见「追加③」**（真机不紫/不青 ⇒ 是模拟器偏离；青色那条仍未定位）。 |
| 4 | 「SN0000 到 SC0000 的专场（章节切换动画）似乎有很多不一致…**先记录，最后再处理**」 | 📌 已开 **`T-0103`（P3）**：**只登记、明确最后再处理**。已把"取证要拆成可核对条目 + 逐条归到 `T-0091` G1/G2 / `T-0099` / `T-0102`"写进验收。 |

**★本批次新增的两条纪律**：
1. **删代码时最容易删掉的是"看起来多余的那一行"**：改动②只该改"推进谁"，却在重写那段时把**发布**一起删了 —— 症状（逐字看不见）与"推进谁"毫无关系，靠读 diff 很难发现。⇒ **改一段逻辑后，逐条对照"这段原本做几件事"**（这里是 3 件：推进、发布、更新 showing/字格）。
2. **守卫必须先证明自己有辨别力**：本批次「坑 B」的首版守卫只断言「门后还有没有新中间态」，**撤销修复后仍然绿 = 假守卫**；改成按 `waitFlags & SLEEP_GATE` 当场打点（「门还置着时必须收到过发布」）后才真正变红。⇒ 新守卫写完，**用 `.tmp/<job>/` 的脚本临时撤销修复跑一遍**（撤销→红、还原→绿、sha256 自检还原），别只信"它绿了"。

### ★轮 8 追加②（用户**复验**批次 —— 3 条；★其中一条把上一批的假设推翻了）

用户在上一批修复后复验，3 条原话与处置：

| # | 用户原话 | 处置 |
|---|---|---|
| 1 | 「ADV 界面的文字颜色似乎又**开始继承设置界面 ADV 设置中最后一行的颜色**了（**紫色**）」 | 🔬 **P1，并入 `T-0102`（判据③ 换成回归口径）**。★「**又开始**」= **回归**；历史上修过一次，修法就是**文本入队时把全局样式快照钉进窗槽**（`MsgSlot.fontStyle`，`src/vm/msgwin.ts:56-63` 的注释原话：「否则 `CONFIG2` 逐行改色会把已排好的 ADV 样例窗一起染色（用户实测的"颜色溢出"）」）⇒ **先查这条快照机制的哪一环又被绕过了**，而不是重新设计。首要嫌疑：某条清理路径把快照置回 `null`（`src/vm/msgwin.ts:695`）后光栅化**回退到当前全局样式**。 |
| 2 | 「**白色背景并没有修复**，和之前表现一致」 | 🔬 **上一批的假设被实测推翻**：`T-0102` 判据① 里那句「很可能随 `T-0100` 的发布修复一并消失」**不成立** ⇒ 按判据② 转**代码点取证**。首要嫌疑（已确证的事实）：`WinGeom.background`（窗口底色）在 `src/` 里**只有默认值 `null` 与读取点、没有任何写入点**（`grep -n "\.background" src/` 只有 `src/tools/diagText.ts:65`）⇒ 「窗底色没有被建模」与症状方向一致；仍需解释**为什么展开/收起侧边栏之后会变正确**（正确路径比错误路径多做了什么 = 唯一判决点）。 |
| 3 | 「从 ADV 进入设置界面，然后右键退出，**命中了未知指令 i082**」 | ✅ **已修（不硬停）**：`0x82` 登记进 `STUB_NATIVE_OPS`（`[0x82, op_stub_unhandled]`，先例 `0x308`）+ 新守卫 `test/op-0104-gdi-repaint-stub.test.ts`（4 条；**辨别力已机械证明**：撤表项 → 4/4 红、还原 → sha256 逐字节一致 → 4/4 绿）+ `test/opcode-operands.test.ts` 的 `ALLOW_UNDERRUN` 补条目。★**真语义（GDI 重绘口径 = 重绘哪个窗）仍未实现** ⇒ `T-0104` **保持 open**，过程文档见 `tickets/T-0104/notes.md`。 |

**★本批次新增纪律 3：用户复验是判决，不是确认。** 上一批把「很可能一并消失」写进票据并紧跟「**先复验**」是对的；但**假设一旦被复验推翻，必须当场改掉票据里的那句假设** —— 否则下一位会继续按错的前提排查（这次 `T-0102` 的判据①/② 就是按推翻后的结论重排的）。同理：**不要**把"白底"和"紫色"当成同一根因（同批同屏 ≠ 同源），各自独立取证。

**★本批次新增纪律 4：还原脚本自己也要被验证。** 本轮证明 `0x82` 守卫辨别力时，临时注释/还原脚本第一版**吃掉了行首两个空格**（`off` 把缩进并进 `  // ` 前缀，`on` 再 `slice(i+5)`）⇒ 还原后 sha256 与原值不一致。教训：**"撤销→红、还原→绿"之外，必须再核 sha256 == 原值**；不一致就说明"验证完的树"已经不是"验证前那棵树"，先修工具再继续。

**★本批次已确证/已修（白底/紫色的落点，下一位直接从这里接）**：

1. **★ADV 那块「半透明黑底」是脚本往纹理槽画的**（不是消息窗表面）：
   `src/NOVEL.txt:44-55`（ADV 包装）与 `src/SC0000.txt:1036-1047`（全库 `i20b 48` 共 183 处）——
   `create-texture 48 500 2d0 0` → `i20b 48 0 0 500 2d0 ff 808080`（填 50% 灰）→ `draw-texture 186a0 48 …`（层序 100000）。
2. **★两处争议点已用 `.lst` 定死**（订正了我方两处凭空注释）：
   - `sub_43B070` = **`ddSetColor`/`SetColorKey`**（`.lst:97104` 起，错误串 `"関数：ddSetColor エラー"` +
     尾调用 `mov eax,[ecx+74h]` = 表面 vtable+0x74，参 `8` = `DDCKEY_SRCBLT`），**不是填面**；
     填面是 `sub_43E260` = **`ddFillSurface`**（`.lst:102245` 起）。
   - `Scene+1560` = **像素格式掩码**（`sub_43B260` `.lst:97339` 写 `0x00FF0000/0x0000FF00/0x000000FF`
     到 `+1556/+1560/+1564`），**不是"窗底色缓存"** ⇒ **引擎根本没有"窗自己的底色字段"**。
   - ⇒ 已订正：`app/amayui-emulator/src/vm/msgwin.ts` 的 `WinGeom.background` 与
     `src/renderer/text/raster.ts:326` 的填面分支（两处都写明**恒 `null`、全 `src/` 无写入点、是死码**）。
3. **★本批修复（真代码改动）**：`TextureCache` 的**异步载入陈旧回写** —— 引擎 `set-texture` 是**同步**的
   （`sub_422CB0` 当场读 AGF + 解码），重写侧走 `window.api.image()` **异步** ⇒ 旧代码会在"脚本
   `create-texture` + `0x20B` 填色"之后被载入结果**无条件覆盖**，表现正是**"脚本再跑一次（开合侧边栏）才对"**。
   修法 = 新增**槽表面世代** `#slotEpoch`（`create`/`release` 各 +1）+ 绑定未变双判据；
   守卫 `test/texture-bind-race.test.ts`（5 条，**判别力已机械证明**：撤销 → ②③④ 红，还原 → 5/5 绿 +
   sha256 逐字节一致）。★**证据强度 = 中**：机制确证、且是唯一能解释"刷新才对"的已知竞态，
   但"用户那次白底就是它"**未**由 E4 确认 ⇒ `T-0102` **不关单**。
4. **紫色 = 模拟器与引擎同构**（本批**故意不改**代码）—— ★★**本条已被下方「追加③」推翻**（用户答「真机正常（不紫）」）：
   保留原文只为留下排查轨迹，**不要**据它下结论。真正的偏离点见「追加③」第 2 条与 `tickets/T-0102/changes.md` §丁。
   以下是当时的取证（仍然有效的部分：载体是**全局字段** `f807b`（`i076` → `0x76` →
   `Engine[21664]`，raw 28669/28680），逐窗/逐对象色 `0x25E`/`0x25F` 全库 **0** 次。
   唯一会留紫的脚本点 = **角色设定页**（`12721e==4` → `CONFIG2`；`src/CONFIG2.txt:1316-1323` →
   `1652-1687`：`f807b = adcd[14acda]`，`a9dd & 2` 门控；**每帧跑** ⇒ 退出时停在最后可见行的角色色）；
   「ADV 設定」页本身用**立即数** `i076 ffffff`（`CONFIG1`）**不留紫**。
   紫色活到 ADV 的路 = 返回包装 `src/SN0000.txt:3235-3258` 只**重发** `i076 (global f807b)`，
   而 `SN0000` 全脚本 **0 处 `adcd`**、0 处 `mov f807b ffffff` ⇒ 旁白直接继承；
   `SC*`/`SG*`/`SP*` 每页重派生（`SC0000` 426 页 = 426 次）⇒ **不继承**。
   **已排除**三条嫌疑（这三条排除**仍然成立**）：`src/vm/msgwin.ts:695` 的 `fontStyle = null`
   （同函数已清 segments，入队必 `captureFontStyle`）、渲染侧回头读全局（只消费发布的 `TextFrame.style`）、
   本批发布路径（`emitWin` 仍取快照且 dirty 只含当前窗）。
   唯一判决点 = `app/amayui-emulator/src/vm/handlers/msgwin.ts:143`。）
5. **已排除**的候选：「纯白 = 缺纹理的 1×1 白占位块」不成立 ——
   `src/renderer/pixi/presenter.ts:474-479` 的 `#placeholder()` 现在按 **layer 派生 tint**
   (`(layer*47 % 360) << 8 | 0x6a`)，缺图是带绿调的块、不是纯白。

### ★轮 8 追加③（用户**第二次**复验：白底仍未修 / 真机不紫）—— ★**上面的第 4 条结论被推翻**

用户回答：白底「**仍然白**」、紫色「**真机正常（不紫）**」。⇒ 两条都变成**在飞的活**（`T-0102` **不关单**）。
★**本节的"下一位怎么接"是可直接执行的**：

#### 丁-A 白底（仍未修）

- 本轮修的**不是**根因：`TextureCache` 异步载入陈旧回写（甲-3/第 3 条）是**真实缺陷、但不是那次白底的原因**
  （用户复验"仍然白"）⇒ 修复保留（有守卫），但**白底继续开**。
- **下一步判据（二选一，都很省事）**：
  1. **现场日志**：`.tmp/amayui-emulator.log` 里 `SC0000` 进场那几帧的
     `fillSlotRect slot=48` / `bind slot 48 <-` / `回写丢弃`，以及有没有 `set-texture … 48`。
  2. **分支判定（无需 GUI）**：`src/SC0000.txt:1037-1039`（ADV 包装同型见 `src/NOVEL.txt:45-47`）是按
     **全局 `708ada`** 分岔的：`708ada == -1` ⇒ 走 `label_00003a88` = **建面 + 填 50% 灰**（正确观感）；
     否则 ⇒ `set-texture (global 708ada) 48` = **绑一张图**（白底的可疑来源）。
     ★而 **`708ada` 在全语料 0 处写入**（183 个文件只读它）⇒ **它在模拟器里读到什么值，决定了走哪条路**。
     ⇒ 先用探针 dump `globals.int.get(0x708ada)`（或直接看日志里有没有 `bind slot 48 <-`）。

#### 丁-B 紫色（已本机复现 + 已定位引擎路径）

**复现命令**（不改产品代码，仓库根执行；探针在 `.tmp/`，不属于交付物）：
```bash
cd app/amayui-emulator
node --env-file=test/options.test.env --import tsx ../../.tmp/t0102/probe-config-style.ts
# 关键输出：★离开时全局色（最后一帧）: #b690ff   （= 紫），而 win9 仍是 #ffffff
```

结论（`tickets/T-0102/changes.md` §丁 有全文）：

- **历史修复只钉住了样例窗**（win 9 的颜色不被逐行设色回溯），**没钉住"全局 `Engine[21664]` 被留在紫"**。
- 引擎的「回 ADV」重派生路径 = **`src/CONFIG.txt:225-269`**：按当前消息号 `3f37` **重派生** `14acda`
  （旁白 ⇒ 0；否则查 `52a49c`/`14b0c4` 表）→ `call label_00001ae8`（`CONFIG.txt:372-407`：
  重算 `f807b/f807c`，`:377-379` 有 **`adcd[14acda] <= 0` 就保持白**的守卫，`:403-404` 用 `i076/i077` **应用**）
  → `i071 2` → `call label_00001d38` → **`:269` 的 `i082`**。
  ★**`:269` 就是用户报的未知指令 `i082`** ⇒ `T-0104` 与紫色是**同一段代码**（见 `tickets/T-0104/notes.md`）。
- **下一步（判据已写死在 `T-0102/changes.md` §丁-3）**：把 `runConfig1Chain` 扩到"**右键退出 CONFIG → 回 ADV 首帧**"，
  dump `Engine[21664]`/`f807b`/`14acda`，以区分：
  - 候选 1（更可能）：`14acda` 的**重派生算错**（`52a49c`/`14b0c4` 两张表或 `3f37` 与引擎不同）⇒ 旁白被算成某角色 ⇒ 紫；
  - 候选 2：这条路径**没跑到**／`i082` 那一笔的效果缺失（= `T-0104` 的真语义）。
- **新增的守卫缺口（明确记下，本票核心判据）**：现有 E3 守卫（`test/text-style-snapshot.test.ts:140-169`）
  只断言"角色页期间 win 9 的颜色不变"；**必须再补一条**："走过 `CONFIG.txt:225-269` 之后，
  `Engine[21664]` == 按当前消息重派生的颜色（旁白 = `#ffffff`）"。

#### 丁-C 本批次新增的两条纪律

5. **"未定死"必须显式留成待办，而不是写成结论**：本轮我先挖到 `sub_43B070` 时手上只有能力台账那句订正 +
   一处 raw 调用点，当时在 handoff 里写的是「★其真语义未定死，需用 `.lst` 复核」—— 正因如此，随后的只读取证
   才能直接把答案钉死（`ddSetColor`/SetColorKey + 掩码），而没被我的半成品结论带偏。
6. **"脚本再跑一次就对"是一个可判定特征**：白底那句「展开/收起侧边栏就正确了」不是冗余信息 ——
   它把候选从"某处**没画**"收敛到"**后画的被先发起的异步操作覆盖**"（因为重跑会把表面抢回来）。
   ⇒ 以后遇到"刷新一下才对 / 切换一下就正常"的症状，**先找覆盖，再找缺失**。
   ★但也要记住本轮的教训：这条特征给出的机制（异步回写）**确实存在**，却**不是**用户那次的原因 ——
   **机制成立 ≠ 就是它**，结论必须由 E4 收口。

#### 丁-D 本批次（追加①②③）动过的文件与验证口径

| 类别 | 文件 | 说明 |
|---|---|---|
| 修复（真代码） | `app/amayui-emulator/src/renderer/pixi/textureCache.ts` | 新增槽表面世代 `#slotEpoch`（`create`/`release` 各 +1）+ `bind` 回写双判据；抽出 `protected decodeImage` 只为可测 |
| 守卫（新） | `test/texture-bind-race.test.ts`（5 条）、`test/op-0104-gdi-repaint-stub.test.ts`（4 条） | 两条修复/处置的判别力都**机械证明过**（撤销→红、还原→绿、**sha256 == 原值**） |
| 守卫（改） | `test/harness.ts`（`mkEngine` 加可选 `native`）、`test/opcode-operands.test.ts`（`ALLOW_UNDERRUN` 补 `0x82`） | — |
| 实现/表 | `src/vm/handlers/stubs.ts`（`[0x82, op_stub_unhandled]` + 体证据注释） | 真语义仍未做，见 `T-0104` |
| 注释订正 | `src/vm/msgwin.ts`（`WinGeom.background`）、`src/renderer/text/raster.ts`（填面分支） | 两处凭空点，按 `.lst` 结论订正 |
| 台账 | `analysis/engine-capabilities.json`（+`texture-bind-async-stale-writeback`，共 136 条）、`analysis/opcode-gaps.json`（`0x82` 处置重写） | 生成物已重建 |
| 票据 | `tickets/T-0102/changes.md`（甲/乙/丙/丁 全文）、`tickets/T-0104/notes.md`、`tickets/T-0075/notes.md`（一处文档矛盾已定案） | — |
| 探针（非交付物） | `.tmp/t0102/probe-config-style.ts`、`.tmp/t0102/revert-bind-guard.mjs`、`.tmp/t0104/revert-check.mjs` | 在 `.tmp/`，可随时重跑 |

**验证口径**：`npm run verify` = **921 tests / 920 pass / 1 skip / 0 fail**、死写 **0**；
四份台账 `--validate` 全绿（capabilities 136 / scripts 30 / gaps `--check` ✓ / tickets 104）；
生成物（`tickets/README.md`、`docs-new/03-engine/opcode-gaps.md`、能力报表）均已重建。

---

> ↓↓↓ 以下为**轮 7** 的暂停点，保留作历史（已被上面这一节取代）↓↓↓

## ⏸ 暂停点（2026-09 · **轮 7 结束时 · 最新 —— 先读这一节**）

**现在的状态 = 干净可续跑，没有任何"在飞"的写操作**：
- **7 个子代理（4×IMPLEMENTATION + 3×ANALYSIS-ONLY）全部收工**，结论已由 owner 合并进台账/票据/文档。本轮的大宗产出是**四份现成规格**（全文已归档，不在 `.tmp/`）：
  `tickets/T-0095/design.md`（`0x1d0` 回看页索引表，40KB）、`tickets/T-0096/design.md`（Live2D 节点矩阵合成器，43KB）、`tickets/T-0091/design.md`（Scene 三标志 `+46508/+46512/+46516`，47KB）、以及 `tickets/T-0097/raw-evidence.md` + `tickets/T-0092/raw-evidence.md`。
- 四份台账与全部生成物**已同步并复核**：`gaps --check` ✓（**已实现 36 / deferred 22 / 有据 no-op 13 / 未实现 0**）、`capabilities --validate` ✓（134 条）、`scripts --validate` ✓（30 条）、`tickets --validate` ✓（**98 张**，done 76）；看板 `tickets/README.md` 已重建。
- 最后一次全量：`npm run verify` = **873 tests / 872 pass / 1 skip / 0 fail**，死写 **0**。（skip 1 = 本机缺某样东西；`danger-full-access` 下不再有 `spawn EPERM`。）

**★下一位的第一件事（复制即用，与轮 6 相同）**：
```bash
cd app/amayui-emulator && npm run verify        # 必须全绿（≈50s）
cd ../.. && node scripts/build-opcode-gaps.mjs --check   # 缺口台账漂移（exit 1 = 有人直接改过 JSON）
node .agents/skills/amayui-ticket-ledger/scripts/tickets.js --root . --list --open | head -30
```

**本轮已落地（四张票全部 done）**：
| 票 | 内容 |
|---|---|
| `T-0093`② | `0x147`/`0x2f2` 纯几何命中 → **新增 `src/vm/handlers/region-hittest.ts`** + 注册进 `OPS`；缺口台账 `deferred 24 → 22`、`已实现 34 → 36`。★**推翻筛体**「op4/op5 顺带写回」（源数组**只读**，唯一写回是 op1）；★由**全库仅有的两个调用点**（`CONFIGCV.txt:380`、`REIGN.txt:550`）反证 op4/op5 是**池中连续槽的起始**（`sub_42AEA0` = operandAddress）。 |
| `T-0094` | `0x196` 第①②路的 MessageSpeed 节流半边（**6341 处**语料）：`op_display_furigana` 装 `SLEEP_GATE` + `sleepUntil`（复用 `0x6E` 同机制，未新造）。**实测可观测**：真 `install/CONFIG1.BIN` 的 `0x71→0x196→0x6E`，`MessageSpeed=40` ⇒ **66.7ms/处**、`=0` ⇒ **0ms**。棘轮已翻正向。 |
| `T-0097` | P2/P3 定点小修批：① `0x2EE` 字段 + `SetConfig(message:MessageFade)` **双写**；② `0x141`/`0x135` 的 **unsigned** 口径（同形订正 `0x136`/`0x13F`）；③ **operand 缺槽读 `enc_zero` ⇒ 0 的全局口径**统一到 `ref.ts` 的 `decIntSlot`（删掉 `0x12E` 的本地 `hasRefValue` 绕法；`hasRefValue` 只剩 `0x2C9` 写侧）；④ `Engine/0x408` scope 复核（见下）。 |
| `T-0092` | `0x02 exit` 的 `-11` 分支不再误抛 `ExitScript`（写 `callRet=-1` → 两次 `GetConfig` → 按 `sub_40F750` 分派；无记录 ⇒ 不动作）。★**订正审计 `op-2-10`**：「读配置并写回」是 Hex-Rays **误渲染**，权威是 `.lst:0041A85A-0041A88B`（两次 `[vtable+4]` = 单参 GetConfig **只读**；写侧 `[vtable+12]` 未被调用）。 |

**★下一轮的现成弹药（按性价比）**：
1. **`T-0095`（P2）—— 判定「现在就能做、纯 VM、零宿主缝」**：`0x1d0` 回看页索引表 + 写端 `0x70`/`0x71` + 清表 `0x85`。规格含落地文件清单（`vm/textItems.ts` 加 `pages`/双游标、`handlers/text-items.ts` 加 `0x1d0`/`0x85`、`msgwin.ts` 的 push+组首、`advState.ts` 快照）、11 条守卫断言、E3 载体（`install/CONFIG.BIN` 实测：426 条、含 `0x1d0`×1）。★连带修三处既有缺陷：`0x71` 的 SetTB 门在 emulator **恒真**（`m.textSlotArg` 从未赋值）、`0x70` 缺 push+组首、`0x85` 的 gaps 理由错（它纯 VM 可实现）。★另一条文档订正：`opcode-table.md` 把 `0x71` 的 op1 写成「文本」是**错的**（实为**消息窗槽号**）。
2. **`T-0096`（P2）**：Live2D 节点矩阵合成器 `sub_4A07F0`。★**票面体区间被截断** —— 真身 = raw **121131-121655**（票面 121520；被截掉的是第 4 个窗（平移）+ 最终 6 次 `D3DXMatrixMultiply` 的组合序与 `T(+pivot)`）。组合式 = `a3·T(−p)·M_base·S·R·T·T(+p)`（右乘，行向量）；落点 `scL2dTick` + `l2dNodeTransform → Affine`（注意转置）；**无宿主缝**。颜色窗有体但**无消费者**（唯一调用者 raw 134347 丢弃输出）⇒ 不设验收。
3. **`T-0091`③（P3）**：Scene 三标志已钉死（scope 155 点全是 Scene、精确计数、与转场主链的交汇）+ **两条真缺口 G1/G2**（`46512` 冻结没传进窗模型；转场表清空门应为「全场景 `46516 == 0`」）。改法与守卫都在 `design.md` §5.3。
4. **`T-0098`（P3，本轮新开）**：`0x2ED`（MessageFade 读侧）未注册 + `0x107`/`0x10B`/`0xFE` 的位号有符号口径（★这三条引擎是**真抛**，别照抄 `0x135` 的 `c.log` 做法）。

**半成品 / 明确未做（别当已完成）**：
- `T-0095`/`T-0096`/`T-0091`③ **只有规格、没有实现**；`T-0098` 只有票。
- `T-0082` B2 计划层、`T-0062`（P1，实现已落地、**卡在 E4 目视**）、`T-0054` Live2D 路线、`T-0075` 剩余 P3 审计条。
- `deferred` **22 条**（语料见缺口台账）**仍会硬停**；「有据 no-op 13 条」的 3D 效果本身没做。

**★两条纪律提醒（本轮实测新增）**：
1. **新注册任何 opcode 都会让 `docs-new/03-engine/opcode-gaps.md` 陈旧**（md 内含实时注册数）⇒ 加了 handler **必须**跑 `node scripts/build-opcode-gaps.mjs`。本轮两个子代理各撞红一次（均已自愈）。
2. **并行子代理会撞同一份「共享口径」**：本轮 `T-0097`③（读口径统一到 `decIntSlot`）与 `T-0093`②（新建 `region-hittest.ts`）就同一处 `hasRefValue` 走法相撞 —— 后者先照抄了旧绕法、前者就地收口成 `readRef` 别名。**启示：跨 agent 的「口径」类改动应在 prompt 里预先写死**（本轮靠事后收口，侥幸一致）。
3. **交接/规格文档一律归档进 `tickets/<id>/`，不许落在 `.tmp/`**（`.tmp/` 是 gitignore 的临时区，不是证据落点）。

---

> ↓↓↓ 以下为**轮 6** 的暂停点，保留作历史（已被上面这一节取代）↓↓↓

## ⏸ 暂停点（2026-09 · 轮 6 结束时；**用户要求暂停任务**）

**现在的状态 = 干净可续跑，没有任何"在飞"的写操作**：
- 三个子代理（2×IMPLEMENTATION + 1×ANALYSIS-ONLY）**全部已收工**，它们的结论已由 owner 合并进台账/票据/文档；临时工作记录（`.tmp/triage`、`.tmp/t77`）里**有价值的两份已归档进票据目录**：
  `tickets/T-0093/deferred-triage-report.md`（deferred + P2/P3 分诊全文）与 `tickets/T-0077/l2d-and-hover-report.md`（Live2D 节点族 + `0x12E` 的体实证）。
- 工作树**未提交**（本工程纪律：**不做 git 提交**，只写文件）：**52 个文件 = 36 改 + 16 新增**；无 `*.tmpdir` 残留（`edit`/`write` 都落盘了）。
- 四份台账与全部生成物**已同步、刚复核过**：`gaps --check` ✓（deferred **24** = 284 处语料）、`capabilities --validate` ✓（134 条）、`scripts --validate` ✓（30 条）、`tickets --validate` ✓（97 张）、看板守卫 `test/ticket-ledger.test.ts` 5/5 ✓。
- 最后一次全量：`npm run verify` = **837 tests / 825 pass / 12 skip / 0 fail**，死写 **0**。

**★下一位的第一件事（复制即用）**：
```bash
cd app/amayui-emulator && npm run verify        # 必须全绿（≈40s；若全红且错在 spawn EPERM 先看 §3.0-1）
cd ../.. && node scripts/build-opcode-gaps.mjs --check   # 缺口台账漂移（exit 1 = 有人直接改过 JSON）
node .agents/skills/amayui-ticket-ledger/scripts/tickets.js --root . --list --open | head -30
```

**本轮已落地**（细节 §6.7 与 `repair-plan-2026-09.md` §2g）：`T-0077`/`T-0076`/`T-0084` 三票 done；
B7 P2 首批 4 条（`0x6E`/`0x1A8`·`0xAF`/`0x20A`/`0x196`）；**`T-0093` 第①半**（SETWEATHER 族 5 条 ⇒ 不再硬停）；
deferred 全量分诊（口径订正 + 29 条重排）；缺口台账 deferred 28 → 24、有据 no-op 8 → 13。

**半成品 / 明确未做（别当已完成）**：
1. **`T-0093` 保持 `doing`**：第①半（SETWEATHER 5 条）已 done 并带守卫；**第②半 `0x147`/`0x2f2` 纯几何命中测试未做**（`CreatePolygonRgn`/`CreateEllipticRgnIndirect` + `PtInRegion` → op1，零宿主缝，各 1 处语料）。
2. **`T-0094`（P1）**：`0x196` 第①②路的 `effect_flags |= 0x20000000` + `sub_453A60` 节拍半边**未建模**（语料 **6341 处** `display-furigana`；现由 `test/op-3-004-furigana-outer-gate.test.ts` 的「缺口棘轮」钉住，补上即改成正向断言）。
3. **`T-0091`**：转场类别 3 的精确核、`[4]` 非 `create-texture` 槽、`Scene+46508·46512·46516` 三标志本身、**E4 像素级可达路径**（`SN0000` 的 `i250` 在 line 3036 之后）。
4. **`T-0092`**：`0x02` 的 `-11` 分支无记录 0 时 emulator 抛 `ExitScript`，引擎**不退出**（审计 `op-2-10`）。
5. **待人工决策**：`T-0088`（无 GUI 时 AGERC cmd 8 返回什么的产品策略）。
6. **未收敛的读法**：`T-0041`（blend state「泄漏」与真机可见行为矛盾）、`T-0054` Live2D 的矩阵合成器（`T-0096`）。

**两条纪律提醒（本轮踩过的）**：
- **语料计数口径**：台账 `mnemonic` 不补零而 `src/*.txt` 是 `i` + 三位（`i28` vs `i028`）⇒ 自己 grep 时两种写法都要数（否则漏 9 条约 70 处）。
- **「语料 0 处」只对助记符字面量成立**：`0x196` 就是反例（`i196` = 0，但 `display-furigana` = 6341 处）⇒ 判定重要性前先按 `opcodes.json` 的 `name`/`aliases` 一起查。

---

## 0. 一句话目标

按 `docs-new/03-engine/repair-plan-2026-09.md` 的批次（B0…B7）推进 emulator 修复：
**每次只按引擎 raw 证据改 → 带守卫测试 → 同步 opcode-table/三层台账/票据 → `npm run verify` 全绿收口。**

**★本轮（轮 6）的里程碑：B4 收口（`T-0077` done）+ P0 `T-0076` done + P2 `T-0084` done + B7 首批（`0x6E`/`0x1A8`·`0xAF`/`0x20A`/`0x196`）+ deferred 全量分诊** ——
`ALLOW_UNDERRUN` 里最后一条「确认是 bug」清零（`0x12E` 按体重写）、Live2D 节点族 7 条按体订正（★`0x348` 是**轴角旋转不是缩放**；真语料 `i34d` 12 处此前 delay/dur 与平移分量整体错位）、`0x306` 的引擎内建默认订正为 **0**（raw 111578-111579）。细节 §6.7 与 `repair-plan-2026-09.md` §2g。
（上一段里程碑：轮 5/6 的读档画面 = 「存档那一屏」，宿主缝 `native.restoreDrawItems` ⇒ `T-0083`/`T-0066`/`T-0072`/`T-0074`/`T-0090` 全 done，见 §6.6/§7。）

> ⚠ **这不是"都实现了"** —— `deferred`（**24 条 = 284 处语料**）**都不在任何注册表里** ⇒ 其语义**不会被执行**
> （严格模式命中即抛 `NotImplementedOp`；诊断模式跳过并计入"被跳过的未实现 opcode"）。
> `implemented` 与 `deferred` 的差别只是"已经从『没人看过』变成『看过、读过体、写清了扩展点』"；
> 另有 **13 条**是 `engine-internal` 的**有据 no-op**（含本轮新登记的 SETWEATHER 族 5 条 —— 它们**不再硬停**，但 3D 效果本身没做）。
> **★残留规模（按语料实测，轮 6 分诊后）：24 条 = 284 处调用点**，最大四档 `0x140`(181, ★全在 DEBUG 路径) / `0x28`(32) / `0x86`(16) / `0x222`(10)。
> **下一步的重点 = 让这些 `deferred` 从"语义不执行"变成"有模型"**（见 §5）。

## 1. 当前状态（可直接复核，勿凭记忆）

| 项 | 值 | 复核命令 |
|---|---|---|
| 测试 | **921 tests / 920 pass / 1 skip / 0 fail**（轮 7→8 由 873 起步，新增守卫文件：0x147/0x2f2、0x196、0x2ee/0x141·0x135、缺槽口径、0x02、0x1d0 回看页、Live2D 合成器、0x0100 reveal 当前窗、★`0x82` 放行 = `test/op-0104-gdi-repaint-stub.test.ts` 4 条、★轮 8 追加批 = `test/texture-bind-race.test.ts` 5 条；skip 1 = 本机缺某样东西） | `cd app/amayui-emulator && npm run verify`（≈43s，含 typecheck + 死写检测） |
| 死写 | **0** | 同上（`check:dead-writes` 扫 `Item`/`MeshObj` 字段） |
| 缺口台账 | **未实现 0（语料 0）/ unjustified no-op 0 / 有据 no-op 13 / 已实现 38 / deferred 20**（共 71 条；轮 5 新增 `0x24D`、轮 6 新增 `0x337`，两者语料均 0 处）★「未实现 0」= 语料用到的零注册指令**已全部定性**（不再有"没人看过"的）；`deferred` **24** 条（**284 处语料**；轮 5 新增的 `0x24D` 与轮 6 新增的 `0x337` 都是语料 0 处）**仍会硬停** | `node scripts/build-opcode-gaps.mjs`（写模式）／`--check`（CI 口径，exit 1 即漂移） |
| 能力台账（第二层） | **136 条**：已核验 **51** / 已建模未核验 7 / 部分 **33** / 缺失 21 / n/a 24（轮 6：`clock-read-transition-window` 由 `partial/E2` → **`modeled-verified/E3`**；`frame-render-gate-mainloop` 补 ADV-before-sleep 的体依据；★轮 8 追加批新增 `texture-bind-async-stale-writeback`） | `node .agents/skills/amayui-engine-analysis/scripts/capabilities.js --root . --validate` |
| 票据 | **104 张**（doing 3 / open 21 / done 79 / dropped 1）★轮 8 收口 `T-0095`（回看页）/`T-0096`（Live2D 矩阵合成器）/`T-0100`（SN0000 文字残留，★用户实测症状已修）+ `T-0104` 的**处置面**（`0x82` 不再硬停，真语义仍未做 ⇒ 保持 open）；新增 `T-0099`（sleep 门帧粒度）/`T-0100`/`T-0101`（默认窗双真源 + 死字段）/`T-0102`（★P1：ADV 白底 + 角色名青色 + **紫色回归**）/`T-0103`（转场不一致，最后再处理）/`T-0104`（`0x82` GDI 重绘口径） | `.agents/skills/amayui-ticket-ledger/scripts/tickets.js --root . --validate` + `node scripts/build-tickets.mjs` |
| 批次 | **B0 ✅ B1 ✅ B2 两步（剩计划层）B3 ✅（缺口清零）B4 ✅（轮 6 收口，剩 Live2D 矩阵合成器 ⇒ `T-0096`）B5 (A)(B)(C) ✅ + 轮 5/6 读档画面收口（`restoreDrawItems`）✅ B6 ✅ B7 进行中（轮 8：`T-0095`/`T-0096`/`T-0100` 三票 done；`deferred 22 → 20`、`已实现 36 → 38`；★T-0096 用真实 `d3dx9_43.dll` 当 oracle 验证坐标约定）**；**轮 5（2026-09）：`T-0084` 转场渲染**——窗口模型 + 12 种条带几何 + 类别 0/2 的**离屏槽**合成已落地（缺口台账/能力台账计数不变；详见 `repair-plan-2026-09.md` §2f） | `repair-plan-2026-09.md` §2d / §2f |

## 2. 真源与生成物（**生成物一律手改禁止**）

| 真源（可改） | 生成物（改真源后重建） | 守卫（红了就是漂移） |
|---|---|---|
| `docs-new/03-engine/opcode-table.md` | `scripts/asm/opcodes.json`（`scripts/asm/build-opcodes.js`） | `app/amayui-emulator/test/opcode-arity.test.ts`（从体解析长度槽 `N=2*argc+1` 对照 574 条） |
| `analysis/opcode-gaps.json` | `docs-new/03-engine/opcode-gaps.md`（`scripts/build-opcode-gaps.mjs`） | `test/opcode-gaps.test.ts`（3 条：生成物最新 / 处置与注册表一致 / 量级不缩水） |
| `tickets/T-00NN/ticket.json` | `tickets/README.md`（`scripts/build-tickets.mjs`） | `test/ticket-ledger.test.ts`（**证据锚点棘轮**：anchor 消失即红） |
| `analysis/functions.json`·`fields.json`·`engine-capabilities.json`·`scripts.json` | `docs-new/03-engine/engine-capabilities.md`、`docs-new/05-scripts/*` | `capabilities.js --validate` / `scripts.js --validate` / `test/capability-ledger.test.ts`、`test/script-ledger.test.ts` |
| 实现 | — | `test/opcode-operands.test.ts`（操作数口径 + `ALLOW_UNDERRUN` 白名单棘轮） |

## 3. 起手命令（复制即用）

### 3.0 ★开工前置（**会话级，不在仓库里，必须口头交代或确认**）

1. **沙箱必须允许子进程管道**：本工程的 `npm run verify` 走 `node --test`，它会**为每个测试文件 spawn 子进程并捕获管道 stdio**。
   在受限沙箱下这会被拦成 `spawn EPERM`（表现为**每个测试文件都红**、错误栈是 `child_process.spawn`）——
   **那不是测试失败，是沙箱**。本会话实测：必须给到 `danger-full-access` 才能跑 `npm run verify`。
   ⇒ 新会话若一上来 `verify` 全红且错在 `spawn EPERM`，先解决权限，**不要**去改测试。
   （临时绕法：单文件直接用 `node --env-file=test/options.test.env --import tsx test/xxx.test.ts` 跑在进程内，不起子进程。）
2. **加载技能**：本仓库的技能是**按需加载**的（`.agents/skills/*`）。开工时在提示里点名它们，否则新会话不会读到纪律
   （★**子代理不点名也会拿到同一份目录**：目录注入挂在 `agent/pre-step`、对每个 agent 各发一次 —— 实测子代理报告里列出了全部 8 个技能并真的加载了其中几个；
   但**正文改动不触发重新注入** ⇒ 技能刚改过时要提醒它「重新 `skill` 一次」）：
   `amayui-engine-analysis`（三层数据层 + 缺口/能力台账）、`amayui-script-analysis`（脚本台账流程）、
   `amayui-ticket-ledger`（票据台账）、`amayui-script-translate` / `amayui-script-update`（翻译相关）、
   `batch-task-runner`（批量）、`amayui-ui-text-render`（UI 图片文字）、`amayui-mnemonic-rename`（助记符改名）。
3. **并发写纪律 → 已进仓库**：见三个技能的「★多 agent 并行纪律」节（单写者表 / 三种子代理 prompt 模板 / 锚点 ABI / validate 红分类 / 共享资源串行化）。
   工具侧已加固：**`--set-json`**（值里带 ASCII 逗号时不再被拆成数组）、**`--recount`**（直接改过 JSON 后修 `counts`）、
   **`--anchors-in <file>`**（改文件前查「谁锚在这」）；三工具写入已是**原子写**（tmp+rename），`--validate` 改为**比磁盘上的 `counts`**（此前比刚重算的副本 ⇒ 陈旧查不出来）。
   仍然成立的两条人肉纪律：**对既有共享文件只用 `edit` 定点替换、不用 `write` 整文件重写**；**`npm run shot` / `verify` 同一时刻只跑一个**
   （`shot` 会覆盖同一个 `.tmp/amayui-emulator.log`，而它是证据源）。
4. **环境要自己构造**（2026-09 系统变更后：本机**没有真游戏安装**）：读档链 E4 用的 079 存档不在默认
   overlay 里，样本在仓库 `cache/`（`SAVE79.DAT`/`SAVE79.STH`）⇒ **按 `cache/README.md` 复制到
   `<repo>/.tmp/appdata/Eushully/天結いキャッスルマイスター.overlay/SAVE/` 并把 mtime 拨回
   头里的存档时间**。★**不要**为了跑那几个 `SAVE00.*` 用例把 079 改名成 00、也不要自造
   `base/SYS4REG.INI`/`base/SAVE/SAVE.DAT` —— 实测那样做会让 `config-version-substr` 与
   `engine-config` 红在**与环境有关、与实现无关**的地方（细节与理由见 `cache/README.md`）。

```bash
# ① 基线（必须全绿）
cd app/amayui-emulator && npm run verify
# ② 台账现状（写模式会顺带回填 counts；--check 是 CI 口径）
cd ../.. && node scripts/build-opcode-gaps.mjs
node scripts/build-opcode-gaps.mjs --check
# ③ 定位任一引擎函数的体（★先 grep 定义头，别猜位置）
#    Select-String -Path engine\天结_unpacked.exe_utf8.c -Pattern '//----- \(0042E8A0\)'
# ④ 真实界面回归（E4）：读档链
cd app/amayui-emulator && npm run shot -- --load 79 --name mycase --page 870,900
#    → 产物 .tmp/mycase-*.png + 日志 .tmp/amayui-emulator.log；GUI 改动需 npm run build:electron（`npm run shot` 已含）
```

## 4. 纪律（本段踩过的坑，**全部是实测教训**）

1. **只按引擎证据改**：改动注释必须给 raw 行号 + 体内真实分支；没有依据的"看起来能跑"的补丁不做。
2. **不静默跳过**：任何不实现/近似都要在 `analysis/opcode-gaps.json` 有一条（`unimplemented`/`deferred`/`engine-internal`/`implemented`）并写理由。**宁可有据 `deferred`，也不要造假实现。**
3. **★筛体/规格文档里的推断只是线索，不是结论**：本轮 13 处推断被逐行读体推翻，其中 **2 处是"归口对象整条错"**（`0x1c4` 被当成"场景层是否已挂项"，实为**语音总线占线查询**；`0x1d0`/`0x1d1` 被当成"GDI 文本度量族"）。**凡采纳前必须读体**。订正要写回文档（本轮落在 `b3-screening-2026-09.md` §6）。
4. **区分"死读"与"漏读"**：`0x1d3`/`0x1d4`/`0x2f3` 的操作数在引擎里**也是**死读（形参在全函数体不出现）⇒ 这不是 bug，写进白名单的"有据豁免"而不是硬补。
5. **不静默跳过 → 也不许用工具悄悄放过**：`--set emulator.note=a, b` 会把值按 ASCII 逗号拆成**数组**；`capabilities.js --validate` 与守卫测试口径现已对齐（都报"必须是字符串"）。**JSON note 里引用短语用「」，不要用裸 ASCII 引号**（会截断字符串）。
6. **手写的"统计量"必然漂移**：`counts` 曾是手写 ⇒ 实测漂移过一次（声明 `deferred 25/unimplemented 6` vs 实际 `31/0`）且无人发现。现在由 `build-opcode-gaps.mjs` 重算回填，`--check` 漂移即 exit 1。**凡是"由工具维护"的字段，就别手写。**
7. **`--check` 必须真的失败**：早前 `gaps:check` 只打印 ✗ 仍 `exit 0`（假"通过"）。已修。
8. **编辑文件一律用 `edit`/`write` 工具**；不要用 PowerShell `Set-Content`/双引号字符串（会吞反引号、写出 NUL）。**对既有共享文件只用 `edit` 定点替换，不要 `write` 整文件**（并发会丢更新）。
9. **定位引擎函数先 grep `//----- (004xxxxx)` 定义头**（按邻近常量猜位置已实测读错函数）。
10. **判定台账内文看 JSON 原文**，不要看渲染后的 md（md 呈现会截断）。
11. **每批出口判据**：守卫测试 + 文档同步（opcode-table / 三层台账 / 审计 §6 / 修复计划 §2d / 票据）+ `npm run verify` 全绿。
12. **新增 opcode 的四件套**：raw 行号注释 → `opcode-table.md` 行 → 台账 disposition（+ 重建生成物）→ 守卫测试。
13. **写字段前先确认有消费端**：往 `Item`/`MeshObj` 加"只写不读"的字段会被 `check:dead-writes` 拦。**也别往"引擎没有的合成级"硬接**（Scene 级变换就是卡在这里 ⇒ 归 `deferred`）。
14. **改宿主行为两宿主对称**：`headlessScene.ts`（测试/报告）与 `pixiBackend.ts`（GUI）都要改；新缝按先例五处同步（`native.ts` + headless + pixi + `stubNative.ts` + `nativeTap` 白名单）。
15. **★会话被打断（休眠/中断）后，先验证"最后一次编辑真的落盘了"**：`edit`/`write` 走的是"临时目录 + 原子改名"，
    被中断时会在目标文件旁边留下 `<文件名>.<pid>.<uuid>.tmpdir/`。**实测踩过**：一次 `edit` 报告成功但改动只在 tmpdir 里
    （`handoff` 的 §5 残留规模段），文件本身没变 —— 只看工具返回值会以为已经写进去了。
    ⇒ 恢复动作：① `Get-ChildItem -Recurse -Filter '*.tmpdir'`；② 用标志串核对目标文件（本工程踩过的标志串 = `残留规模（先看这个再挑活）`）；
    ③ 若 tmpdir 里的内容 = 目标文件 + 那一次编辑，**重新应用该编辑**（不要直接覆盖，除非逐行严格比对为 0 差异）；④ 清理 tmpdir。
16. **★语料量 ≠ 重要性：先看那批命中是不是在「门后/DEBUG 路径」上**。实测教训：`0x140` 以 **181 处**排在
    `deferred` 榜首、连着两轮被列为"最值得先做的一条"，读体后发现它**全在 DEBUG 路径**（`global 708ad6 == 1`
    才进，该全局全语料唯一写点 = `TITLE.txt:462` 的 DEBUG 菜单）⇒ 正常剧情零影响。
    ⇒ 排优先级时**必须**先 `Select-String` 看实参形态是否高度一致 + 追一下「进这条分支的门是什么」，
    否则会把力气花在只有开发者菜单才会走到的指令上。
17. **★锚点不是注释，是跨文件/跨 agent 的 ABI**（轮 5 实测）：`ticket.json` 的 `evidence[].anchor` 与 `analysis/scripts.json` 的 `layout[].anchor`
    要求**别人正在改的文件**里存在那个字面串。改任何被锚定的文件（**源码注释、机制文档的表格行都算**）之前先跑
    `tickets.js --anchors-in <file>` 与 `scripts.js --anchors-in <file>`；能保留就把旧串留在标题/引用里，不能保留就**在报告里申报**（由台账 owner retarget）。
    ★**不许用「删证据 / 降 status / 删条目」来消红**。（实测收益：`--anchors-in save-slot.ts` 一次列出 17 条锚点 —— 此前只能人工列举「必须保留的 4 个串」；它还当场暴露了两条说明过时的证据。）
18. **★「不在被调函数里」≠「引擎没做」**（轮 5 最贵的一课）：`sub_410160` 的 27 个 callee 确实都不清绘制容器，但清容器是它**自己的行内语句**（raw 19810-19820）。
    ⇒ 结论必须落在**函数体文本**上（含行内循环/内联语句），不能只审调用图。
19. **`--validate` 绿 ≠ 数据层对**：直到轮 5，两个工具都在拿**刚重算过的副本**比 `counts` ⇒ 磁盘上的陈旧**检测不出来**（实测踩过 `partial 18→19`、`modeled-verified 48`）。
    现在改为比磁盘并提示 `--recount`。同理：**生成物（`*.md`）只在结算时由台账 owner build 一次**，别的 agent 不跑 build（会用陈旧输入覆盖别人的结果）。
20. **派子代理的三件套**（详见三个技能的同名节）：① 角色（ANALYSIS-ONLY / IMPLEMENTATION / LEDGER-OWNER）；② **路径白名单**（可写哪些、禁写 `analysis/`·`tickets/`·`docs-new/`）；
    ③ **必保字面串**（锚点）+ 退出判据（`npm run verify` + E4）。★ANALYSIS-ONLY 的 prompt **必须**写明「即使你加载了某技能，也**跳过**它的落库步骤」——
    否则子代理会在「技能要求落库」与「只读分析」之间自行取舍（实测原话如此）。

## 5. 剩余工作（按性价比排序；**轮 6 后已重排**）

> ★**轮 6 已收口、不要再当待办**：`T-0077`（B4，13 处凭空/错读）/ `T-0076`（P0）/ `T-0084`（P2 转场，剩项转 `T-0091`）；
> B4 的 Live2D 半边（节点矩阵合成器）转 `T-0096`。**B4 不再是"进行中"**。

### 5.1 下一步按性价比

| # | 活 | 票 | 为什么 / 起手 |
|---|---|---|---|
| **1** | ✅（轮 6 已完成第①半）**SETWEATHER 族 5 条登记为 `engine-internal` 有据 no-op**；剩 `0x147`/`0x2f2` 纯几何命中 | `T-0093`（P1，doing） | ★**用户可见 + 机械可验证**：`SETWEATHER` 由剧情脚本 `call-script 47` 调用（SC0500:26212 / SC0070:29136 / SC2060:28374,30048 / SC4000:4359 / SC4160:5752 / SC5450:3573 / SC5530:4181 / `$1$SC4330`:4993 …），而 `0x327/0x328/0x329/0x32C/0x32E` 三张表都没有 ⇒ **每次走到 SETWEATHER 就 NotImplementedOp 硬停**。五条体内机械扫描**无 `sub_42B4B0`/`sub_42BA00`（不回写操作数）**，同族 `0x324/0x325/0x326` 已在 `stubs.ts` 同口径登记。同批可做 **`0x147`/`0x2f2` 纯几何命中测试**（`CreatePolygonRgn`/`CreateEllipticRgnIndirect` + `PtInRegion` → op1，**零宿主缝**，各 1 处语料）。 |
| **2** | **`0x196` 第①②路的 MessageSpeed 节流半边** | `T-0094`（P1） | **6341 处** `display-furigana`（★审计原文「语料 i196 = 0」只是助记符字面量，已订正）⇒ 每处注音比引擎少等一拍。外层门与第③路轮 6 已接，现由棘轮测试钉住（`test/op-3-004-furigana-outer-gate.test.ts`），补上即翻正向断言。 |
| **3** | **`0x1d0` + 写端 `0x70`/`0x71`（回想页表）** | `T-0095`（P2） | deferred 里少见的「① 现在就能做」：`sub_459860`（raw 70629-70724）**零 GDI**（轮 4 已订正「GDI 文本度量族」的错归口）。卡点 = 写端未读 ⇒ 动手第一件事 = 读 `sub_45D660`（raw 73181）/ `sub_45EC60`（raw 74267）。语料 HISTORY 3 / CONFIG 1 / REPLAYVOICE 1。 |
| **4** | **P2/P3 定点小修批** | `T-0097`（P2） | `0x2EE` 补 `SetConfig(message:MessageFade)`（审计 `op-4-11`，重启后回默认）；`0x141`/`0x135` 的**无符号**口径（体 raw 31005 / 39409；语料 0 处）；**operand 未写槽读 `enc_zero`** 的全局口径（引擎装载时整块填 `enc_zero`，轮 6 只在 `0x12E` 本地绕开 ⇒ 两套口径只能留一个）；`fields.json` 的 `Engine/0x408` scope 复核（分诊读体：`Engine+1032 = Input 管理器`，绘制项 map 在 `Scene+1032`）。 |
| **5** | **Live2D 节点矩阵合成器 `sub_4A07F0`** | `T-0096`（P2） | 轮 6 把节点族 7 条改对了操作数/落点，但**消费端未实现** ⇒ `L2dNode.scale/rotation/translate/wins` 有值而无消费者（`l2dNodeTransform` 恒单位变换）。体 = raw **121131-121520**。 |
| **6** | **转场渲染剩余四项** | `T-0091`（P3） | 类别 3 的 `(2L+1)²` 核逐点权重、`[4]` 指向非 `create-texture` 槽、`Scene+46508·46512·46516` 三标志本身、**E4 像素级可达路径**（`i250` 在 `SN0000` line 3036 之后；178 个含 `i223` 的脚本前 12 个 ×3000 帧零命中）。 |

### 5.2 仍是「卡子系统」的大块（分诊结论：都指名了 emulator 没有的东西）

- **DDraw/2D 缝（7 条 / 45 处剧情语料，回报最大）**：`0x28`(32)/`0x25`(4)/`0x26`/`0x2b`/`0x36`(5)/`0x82`/`0x85` —— 卡点 = `sub_441060`/`sub_443B20`（`Engine+7912`）「哪张 surface / 什么混合」。
- **宿主光标（2 条 / 25 处）**：`0x86`(16)/`0x87`(9) —— `sub_4B8C70`（raw 140780）= `SetCursor`、`sub_4B8660`（raw 140395）= reapply cursor；体已读全，**缝最小**（或按有据 no-op 登记）。
- **其它**：Scene 拾取层 `0x222`(10)（需先建 `KNOWN_DRAW_ITEM_FLAGS` 的 `0x10000` 位 + `Scene[12676]`）；mesh 对象族 `0x236`(6)/`0x241`/`0x329`；输入点击队列 `0x2fd`(4)（`sub_477A60`，emulator 无 click 队列）；GDI 文本 `0x1d1`；AGERC `0x140`(181, DEBUG)/`0x144`（**cmd 10**，会回写两个串）；音频回读 `0x1c4`；模型未确证 `0x23a`。**语料 0 处**：`0x24d`/`0x82`/`0x85`/`0x26`/`0x2b`。

### 5.3 批次尾巴

- **B2 计划层**（`T-0082`）：handler 只消费 `c.args` 的声明式操作数计划。第一层已备好 `frames[].len_slot`（`Engine 0x5D8F4`，`N = 2*argc+1`）；两条守卫（`opcode-operands`/`opcode-arity`）已挡住口径漂移。
- **B7 P2/P3（218 条）**：分诊已把**代码侧且影响可见行为**的挑出来并入 `T-0097`；其余多为**纯文档措辞**类（`no-evidence`/`overreach`），按 影响可见行为 > 回写操作数 > 纯记账 分批。
- **`T-0075`**（文档×实现审计，P1 open）与 **`T-0076` 已 done** 的分工：前者是审计本身，剩余 P3 条目按上面处理。
- **`T-0092`**：`0x02` 的 `-11` 分支无记录 0 时 emulator 抛 `ExitScript`，引擎**不退出**（审计 `op-2-10`）。

### 5.4 已知的小尾巴

- `--validate` 的行号漂移警告已清零（轮 6 刷新了 `T-0085` 的 evidence 行号）。
- `analysis/opcode-gaps.json` 的 `counts` 由工具维护：**改了 disposition 一定要跑写模式**（`node scripts/build-opcode-gaps.mjs`），否则 `--check` 与守卫测试都会红。
- ★**语料计数口径**：台账 `mnemonic` 不补零、`src/*.txt` 是 `i` + 三位 ⇒ 自己 grep 时**两种写法都要数**（否则会漏 `i028`/`i086`/`i025`/`i036`/`i087` 共 9 条 / 约 70 处）。

## 6. 已完成的关键成果（可直接引用；轮 47+ / 轮 4 / 轮 5+6）

**★B3 缺口清零（未实现 35 → 0 / 语料 203 → 0）**，实现 14 → **34**，deferred 11 → **27**，unjustified 4 → 0。

### 6.1 落地为真实现的（按族）

- **bit2 动画窗族 6 条 + `0x244`**：`0x230`→`op_reset_draw_item_loop`、`0x231`→`op_set_flipbook_loop`、`0x232`→`op_set_color_loop`、`0x233`→`op_set_scale_loop`、`0x234`→`op_set_rotation_loop`、`0x235`→`op_set_translation_loop`、`0x244`→`op_clear_draw_item_anim_starts`。
  新宿主缝 2 个（`native.setDrawItemLoop` 判别联合 / `clearDrawItemAnimStarts`，五处同步）；`KNOWN_DRAW_ITEM_FLAGS` `0b011 → 0b111`；B 层五通道求值进 `drawitem/eval.ts`；bit2 **不进 wait 门**。语义规格 = `b3-bit2-model-spec-2026-09.md`；守卫 `test/draw-item-loop-anim.test.ts`(14)。
  **7 处以体订正筛体方案**（`b3-screening-2026-09.md` §6）：`0x234` 是**旋转**不是平移、`0x235` 是平移往复不是 flipbook、`0x231` 是换格循环不是旋转、`0x230` 只清 `{540,544,548,552,556,560}` 且**不置脏**、`0x232` 的 `+576` ≠ `0x202` 的 `+100`、`+524..+536` 是**起点锁存槽**不是 delay。
- **转场记录族** `0x24f`/`0x250`/`0x251`：`Scene+1048` 的 96B（24 dword）记录表写入端 + 宿主缝 `native.setTransition`（含两条**方向相反**的边界分支）；`scClearTransitions` 按 `sub_4A9BE0` 改为**真 clear()**；守卫 `test/op-24f-250-251-transitions.test.ts`(8)。渲染端扫描带仍缺 ⇒ `T-0084`（规格已在手）。
- **音频族** `0x1ba`/`0xc1`：按类别的声音开关 / **BGM 暂停继续翻转**。★订正两处旧读法（不是「音量档位」、不是「静音/启用开关」—— `a2` 统一是 0 关/非 0 开，`±3` 只是 `sound:Music` 音源槽的符号开关机制）。宿主侧**真**暂停/继续（流式走 `setPaused`，缓冲宿主走"停播 + `offsetSec` 续播"）。
- **队列族** `0x132`/`0x133`/`0x134` + `0xd0`：`Engine.dispatchQueues`（11 队；`op1 > 0xA` 走错误串分支且**不动队列**）、`op_wall_clock_ms`（★订正：`Engine.wallClockMs` **不存在**，用既有的 `Engine.nowMs`）。
- **Scene 级变换族 `0x22a`/`0x22c`/`0x22d`/`0x22f`（轮 4）**：`op_scene_scale`/`op_scene_translation`/`op_scene_axis_scale`/`op_scene_axis_translation` + **4 条新宿主缝**（五处同步）+ `SceneState.sceneXform` + `applySceneXformToPlacement`/`sceneLayerAffected`；消费端 = `pixi/presenter.ts` 归并循环（item/text/mesh 三路）；守卫 `test/op-22a-22f-scene-world.test.ts`(13) + `test/op-22a-22f-scene-xform.test.ts`(12)；第二层新条目 `scene-layer-xform-compose-20-29`。**3 处读体订正**：`0x22f` 确为 `D3DXMatrixTranslation(Scene+387)`；★**层号门（此前记反）** = `(unsigned)(layer − 20) > 9` ⇒ **区间外**拿完整矩阵、**20..29 走 `else` 支**（`D3DXMatrixDecompose` 后只装回 2D 缩放+平移）；`0x22f` 的轴分量对 20..29 **无净效果**（旋转矩阵在该支被置单位阵）。左右序 = `work ← work · sceneWorld`（行向量）⇒ `屏幕点 ← 屏幕点 × (sx,sy) + (tx,ty)`。
- **`engine-internal-unjustified` 清零**：`0x10c`（VK→掩码位表；无键码表 ⇒ 零消费者，**`T-0052` 落地后必须移进 `OPS`**）、`0x324`/`0x325`（Effect3D 释放/销毁判据 ⇒ 有据 no-op）、`0x244`（已实现）。

### 6.2 台账 / 数据层

- **第一层回填**：`Engine 0x5D8F4 frames[].len_slot`（`N = 2*argc+1`）+ 18 条函数（全 ANALYZED）+ 5 支撑 + 53 字段（新作用域 `Layer`/`TransitionRecord`）；★随后订正 `DrawItem 0x244..0x24C` = **旋转轴**（不是平移分量），字段/函数改名消除 `trans_win_*`；轮 4 又补 9 条函数 + 13 条 Scene 变换字段。
- **第二层**：新增 `drawitem-loop-anim-frame-drive`（partial/E2）、`text-blank-extent-mode-gate`（轮 4 由 absent → **partial/E2**）、`scene-layer-xform-compose-20-29`（modeled-verified/E2）；`clock-read-transition-window` 由 absent → **partial/E2**（记录表已建模、扫描带仍缺）。
- **漏读清尾**：`ALLOW_UNDERRUN` 27 → 26，「确认是 bug」6 → 1；`0x1f9` 修好并**删条目**（机械判据）；`0x1d3`/`0x1d4`/`0x2f3` 核体后是引擎**死读**（有据豁免）；`0x33f` 三格全读但缺消费端（回链 `T-0017`）；`0x249` 同病 ⇒ `T-0086`（done，抽共用 `normalizeTextureColor`，归一化 = i32 域负值落 0、否则强置 `A=0xFF`）。
- **`T-0060` 收口**：真槽续跑链从「`0x231@RESETREIGNAN` × 333434 次死循环」变为「被跳过的未实现 opcode **0 个**」，轨迹 `REIGN.BIN → SETADVFLAG.BIN → SETGARDEN.BIN`。
- **`T-0085` 收口（轮 4）**：`set:BlankExtentMode` 门与公式接线（`layout.ts` 的 `blankAdvance`/`numberCellExtent` + `msgwin.ts` 的 `blankExtentOf`），**mode 0 与旧纯算术逐字等价**（零回归）；缺的宿主字形度量来源降级为**可见** `blankExtentFallback`（只在该标志为真时出现）而不是编数；两种候选来源（宿主 `measureText` 缝 / 自建 TTF `hmtx` 表）写在 `layout.ts` 文件尾。

### 6.3 工具修复（都用"注入漂移"反证过）

- `counts` 工具化：`build-opcode-gaps.mjs` 重算并**回填**真源（此前手写 ⇒ 实测漂移 `deferred 25/未实现 6` vs 实际 `31/0` 且无人发现）。
- `--check` 真失败：此前只打印 ✗ 仍 `exit 0`（假"通过"）；现在 md 陈旧与 counts 漂移都 exit 1。
- md 新增 **§6 deferred 段**：此前 31 条 deferred 在生成物里**完全不可见**。
- `capabilities.js --validate` 补 `emulator.note` 类型检查：`--set emulator.note=a, b` 会把值按 ASCII 逗号拆成**数组**而旧 validate 放行。
- ★**踩坑记录（同一个坑被踩了三次）**：`--set` 的 ASCII 逗号 / 裸 ASCII 引号**会写坏 JSON**（`engine-capabilities.json` 因此一度整文件非法，靠人工最小修复救回）。
  ⇒ 结论：**note 里引用短语一律用「」，值里不要写 ASCII 逗号；改完立刻 `--validate`。**

### 6.4 未实现 → 有据 `deferred` 的收尾（不是"都实现了"）

- 最后 6 条（`0x22a`/`0x22c`/`0x22d`/`0x22f` 轮 4 已转 implemented；`0x1c4`/`0x23a` 仍 deferred）。
  - `0x1c4`：★筛体**归口整条错** —— 实为**语音总线占线查询**（`Engine+84128` = 语音对象），需音频侧对外回读缝。
  - `0x23a`：`Engine+91322` 表元素类型**未确证**（仅 2 处读、无写点；与 `94672` 的 L2D 槽表**不是**同一张）+ `+1068` 无消费者。
- `0x140`（181 处）：旧理由（"静态定不了目标"）被**推翻** —— `dword_55E1B4` = `AGERC.DLL!_ShowDialog@12`；且 181 处**全在 DEBUG 路径** ⇒ 正常剧情零影响 ⇒ `T-0088`（含一个待定**产品策略**）。

### 6.5 `T-0087`：`0x223` 容器错位（轮 4 发现并修复，**转场渲染的前置**）

- **错在哪**：`0x223` 是 `Scene+1048` 转场记录表·**类别 0（全屏交叉淡化）**的写入端（`sub_423F00` → `sub_4ADDB0`，`sub_4AAE10(_this + 262, &a2)` 的 `_this + 262` dword = 字节 **1048**，`[0] = 0`），emulator 却把逐格**正确**的 9 个数写进 `Engine.itemRegions` —— **数据对、容器错**，且那是个生产代码**零读者**的死模型（`check:dead-writes` 只扫 `Item`/`MeshObj`，覆盖不到）。后果：语料 **178 处 / 178 文件**的类别 0 转场对渲染端**完全不可见**；连"引擎先建 24 格默认记录再覆盖前 9 格"的行为也丢了（记录只有 9 格）。
- **怎么修**：handler 改名 `op_set_transition_fade`，改走 `native.setTransition`（= `0x24F`/`0x250`/`0x251` 同一条缝、同一张表）；删掉 `Engine.itemRegions`；旧测试删除、新守卫 `test/op-223-transition-fade.test.ts`（4 条：`length === 24`、`[0] === 0`、前 9 格逐格 deepEqual、`[9..13]` 默认、`itemRegions === undefined`、与 `0x24F` 同表不串格）；`op-24f-250-251-transitions` 保持 8/8 绿。
- ★**实现坑（已写进注释）**：8 个操作数**必须先读进局部量**再调用 —— 内联进 `setTransition?.(…)` 的实参表时，**可选调用在宿主无该缝时不求值实参**（`StubNative` 没有它）⇒ 8 格一个都不读，`opcode-operands` 直接红。
- ★**顺带订正**：`transition-render-spec` §2.3 曾把**类别 0** 的 `[13]` 来源记为 `a10`；实为 `a10` 只属**类别 1 的写入端 `sub_4ADEE0`**（12 参，raw 132679），类别 0 的 `sub_4ADDB0`（`a2..a9`）**不写 `[13]`**。已订正。
- **仍记缺口**：`sub_4ADDB0` 头部的惰性（重）建纹理层分支（`sub_4A2C10` 的 `0x460` 对象内部）未读完 ⇒ 未建模（属渲染端缺口）。

### 6.6 轮 5/6 收口：读档画面 = 存档那一屏（`T-0083`/`T-0066`/`T-0072`/`T-0074`/`T-0090` 全部 done）

**① 症状**：`--load 79` 后背景「完全混乱、很多图元缩放错误」—— 实为 TITLE 残留项画出的「天空碎片阶梯」+ 一块橄榄灰板。

**② 判定（源码级，按用户要求不依赖真机）**：装载点**行内清** `Scene+0x408` 并**从 body 还原绘制项清单**（raw 19810-19832，细节见 §7）；
`0xAE` 的 ip 直落语义 ⇒ SN0000 的 738..793 被跳过（含唯一的场景起始背景绘制）。
**键对表**：背景键 = `f8023[层]`（`INIT2.txt:6-17` = 0x18A88…0x19258）**≫** TITLE 的 max **0x135**；
而 TITLE 的项在 Load Data 分支（`TITLE.txt:333-341`）**没有任何清理**、且**全部建在槽 4**（`TITLE.txt:526`）
⇒ 装载段重绑 `槽 4 ← 0xB37`（BG050ABL 2048×1152）后，它们按**标题屏的源矩形**去采样那张图 = 阶梯
（5 块 156×156 菜单板在 (1102,294)/(992,402)/(869,485)/(729,543)/(1107,554)）+ `0x64` 那条源 y=1161 越过图高 1152 的灰块。

**③ 解析器真 bug**：清单条目步长 = `1 + size` dword = **2964 B**（引擎 `&v67[4*hFile]`），旧代码写 `1 + size/4`（744 B）⇒ 第 2..69 条 handle 全落在第 0 条记录里（垃圾），
这也是它一直没被消费的原因之一。真槽 79 解出 **69 条**：`0x18A88`（背景，flags=3、tex=4、src (0,0)-(2048,1152)、pos (−768,−272)）
+ `0x19835..0x19840`（ADV 侧栏，tex=17）+ `0x19A28..0x19A62`（消息窗字格，tex=28）。

**④ 实现**：`src/vm/engineDrawItem.ts`（新：740 B → `Item`；★4×4 矩阵必须按 **D3DX 写入位置**取分量 —— 缩放 = 对角线 `+0/+20/+40`、平移 = 第 4 行 `+48/+52/+56`；
按「连续 3 个 f32」读会得到 `(1,0,0)`/`(0,0,0)` 而**静默画错**；读取端自证 = `0x228`/`sub_4AA060` 的 `D3DXMatrixDecompose`）；
`engineSlot.ts` 步长修正 + `imageReload` → `drawItems`；装载点宿主缝 **`native.restoreDrawItems(items)`**（清上一屏 + 装清单，两宿主 + 桩 + tap 对称；
**不**调 `clearDrawContainer` —— 引擎的 clear 只走 `Scene+0x408`（= 字节 1032），而那个缝连网格一起清）；`ownerFrame`/`dropFrameItems`/`#holdFrames` 降级为「body 无清单」的回退。

**⑤ E4**：`npm run shot -- --load 79` → 日志 `restoreDrawItems: 清掉上一屏 172 项、按存档装回 69 项`；
阶梯/灰块消失、背景 = BG050ABL（截图 `tickets/T-0083/evidence/after-itemrestore-*.png`；修前对照 `tickets/T-0090/evidence/`）。

**⑥ `T-0090`（Live2D 泄漏）**：`l2dResetHost` + 装载点调用 + 一行日志；守卫 `test/slot-load-l2d-reset.test.ts`(2)。
★定位价值：修完 L2D 后阶梯**仍在** ⇒ 才把根因锁定到「上一屏绘制项残留」（阶梯 ≠ Live2D）。

**⑦ 台账/文档**：第二层 新增 `save-load-drawitem-clear-and-restore`（modeled-verified/E4）+ 订正 `scene-teardown-on-load-point`（**原始实现是对的，(B) 步删错了**）；
第一层 补 `Scene/0x40C`（树根）、`Scene/0x410`（计数）；第三层 新增 `NOVEL` 条目 + `SN0000`/`TITLE`/`INIT2`/`SYSTEM4` 的行区间/不变量/坑；
`save-data.md` §7.10 第 4 行**重写**（旧结论「装载路径不清绘制容器」被推翻）、`repair-plan` §2f、本文件 §7。

**⑧ 流程/工具加固（多 agent 并行）**：三个技能各加「★多 agent 并行纪律」节（单写者表 / 三种子代理 prompt 模板 / 锚点 ABI / validate 红分类 / 共享资源串行化；
三份同源 + `test/agent-workflow.test.ts` 逐字节守卫）；三工具新增 `--set-json` / `--recount` / `--anchors-in`，写入改**原子写**，`--validate` 改比**磁盘上的 counts**。
守卫：`test/engine-draw-item-decode.test.ts`(3)、`engine-slot.test.ts`(+3)、`slot-load-screen.test.ts`（重写 3）、`agent-workflow.test.ts`(5)。

### 6.7 轮 6 收口：B4 + B7 首批 + 三票 done（详见 `repair-plan-2026-09.md` §2g）

**① `T-0077`（P1）done**：`ALLOW_UNDERRUN` 的「确认是 bug」清零（`0x12E` 按体重写：首项 `op1+1`、两道边界门、四点判据、平面按记录下标步进、margin 基址==记录基址⇒跳过 —— 删条目后守卫仍绿 = 机械证明）；
Live2D 节点族 7 条按体订正（**`0x348` 是轴角旋转不是缩放**；补窗门 `record[0]&1`；真语料 **`i34d` 12 处（BTL）此前 delay/dur 与平移分量整体错位**）；
`0x203` 补 clamp + 负值回退（新宿主缝 `native.getDrawItemColor` = `sub_4ADD60`，五处同步）；`0x323` 命名订正。

**② `T-0076`（P0）done**：21 条全部有处置；★**`system:EffectSkipOnClick` 的引擎内建默认 = 0**（raw 111578-111579），而 `0x306` 的兜底、测试、文档都写着 1 ⇒ 三处订正（兜底改向 `registryDefault()` 取）；`0x337` 补登记 `deferred`（3D 层节点平移，语料 0 处）。

**③ `T-0084`（P2）done**：能力台账 `clock-read-transition-window` → `modeled-verified/E3`（E3 = `test/transition-corpus-e3.test.ts`）；剩余四项转 `T-0091`。

**④ B7 P2 首批**：`0x6E`（ADV 位已置 ⇒ 同步排空、不装 SLEEP_GATE；帧循环 ADV 分支上移到 sleep 门之前，体依据 raw 21158 vs 21176）、
`0x1A8`/`0xAF`（体 = 写当前帧步长槽 `95805 = 1`，两者同一个 handler `sub_419690`）、`0x20A`（两条效果的等价性论证 + 守卫）、
`0x196`（外层门 `Engine[122497] & 1` + 第③路；★订正审计的 `i196` 语料计数——名字形式 `display-furigana` 有 **6341 处**，第①②路节流半边 ⇒ `T-0094`）。

**⑤ deferred 分诊**（analysis-only 子代理，报告 `.tmp/triage/report.md`）：口径订正 + 全 29 条重排 + 逐条「能不能现在做」判定 ⇒
真正可做的只有 SETWEATHER 族 5 条与 `0x147`/`0x2f2`；派生 `T-0093`~`T-0097`。

**⑥ 守卫**：`op-10-002-adv-sleep-order`(5)、`op-6-05-step-slot`(4)、`op-6-09-window-relayout`(3)、`op-3-004-furigana-outer-gate`(3)、
`op-12e-hover-hittest`(8)、`l2d-node-transform-ops`(10)、`op-203-draw-color-alpha`(9)；`opcode-operands` 白名单删 4 条（`0x12e`/`0x347`/`0x348`/`0x34b`）后仍绿。
`npm run verify` = **837 tests / 825 pass / 12 skip / 0 fail**，死写 **0**。

**⑦ 追加（同一轮）：`T-0093` 第①半落地** —— SETWEATHER 族 `0x327`/`0x328`/`0x329`/`0x32C`/`0x32E` 登记为 `ENGINE_INTERNAL_OPS` 有据 no-op（缺消费端 = 无 Effect3D / 3D 网格 / mesh / 3D 相机 / 3D 图元；逐条机械扫描确认**体内无操作数写原语**）⇒ **每次走到 `SETWEATHER` 不再硬停**；守卫 `test/op-327-32e-setweather-noop.test.ts`(3)；缺口台账 `deferred` 29 → **24**、有据 no-op 8 → **13**。

## 7. ✅ `T-0066`（读档画面残留）—— 状态：**已收口（轮 5/6）**

**结论（源码级）**：引擎读档后画面上是「**存档那一屏的绘制项**」，机制在 `sub_410160` 里，分两半：

1. **清**：raw **19810-19820** 整批销毁 `Scene+0x408` 容器的树（`sub_40BB60` 释放 + `operator delete`），并复位哨兵/计数（`Scene+0x40C` 树根、`Scene+0x410` 计数）。
   ★它是**行内语句**，不在那 27 个被调函数里 —— 这正是 (B) 步误判的根源（见 §4-18）。
2. **装**：body 末段 `{u32 740、u32 count、(u32 handle + 2960 B 记录区) × count}`（条目步长 = `1 + 740` dword = 2964 B，引擎 raw 19828 `&v67[4*hFile]`），
   raw **19822-19832** 逐条 `sub_49A300`（740 B 记录默认初始化，raw 116879）+ `memcpy` + `sub_40C910`/`sub_40C310` 插回容器。

配套两条订正：
- `0xAE`（`sub_4192F0` raw 24634-24731）把帧 ip **直接置**成记录落点（`95781 + 4*table[idx]`，步长 `95805` 记 0/3）⇒ 帧自己的 `i0ae` 与落点之间**被跳过**。
  SN0000：`i0ae` = 指令 737、落点 = 794 ⇒ 738..793 不执行，而**全文件唯一的场景起始背景绘制就在带内**（指令 756/757/758 = line 1025-1027）⇒「引擎靠脚本重跑把背景重画」是错的。
- `NOVEL.txt:55` 的 `draw-texture 186a0` 在 `(global-int 3f90) != 0` 门后，而 **`3f90` 全语料只被写成 0** ⇒ 那条分支（与 SYSTEM4 里同构的一块）**从不执行**（handle 0x186A0 从未被画出）。

**残留（有据，已登记）**：① `animStart` 是引擎**绝对时钟**（`timeGetTime` 族毫秒），body 里没有锚点可换算 ⇒ 还原后各窗判「未开始」= 冻结在存档当时的 work 矩阵；
② 旋转通道（`+0xEC`/`+0x12C` 矩阵与 `+0x1EC..+0x208` 轴角）逐字段偏移未确证 ⇒ 未还原；③ body 尾部 `{2 dword + 740 B}`（`Scene+0x458`/`0x45C`/`0x460`，本机槽 79 全 0）未解析。

**热路径复验（建议做，但已非阻塞）**：进 SN0000 首句 → 菜单存档 → 从菜单读回该槽。正确 ⇒ 收尾；不正确 ⇒ 把 `slot-load-screen` 的 A/B 升级为**真脚本版**
（同一份 SN0000：正常跑到第 794 句 vs 从槽 79 读档到它）。

## 8. 工具速查

| 目的 | 命令 / 路径 |
|---|---|
| 全量验证 | `cd app/amayui-emulator && npm run verify` |
| 单文件测试 | `node --env-file=test/options.test.env --import tsx --test test/xxx.test.ts`（在 `app/amayui-emulator` 下） |
| 注册表分两张 | `OPS`（VM 核心）与 `NATIVE_OPS`（子系统）；测试里取 handler 要 `OPS.get(op) ?? NATIVE_OPS.get(op)` |
| 缺口台账 | `node scripts/build-opcode-gaps.mjs`（写模式，回填 counts）/ `--check`（CI，漂移 exit 1）；真源 `analysis/opcode-gaps.json` |
| 能力台账（第二层） | `node .agents/skills/amayui-engine-analysis/scripts/capabilities.js --root . [--validate|--attention|--id X]` + `node scripts/build-capabilities.mjs` |
| 脚本台账（第三层） | `.agents/skills/amayui-engine-analysis/scripts/scripts.js --root . [--validate|--coverage]` + `node scripts/build-scripts.mjs` |
| 开工前一页纸（脚本） | `node .agents/skills/amayui-script-analysis/scripts/brief.js <ID>` |
| 真机截图回归 | `npm run shot -- --load 79 --name X --page 870,900`；日志 `.tmp/amayui-emulator.log` |
| 引擎反编译 | `engine/天结_unpacked.exe_utf8.c`（**唯一权威**；函数头 `//----- (0040xxxx)`）；thunk 查 `…utf8.lst` |
| 票据 | `node .agents/skills/amayui-ticket-ledger/scripts/tickets.js --root . --show T-00NN` / `--note` / `--set-status` / `--validate` |
| ★改文件前查锚点 | `tickets.js --anchors-in <file>`（谁锚在这）· `scripts.js --anchors-in <file>`（脚本 layout 锚点） |
| ★台账安全写 | `--set-json k='<json>'`（值含 ASCII 逗号时必须用它）· `--recount`（直接改过 JSON 后修 counts；`--validate` 现比磁盘） |
| ★多 agent / 子代理纪律 | 三个技能的「★多 agent 并行纪律」节（单写者表 + 三种 prompt 模板）；守卫 `test/agent-workflow.test.ts` |
| 两宿主对称 | 改宿主行为必须同时改 `headlessScene.ts`（测试/报告用）与 `pixiBackend.ts`（Electron GUI 用） |

## 9. 不要做的事

- 不手改生成物（`opcode-gaps.md` / `engine-capabilities.md` / `docs-new/05-scripts/*` / `tickets/README.md` / `scripts/asm/opcodes.json`）；
- 不为"看起来正常"新增启发式（尤其不要给 `#holdFrames` 打补丁）；
- 不把缺口塞进 `ENGINE_INTERNAL_OPS` 静默跳过（`gaps:check` 现在拦得住）；
- **不照抄筛体/规格文档的推断当结论**（先读体；本轮已实证 13 处错，含 2 处整条归口错）；
- 不改真实游戏数据（base `SAVE.DAT` / AGF 等只读；写入只落 `.overlay`）；
- 不在没有消费者的情况下往 `Item`/`MeshObj` 加字段，也不往"引擎没有的合成级"硬接；
- **不用「删证据 / 降 status / 删条目」来消 `--validate` 的红**（锚点漂移就 retarget、`counts` 陈旧就 `--recount` + rebuild，见 §4-17/19）；
- 不把「清容器不在被调函数里」当成「引擎没清」（结论只认函数体文本，见 §4-18）；
- 做 git 提交（只写文件）。
