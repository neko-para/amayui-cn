/**
 * **实例注册表（file-based instance registry）** —— 让"谁在跑"这件事**跨进程/跨终端**可发现
 * （`tickets/T-0136`；设计来源该票的「文件注册表」选择）。
 *
 * ## 为什么是文件而不是 IPC
 *
 * `T-0135` 的插件只知道自己 `spawn` 的那一个子进程（一个 `child` 变量）⇒ agent 在别的终端起的
 * 实例它**根本看不见**。把"活着的实例"写成**磁盘上的几条记录**，任何读者（DSH 插件、人、agent 的
 * shell）都能发现它们，而**不需要**任何中心进程：写者就是宿主自己，读者只读文件。
 *
 * ## 落点与寿命
 *
 * ```text
 * <repo>/.tmp/instances/<id>/instance.json     # 具名实例（与 `instanceLayout` 的 root 一致）
 * <repo>/.tmp/instance.json                    # 默认实例（default 的 root 就是 `.tmp`）
 * ```
 *
 * ★**记录是"运行时"的，不是"身份"的**：`pid` + `heartbeatAt` 一起回答"它还活着吗"。
 * 进程被 `SIGKILL`（或断电）时没人删得掉记录 ⇒ 读者必须用
 * `isAlive(pid)` **且** `now - heartbeatAt <= HEARTBEAT_STALE_MS` 双重过滤（`listInstances` 就是这么做的），
 * 宿主也据此判断"同 id 是否真的在跑"。
 *
 * ## 写入必须是原子的（`.tmp` + `rename`）
 *
 * 读者（插件面板每 3s 轮询）与写者（宿主每 5s 刷心跳）**没有锁**：如果就地覆盖，读者可能读到
 * "写了一半"的 JSON。同目录 `rename` 在 POSIX 上是原子的 ⇒ 读者要么看到旧记录、要么看到新记录。
 * 崩溃的写者留下的 `<path>.tmp` 会被下一次写入**直接覆盖**，永远不会被当成正式记录（`readRecord`
 * 只认 `<path>`）。
 *
 * ★本模块**不 import `web/host.ts`**（那是上层）；只依赖 `node:fs`/`node:path` 与
 *   `instance.ts` 的纯常量（默认 id 与实例目录相对路径），保持"读盘纯函数"的可测性。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { DEFAULT_INSTANCE_ID, INSTANCES_DIR_REL } from './instance.js';

/**
 * 心跳过期阈值（ms）：`heartbeatAt` 比现在早**超过**它 ⇒ 视为死实例。
 *
 * ★取 20s = 4 个心跳周期（宿主每 5s 刷一次）：允许几次事件循环卡顿/磁盘慢，同时让
 * "`kill -9` 后被发现的延迟"保持在十秒量级（读者每 3s 轮询一次面板）。
 */
export const HEARTBEAT_STALE_MS = 20_000;

/**
 * 保留 id：不能当实例名。
 *
 * `api` 是 web 宿主的**路由保留段**（`/api/<method>`、`/api/event`）⇒ 若实例 id 也叫 `api`，
 * 每实例路由 `/dsh-emulator/api/…` 就会与"这个实例"歧义。宁可在这里拒绝，也不要在路由层猜。
 */
export const RESERVED_IDS: readonly string[] = ['api'];

/** 实例 id 的合法形状：**纯文件名安全串**（会被拼进路径，防 `../..` 逃逸）。 */
const INSTANCE_ID_RE = /^[A-Za-z0-9._-]{1,64}$/;

/** 一条实例记录（**冻结口径**：DSH 插件与宿主的 web 宿主两侧都按它读写）。 */
export interface InstanceRecord {
  /** 实例 id（`[A-Za-z0-9._-]{1,64}`，且不是保留段）。 */
  id: string;
  /** web 宿主**进程**的 pid（读者用它判活）。 */
  pid: number;
  /** 只绑 `127.0.0.1` 的监听端口（`--port 0` 时是 OS 分配的真实端口）。 */
  port: number;
  /** 监听地址（按约定恒为 `127.0.0.1`）。 */
  host: string;
  /** 仓库根（读者据此定位 overlay/log 与实例目录）。 */
  repoRoot: string;
  /** 进程启动（= listen 成功）时刻，epoch ms。 */
  startedAt: number;
  /** 最近一次心跳，epoch ms（每 5s 刷；超过 `HEARTBEAT_STALE_MS` 视为死）。 */
  heartbeatAt: number;
  /** 渲染页最近一次 `renderer-status` 的摘要（跑到哪支 BIN / 第几帧 / 卡在哪个 gate）。 */
  lastStatus?: { bin?: string; frames?: number; gate?: string };
}

