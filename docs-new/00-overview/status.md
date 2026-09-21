---
kind: generated
state: live
home: analysis/*.json + tickets/*/ticket.json
generated_by: scripts/build-status.mjs
---

# 当前状态（生成物）

> 由四份台账 + 票据 + 沿革实时算出：`node scripts/build-status.mjs`。**勿手改。**
> ★**本页故意不写"测试条数"这类只能跑出来的数** —— 跑 `cd app/amayui-emulator && npm run verify` 看。
> 手抄的数必然漂移（实测：同一个测试条数曾在 4 份文档里各写一遍，4 处全错）。

## 1. 四份台账

| 台账 | 口径 | 复核命令 |
|---|---|---|
| opcode 缺口 | 未实现 **0**（语料 0 次）· unjustified no-op **0** · 有据 no-op **13** · 已实现 **38** · deferred **20** | `node scripts/build-opcode-gaps.mjs --check` |
| 引擎常态能力 | **136** 条：已核验 **53** / 已建模未核验 7 / 部分 31 / 缺失 21 / n/a 24 | `capabilities.js --root . --validate` |
| 脚本台账 | **30** 条：已分析 10 / 部分 19 / 仅登记 1 | `scripts.js --root . --validate` |
| 票据 | **105** 张 | `tickets.js --root . --validate` |

**能力缺口（需要关注 = 非 n/a 且非已核验）**：

`消息窗` 18 · `渲染` 14 · `帧循环` 8 · `资源` 6 · `3D` 5 · `Live2D` 4 · `转场` 2 · `输入` 1 · `声音` 1（共 59 条）

> 详细条目：`capabilities.js --root .` / 单条全文 `capabilities.js --root . --show <id>`。

## 2. 工作项

状态：`doing` **4** · `done` **79** · `dropped` **1** · `open` **21**

未完成按优先级：`P0` 0 · `P1` 5 · `P2` 3 · `P3` 17

| P | 状态 | id | 域 | 标题 | 阻塞于 |
|---|---|---|---|---|---|
| P1 | doing | [`T-0062`](../../tickets/T-0062/ticket.json) | `renderer/scene` | 存档缩略图全黑：0x20D 渲染目标窗口里的 0x20C 必须把整帧画进该槽 | — |
| P1 | doing | [`T-0082`](../../tickets/T-0082/ticket.json) | `emulator/vm` | RF-A 操作数读取计划重构：per-opcode 计划层 + arity 槽（`frame.state[95805]`）建模 + argc | — |
| P1 | open | [`T-0075`](../../tickets/T-0075/ticket.json) | `docs/03-engine` | 文档×实现 凭空/推测点审计：opcode-table 574 行 + capabilities 130 条 + 17 份机制文档逐条与引擎 | — |
| P1 | open | [`T-0080`](../../tickets/T-0080/ticket.json) | `docs/03-engine` | 修复总计划（2026-09）：按审计结论排序、区分「补实现 / 改实现 / 必须重构」 | — |
| P1 | open | [`T-0102`](../../tickets/T-0102/ticket.json) | `emulator/adv` | 进入 SC 场景后 ADV 窗口背景是白色（展开/收起侧边栏菜单刷新后才正确）；阿瓦罗角色名颜色变青色（预期橘色） | — |
| P2 | doing | [`T-0054`](../../tickets/T-0054/ticket.json) | `emulator/render` | Live2D 支持：先定依赖路线（自研移值 / Cubism 2.1 运行时 / Cubism 5），再按 TITLE·INFOEN·BTL | — |
| P2 | open | [`T-0067`](../../tickets/T-0067/ticket.json) | `emulator/render` | 保存时存档页面闪一帧（瞬间露出 ADV 界面） | — |
| P2 | open | [`T-0104`](../../tickets/T-0104/ticket.json) | `emulator/adv` | 0x82（sub_41F720 → GDI 文本族 sub_466000）未建模：现为 STUB 放行，需补「重绘哪个窗」的口径 | — |
| P3 | doing | [`T-0091`](../../tickets/T-0091/ticket.json) | `emulator/render` | 转场渲染剩余四项：类别 3 的精确核 / [4] 非 create-texture 槽 / Scene+46508·46512·46516  | — |
| P3 | open | [`T-0019`](../../tickets/T-0019/ticket.json) | `emulator/msgwin` | 拆 handlers/msgwin.ts（1338 行）与 vm/msgwin.ts（803 行） | — |
| P3 | open | [`T-0020`](../../tickets/T-0020/ticket.json) | `emulator/test` | 收敛测试结构：mk() 17 变体统一 + 5 处自造帧循环接到共享驱动 | — |
| P3 | open | [`T-0021`](../../tickets/T-0021/ticket.json) | `emulator/arch` | 消 A1 分层违规：arch/nodeFileSource.ts 与 electron/ipc/files.ts 反向依赖 vm/saveD | — |
| P3 | open | [`T-0022`](../../tickets/T-0022/ticket.json) | `repo` | 跨包边与孤儿文件清理（src/opcodes.ts → scripts/asm/opcodes.json；根 age_map_src.mjs | — |
| P3 | open | [`T-0025`](../../tickets/T-0025/ticket.json) | `emulator/render` | headless 自带 AGF 尺寸解析：让 0x208 不再依赖录制 | — |
| P3 | open | [`T-0029`](../../tickets/T-0029/ticket.json) | `emulator/render` | 删掉 boot 里的 PRELOAD_IMAGES：统一走 0x1F9 绑定时的按需加载（TextureCache + 帧屏障） | — |
| P3 | open | [`T-0032`](../../tickets/T-0032/ticket.json) | `emulator/tools` | tools/record.cjs 的 --out 按仓库根解析、--scenario 按 cwd：传 cwd 相对路径会去仓库外 mkdir | — |
| P3 | open | [`T-0051`](../../tickets/T-0051/ticket.json) | `emulator/verify` | 真机/真界面待验证清单（E4）：0x32 存档缩略图、0x32 缩放插值、0x207 同尺寸转送、0x214 收场换位、0x10A 侧栏钉光 | — |
| P3 | open | [`T-0052`](../../tickets/T-0052/ticket.json) | `emulator/input` | 键盘掩码位（0..6）没有接入：emulator 只支持鼠标 ⇒ 键盘/手柄式菜单操作（joy-callback 0..4）与 T-0048 | — |
| P3 | open | [`T-0088`](../../tickets/T-0088/ticket.json) | `emulator/hosts` | AGERC 对话框宿主缝缺口：0x140（AGERC ShowDialog cmd 8）的返回值只能由真人点选，且两张运行时表未建模 | — |
| P3 | open | [`T-0089`](../../tickets/T-0089/ticket.json) | `emulator/vm` | 模块环：handlers/save-slot → vm/ops → handlers/index → handlers/save-slot（ | — |
| P3 | open | [`T-0098`](../../tickets/T-0098/ticket.json) | `emulator/vm` | 0x2ED（message:MessageFade 读侧）未注册 + 0x107/0x10B/0xFE 位号的有符号口径（引擎真抛、emul | — |
| P3 | open | [`T-0099`](../../tickets/T-0099/ticket.json) | `emulator/frame-loop` | sleep 门的帧粒度残差：0x196/0x6E 的 MessageSpeed 节流在 40ms 档每处多等约一帧（实测 66.7ms vs | — |
| P3 | open | [`T-0101`](../../tickets/T-0101/ticket.json) | `emulator/msgwin` | 文本/消息窗的两处遗留口径：默认窗有两个真源（i080 之前不一致）+ MsgWindow.textSlotArg 是死字段 | — |
| P3 | open | [`T-0103`](../../tickets/T-0103/ticket.json) | `emulator/render` | SN0000 → SC0000 的章节切换演出（转场）多处不一致（用户描述：很难讲清，先记录） | — |
| P3 | open | [`T-0105`](../../tickets/T-0105/ticket.json) | `docs/03-engine` | 文档模型收尾：机制叙述与台账的重复段清理 + copyright-effect 无台账落点 | — |

