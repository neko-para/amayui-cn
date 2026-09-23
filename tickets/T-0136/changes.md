# T-0136 · 变更记录

> 每次变更一条：改了哪些文件、行为怎么变、判据是什么、看了哪些证据。

---

## 变更 1（2026-09-23）· 观察台化：注册表 + 每实例路由 + 面板纯观察 + 闲置自停

### 0. 替代关系（先说清与 T-0135 的关系）

`T-0135` 交付的**桥与宿主全部保留**（`src/web/envelope.ts`、`src/renderer/webBridge.ts`、
`webBridgeEntry.ts`、`src/web/host.ts`、构建入口 —— 它们已被真浏览器验证过）。
本票**替代**的是**旧版插件的形态**：那版自己 `spawn` 子进程、面板带启动/停止
（记录在 `tickets/T-0135/changes.md` 的变更 2；本票不改历史，只记替代）。

### 1. 宿主侧：注册表 / 互斥 / 闲置自停（子代理 A + 主 agent 复核）

| 文件 | 改动 |
|---|---|
| `src/host/registry.ts`（新，260 行） | 冻结 schema 逐字实现：`InstanceRecord`、`HEARTBEAT_STALE_MS=20_000`、`RESERVED_IDS=['api']`、`registryPath`/`writeRecord`（`.tmp` + `rename` 原子）/`readRecord`（坏 JSON ⇒ null）/`removeRecord`（不存在也不抛）/`isAlive(pid)`/`listInstances`/`isValidInstanceId`（额外拒 `.`/`..`） |
| `src/web/host.ts` | ① listen 后写记录、每 5s 刷 `heartbeatAt`（带 `lastStatus{bin,frames,gate}`，取自 `renderer-status`）；② **同 id 互斥**（判断放在 `createHostService` **之前** —— 否则构造就会打开既有实例的 log/overlay），失败 throw ⇒ CLI 退出码 1，消息含 `实例 <id> 已在运行 pid=… port=…`；③ `close()`/SIGINT/SIGTERM 删记录；④ **闲置自停**：`--idle-sec`（0=关）> env `AMAYUI_WEB_IDLE_SEC` > 600，检查周期 `min(15s, max(250ms, idleSec*1000))`，判据 = 无 SSE 观察者 **且** 无请求 |
| `test/host-registry.test.ts`（新） | **14/14**：往返、原子写、坏 JSON、死 pid 过滤、过期心跳过滤、id 校验（含 `api`/`..`）、目录无记录跳过、**真进程 `--idle-sec 1` 自停后记录消失** |

### 2. 插件侧：纯观察（子代理 B + 主 agent 裁决跨半边口径）

| 文件 | 改动 |
|---|---|
| `lib/index.js`（重写） | **删掉** spawn/`ensureStarted`/`stop`/端口横幅解析与 `api/__start`/`__stop`；`GET /dsh-emulator/api/__instances` 读注册表（**两种落点都扫**：`.tmp/instance.json` 的 default + `.tmp/instances/*/instance.json` 的具名，按 id 去重、按 `startedAt` 降序、坏 JSON/死 pid/过期心跳一律跳过）；`ANY /dsh-emulator/<id>/<rest>` **流式**反向代理（`up.setTimeout(0)`、`res.writeHead` + `flushHeaders`、客户端断开时 destroy 上游 ⇒ SSE 15s 心跳直通）；裸前缀在恰一个活实例时 302，否则回列表；404（没见过/非法/保留段 `api`）/410（记录在但已死，或本会话见过它之后记录被删 —— 内存墓碑，否则"杀掉后断言 410"不成立） |
| `lib/client.js`（重写） | 纯观察面板：按钮（id `amayui-emulator-open`/order 36）+ `shell.overlay`（id `amayui-emulator-dialog`/order 160，**顺序未变**）；活实例数徽标、3s 轮询列表（id/端口/BIN/起于/心跳年龄）、点行选中、640×360 同源 iframe（外层 `scale(0.5)`）、「新标签打开」、空列表给可复制的起实例命令；**无启动/停止** |
| `smoke.mjs`（重写） | 离线冒烟走**真注册表主路径**：路由契约 → 空注册表 → default 落点/死 pid/坏 JSON → agent 真起实例 → `__instances` 发现 → 代理 `/health` 与二进制 `read-script`（12020B + `x-amayui-kind:bin` + meta 含 `SYSTEM4.BIN`）→ SSE 响应头 6ms 到达（流式）→ 裸前缀 302 → SIGTERM 后 252ms 删记录 ⇒ 该 id 410 且列表剔除 |
| `README.md` | 观察台架构、注册表两种落点与 `__instances` 契约、agent 起实例的命令、`--idle-sec` 自停、安装/重启边界，并写明"替代 T-0135 的启动/停止形态" |
| `cordis.patch.yml` | 注释更新（旧注释还写着 `__start/__stop`） |
| `e2e-shot.cjs`（新） | **跨半边端到端探针**：把插件 handler 挂在真 `node:http` 上（⇒ 浏览器真的走插件路由，**不需重启 DSH**），起**两个**实例，跑 12 条断言 |