/**
 * 实例 id 是否可作实例名。
 *
 * 规则 = `[A-Za-z0-9._-]{1,64}` **且** 不是保留段。额外拒绝 `.`/`..` —— 两者都匹配上面那个
 * 字符集，但会**改变路径语义**（`<root>/instances/..` = `<root>`），属于逃逸面。
 */
export function isValidInstanceId(id: string): boolean {
  if (typeof id !== 'string') return false;
  if (!INSTANCE_ID_RE.test(id)) return false;
  if (id === '.' || id === '..') return false;
  return !RESERVED_IDS.includes(id);
}

/** 一个实例根下的记录文件：`<root>/instance.json`（`root` = `instanceLayout().root`）。 */
export function registryPath(root: string): string {
  return path.join(root, 'instance.json');
}

/**
 * 记录文件的落点根 —— 与 `instanceLayout` 的 `root` **同口径**：
 * `default` ⇒ `<repo>/.tmp`，具名 ⇒ `<repo>/.tmp/instances/<id>`。
 *
 * ★为什么 `writeRecord` 需要它：冻结签名只收 `InstanceRecord`（没有 `root` 参数），
 *   而记录里带着 `repoRoot` + `id` ⇒ 落点必须由这两者**唯一**决定，读者才不会与写者漂移。
 */
function rootOf(repoRoot: string, id: string): string {
  return id === DEFAULT_INSTANCE_ID ? path.join(repoRoot, '.tmp') : path.join(repoRoot, INSTANCES_DIR_REL, id);
}

/**
 * **原子写**一条记录：先写 `<path>.tmp`，再 `rename` 到 `<path>`。
 *
 * 于是任何读者（不管何时读）要么看到上一版、要么看到这一版，**看不到半个 JSON**；
 * 崩溃写者留下的 `.tmp` 会被这次 `writeFileSync` 直接截断覆盖。
 */
export function writeRecord(r: InstanceRecord): void {
  const file = registryPath(rootOf(r.repoRoot, r.id));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(r, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, file);
}

/** 把任意 JSON 收窄成记录；**坏形状一律 `null`**（读盘路径不许炸）。 */
function asRecord(value: unknown): InstanceRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  if (typeof o.id !== 'string' || !isValidInstanceId(o.id)) return null;
  const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  const pid = num(o.pid);
  const port = num(o.port);
  const startedAt = num(o.startedAt);
  const heartbeatAt = num(o.heartbeatAt);
  if (pid === null || !Number.isInteger(pid) || pid <= 0) return null;
  if (port === null || !Number.isInteger(port) || port < 0 || port > 65535) return null;
  if (startedAt === null || heartbeatAt === null) return null;
  if (typeof o.host !== 'string' || !o.host) return null;
  if (typeof o.repoRoot !== 'string' || !o.repoRoot) return null;

  const rec: InstanceRecord = {
    id: o.id,
    pid,
    port,
    host: o.host,
    repoRoot: o.repoRoot,
    startedAt,
    heartbeatAt,
  };
  const st = o.lastStatus;
  if (st && typeof st === 'object' && !Array.isArray(st)) {
    const s = st as Record<string, unknown>;
    const summary: { bin?: string; frames?: number; gate?: string } = {};
    if (typeof s.bin === 'string') summary.bin = s.bin;
    const frames = num(s.frames);
    if (frames !== null) summary.frames = frames;
    if (typeof s.gate === 'string') summary.gate = s.gate;
    if (Object.keys(summary).length > 0) rec.lastStatus = summary;
  }
  return rec;
}

