# T-0188 · 过程文档（notes.md）

## 0. 本轮做了什么（2026-09-26）

用户口径：**把 reset / 从 TITLE 读档 N / 从 ADV 读档 N 这三个操作固化成工程脚本**，别再每轮读界面猜坐标；
后续还会有 battle / workshop 等场景，**用例要标注清楚**。随后追加两条边界：
**① 原语与用例分层**（`emu.mjs` 只放原语，操作 snippet 放外部，便于一眼看到有哪些脚本）；
**② 这一层不模拟设备**（I/O 全走 remote-debug；渲染页/无头窗是设备侧的事）。

落地结构：

```
app/amayui-emulator/tools/
  emu.mjs                 ← 核心驱动（原语 + 原语 CLI：status/reset/frame/probe/globals/cap/tap/log）
  ops/README.md           ← ★用例索引（一条一行：前置/判据/状态；含待登记场景）
  ops/load-from-title.mjs ← 用例：TITLE → Load Data → 槽 N（内置"开屏重试一次"）
  ops/load-from-adv.mjs   ← 用例：ADV 侧栏 → 候选扫描 → 存档画面 → 模式断言 → 槽 N
  ops/_template.mjs       ← 新场景模板（必须给：开屏手势 / 机器可读判据 / 特有坑）
  load-slot.mjs           ← 兼容壳（转发到 ops/load-from-title.mjs，既有文档命令不失效）
```

## 1. 验证矩阵（**如实登记，未验证的不写成通过**）

| 判据 | 状态 | 证据 |
|---|---|---|
| `emu.mjs status` 打出活实例与"可驱动/不可驱动 + 分类诊断" | ✅ 实测 | 输出见本文件 §2；`no-viewer` / `stalled` 两态都真实出现过 |
| `emu.mjs reset`（pid 真死 → 起 → 注册表 pid 对齐 → 等可驱动 → 等 TITLE → 时钟新鲜度） | ✅ 实测（用 `stop` 验了收尾；`reset` 路径本身在修好 pid 判据后跑通） | `emu.mjs stop --instance sn187b → {"stopped":true,"pid":4492}`，无残留宿主进程 |
| `ops/load-from-title.mjs --slot 79 --expect SN0000.BIN` | ✅ **端到端通过** | `evidence/op1-load-from-title-79.log` |
| `ops/load-from-adv.mjs --slot 78` | ⚠ **实现完成、端到端未通过**（验证中途实例损坏，用户中止并要求不再碰现场） | 票面判据④已如实写明；补验时机 = T-0189 的覆盖开关落地后 |
| `load-slot.mjs` 兼容壳 | ✅ 语法与转发路径检查 | `node --check` + `--list` 分支保留 |
| `npm run verify` | ✅ exit 0（无新增死写；测试全绿） | 本轮 verify 输出 |

## 2. 本轮踩到并已写进脚本的坑（都是"看起来像引擎坏了"的那种）

1. **菜单/侧栏/底部按钮要"两帧点击"**：一次注入 `cursor+press+release` 不激活 ⇒ `emu.tap()` = `move → press → 停 ≥2 帧 → release`。
2. **悬停靠位置变化**：同一点重复 `move` 不产生第二次 hover。
3. **ADV 侧栏"视觉展开 ≠ 逻辑展开"**（T-0028）：必须先悬停折叠条（1230,233–1280,493）重登记热点。
4. **确认键只按一次**：多按一次会留下未消费的输入边沿，它会在新场景第一个等待页被当成"推进"，
   把 ▼ 的武装位（`effectFlags & 0x40000000`）提前清掉（这也是 T-0187 那条症状的干扰源之一）。
5. **`reset` 的"停掉"判据必须是 pid 真死**，不能用心跳新鲜度：心跳有 20s 容差，
   拿它当判据会出现"新旧两个宿主并存、debug-query 答的是旧的"（实测一次，表现为 reset 后 13ms 就到 TITLE）。
6. **两种"不可驱动"要分开报**：`no-viewer`（503，没人挂页）vs `stalled`（页面在但帧循环停摆，
   多半是面板页被收起/切走被 Chromium 节流，`snapshot` 报"没等到帧边界"）。

## 3. 环境事实（本机，登记待设备侧处理）

宿主自带的 `--attach-headless` **起一个死一个**（宿主控制台 `无头渲染页退出 code=4294967295`，
见 `evidence/headless-attach-dies.log`，连续 4 次同轨迹）⇒ 实际在跑的渲染页是**面板那一页**。
**这一层不去补页面**（不自建浏览器页、不用 playwright、不改玩家数据）：只把两种不可用状态分类报出来 + 给设备侧修法。

## 4. 两条被用户当场按住的越界（留作纪律）

1. 为了"让页面跑起来"去研究 playwright / 自建 Electron 页 —— **越界**：I/O 全走 remote-debug，渲染页属设备侧。
2. 想把"强制带玩家 `cache/SAVE.DAT`"当默认 —— **不对**：会把玩家数据耦合进测试、默认布局被无声替换、
   不同场景要不同排布时无法表达。正确做法 = 给一张**可覆盖的运行期配置表**（侧栏 = charm 表 `global 13b0`，
   研究见 `tickets/T-0189/evidence/sidebar-charm-table-findings.md`）。

## 5. 用例层的关键发现：侧栏是**可配置**的（⇒ 不许写死格子序号）

9 个格子的热点矩形写死在脚本里（`src/SN0000.txt:54-62`），**每格的功能**由 charm 表 `global 13b0[0..8]` 决定
（派发在**点击时**读表：`src/SN0000.txt:401`），默认值 = `[1 b c 2 3 4 5 6 7]`（`src/INITCHARM.txt:6`）
⇒ **默认布局里没有 SAVE/LOAD**（与用户口径一致）。所以 `ops/load-from-adv.mjs` 用
**候选扫描 + `f7ff0` 模式安全断言**（0=存档/1=读档；不是读档模式就中止，绝不点槽位以免覆盖存档）。