### 3. ★端到端实跑（12/12 全过）

```bash
cd app/amayui-emulator && npx electron ../../plugins/amayui-emulator/e2e-shot.cjs
```

| 断言 | 结果 |
|---|---|
| 跨进程发现（注册表） | ✓ 两个实例都列出（端口 55799 / 55800） |
| 每实例写盘隔离 | ✓ 槽文件各自落在 `.tmp/instances/<id>/overlay/SAVE/SAVE07.DAT`，内容 `[1,2]` 不串 |
| 真浏览器经插件路由跑到 TITLE | ✓ 截图 4,061,744B |
| 页面内 API（经每实例路由） | ✓ `readScript(0)` → 12012 |
| agent `move` 经插件路由 | ✓ HTTP 200 `["已注入 1 个输入事件（cursor）"]` |
| agent `capture` 经插件路由 | ✓ **1,793,344B / 1280×720**（经 `FrameHost.capture`） |
| 每实例路由报到的是自己 | ✓ `/obs-b/health` → `instance: "obs-b"` |
| 未附渲染页时的语义 | ✓ 对 `obs-b` 发命令 ⇒ **503「没有渲染页」**（正确，不是缺陷） |

记录 `evidence/observer-e2e.txt`；目视核对 `evidence/observer-instance-a.jpg`、`observer-agent-capture.jpg`。

### 4. ★这条实跑顺带钉住的一个**架构后果**（要写进用法）

**web 形态下 VM 跑在页面里** ⇒ 没有渲染页附着的实例：`/health` 照常（宿主在），
但 `debug-query` 必然 503。所以"agent 起一个实例自己调、不需要人看"需要 **agent 侧自己也附一个
（无头）渲染页**；或者按自然流程：agent 起宿主 → 人在面板里附上去 → VM 随之跑起来 → agent 下命令。
（对比 `T-0133` §B.4.1 的 offscreen 形态：那种形态进程自己就是渲染者，没有这个约束。）

### 5. 判据与证据

| 判据 | 结果 |
|---|---|
| 注册表守卫 | `npx tsx --test test/host-registry.test.ts` → **14/14** |
| 插件离线冒烟 | `node plugins/amayui-emulator/smoke.mjs` → 全部通过（真注册表主路径） |
| 端到端 | 上面的 12/12 + `evidence/` |
| 全量回归 | `npm run verify` → 见 `changes.md` 记录时的 EXIT（应为 0） |
| 台账 | `tickets.js --validate` 134 张全绿；`test/ticket-ledger.test.ts` 6/6 |

### 6. 未做完 / 待你确认

1. **GUI 里的目视确认**（环境步骤）：插件路由是启动边界 ⇒ 要在 DSH 面板里看到**列表形态**，
   需要**重启一次 `dsh web`**。代码侧能验的都验了（含"浏览器走插件路由"的真链路）。
2. 你现在跑着的那个 `dsh` 实例是**旧宿主代码**起的、没写注册表 ⇒ 重启后列表里不会出现它；
   用新命令起一个即可（`node --import tsx app/amayui-emulator/src/web/host.ts --instance dbg-a`）。
3. `registry.ts` 的 `writeRecord` 落点由记录自身推导，而 `WebHostOptions` 未暴露自定义 root ⇒
   今天两者恒等；将来若给实例传自定义 root，两处会漂移（已在 registry.ts 注释里点明，未做）。
