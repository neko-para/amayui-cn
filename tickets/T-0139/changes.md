# T-0139 · 变更记录

---

## 变更 1（2026-09-23）· 新建技能 `.agents/skills/amayui-remote-debug/SKILL.md`（纯手册，零生产代码改动）

### 一、为什么需要它

把实例**完整驱动起来**所需的能力已经齐了（实例注册表、每实例路由、声明式输入命令表、`capture` 取帧、
`focus` 焦点控制，以及本轮新加的 `--attach-headless`），但这些知识散在五张票的 notes 与源码里：
本轮就现场重新摸过 `CONFIG_XY`、左侧分类的贴片公式、`debug-query` 的超时/503 语义，
还踩了 `shot` 名字被 `tools/debugsrv.cjs` 占用、以及**注册表心跳滞后 5s** 这两个坑。
⇒ 收成一份**可加载的操作手册**：发现 → 起停 → 驱动 → 读结果。

### 二、覆盖的四个环节（acceptance ②）

| 环节 | 手册里的内容 | 复核出处 |
|---|---|---|
| ① 发现 | `GET /dsh-emulator/api/__instances`；注册表**两种落点**（`.tmp/instance.json` = 默认实例、`.tmp/instances/<id>/instance.json` = 具名实例）；活实例判据 = `pid` 活 **且** `heartbeatAt` ≤ 20s（宿主每 5s 刷）；`viewers` 的含义 | `plugins/amayui-emulator/lib/index.js`、`src/host/registry.ts`（`HEARTBEAT_STALE_MS = 20_000`、`listInstances`） |
| ② 起停 | `node --import tsx src/web/host.ts --instance <id> [--port 0] [--idle-sec N] [--attach-headless] [--dist-dir <dir>]`；同 id 互斥；闲置自停；**磁盘状态保留而内存不保留**；产物前提（`build-electron.mjs`） | `src/web/host.ts` 的 CLI 段与 `WebHostOptions` |
| ③ 驱动 | 逐条命令表（`move`/`leave`/`click`/`press`/`release`/`wheel`/`key`/`keyup`/`capture`/`focus`/查询），含参数与非法参数的"当查询回报"口径；**坐标 = 引擎虚拟 1280×720**；★**hover 靠位置变化触发** | `src/vm/debugCommand.ts`（命令表唯一真源）、`src/vm/input.ts:250-265`（`setCursor` 只在位置变化时置 `mouseMoved`）、`src/frame/scenario.ts:182`（`applyScenarioEvent`） |
| ④ 读结果 | `capture` 的 base64 落盘并看图（1280×720）；用 `frame`/`global` 读 **VM 真值**（比注册表实时）；宿主日志 `[web] status obs=#N frames=M` 看每步 bin | `src/vm/debugQuery.ts`、`src/web/host.ts` 的 `renderer-status` 分支、`/health` |

### 三、硬约束与坑（acceptance ③，逐条落在手册 §5 的表格 + §3.1）

没有渲染页 ⇒ 503；抓帧命令叫 `capture`（`shot` 被主进程截获）；`AMAYUI_DEBUG_QUERY_TIMEOUT_MS`（缺省 8000，
页面卡住 504 vs 没渲染页 503 **语义不同**）；同一时刻只跑一个 Electron/verify；`viewers > 1` = 两个 VM 抢
overlay/log（刷新会造成瞬时 2，属正常）；面板「收起」不杀会话但**可能被浏览器节流**；同 id 互斥；
闲置自停；**注册表心跳滞后 5s**；坐标是虚拟 1280×720；悬停靠位置变化。

### 四、两个完整示例（acceptance ④）——**都实测过**

* **示例 A**：起实例 → 等 TITLE → `frame` 看 `←cur` → `capture` 落盘看图。
  实测：`←cur = TITLE.BIN`；PNG **1280×720**、约 1.7MB、内容为标题画面（TITLE + 五个菜单项）。
* **示例 B**：`click 807 621` 打开 OPTION → `click 120 319` 切「角色设定」。
  实测：`←cur` 依次变成 `CONFIG1.BIN` → **`CONFIG2.BIN`**；截图分别是「系统设定」页与「角色设定」页（9 个角色位）。
  坐标口径与**分类↔脚本映射**都写了出处（`src/tools/config1Chain.ts` 的 `CONFIG_XY`；
  `src/CONFIG.txt:51` 判 `12721e == 4` ⇒ 只有第 5 项进 CONFIG2）。

### 五、★"已验证 / 待核"分栏（acceptance ⑤）

手册里每条命令与坐标都带出处；并且**显式**把没验过的列出来，而不是含糊过去：

* **已验证**：分类中心坐标 6/6（`T-0141` 实测，附真命中带 `y = 100+50i .. 149+50i`）、
  `CONFIG_XY = (807,621)`、§6 两条完整流程、§3 命令表全部参数形态、§4 的两种读法。
* **明确标「待核」**：底部「初始化本页 / 初始化全部 / 返回」三个按钮的**精确命中矩形**（只知 `y ≥ 400`
  是那个区域）；其它界面（存档页、ADV 推进、列表滚动）的坐标一律指向各自票据，**不许照搬本手册**。

### 六、边界（acceptance ⑥）

显式划清：引擎/脚本语义 → `amayui-engine-analysis` / `amayui-script-analysis`；
记录问题 → `amayui-ticket-ledger`；批量驱动 → `batch-task-runner`。**本技能不改任何生产代码**。

### 七、判据

| 判据 | 结果 |
|---|---|
| ① `SKILL.md` 存在且能被 `skill` 工具加载 | ✅ 写完**当场**出现在本会话的技能目录里，并已用 `skill amayui-remote-debug` 实际加载成功（frontmatter 的 name/description 与内容一致） |
| ②③④⑤⑥ | ✅ 见 §二～§六；每条都标了复核出处 |
| 生产代码 | ✅ **零改动**（本票只新增一个 `.md`） |
