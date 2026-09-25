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
| opcode 缺口 | 未实现 **5**（语料 0 次）· unjustified no-op **0** · 有据 no-op **9** · 已实现 **66** · 部分实现 **80** · deferred **22** | `node scripts/build-opcode-gaps.mjs --check` |
| 引擎常态能力 | **144** 条：已核验 **79** / 已建模未核验 5 / 部分 30 / 缺失 6 / n/a 24 | `capabilities.js --root . --validate` |
| 脚本台账 | **37** 条：已分析 10 / 部分 25 / 仅登记 2 | `scripts.js --root . --validate` |
| 票据 | **177** 张 | `tickets.js --root . --validate` |

**能力缺口（需要关注 = 非 n/a 且非已核验）**：

`消息窗` 17 · `渲染` 9 · `帧循环` 5 · `资源` 5 · `Live2D` 2 · `声音` 1 · `3D` 1 · `ScriptContext` 1（共 41 条）

> 详细条目：`capabilities.js --root .` / 单条全文 `capabilities.js --root . --show <id>`。

## 2. 工作项

状态：`doing` **3** · `done` **163** · `dropped` **2** · `open` **9**

未完成按优先级：`P0` 0 · `P1` 1 · `P2` 4 · `P3` 7

| P | 状态 | id | 域 | 标题 | 阻塞于 |
|---|---|---|---|---|---|
| P1 | doing | [`T-0148`](../../tickets/T-0148/ticket.json) | `analysis/emulator/vm` | 全指令「实现 × 引擎」逐条核对与缺口汇总（2026-09）：364 条注册指令 + 54 条能力条目 | — |
| P2 | doing | [`T-0067`](../../tickets/T-0067/ticket.json) | `emulator/render` | 保存时存档页面闪一帧（瞬间露出 ADV 界面） | — |
| P2 | open | [`T-0122`](../../tickets/T-0122/ticket.json) | `emulator/tooling` | 调试器第 3 步：内存快照/恢复（引擎态 dump 与回灌） | — |
| P2 | open | [`T-0142`](../../tickets/T-0142/ticket.json) | `emulator/tooling` | 把 Electron 侧的 agent 调试通道也收敛到 VM 外层桥（debugsrv 的 sendInputEvent → Scenar | — |
| P2 | open | [`T-0179`](../../tickets/T-0179/ticket.json) | `analysis/analysis/emulator/vm` | 缺口台账 `partial` 的 140 条 `missing[]` 缺 live 承接票：批量改指本票 + 逐条裁决（实现 / 关掉 /  | — |
| P3 | doing | [`T-0091`](../../tickets/T-0091/ticket.json) | `emulator/render` | 转场渲染剩余四项：类别 3 的精确核 / [4] 非 create-texture 槽 / Scene+46508·46512·46516  | — |
| P3 | open | [`T-0019`](../../tickets/T-0019/ticket.json) | `emulator/msgwin` | 拆 handlers/msgwin.ts（1338 行）与 vm/msgwin.ts（803 行） | — |
| P3 | open | [`T-0051`](../../tickets/T-0051/ticket.json) | `emulator/verify` | 真机/真界面待验证清单（E4）：0x32 存档缩略图、0x32 缩放插值、0x207 同尺寸转送、0x214 收场换位、0x10A 侧栏钉光 | — |
| P3 | open | [`T-0088`](../../tickets/T-0088/ticket.json) | `emulator/hosts` | AGERC 对话框宿主缝缺口：0x140（AGERC ShowDialog cmd 8）的返回值只能由真人点选，且两张运行时表未建模 | — |
| P3 | open | [`T-0103`](../../tickets/T-0103/ticket.json) | `emulator/render` | SN0000 → SC0000 的章节切换演出（转场）多处不一致（用户描述：很难讲清，先记录） | — |
| P3 | open | [`T-0118`](../../tickets/T-0118/ticket.json) | `analysis/emulator/verify` | darwin 预置通用二进制的 **x86_64 slice 未实跑**（本机无 Rosetta）：到 Intel Mac / 装了 Ros | — |
| P3 | open | [`T-0146`](../../tickets/T-0146/ticket.json) | `emulator/test` | 预先存在的 verify 红（3 条）：真槽 SAVE70/71 解析、scene-report 占位项下限 —— A/B 已证与 D1~D | — |

> 单票：`tickets.js --root . --show <ID>`；看板：`tickets/README.md`。

## 3. 沿革

`analysis/journal.jsonl`：**47** 条 / 轮次 4 5 6 7 8 9 47 ／ 标签：T-0148 实施轮（P1） · T-0148 实施轮（滚轮/回想链追查）。

最近一条：**票据证据行号补全：全库 1003 条被锚证据的 line 归零，同时把工具改成"多命中不猜"**（`tickets/（26 张票的 ticket.json）+ .agents/skills/amayui-ticket-ledger/scripts/fix-evidence-lines.js`，票 T-0112 T-0148 T-0153 T-0168 T-0173 T-0174）

> `node scripts/journal.js --tail 5` / `--round N` / `--ticket T-xxxx` / `--lessons`。
> **沿革不在任何生成物里**（本页只引用最后一条的标题，不展开正文）。

## 4. 下一步（从票据派生，不是手写）

- **`T-0148`**（P1/doing）全指令「实现 × 引擎」逐条核对与缺口汇总（2026-09）：364 条注册指令 + 54 条能力条目
- **`T-0067`**（P2/doing）保存时存档页面闪一帧（瞬间露出 ADV 界面）
- **`T-0091`**（P3/doing）转场渲染剩余四项：类别 3 的精确核 / [4] 非 create-texture 槽 / Scene+46508·46512·46516 三标志本身 / E4 可达路径

> 开门前的会话级前置与纪律：`docs-new/03-engine/handoff.md` §1.0 / §2。
