# 需求 / 缺陷单看板

> **生成物**：由 `tickets/<ID>/ticket.json`（真源）渲染，`node scripts/build-tickets.mjs`。**勿手改本文件。**
> 单票的可读视图：`node .agents/skills/amayui-ticket-ledger/scripts/tickets.js --show <ID>`
> （它会把 `ticket.json` 与该票**所有过程文档**一起列出来；过程文档在 `tickets/<ID>/` 里手写。）
> 纪律与 schema：`docs-new/00-overview/tickets.md`；维护流程见 `amayui-ticket-ledger` 技能。

## 概览

共 **88** 张：🔜 doing **4** · ⛔ blocked **0** · ⬜ open **19** · ✅ done **64** · 🚫 dropped **1**（P0 7 / P1 37）

按域：`emulator/render` 18 · `emulator/frame-loop` 9 · `emulator/save-slot` 7 · `emulator/input` 6 · `emulator/adv` 5 · `emulator/vm` 5 · `emulator/hosts` 4 · `emulator/test` 4 · `emulator/ops` 4 · `docs/03-engine` 3 · `emulator/boot` 2 · `emulator/tools` 2 · `emulator/save-data` 2 · `emulator/save-render` 2 · `emulator/audio` 1 · `emulator/deadcode` 1 · `emulator/msgwin` 1 · `emulator/arch` 1 · `repo` 1 · `engine/opcodes` 1 · `translation/src` 1 · `tooling/repo` 1 · `emulator/verify` 1 · `emulator/core` 1 · `renderer/scene` 1 · `emulator/save-load` 1 · `emulator/opcodes` 1 · `analysis/engine-capabilities` 1 · `emulator/text` 1

## 🔜 doing（4）

| id | P | 类型 | 域 | 标题 | 判据 | 守卫 | 过程文档 | 阻塞于 |
|---|---|---|---|---|---|---|---|---|
| [`T-0076`](./T-0076/ticket.json) | P0 | bug | `emulator/ops` | emulator 零注册的引擎指令（P0/P1 共 21 条）：命中即硬停或让脚本读到陈旧操作数 | 6 | — | `notes.md` `changes.md` | — |
| [`T-0062`](./T-0062/ticket.json) | P1 | bug | `renderer/scene` | 存档缩略图全黑：0x20D 渲染目标窗口里的 0x20C 必须把整帧画进该槽 | 3 | — | `notes.md` `changes.md` evidence/(2) | — |
| [`T-0082`](./T-0082/ticket.json) | P1 | refactor | `emulator/vm` | RF-A 操作数读取计划重构：per-opcode 计划层 + arity 槽（`frame.state[95805]`）建模 + argc 自动核验 | 6 | `app/amayui-emulator/test/opcode-operands.test.ts` | `notes.md` | — |
| [`T-0054`](./T-0054/ticket.json) | P2 | req | `emulator/render` | Live2D 支持：先定依赖路线（自研移值 / Cubism 2.1 运行时 / Cubism 5），再按 TITLE·INFOEN·BTL 三处用例分阶段落地 | 6 | `test/live2d-moc.test.ts` `test/live2d-deform.test.ts` `test/live2d-chain.test.ts` `test/live2d-render.test.ts` | `notes.md` | — |

## ⬜ open（19）