> 单票：`tickets.js --root . --show <ID>`；看板：`tickets/README.md`。

## 3. 沿革

`analysis/journal.jsonl`：**39** 条 / 轮次 4 5 6 7 8 9 47。

最近一条：**audit-2026-09 §6 修复状态（滚动更新）**（`audit-2026-09.md:110-155`，票 T-0017 T-0052 T-0060 T-0066 T-0076 T-0077 T-0078 T-0079 T-0081 T-0083 T-0084 T-0085 T-0086 T-0087 T-0088 T-0091 T-0093 T-0094 T-0096 T-0097）

> `node scripts/journal.js --tail 5` / `--round N` / `--ticket T-xxxx` / `--lessons`。
> **沿革不在任何生成物里**（本页只引用最后一条的标题，不展开正文）。

## 4. 下一步（从票据派生，不是手写）

- **`T-0062`**（P1/doing）存档缩略图全黑：0x20D 渲染目标窗口里的 0x20C 必须把整帧画进该槽
- **`T-0082`**（P1/doing）RF-A 操作数读取计划重构：per-opcode 计划层 + arity 槽（`frame.state[95805]`）建模 + argc 自动核验
- **`T-0054`**（P2/doing）Live2D 支持：先定依赖路线（自研移值 / Cubism 2.1 运行时 / Cubism 5），再按 TITLE·INFOEN·BTL 三处用例分阶段落地
- **`T-0091`**（P3/doing）转场渲染剩余四项：类别 3 的精确核 / [4] 非 create-texture 槽 / Scene+46508·46512·46516 三标志本身 / E4 可达路径
- **`T-0075`**（P1/open）文档×实现 凭空/推测点审计：opcode-table 574 行 + capabilities 130 条 + 17 份机制文档逐条与引擎反编译对照
- **`T-0080`**（P1/open）修复总计划（2026-09）：按审计结论排序、区分「补实现 / 改实现 / 必须重构」
- **`T-0102`**（P1/open）进入 SC 场景后 ADV 窗口背景是白色（展开/收起侧边栏菜单刷新后才正确）；阿瓦罗角色名颜色变青色（预期橘色）

> 开门前的会话级前置与纪律：`docs-new/03-engine/handoff.md` §1.0 / §2。
