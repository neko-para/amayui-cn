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
| opcode 缺口 | 未实现 **5**（语料 0 次）· unjustified no-op **0** · 有据 no-op **9** · 已实现 **74** · 部分实现 **72** · deferred **22** | `node scripts/build-opcode-gaps.mjs --check` |
| 引擎常态能力 | **144** 条：已核验 **79** / 已建模未核验 5 / 部分 31 / 缺失 5 / n/a 24 | `capabilities.js --root . --validate` |
| 脚本台账 | **37** 条：已分析 10 / 部分 25 / 仅登记 2 | `scripts.js --root . --validate` |
| 票据 | **177** 张 | `tickets.js --root . --validate` |

**能力缺口（需要关注 = 非 n/a 且非已核验）**：

`消息窗` 17 · `渲染` 9 · `帧循环` 5 · `资源` 5 · `Live2D` 2 · `声音` 1 · `3D` 1 · `ScriptContext` 1（共 41 条）

> 详细条目：`capabilities.js --root .` / 单条全文 `capabilities.js --root . --show <id>`。

## 2. 工作项

状态：`doing` **4** · `done` **166** · `dropped` **2** · `open` **5**

未完成按优先级：`P0` 0 · `P1` 1 · `P2` 3 · `P3` 5

| P | 状态 | id | 域 | 标题 | 阻塞于 |
|---|---|---|---|---|---|
| P1 | doing | [`T-0148`](../../tickets/T-0148/ticket.json) | `analysis/emulator/vm` | 全指令「实现 × 引擎」逐条核对与缺口汇总（2026-09）：364 条注册指令 + 54 条能力条目 | — |
| P2 | doing | [`T-0067`](../../tickets/T-0067/ticket.json) | `emulator/render` | 保存时存档页面闪一帧（瞬间露出 ADV 界面） | — |
| P2 | doing | [`T-0142`](../../tickets/T-0142/ticket.json) | `emulator/tooling` | 把 Electron 侧的 agent 调试通道也收敛到 VM 外层桥（debugsrv 的 sendInputEvent → Scenar | — |
| P2 | doing | [`T-0179`](../../tickets/T-0179/ticket.json) | `analysis/analysis/emulator/vm` | 缺口台账 `partial` 的 140 条 `missing[]` 缺 live 承接票：批量改指本票 + 逐条裁决（实现 / 关掉 /  | — |
| P3 | open | [`T-0019`](../../tickets/T-0019/ticket.json) | `emulator/msgwin` | 拆 handlers/msgwin.ts（1338 行）与 vm/msgwin.ts（803 行） | — |
| P3 | open | [`T-0051`](../../tickets/T-0051/ticket.json) | `emulator/verify` | 真机/真界面待验证清单（E4）：0x32 存档缩略图、0x32 缩放插值、0x207 同尺寸转送、0x214 收场换位、0x10A 侧栏钉光 | — |
| P3 | open | [`T-0088`](../../tickets/T-0088/ticket.json) | `emulator/hosts` | AGERC 对话框宿主缝缺口：0x140（AGERC ShowDialog cmd 8）的返回值只能由真人点选，且两张运行时表未建模 | — |
| P3 | open | [`T-0103`](../../tickets/T-0103/ticket.json) | `emulator/render` | SN0000 → SC0000 的章节切换演出（转场）多处不一致（用户描述：很难讲清，先记录） | — |
| P3 | open | [`T-0118`](../../tickets/T-0118/ticket.json) | `analysis/emulator/verify` | darwin 预置通用二进制的 **x86_64 slice 未实跑**（本机无 Rosetta）：到 Intel Mac / 装了 Ros | — |

> 单票：`tickets.js --root . --show <ID>`；看板：`tickets/README.md`。

## 3. 沿革

`analysis/journal.jsonl`：**48** 条 / 轮次 4 5 6 7 8 9 47 ／ 标签：T-0148 实施轮（P1） · T-0148 实施轮（滚轮/回想链追查）。

最近一条：**CONTEXT §8「不在任何技能里的 18 条」拆回各自落点，CONTEXT 删掉该节；17 处悬空指针一并修掉**（`CONTEXT.md（§8 已删）+ docs-new/00-overview/lessons.md + docs-new/04-app/{test-organization,emulator-refactor-plan}.md + amayui-engine-analysis SKILL`，票 T-0019 T-0020 T-0148 T-0179）

> `node scripts/journal.js --tail 5` / `--round N` / `--ticket T-xxxx` / `--lessons`。
> **沿革不在任何生成物里**（本页只引用最后一条的标题，不展开正文）。

## 4. 下一步（从票据派生，不是手写）

- **`T-0148`**（P1/doing）全指令「实现 × 引擎」逐条核对与缺口汇总（2026-09）：364 条注册指令 + 54 条能力条目
- **`T-0067`**（P2/doing）保存时存档页面闪一帧（瞬间露出 ADV 界面）
- **`T-0142`**（P2/doing）把 Electron 侧的 agent 调试通道也收敛到 VM 外层桥（debugsrv 的 sendInputEvent → ScenarioEvent、shot → FrameHost.capture）
- **`T-0179`**（P2/doing）缺口台账 `partial` 的 140 条 `missing[]` 缺 live 承接票：批量改指本票 + 逐条裁决（实现 / 关掉 / 保留并写重开条件）

> 开门前的会话级前置与纪律：`docs-new/03-engine/handoff.md` §1.0 / §2。