| id | P | 类型 | 域 | 标题 | 判据 | 守卫 | 过程文档 | 阻塞于 |
|---|---|---|---|---|---|---|---|---|
| [`T-0066`](./T-0066/ticket.json) | P1 | bug | `emulator/save-slot` | 真槽读档后画面未还原：只有消息窗与右侧栏，背景与 ADV 窗不再出现 | 3 | — | `notes.md` | — |
| [`T-0072`](./T-0072/ticket.json) | P1 | bug | `emulator/save-render` | 真槽读档后：上一个画面的绘制项没被丢掉（TITLE 残留在上半屏、ADV 文字落到错误窗口） | 4 | `app/amayui-emulator/test/slot-load-resume.test.ts` | `notes.md` | — |
| [`T-0074`](./T-0074/ticket.json) | P1 | analysis | `emulator/save-slot` | 读档装载点「清绘制项」的引擎依据复核：引擎在装载点什么都不清（27 个 callee 全查）⇒ 该刀降级为近似，并登记真正缺口 | 4 | — | — | — |
| [`T-0075`](./T-0075/ticket.json) | P1 | analysis | `docs/03-engine` | 文档×实现 凭空/推测点审计：opcode-table 574 行 + capabilities 130 条 + 17 份机制文档逐条与引擎反编译对照 | 5 | — | — | — |
| [`T-0077`](./T-0077/ticket.json) | P1 | bug | `emulator/ops` | emulator「凭空实现 / 错读操作数」修正（13 处）：代码做了引擎体里没有或相反的事 | 5 | — | `notes.md` `changes.md` | — |
| [`T-0080`](./T-0080/ticket.json) | P1 | analysis | `docs/03-engine` | 修复总计划（2026-09）：按审计结论排序、区分「补实现 / 改实现 / 必须重构」 | 4 | — | — | — |
| [`T-0083`](./T-0083/ticket.json) | P1 | refactor | `emulator/render` | RF-C 呈现/帧保留重构：去掉 hold 启发式 + 撤销装载点 clearDrawContainer，按引擎语义重做（并解 T-0072/T-0074） | 6 | — | `notes.md` `design.md` | — |
| [`T-0067`](./T-0067/ticket.json) | P2 | bug | `emulator/render` | 保存时存档页面闪一帧（瞬间露出 ADV 界面） | 3 | — | — | — |
| [`T-0084`](./T-0084/ticket.json) | P2 | req | `emulator/render` | 转场效果（i24f/i250/i251）只写了记录表，渲染端扫描带未实现 ⇒ 画面看不到任何转场 | 5 | — | `notes.md` | — |
| [`T-0019`](./T-0019/ticket.json) | P3 | refactor | `emulator/msgwin` | 拆 handlers/msgwin.ts（1338 行）与 vm/msgwin.ts（803 行） | 3 | — | — | — |
| [`T-0020`](./T-0020/ticket.json) | P3 | refactor | `emulator/test` | 收敛测试结构：mk() 17 变体统一 + 5 处自造帧循环接到共享驱动 | 2 | — | — | — |
| [`T-0021`](./T-0021/ticket.json) | P3 | refactor | `emulator/arch` | 消 A1 分层违规：arch/nodeFileSource.ts 与 electron/ipc/files.ts 反向依赖 vm/saveData | 2 | — | — | — |
| [`T-0022`](./T-0022/ticket.json) | P3 | tooling | `repo` | 跨包边与孤儿文件清理（src/opcodes.ts → scripts/asm/opcodes.json；根 age_map_src.mjs 等） | 2 | — | — | — |
| [`T-0025`](./T-0025/ticket.json) | P3 | req | `emulator/render` | headless 自带 AGF 尺寸解析：让 0x208 不再依赖录制 | 3 | — | `notes.md` | — |
| [`T-0029`](./T-0029/ticket.json) | P3 | req | `emulator/render` | 删掉 boot 里的 PRELOAD_IMAGES：统一走 0x1F9 绑定时的按需加载（TextureCache + 帧屏障） | 5 | — | `notes.md` | — |
| [`T-0032`](./T-0032/ticket.json) | P3 | tooling | `emulator/tools` | tools/record.cjs 的 --out 按仓库根解析、--scenario 按 cwd：传 cwd 相对路径会去仓库外 mkdir 并让 Elect… | 4 | — | — | — |
| [`T-0051`](./T-0051/ticket.json) | P3 | analysis | `emulator/verify` | 真机/真界面待验证清单（E4）：0x32 存档缩略图、0x32 缩放插值、0x207 同尺寸转送、0x214 收场换位、0x10A 侧栏钉光标 | 5 | — | — | — |
| [`T-0052`](./T-0052/ticket.json) | P3 | req | `emulator/input` | 键盘掩码位（0..6）没有接入：emulator 只支持鼠标 ⇒ 键盘/手柄式菜单操作（joy-callback 0..4）与 T-0048 的 E3 都不可达 | 5 | — | — | — |
| [`T-0088`](./T-0088/ticket.json) | P3 | req | `emulator/hosts` | AGERC 对话框宿主缝缺口：0x140（AGERC ShowDialog cmd 8）的返回值只能由真人点选，且两张运行时表未建模 | 5 | — | — | — |

## ✅ done（64）

