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
| opcode 缺口 | 未实现 **0**（语料 0 次）· unjustified no-op **0** · 有据 no-op **13** · 已实现 **39** · deferred **19** | `node scripts/build-opcode-gaps.mjs --check` |
| 引擎常态能力 | **139** 条：已核验 **58** / 已建模未核验 7 / 部分 32 / 缺失 19 / n/a 23 | `capabilities.js --root . --validate` |
| 脚本台账 | **33** 条：已分析 10 / 部分 22 / 仅登记 1 | `scripts.js --root . --validate` |
| 票据 | **120** 张 | `tickets.js --root . --validate` |

**能力缺口（需要关注 = 非 n/a 且非已核验）**：

`消息窗` 18 · `渲染` 15 · `帧循环` 8 · `资源` 6 · `3D` 5 · `转场` 2 · `Live2D` 2 · `输入` 1 · `声音` 1（共 58 条）

> 详细条目：`capabilities.js --root .` / 单条全文 `capabilities.js --root . --show <id>`。

## 2. 工作项

状态：`doing` **5** · `done` **103** · `dropped` **1** · `open` **11**

未完成按优先级：`P0` 0 · `P1` 1 · `P2` 4 · `P3` 11

| P | 状态 | id | 域 | 标题 | 阻塞于 |
|---|---|---|---|---|---|
| P1 | doing | [`T-0102`](../../tickets/T-0102/ticket.json) | `emulator/adv` | 进入 SC 场景后 ADV 窗口背景是白色（展开/收起侧边栏菜单刷新后才正确）；阿瓦罗角色名颜色变青色（预期橘色） | — |
| P2 | doing | [`T-0067`](../../tickets/T-0067/ticket.json) | `emulator/render` | 保存时存档页面闪一帧（瞬间露出 ADV 界面） | — |
| P2 | doing | [`T-0114`](../../tickets/T-0114/ticket.json) | `emulator/tooling` | 控制面板强化为调试器：① 调试查询（已落地）② 断点/表达式日志 ③ 内存快照/恢复 | — |
| P2 | open | [`T-0109`](../../tickets/T-0109/ticket.json) | `emulator/adv` | B7-A：ADV 阅读链路清尾 —— 消息回看页表/滚轮（0x84 前进）+ 文本断行·注音配对 | — |
| P2 | open | [`T-0115`](../../tickets/T-0115/ticket.json) | `emulator/test` | verify 太慢：四个 E3 真语料测试文件占掉大半（建议共享 fixture / 分档） | — |
| P3 | doing | [`T-0091`](../../tickets/T-0091/ticket.json) | `emulator/render` | 转场渲染剩余四项：类别 3 的精确核 / [4] 非 create-texture 槽 / Scene+46508·46512·46516  | — |
| P3 | doing | [`T-0111`](../../tickets/T-0111/ticket.json) | `emulator/ops` | B7-C：低影响登记与派发接线（opcode-table 行同步 / 0x308 触摸注册 / 0x1F5→sub_40FB60） | — |
| P3 | open | [`T-0019`](../../tickets/T-0019/ticket.json) | `emulator/msgwin` | 拆 handlers/msgwin.ts（1338 行）与 vm/msgwin.ts（803 行） | — |
| P3 | open | [`T-0020`](../../tickets/T-0020/ticket.json) | `emulator/test` | 收敛测试结构：mk() 17 变体统一 + 5 处自造帧循环接到共享驱动 | — |
| P3 | open | [`T-0051`](../../tickets/T-0051/ticket.json) | `emulator/verify` | 真机/真界面待验证清单（E4）：0x32 存档缩略图、0x32 缩放插值、0x207 同尺寸转送、0x214 收场换位、0x10A 侧栏钉光 | — |
| P3 | open | [`T-0088`](../../tickets/T-0088/ticket.json) | `emulator/hosts` | AGERC 对话框宿主缝缺口：0x140（AGERC ShowDialog cmd 8）的返回值只能由真人点选，且两张运行时表未建模 | — |
| P3 | open | [`T-0103`](../../tickets/T-0103/ticket.json) | `emulator/render` | SN0000 → SC0000 的章节切换演出（转场）多处不一致（用户描述：很难讲清，先记录） | — |
| P3 | open | [`T-0107`](../../tickets/T-0107/ticket.json) | `analysis/emulator/live2d` | INFOEN 的 L2D 资产 id 表（全局槽 527d8c / 528944）真源未定位：脚本 0 写点 ⇒ 需要找出引擎侧是谁填的 | — |
| P3 | open | [`T-0108`](../../tickets/T-0108/ticket.json) | `analysis` | 数据层沿革话术：semantics/note 里的「订正/原记/旧写」146 处 → 结论留原文、沿革落 journal[] | — |
| P3 | open | [`T-0112`](../../tickets/T-0112/ticket.json) | `docs/03-engine` | B7-B 残余：逐格待核（adv-text-rendering 字段表行号 / 0x204 措辞 / AutoLineFeed / copy | — |
| P3 | open | [`T-0118`](../../tickets/T-0118/ticket.json) | `analysis/emulator/verify` | darwin 预置通用二进制的 **x86_64 slice 未实跑**（本机无 Rosetta）：到 Intel Mac / 装了 Ros | — |

> 单票：`tickets.js --root . --show <ID>`；看板：`tickets/README.md`。

## 3. 沿革

`analysis/journal.jsonl`：**41** 条 / 轮次 4 5 6 7 8 9 47。

最近一条：**宿主原生模块**平台维度的收敛**：win32-input + macos-input 合并成 `native/host-input`（一个 addon 两个平台实现，T-0119）**（`tickets/T-0119/changes.md · tickets/T-0119/notes.md`，票 T-0119 T-0053 T-0058 T-0116 T-0117 T-0118 T-0120）

> `node scripts/journal.js --tail 5` / `--round N` / `--ticket T-xxxx` / `--lessons`。
> **沿革不在任何生成物里**（本页只引用最后一条的标题，不展开正文）。

## 4. 下一步（从票据派生，不是手写）

- **`T-0102`**（P1/doing）进入 SC 场景后 ADV 窗口背景是白色（展开/收起侧边栏菜单刷新后才正确）；阿瓦罗角色名颜色变青色（预期橘色）
- **`T-0067`**（P2/doing）保存时存档页面闪一帧（瞬间露出 ADV 界面）
- **`T-0114`**（P2/doing）控制面板强化为调试器：① 调试查询（已落地）② 断点/表达式日志 ③ 内存快照/恢复
- **`T-0091`**（P3/doing）转场渲染剩余四项：类别 3 的精确核 / [4] 非 create-texture 槽 / Scene+46508·46512·46516 三标志本身 / E4 可达路径
- **`T-0111`**（P3/doing）B7-C：低影响登记与派发接线（opcode-table 行同步 / 0x308 触摸注册 / 0x1F5→sub_40FB60）

> 开门前的会话级前置与纪律：`docs-new/03-engine/handoff.md` §1.0 / §2。
