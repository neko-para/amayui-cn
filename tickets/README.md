# 需求 / 缺陷单看板

> **生成物**：由 `tickets/<ID>/ticket.json`（真源）渲染，`node scripts/build-tickets.mjs`。**勿手改本文件。**
> 单票的可读视图：`node .agents/skills/amayui-ticket-ledger/scripts/tickets.js --show <ID>`
> （它会把 `ticket.json` 与该票**所有过程文档**一起列出来；过程文档在 `tickets/<ID>/` 里手写。）
> 纪律与 schema：`docs-new/00-overview/tickets.md`；维护流程见 `amayui-ticket-ledger` 技能。

## 概览

共 **23** 张：🔜 doing **0** · ⛔ blocked **0** · ⬜ open **23** · ✅ done **0** · 🚫 dropped **0**（P0 0 / P1 8）

按域：`emulator/frame-loop` 9 · `emulator/render` 3 · `emulator/audio` 1 · `emulator/input` 1 · `emulator/hosts` 1 · `emulator/deadcode` 1 · `emulator/adv` 1 · `emulator/vm` 1 · `emulator/msgwin` 1 · `emulator/test` 1 · `emulator/arch` 1 · `repo` 1 · `engine/opcodes` 1

## ⬜ open（23）

| id | P | 类型 | 域 | 标题 | 判据 | 守卫 | 过程文档 | 阻塞于 |
|---|---|---|---|---|---|---|---|---|
| [`T-0001`](./T-0001/ticket.json) | P1 | refactor | `emulator/frame-loop` | B1 抽共享帧驱动 src/frame/*，先把 headless 各循环接上（零行为变更） | 4 | — | `notes.md` | — |
| [`T-0002`](./T-0002/ticket.json) | P1 | refactor | `emulator/frame-loop` | B2 收敛帧循环的漂移（14 条工单，逐条 before/after 对照） | 3 | — | `notes.md` | T-0001 |
| [`T-0003`](./T-0003/ticket.json) | P1 | req | `emulator/frame-loop` | B3 headless 补齐能力面：audio 帧泵 / needsRender 语义 / 输入源（⇒ 悬停真的跑）/ digest | 4 | — | — | T-0001 |
| [`T-0004`](./T-0004/ticket.json) | P1 | refactor | `emulator/frame-loop` | B4 Electron 迁到帧驱动：session.ts 缩成"装配 + 观察者 + yield" | 4 | — | — | T-0001 T-0002 |
| [`T-0006`](./T-0006/ticket.json) | P1 | bug | `emulator/audio` | headless 没有音频帧泵 ⇒ 寄存语音/延迟 SE/BGM 淡变整条缺失 | 2 | — | — | — |
| [`T-0007`](./T-0007/ticket.json) | P1 | bug | `emulator/input` | headless 完全没有悬停：serviceAdvanceWait 只在 Electron 被调用 | 3 | — | — | — |
| [`T-0008`](./T-0008/ticket.json) | P1 | bug | `emulator/render` | PixiBackend.waitFlags 只置不清 ⇒ needsRender() 永久为真（Electron 此后每帧 present） | 3 | — | — | — |
| [`T-0011`](./T-0011/ticket.json) | P1 | bug | `emulator/frame-loop` | 两份 chain 无条件清 0x400 且从不推进动画窗 ⇒ E3 证据与产品路径不同源 | 2 | — | — | T-0001 |
| [`T-0005`](./T-0005/ticket.json) | P2 | req | `emulator/frame-loop` | B5 统一 Scenario（shot.cjs 的点击脚本 与 chain 的输入驱动合一）+ --record/--replay 回放器 | 3 | — | — | T-0004 |
| [`T-0009`](./T-0009/ticket.json) | P2 | bug | `emulator/render` | 动画"完成"判据不自洽：scAnimationsDone 只看颜色窗 + 0x400 门读上一帧时钟 | 3 | — | — | — |
| [`T-0010`](./T-0010/ticket.json) | P2 | bug | `emulator/frame-loop` | report.ts 完全没有 0x400 / SLEEP_GATE 分支（置上后永不清、sleep 永不满足） | 2 | — | — | T-0001 |
| [`T-0012`](./T-0012/ticket.json) | P2 | bug | `emulator/frame-loop` | run.ts 的帧循环：时钟只在一个分支前进、逐字分支顺序相反、缺 CharGrid/advActive | 2 | — | — | T-0001 |
| [`T-0013`](./T-0013/ticket.json) | P2 | refactor | `emulator/hosts` | 宿主能力面入桥：needsRender / animationsDone / preloadImage 不在 NativeBridge 也不在 nativeT… | 2 | — | — | — |
| [`T-0014`](./T-0014/ticket.json) | P2 | tooling | `emulator/deadcode` | 删死代码：interpreter.run()、Engine.pickHoverLabel()、HeadlessScene.waitFlags、PixiBack… | 2 | — | — | — |
| [`T-0016`](./T-0016/ticket.json) | P2 | bug | `emulator/adv` | #4 ADV 右侧面板仍被无条件展示，且 hover 时会触发并 cache 若干推进指令 | 3 | — | — | — |
| [`T-0017`](./T-0017/ticket.json) | P2 | req | `emulator/render` | 消费 Item.blend / MeshObj.blend（引擎的混合模式选择子 → Pixi blendMode） | 2 | — | — | — |
| [`T-0018`](./T-0018/ticket.json) | P2 | req | `emulator/vm` | 实现 0x1A0（读档：SAVE%2.2d.DAT + sub_438120） | 2 | — | — | — |
| [`T-0015`](./T-0015/ticket.json) | P3 | docs | `emulator/frame-loop` | 订正文档与代码矛盾：renderer.ts/native.ts 称"Pixi ticker 每帧驱动渲染"、run(frames) 返回语义不同 | 2 | — | — | — |
| [`T-0019`](./T-0019/ticket.json) | P3 | refactor | `emulator/msgwin` | 拆 handlers/msgwin.ts（1338 行）与 vm/msgwin.ts（803 行） | 3 | — | — | — |
| [`T-0020`](./T-0020/ticket.json) | P3 | refactor | `emulator/test` | 收敛测试结构：mk() 17 变体统一 + 5 处自造帧循环接到共享驱动 | 2 | — | — | — |
| [`T-0021`](./T-0021/ticket.json) | P3 | refactor | `emulator/arch` | 消 A1 分层违规：arch/nodeFileSource.ts 与 electron/ipc/files.ts 反向依赖 vm/saveData | 2 | — | — | — |
| [`T-0022`](./T-0022/ticket.json) | P3 | tooling | `repo` | 跨包边与孤儿文件清理（src/opcodes.ts → scripts/asm/opcodes.json；根 age_map_src.mjs 等） | 2 | — | — | — |
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
