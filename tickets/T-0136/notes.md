# T-0136 · 实例观察台 —— 设计冻结点（子代理的契约来源）

> 由来：用户实测 `T-0135` 的插件后反馈「每次打开时是一个新实例 … 并不需要我自己去创建实例，
> 而是类似于，查看目前所有后台实例，选择激活某一个」。本文件把这次澄清**落成可复核的契约**。
> 诊断依据（实测）：`T-0135` 的插件自己 `spawn` 子进程并用 `child` 记忆 ⇒ ① 只知道自己起的那一个；
> ② 每次「启动」= 一次全新会话（`ALINIT → TITLE`，内存进度归零）。

---

## 1. 术语（先把混在一起的两件事分开）

| | 是什么 | 谁拥有 | 今天的状态 |
|---|---|---|---|
| **实例（磁盘身份）** | `.tmp/instances/<id>/{base,overlay,log}` —— 存档/配置/日志/回放的落点 | **agent/CLI**（`--instance <id>`） | 稳定、已隔离（`T-0134` 的 `instanceLayout`） |
| **观察台（DSH 侧）** | 列出活实例、选中即嵌 iframe | **DSH 插件** | 本票新做 |
| **注册表（发现机制）** | `.tmp/instances/<id>/instance.json` 心跳 | 实例自己写/刷/删 | 本票新做 |
| **路线（寻址）** | `/dsh-emulator/<id>/…` 反向代理 | DSH 插件 | 本票新做 |

**关键判据**：人在面板里做的任何操作**都不改变**实例的生死（纯观察）。

## 2. 注册表 schema（**冻结**：两侧并行实现的契约）

```ts
// app/amayui-emulator/src/host/registry.ts
export interface InstanceRecord {
  id: string;              // [A-Za-z0-9._-]{1,64}；不许等于保留段 'api'
  pid: number;             // web 宿主进程 pid
  port: number;            // 只绑 127.0.0.1
  host: string;            // '127.0.0.1'
  repoRoot: string;
  startedAt: number;       // epoch ms
  heartbeatAt: number;     // epoch ms（每 5s 刷）
  lastStatus?: { bin?: string; frames?: number; gate?: string };   // 最近一次 renderer-status 摘要
}
export const HEARTBEAT_STALE_MS = 20_000;
export const RESERVED_IDS = ['api'];
// 位置：<layout.root>/instance.json；写=原子（.tmp + rename）；读=坏 JSON ⇒ null；删=不存在也不抛
export function registryPath(root: string): string;
export function writeRecord(r: InstanceRecord): void;
export function readRecord(root: string): InstanceRecord | null;
export function removeRecord(root: string): void;
export function isAlive(pid: number): boolean;                    // process.kill(pid, 0)
export function listInstances(instancesRoot: string): InstanceRecord[];   // 过滤死 pid/过期心跳/坏 JSON
export function isValidInstanceId(id: string): boolean;
```

**活实例的判据**（两侧必须同口径）：`isAlive(pid) && heartbeatAt > now - HEARTBEAT_STALE_MS`。

## 3. 生命周期（四个确认的选择如何落地）

```text
agent / CLI（唯一的所有者）
  node --import tsx app/amayui-emulator/src/web/host.ts --instance dbg-a --idle-sec 600
    ├─ listen 127.0.0.1:0（OS 分配端口）
    ├─ 写 .tmp/instances/dbg-a/instance.json（pid/port/startedAt）         ← 注册
    ├─ 每 5s 刷 heartbeatAt（带 lastStatus.bin）                            ← 心跳
    ├─ 同 id 已在跑（pid 活 + 心跳新）⇒ **拒绝启动**并打印「已在运行」      ← 互斥（防抢 overlay/log）
    └─ 自停条件：无 SSE 观察者 且 无任何请求 持续 > --idle-sec（缺省 600；0=关）
         ⇒ 写一行日志 + 删注册项 + 退出                                     ← 闲置自停
DSH 插件（纯观察，不 spawn）
  GET  /dsh-emulator/api/__instances        → 读注册表（活实例列表）
  ANY  /dsh-emulator/<id>/…                 → 反向代理到该实例（流式；SSE 直通）
  GET  /dsh-emulator/                       → 恰一个活实例则 302 到它，否则回列表+提示
```

**被自停/被杀之后**：磁盘状态保留（`SYS4REG.INI`、存档槽仍在 `.tmp/instances/<id>/overlay/`），
下次用**同一个 id** 起来就还在；但**内存里的进度不保留**（那是快照/读档的事，见 `T-0059`，不在本票范围）。

## 4. 面板（纯观察）要显示什么

| 列 | 来源 | 为什么有用 |
|---|---|---|
| id | `record.id` | 与 agent 的命令寻址一致 |
| 端口 | `record.port` | 排障（也能直接 curl） |
| **跑到哪支 BIN** | `lastStatus.bin` | 回答"agent 现在走到哪了" —— 这正是 `T-0133` 立这个需求的目的 |
| 起于何时 / 心跳年龄 | `startedAt` / `heartbeatAt` | 一眼看出"是不是刚起的/是不是卡住了" |
| 帧数 / 门 | `lastStatus.frames` / `gate` | 配合"看个大致情况" |

**空列表时**必须给出可复制的启动命令（否则人会以为插件坏了）。

## 5. 与 `T-0135` 的关系（替代，不是叠加）

* `T-0135` 交付的：`envelope`、`webBridge`、`webBridgeEntry`、`src/web/host.ts`（HTTP+SSE 宿主）、
  构建入口、以及**旧版插件**（自 spawn + start/stop）。**这些桥与宿主全部保留**（已验证）。
* 本票**替代**旧版插件的形态：删掉 spawn 与 `__start`/`__stop`，改成"注册表 + 每实例路由 + 纯观察面板"。
* 旧形态的记录留在 `tickets/T-0135/changes.md`（不改历史），替代关系记在本票 `changes.md`。

## 6. 不做什么

* 不做"实例管理服务"（集中启停）：用户选了"只在 agent/CLI"，多一个常驻进程不划算；
* 不引入 OSR / 不改 VM 语义 / 不删 Electron 可见窗口路径；
* 不做"进程内进度持久化"（"附上去接着上次跑"）—— 那需要快照/读档，属于 `T-0059` 的地盘。