/**
 * 读一个实例根下的记录。
 *
 * **坏 JSON / 缺字段 / 非法 id ⇒ `null`**（不问原因）：插件每 3s 轮询一次，任何一个"半截文件"
 * 都不该让整块面板 500。读者要的是"能不能用"，不是"为什么不能用"。
 */
export function readRecord(root: string): InstanceRecord | null {
  let text: string;
  try {
    text = fs.readFileSync(registryPath(root), 'utf8');
  } catch {
    return null; // 不存在 / 不可读 —— 与"坏记录"同义
  }
  try {
    return asRecord(JSON.parse(text));
  } catch {
    return null;
  }
}

/** 删记录（**不存在也不抛**）；顺带清掉崩溃写者可能留下的 `.tmp`。 */
export function removeRecord(root: string): void {
  try {
    fs.rmSync(registryPath(root), { force: true });
  } catch {
    /* 删不掉就当没有 */
  }
  try {
    fs.rmSync(`${registryPath(root)}.tmp`, { force: true });
  } catch {
    /* 同上 */
  }
}

/**
 * 进程是否还活着：`process.kill(pid, 0)` 的异常 ⇒ `false`。
 *
 * ★`EPERM` 也算"活着"（进程存在但属于别的用户）—— 这是 `kill(pid, 0)` 的语义；
 * `ESRCH` 才是不存在。任何异常都当死，是本模块**故意**的保守选择：漏掉一个的代价是
 * 注册表里多一条陈旧记录（会被心跳过期再滤一次），而错杀一个的代价是**两个进程抢同一份 overlay**。
 */
export function isAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** 活实例过滤 + 去重 + 按 `startedAt` 升序（老实例在前 ⇒ 面板顺序稳定）。 */
function liveOnly(list: readonly InstanceRecord[], now: number): InstanceRecord[] {
  const seen = new Set<string>();
  const out: InstanceRecord[] = [];
  for (const r of list) {
    if (seen.has(r.id)) continue;
    if (!isAlive(r.pid)) continue;
    if (now - r.heartbeatAt > HEARTBEAT_STALE_MS) continue;
    seen.add(r.id);
    out.push(r);
  }
  out.sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));
  return out;
}

/**
 * 扫 `instancesRoot` 下的**活实例**列表。
 *
 * 覆盖两种调用口径：
 *  1. **`instancesRoot` = `<repo>/.tmp/instances`**（具名实例的常态）：每个子目录是一个实例根；
 *  2. **`instancesRoot` = `<repo>/.tmp`**：目录自己就是**默认实例**的根（`<repo>/.tmp/instance.json`），
 *     而具名实例在已知容器 `instances/` 下一层。
 *
 * 为什么两种都要支持：`default` 实例的 `instanceLayout().root` 就是 `<repo>/.tmp`
 * （`T-0133` §B.3 的"零行为变更"口径）⇒ 它的记录**不在** `instances/` 里。宿主按
 * `registryPath(layout.root)` 读写，读者（插件/人）不该因此看不见它。
 *
 * 过滤：坏 JSON（`readRecord` ⇒ `null`）、`pid` 已死、心跳过期；按 `startedAt` 升序。
 * 目录不存在 ⇒ 空数组（首次启动，没有任何实例在跑，不是错误）。
 */
export function listInstances(instancesRoot: string): InstanceRecord[] {
  const found: InstanceRecord[] = [];
  const own = readRecord(instancesRoot);
  if (own) found.push(own);
  for (const sub of subdirs(instancesRoot)) {
    const dir = path.join(instancesRoot, sub);
    const rec = readRecord(dir);
    if (rec) {
      found.push(rec);
      continue;
    }
    // ★已知容器（`instances/`）自己不放记录 ⇒ 再往下一层找具名实例（见上面第 2 种口径）。
    if (sub === path.basename(INSTANCES_DIR_REL)) {
      for (const inner of subdirs(dir)) {
        const r = readRecord(path.join(dir, inner));
        if (r) found.push(r);
      }
    }
  }
  return liveOnly(found, Date.now());
}

/** 直接子目录名（不可读/不存在 ⇒ 空）。 */
function subdirs(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
}