| id | P | 类型 | 域 | 标题 | 判据 | 守卫 | 过程文档 | 阻塞于 |
|---|---|---|---|---|---|---|---|---|
| [`T-0001`](./T-0001/ticket.json) | P0 | refactor | `emulator/frame-loop` | B1 抽共享帧驱动 src/frame/*，先把 headless 各循环接上（零行为变更） | 5 | `app/amayui-emulator/test/frame-loop.test.ts` `app/amayui-emulator/test/game-start-chain.test.ts` `app/amayui-emulator/test/config1-chain.test.ts` `app/amayui-emulator/test/scene-report.test.ts` | `notes.md` `changes.md` | — |
| [`T-0002`](./T-0002/ticket.json) | P0 | refactor | `emulator/frame-loop` | B2 收敛帧循环的漂移（14 条工单，逐条 before/after 对照） | 3 | `app/amayui-emulator/test/frame-loop.test.ts` `app/amayui-emulator/test/scene-report.test.ts` `app/amayui-emulator/test/game-start-chain.test.ts` `app/amayui-emulator/test/config1-chain.test.ts` `app/amayui-emulator/test/anim-window-done.test.ts` | `notes.md` `changes.md` | T-0001 |
| [`T-0003`](./T-0003/ticket.json) | P0 | req | `emulator/frame-loop` | B3 headless 补齐能力面：audio 帧泵 / needsRender 语义 / 输入源（⇒ 悬停真的跑）/ digest | 4 | `app/amayui-emulator/test/frame-digest.test.ts` `app/amayui-emulator/test/frame-loop.test.ts` `app/amayui-emulator/test/headless-needs-render.test.ts` `app/amayui-emulator/test/game-start-chain.test.ts` `app/amayui-emulator/test/config1-chain.test.ts` | `notes.md` `changes.md` | T-0001 |
| [`T-0004`](./T-0004/ticket.json) | P0 | refactor | `emulator/frame-loop` | B4 Electron 迁到帧驱动：session.ts 缩成"装配 + 观察者 + yield" | 4 | `app/amayui-emulator/test/frame-loop.test.ts` `app/amayui-emulator/test/frame-digest.test.ts` `app/amayui-emulator/test/scenario-replay.test.ts` `app/amayui-emulator/test/game-start-chain.test.ts` `app/amayui-emulator/test/scene-report.test.ts` | `notes.md` `changes.md` | T-0001 T-0002 |
| [`T-0005`](./T-0005/ticket.json) | P0 | req | `emulator/frame-loop` | B5 统一 Scenario（shot.cjs 的点击脚本 与 chain 的输入驱动合一）+ --record/--replay 回放器 | 3 | `app/amayui-emulator/test/scenario-replay.test.ts` `app/amayui-emulator/test/frame-digest.test.ts` `app/amayui-emulator/test/frame-loop.test.ts` | `notes.md` `changes.md` | T-0004 |
| [`T-0081`](./T-0081/ticket.json) | P0 | req | `emulator/ops` | RF-B 缺口治理基建：缺口真源 + 生成 md + 守卫棘轮（未登记的硬停/no-op 即红） | 6 | `app/amayui-emulator/test/opcode-gaps.test.ts` | `notes.md` | — |
| [`T-0006`](./T-0006/ticket.json) | P1 | bug | `emulator/audio` | headless 没有音频帧泵 ⇒ 寄存语音/延迟 SE/BGM 淡变整条缺失 | 2 | `app/amayui-emulator/test/audio-node-host.test.ts` `app/amayui-emulator/test/frame-loop.test.ts` | `notes.md` `changes.md` | — |
| [`T-0007`](./T-0007/ticket.json) | P1 | bug | `emulator/input` | headless 完全没有悬停：serviceAdvanceWait 只在 Electron 被调用 | 3 | `app/amayui-emulator/test/game-start-chain.test.ts` `app/amayui-emulator/test/scenario.test.ts` `app/amayui-emulator/test/route-dispatch.test.ts` | `notes.md` | — |
| [`T-0008`](./T-0008/ticket.json) | P1 | bug | `emulator/render` | PixiBackend.waitFlags 只置不清 ⇒ needsRender() 永久为真（Electron 此后每帧 present） | 3 | `app/amayui-emulator/test/anim-window-done.test.ts` `app/amayui-emulator/test/frame-loop.test.ts` | `notes.md` `changes.md` | — |
| [`T-0011`](./T-0011/ticket.json) | P1 | bug | `emulator/frame-loop` | 两份 chain 无条件清 0x400 且从不推进动画窗 ⇒ E3 证据与产品路径不同源 | 2 | — | — | T-0001 |
| [`T-0024`](./T-0024/ticket.json) | P1 | bug | `emulator/render` | 0x400 门的真值没建模：sub_407E20 = 池挂起位 + 0x238 装载的等待计时器（现在门的动画口径无引擎依据） | 4 | `app/amayui-emulator/test/wait-gate-timer.test.ts` `app/amayui-emulator/test/anim-window-done.test.ts` `app/amayui-emulator/test/frame-loop.test.ts` `app/amayui-emulator/test/game-start-chain.test.ts` | `notes.md` `changes.md` | — |
| [`T-0027`](./T-0027/ticket.json) | P1 | bug | `emulator/input` | ADV 等待推进门把「按住态」当成新按下：一次点击连翻多页、按住即每帧推进 | 6 | `app/amayui-emulator/test/adv-msgwin.test.ts` `app/amayui-emulator/test/input.test.ts` | `notes.md` `changes.md` `repro.md` | — |
| [`T-0030`](./T-0030/ticket.json) | P1 | bug | `emulator/boot` | 首次运行（overlay 里没有 SYS4REG.INI）时 SAVE.DAT 既不装载也不回写 ⇒ 设置/侧栏编辑永远还原 | 6 | `app/amayui-emulator/test/save-data.test.ts` | `notes.md` `changes.md` evidence/(4) | — |
| [`T-0033`](./T-0033/ticket.json) | P1 | bug | `emulator/adv` | ADV 逐字显现期间的点击不生效：点击被攒到显完之后当成「推进」⇒ 快速点击要等整句逐字完才跳下一句 | 6 | `app/amayui-emulator/test/adv-msgwin.test.ts` `app/amayui-emulator/test/frame-loop.test.ts` | `notes.md` `changes.md` | — |
| [`T-0035`](./T-0035/ticket.json) | P1 | bug | `emulator/render` | 文本比引擎渲染更粗、白色更亮：抗锯齿/字重/描边与引擎的字体配置面（set:EnableAntiFont 等）不一致 | 8 | `app/amayui-emulator/test/text-aa.test.ts` `app/amayui-emulator/test/text-style-snapshot.test.ts` `app/amayui-emulator/test/font-bold-face.test.ts` `app/amayui-emulator/test/text-layout.test.ts` `app/amayui-emulator/test/draw-string.test.ts` | `notes.md` `changes.md` | — |
| [`T-0036`](./T-0036/ticket.json) | P1 | bug | `emulator/vm` | 存档界面右侧缩略图不显示：0x1AF 只校验长度、没把 .STH 里的 BMP 装进 op3 指定的纹理槽 | 4 | `app/amayui-emulator/test/save-thumb.test.ts` `app/amayui-emulator/test/save-slot.test.ts` `app/amayui-emulator/test/save-slot-chain.test.ts` | `notes.md` `changes.md` | — |
| [`T-0037`](./T-0037/ticket.json) | P1 | bug | `emulator/adv` | ADV 逐字显现期间注音（振假名）提前显示：注音没有和它本文词的**末字**同步出现 | 3 | `app/amayui-emulator/test/text-layout.test.ts` | `changes.md` | — |
| [`T-0038`](./T-0038/ticket.json) | P1 | bug | `emulator/adv` | ADV 行距没实现：换行步进少了 Font+1380（i08b），注音压到上一行字上 | 4 | `app/amayui-emulator/test/text-layout.test.ts` `app/amayui-emulator/test/engine-field-store.test.ts` | `changes.md` | — |
| [`T-0044`](./T-0044/ticket.json) | P1 | bug | `translation/src` | BTL/FIELD/HISTORY/MENU/SELBOMB/TITLE 的 src 缺 label 定义行 ⇒ assemble 骨架校验红、这 6 个脚本… | 4 | `scripts/check-skeleton.mjs` | — | — |
| [`T-0056`](./T-0056/ticket.json) | P1 | bug | `emulator/vm` | 读档崩在 `Depth が不正です 51 != 54`（读档不是普通还原，而是控制转移）+ 该错误在控制面版看不到 | 6 | `app/amayui-emulator/test/slot-load-transfer.test.ts` `app/amayui-emulator/test/control-error-banner.test.ts` `app/amayui-emulator/test/save-slot-chain.test.ts` `app/amayui-emulator/test/save-slot.test.ts` | `notes.md` | — |
| [`T-0057`](./T-0057/ticket.json) | P1 | refactor | `emulator/core` | emulator 实现审计与治理：消除『同一语义多处真源 / 魔法字段下标 / 临时补丁 / 静默错值』，把配置键、引擎字段与帧宿主收敛成单一建模 | 7 | `app/amayui-emulator/test/config-keys.test.ts` `app/amayui-emulator/test/engine-field-ids.test.ts` `app/amayui-emulator/test/engine-field-store.test.ts` `app/amayui-emulator/test/op-a2-a3.test.ts` `app/amayui-emulator/test/adv-msgwin.test.ts` `app/amayui-emulator/test/audio-opcodes.test.ts` | `notes.md` `changes.md` `design.md` | — |
| [`T-0059`](./T-0059/ticket.json) | P1 | req | `emulator/save-slot` | 真游戏槽（format=3）读档续跑：解状态主体（帧记录+三个池）并让 0xAE 走栈 | 6 | `app/amayui-emulator/test/engine-slot.test.ts` `app/amayui-emulator/test/slot-load-resume.test.ts` `app/amayui-emulator/test/slot-load-transfer.test.ts` | `notes.md` `changes.md` | — |
| [`T-0061`](./T-0061/ticket.json) | P1 | bug | `emulator/save-slot` | 存档退栈 + 读档转移：从 ADV 存档菜单存/读档不得停在菜单上 | 5 | `app/amayui-emulator/test/slot-save-resume.test.ts` `app/amayui-emulator/test/slot-load-transfer.test.ts` | `notes.md` `changes.md` | — |
| [`T-0063`](./T-0063/ticket.json) | P1 | bug | `emulator/save-slot` | 读档后存档界面残留在 ADV 上；并补齐被忽略的 clearMeshSlots / clearSlotRecords | 4 | `app/amayui-emulator/test/slot-save-resume.test.ts` | `notes.md` `changes.md` | — |
| [`T-0064`](./T-0064/ticket.json) | P1 | bug | `emulator/save-slot` | 读档后 BGM 丢失：补齐音乐运行态（当前曲 id）与引擎 CALLBACK_LOAD 的 i0b7 0 重播 | 5 | `app/amayui-emulator/test/slot-save-resume.test.ts` `app/amayui-emulator/test/audio-opcodes.test.ts` | `changes.md` | — |
| [`T-0065`](./T-0065/ticket.json) | P1 | bug | `emulator/save-slot` | 真槽（format=3）读档不续跑、直接跑回 TITLE：sv1/sv2 依赖玩家 INI 的 [set] 段 | 3 | `app/amayui-emulator/test/slot-load-resume.test.ts` | — | — |
| [`T-0068`](./T-0068/ticket.json) | P1 | bug | `emulator/save-data` | 真 SAVE.DAT 解析失败：字符串区/尾部块的自校验窗口过严（记录区 4481 vs 声明 4480） | 3 | `app/amayui-emulator/test/save-data.test.ts` `app/amayui-emulator/test/gallery-bgm-list.test.ts` | — | — |
| [`T-0069`](./T-0069/ticket.json) | P1 | bug | `emulator/save-data` | 存档列表没有标题、读档点不进去：overlay 的 SAVE.DAT 缺「按槽」的记录（需要两侧并表） | 4 | `app/amayui-emulator/test/save-data.test.ts` | — | — |
| [`T-0070`](./T-0070/ticket.json) | P1 | bug | `emulator/save-render` | 读档画面被二次播放：走栈期间场景入口重跑（重建遮罩 + 重播淡入） | 4 | `app/amayui-emulator/test/slot-save-resume.test.ts` | — | — |
| [`T-0071`](./T-0071/ticket.json) | P1 | bug | `emulator/save-load` | 真槽读档没装回「槽 → 图像」表，也没保住池外全局（画面缺图 / 续跑读到 0） | 5 | `app/amayui-emulator/test/slot-load-resume.test.ts` | — | — |
| [`T-0073`](./T-0073/ticket.json) | P1 | bug | `emulator/opcodes` | 0x2FA 未实现 ⇒ CALLBACK_LOAD.BIN 每帧空转卡死（读档收尾那一跳接不上） | 4 | `app/amayui-emulator/test/slot-load-resume.test.ts` | — | — |
| [`T-0078`](./T-0078/ticket.json) | P1 | docs | `analysis/engine-capabilities` | capabilities 台账失真 11 条（P0 2 / P1 7 / P2 2）：status/evidence/note 与代码和引擎都不符 | 5 | — | `notes.md` | — |
| [`T-0079`](./T-0079/ticket.json) | P1 | docs | `docs/03-engine` | 机制文档陈旧/错误 9 条（P0 2 / P1 7）：把「已实现」写成未建模、把有读者的字段写成死写 | 5 | — | `notes.md` | — |
| [`T-0087`](./T-0087/ticket.json) | P1 | bug | `emulator/render` | 0x223 写进了错误的容器：它是 Scene+1048 转场记录表的「类别 0（全屏交叉淡化）」写入端，emulator 却存进无人读的 Engine.it… | 5 | `app/amayui-emulator/test/op-223-transition-fade.test.ts` `app/amayui-emulator/test/op-24f-250-251-transitions.test.ts` | `changes.md` | — |
| [`T-0009`](./T-0009/ticket.json) | P2 | bug | `emulator/render` | 动画"完成"判据不自洽：scAnimationsDone 只看颜色窗 + 0x400 门读上一帧时钟 | 3 | `app/amayui-emulator/test/frame-loop.test.ts` | `notes.md` | — |
| [`T-0010`](./T-0010/ticket.json) | P2 | bug | `emulator/frame-loop` | report.ts 完全没有 0x400 / SLEEP_GATE 分支（置上后永不清、sleep 永不满足） | 2 | `app/amayui-emulator/test/scene-report.test.ts` | `notes.md` `changes.md` | T-0001 |
| [`T-0012`](./T-0012/ticket.json) | P2 | bug | `emulator/frame-loop` | run.ts 的帧循环：时钟只在一个分支前进、逐字分支顺序相反、缺 CharGrid/advActive | 2 | `app/amayui-emulator/test/run-cli-loop.test.ts` | `notes.md` `changes.md` | T-0001 |
| [`T-0013`](./T-0013/ticket.json) | P2 | refactor | `emulator/hosts` | 宿主能力面入桥：needsRender / animationsDone / preloadImage 不在 NativeBridge 也不在 nativeT… | 2 | `app/amayui-emulator/test/native-tap.test.ts` | `notes.md` `changes.md` | — |
| [`T-0016`](./T-0016/ticket.json) | P2 | bug | `emulator/adv` | #4 ADV 右侧面板仍被无条件展示，且 hover 时会触发并 cache 若干推进指令 | 4 | `app/amayui-emulator/test/adv-msgwin.test.ts` `app/amayui-emulator/test/route-dispatch.test.ts` `app/amayui-emulator/test/game-start-chain.test.ts` | `notes.md` `changes.md` | — |
| [`T-0017`](./T-0017/ticket.json) | P2 | req | `emulator/render` | 消费 Item.blend / MeshObj.blend（引擎的混合模式选择子 → Pixi blendMode） | 7 | `app/amayui-emulator/test/blend-mode.test.ts` | `notes.md` `changes.md` | — |
| [`T-0018`](./T-0018/ticket.json) | P2 | req | `emulator/vm` | 实现存档槽链路（0x19E 存 / 0x1A1 读 / 0x1A0 读头 / 0x19F 短读 / 0x1AB 删 / 0x1AC 复制 / 0x1AE·0x… | 6 | `app/amayui-emulator/test/save-slot.test.ts` `app/amayui-emulator/test/save-slot-chain.test.ts` `app/amayui-emulator/test/wheel.test.ts` `app/amayui-emulator/test/save-data.test.ts` | `notes.md` `changes.md` | — |
| [`T-0026`](./T-0026/ticket.json) | P2 | req | `emulator/render` | emulator.config.json 增加 resources 段（共用前缀）：resources.version（jp/cnjp）决定字体策略 + re… | 10 | `app/amayui-emulator/test/emulator-options.test.ts` `app/amayui-emulator/test/text-layout.test.ts` | `notes.md` `changes.md` | — |
| [`T-0028`](./T-0028/ticket.json) | P2 | bug | `emulator/adv` | ADV 侧边栏进入时即呈「hover 展开」外观：状态位与 16 槽平移不一致，手动 hover 移开后自愈 | 5 | `app/amayui-emulator/test/op-a4-a6.test.ts` | `notes.md` `changes.md` `repro.md` evidence/(7) | — |
| [`T-0031`](./T-0031/ticket.json) | P2 | bug | `emulator/boot` | 首次运行（无 SYS4REG.INI）时配置注册表改动不落盘：引擎字段层（消息速度/淡入、声音开关、音乐、显示模式、右键行为）重启即回默认 | 5 | `app/amayui-emulator/test/config-version-substr.test.ts` | `notes.md` `changes.md` evidence/(3) | — |
| [`T-0039`](./T-0039/ticket.json) | P2 | tooling | `emulator/test` | 闸门 C 的死写检测把注释里的 .field 当成「读」⇒ 一句文档注释就能让棘轮静默失效 | 4 | `app/amayui-emulator/test/no-dead-writes.test.ts` | `notes.md` | — |
| [`T-0040`](./T-0040/ticket.json) | P2 | tooling | `emulator/tools` | 测试期窗口贴屏幕边缘打开（不居中、不抢焦点）：shot/record 默认开启，--centered 可关 | 6 | `app/amayui-emulator/test/window-edge.test.ts` | — | — |
| [`T-0041`](./T-0041/ticket.json) | P2 | analysis | `emulator/render` | 未收敛：2D 合并段的 blend 状态由谁重设（引擎「状态泄漏」读法与真机可见行为矛盾） | 5 | `app/amayui-emulator/test/blend-mode.test.ts` | — | — |
| [`T-0042`](./T-0042/ticket.json) | P2 | bug | `emulator/render` | ADV 正文白度：emulator 画 255 纯白，真机实测核心亮度约 230-231（且不随背景变化） | 4 | `app/amayui-emulator/test/text-aa.test.ts` `app/amayui-emulator/test/draw-string.test.ts` | `notes.md` `changes.md` | — |
| [`T-0046`](./T-0046/ticket.json) | P2 | bug | `emulator/input` | CHARMEDIT（ADV 右侧菜单的编辑界面）在 emulator 里右键无反应：0x100 漏了「掩码为空 ⇒ 派发默认键槽（SetKeyTotal）」这… | 5 | `app/amayui-emulator/test/input.test.ts` | — | — |
| [`T-0047`](./T-0047/ticket.json) | P2 | bug | `emulator/input` | 0xCD 的节流间隔（Engine[429812]）没建模：它的真身是 mouse-callback(0xCC) 的 op1，emulator 恒 0 ⇒ 输… | 5 | `app/amayui-emulator/test/input.test.ts` `app/amayui-emulator/test/title-exit.test.ts` `app/amayui-emulator/test/route-dispatch.test.ts` | — | — |
| [`T-0048`](./T-0048/ticket.json) | P2 | req | `emulator/input` | 实现 0x10A（`i10a`：把光标移到虚拟屏坐标）—— 此前不在任何表里，命中即 NotImplementedOp；语料 1678 处、ADV 侧边栏悬停… | 5 | `app/amayui-emulator/test/input.test.ts` | `changes.md` | — |
| [`T-0049`](./T-0049/ticket.json) | P2 | req | `emulator/render` | 实现 0x214（`i214`：交换两条绘图项记录）—— 此前不在任何表里，命中即 NotImplementedOp；语料 229 处、ADV 收场块依赖它 | 5 | `app/amayui-emulator/test/op-214-swap-items.test.ts` | — | — |
| [`T-0050`](./T-0050/ticket.json) | P2 | req | `emulator/render` | 实现 0x32（`i032`：槽→槽的缩放转送 / StretchTexture）—— 存档缩略图的「缩屏」这一步，此前不在任何表里（命中即 NotImple… | 5 | `app/amayui-emulator/test/op-032-stretch-texture.test.ts` | — | — |
| [`T-0055`](./T-0055/ticket.json) | P2 | req | `emulator/vm` | 实现 0xD3/0xD4/0xD5「阶梯动画时间表」：把一段代码按时间轴分多次执行（存档动画 / 回想缓动 / 战斗入场 / 经验条） | 7 | `app/amayui-emulator/test/stage-loop.test.ts` | `notes.md` | — |
| [`T-0058`](./T-0058/ticket.json) | P2 | req | `emulator/hosts` | 建一个可复用的宿主侧原生模块工程（CMake + C++ + node-addon-api）：先落地 0x10A 的真实光标移动，后续宿主能力都走它 | 6 | `app/amayui-emulator/test/native-win32.test.ts` `app/amayui-emulator/test/input.test.ts` | — | — |
| [`T-0060`](./T-0060/ticket.json) | P2 | req | `emulator/ops` | 0x231（sub_4243F0，argc 4）未实现：真槽续跑后的 ADV 场景在 RESETREIGNAN.BIN 上死循环 | 3 | `app/amayui-emulator/test/draw-item-loop-anim.test.ts` `app/amayui-emulator/test/slot-load-resume.test.ts` `app/amayui-emulator/test/slot-load-transfer.test.ts` | `notes.md` | — |
| [`T-0014`](./T-0014/ticket.json) | P3 | tooling | `emulator/deadcode` | 删死代码：interpreter.run()、Engine.pickHoverLabel()、HeadlessScene.waitFlags、PixiBack… | 4 | `app/amayui-emulator/test/adv-msgwin.test.ts` `app/amayui-emulator/test/route-dispatch.test.ts` `app/amayui-emulator/test/anim-window-done.test.ts` | `notes.md` `changes.md` | — |
| [`T-0015`](./T-0015/ticket.json) | P3 | docs | `emulator/frame-loop` | 订正文档与代码矛盾：renderer.ts/native.ts 称"Pixi ticker 每帧驱动渲染"、run(frames) 返回语义不同 | 2 | — | — | — |
| [`T-0034`](./T-0034/ticket.json) | P3 | tooling | `emulator/test` | engine-config.test.ts 的两条断言直接读「真游戏 base 的 SYS4REG.INI」具体取值 ⇒ 玩家一改设置就红 | 3 | `app/amayui-emulator/test/engine-config.test.ts` | `changes.md` | — |
| [`T-0043`](./T-0043/ticket.json) | P3 | tooling | `emulator/test` | 两条守卫在本机必红：overlay 断言 Windows 绝对路径、config1-chain 依赖本地化 BIN 产物（assemble 还会因 insta… | 4 | `app/amayui-emulator/test/overlay.test.ts` `app/amayui-emulator/test/config1-chain.test.ts` | `notes.md` | — |
| [`T-0045`](./T-0045/ticket.json) | P3 | tooling | `tooling/repo` | 全量构建会把 941 个脚本全装进 install/：需要一个按 install-manifest 收口的工具（prune-install） | 4 | `scripts/prune-install.mjs` | — | — |
| [`T-0053`](./T-0053/ticket.json) | P3 | req | `emulator/hosts` | 0x10A 的宿主侧做不到：浏览器/Electron 没有「移动真实系统光标」的 API（SetCursorPos）—— 观感上的「光标跳过去」暂时无法实现 | 5 | `app/amayui-emulator/test/native-win32.test.ts` | — | — |
| [`T-0085`](./T-0085/ticket.json) | P3 | bug | `emulator/text` | set:BlankExtentMode == 1 的空白字前进量口径未建模（GDI 量宽分支缺失） | 5 | `app/amayui-emulator/test/op-205-blank-extent.test.ts` | — | — |
| [`T-0086`](./T-0086/ticket.json) | P3 | bug | `emulator/render` | 0x249（load-texture-by-id）丢了引擎对颜色操作数的归一化：未强置 A=0xFF、负值未落 0 | 4 | `app/amayui-emulator/test/op-underun-fixups.test.ts` `app/amayui-emulator/test/op-a2-a3.test.ts` | — | — |

## 🚫 dropped（1）

| id | P | 类型 | 域 | 标题 | 判据 | 守卫 | 过程文档 | 阻塞于 |
|---|---|---|---|---|---|---|---|---|
| [`T-0023`](./T-0023/ticket.json) | P3 | analysis | `engine/opcodes` | 把 88 条"md 已核对但数据层没有条目"的 opcode 语义回填 analysis/（按族推进） | 2 | — | — | — |

## 怎么用（30 秒）

```bash
node .agents/skills/amayui-ticket-ledger/scripts/tickets.js                 # 统计 + 待办清单
node .agents/skills/amayui-ticket-ledger/scripts/tickets.js --list --open   # 只看未完成
node .agents/skills/amayui-ticket-ledger/scripts/tickets.js --show T-0001   # 单票（含过程文档清单）
node .agents/skills/amayui-ticket-ledger/scripts/tickets.js --add '{"title":"…","type":"bug","area":"…","why":"…","acceptance":["…"]}'
node .agents/skills/amayui-ticket-ledger/scripts/tickets.js --set-status T-0001 doing --note "开工"
node .agents/skills/amayui-ticket-ledger/scripts/tickets.js --note T-0001 --file changes.md --text "第 1 次变更：…"
node scripts/build-tickets.mjs                                              # 刷新本页
node .agents/skills/amayui-ticket-ledger/scripts/tickets.js --validate      # 自检（锚点棘轮 / done 必须带守卫）
```

> 改完票据要重跑 `build-tickets.mjs`，否则 `test/ticket-ledger.test.ts` 会红（与 `analysis/*.json` 的台账同一纪律）。
