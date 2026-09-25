/**
 * **引擎态快照 / 恢复**（内存态，`tickets/T-0122`）—— 调试器第 3 步「存 / 回」。
 *
 * 为什么要有它（票面动机，两条实测来源）：
 *  1. `T-0102` 那类排查的本质是**二分**——「这一帧的状态是从哪一步开始不对的」；没有「把某一刻的引擎态
 *     存下来、之后反复回到这一刻做对照」的手段，每验一个假设都要重跑几分钟的启动链。
 *  2. 现有的**画面**快照（`renderer/scene/present.ts` 的 `scSnapshotPresent`）只覆盖绘制项/网格/文本窗/槽模式，
 *     而排查往往卡在**画面之外**的量（池、槽绑定、门计时器、效果位）⇒ 需要的是**引擎态**快照。
 *
 * ★**本模块只做"存 / 回"，不做求值、不 eval、不改 `src/*.txt`**（承 `T-0114` 的硬约束）。
 * ★**优先只在帧边界做**（`capture` 的调用点决定；`host.ts`/`session.ts` 只在 `onFrameEnd` 之后调）。
 *
 * ## 与「存档」的关系（为什么不是"再做一遍存档"）
 * 整机快照这件事工程已经做过 —— 只是落在**磁盘**（`src/save/saveSlot.ts` + `src/vm/engineSlot.ts`）而不是内存。
 * 本模块**复用**那套字段划分的结论（帧链 + 池），但**不**复用它的编码/压缩：这里是自描述的 JSON，为的是
 * 「人能读、能 diff、能手工改一处再灌回去」。
 *
 * ## ★本票的核心纪律：**显式列出「哪些量不进快照」**
 * `T-0102` 踩过的坑正是"有个量没回去"（`global f8080` 在保存池之外、是进程内裸量）。
 * 所以：① 清单 = `SNAPSHOT_EXCLUDED`（代码里的**显式条目**，不是靠遗漏）；② `restore` 时**逐条打告警**
 * （把"这些没被恢复 + 当前值"写进 `report.warnings`）⇒ 调查者不会误信快照是完整的。
 */

/** 快照格式版本（自描述文件头）。**改字段语义就要升它**；读到不认识的版本必须响亮拒绝。 */
export const ENGINE_SNAPSHOT_VERSION = 1;

/**
 * **不进快照的量**（每条都要有 `why`）—— ★这是本票的核心判据，不是装饰。
 *
 * 守卫：`test/engine-snapshot.test.ts` 的「源码棘轮」会逐条检查 `why` 的字面串出现在本文件里，
 * 且 `restore` 的告警**逐条**覆盖它们 ⇒ 不许靠"忘了写"来省略一个量。
 */
export const SNAPSHOT_EXCLUDED: readonly { what: string; why: string }[] = [
  {
    what: '池外裸量（`global f8080` / `708ada` / `f8c48` 一类超出保存池长度的全局）',
    why: '引擎的存档池有长度上界，池外那些是**进程内裸量**（`T-0102` 实测量到 `global f8080 = 1015936` 而池长 1015792）⇒ 它们本就不在"可持久化"的定义域里；恢复时会打告警并给出当前值，避免误信。',
  },
  {
    what: 'L2D 运行态（`Engine.l2dSlots` / `l2dNodes` / `l2dMotionCache`）',
    why: '`tickets/T-0090` 已确认 L2D 运行态**不在存档 body 里**（真机读档也要重建），且它的真值来自宿主侧 Live2D 运行时 ⇒ 进快照只会造出"看起来恢复了"的假象。',
  },
  {
    what: '纹理在途 / 宿主侧槽对象（`slotTex`、画布、`texturesIdle` 的等待者）',
    why: '纹理是**宿主异步**到货的（`0x1F9`/`0x249` 的帧屏障就是为它设的）⇒ 快照能记住"槽→imgid"的意图，记不住"像素到了没有"；恢复后纹理绑定由既有自愈路径（`#healSlot` / 再次 `set-texture`）补齐。',
  },
  {
    what: '音频队列与设备运行态（宿主 `audioEngine` 的 SE/语音/BGM 队列与播放位置）',
    why: '播放位置由宿主的 `HTMLAudioElement`/`AudioBufferSourceNode` 持有，VM 侧只有意图（`T-0152` 的结论）⇒ 进快照没有承载面。',
  },
  {
    what: '门计时器的**墙钟起点**在跨进程语义下的偏移（`gateWaitStart` 存的是绝对 ms）',
    why: '本字段**进**快照（它是引擎态），但它的口径是"相对当前时钟的绝对毫秒"⇒ 恢复到一个**不同的时钟基准**（换进程）时语义会漂；同进程内恢复逐字成立。这条写在清单里是为了让读者知道边界在哪。',
  },
  {
    what: '`debugEvent` / 观察者回调 / `#onWrite` 监听器',
    why: '它们是**宿主注入的函数**，不是状态；恢复不该把调用者的闭包换掉（那会让"恢复"变成"换一套宿主"）。',
  },
  {
    what: '`fileSource` / `config` / `native` / `musicTable` / `agerc.loaded` 等**装载期输入**',
    why: '它们是"这台机器上装载了什么"的登记（脚本源、INI、宿主桥、曲表），恢复快照**不应该**篡改装载事实 —— 那会造出"快照里带了一个宿主"这种无法解释的状态。',
  },
  {
    what: '`TextItemTable` 的每窗「下一条 push 是组首」标记（`groupStart`，私有）',
    why: '它是一次性的**入队侧**标记（下一条 push 就消费掉），跨帧保存没有意义；恢复后下一次 `0x71` 会重设它。',
  },
  {
    what: '场景态里**除 `render4` 之外**的部分（`SceneState` 的动画窗 / 绘制项进行态 / 纹理槽表面 / `render4.transitionRuntime` 等）',
    why:
      '★这一条是 **E3 实测逼出来的**（`test/engine-snapshot-e3.test.ts`）：本模块的 `scene` 分区只覆盖 `render4`（`transitions`/`slotModes`，票面点名的两格），' +
      '而**帧循环的行为还取决于场景的动画进行态**（`advanceModel` 推进哪些窗、哪一帧让出）。' +
      '⇒ 同进程内"回灌后重跑到同一帧"与"自然跑到那一帧"会在**依赖场景动画态的派生量**上分叉（实测分叉面 = `gates.gateWaitStart`/`gateWaitMs` 与 `dispatchQueues`，即"门在哪个绝对时刻被武装"差了若干帧），' +
      '而**与场景无关的引擎态**（池/帧链/槽/文本项/路由）**逐字节相同**。' +
      '重开条件：① 把 `SceneState` 整体纳入快照（`renderer/scene/state.ts` 的容器都能序列化，但 `vm/` 不许 import `renderer/` ⇒ 需要宿主侧提供一个 `snapshotSceneState()`/`restoreSceneState()` 对，形如 `RoutePanel.snapshotState()`）；' +
      '② 或把"引擎态快照"的语义**明确收窄**为"VM 态"，并在调用方（调试器）把场景态交给**画面快照**（`scSnapshotPresent`/`scRestorePresent`）一起存回 —— 两条路都要在票面写清口径。',
  },
] as const;

/** 一份自描述快照（JSON 友好：所有 Map 都是 `[k, v]` 对的升序数组 ⇒ 同样状态**逐字节可比**）。 */
export interface EngineSnapshotV1 {
  /** 文件头：格式名 + 版本 + 生成时刻（人读用；**不参与**相等性判据）。 */
  header: { format: 'amayui-engine-snapshot'; version: number; at: string };
  /** DEC/ENC key —— int 池里存的是**编码值**，带上它才谈得上"原始值 + 解码值两个口径"。 */
  key: number;
  cur: number;
  globals: PoolsSnapshot;
  frames: FrameSnapshot[];
  engineValues: [number, number][];
  texSlots: [number, number][];
  texSlotFlags: [number, number][];
  dispatchQueues: number[][];
  scriptRequests: number[];
  gates: {
    waitFlags: number;
    effectFlags: number;
    gateWaitStart: number;
    gateWaitMs: number;
    sceneFreeze: boolean;
    scenePending: boolean;
  };
  textItems: {
    records: unknown[];
    pages: unknown[];
    cursor: number;
    baseCursor: number;
  };
  routes: Record<string, unknown>;
  /** 场景态（`render4`）—— 只在宿主给了 scene 时才有；`vm/` 不 import `renderer/`（结构化类型）。 */
  scene?: { render4: { transitions: [number, number[]][]; slotModes: [number, number][] } };
}

export interface PoolsSnapshot {
  int: [number, number][];
  float: [number, number][];
  str: [number, string][];
  ptr: [number, unknown][];
  floatPtr: [number, unknown][];
  strPtr: [number, unknown][];
}

export interface FrameSnapshot {
  name: string;
  scriptId: number;
  ip: number;
  caller: number;
  frameArg: number;
  curDwordOffset: number;
  retStack: number[];
  strTable: string[];
  locals: PoolsSnapshot;
}

/** `restore` 的结果 —— ★`warnings` 与 `skipped` **必须**被调用方打出去（`SNAPSHOT_EXCLUDED` 的口径）。 */
export interface SnapshotRestoreReport {
  /** 真的灌回去的顶层分区名（升序）。 */
  restored: string[];
  /** 逐条：哪些量**没**进快照（含当前值）—— 不许静默。 */
  warnings: string[];
  /** 快照里有、但目标状态里没有对应物而被跳过的（例如没有 scene）。 */
  skipped: string[];
}

/** 只要求 `render4` 的结构化类型 —— 避免 `vm/` 反向依赖 `renderer/`。 */
export interface SnapshotSceneLike {
  render4: {
    transitions: Map<number, number[]>;
    slotModes: Map<number, number>;
  };
}

/** 引擎侧最小结构化类型（只需要本模块用到的公开字段）。 */
export interface SnapshotEngineLike {
  key: number;
  cur: number;
  frames: {
    name: string;
    scriptId: number;
    ip: number;
    caller: number;
    frameArg: number;
    curDwordOffset: number;
    retStack: number[];
    strTable: string[];
    locals: {
      int: Map<number, number>;
      float: Map<number, number>;
      str: Map<number, string>;
      ptr: Map<number, unknown>;
      floatPtr: Map<number, unknown>;
      strPtr: Map<number, unknown>;
    };
  }[];
  globals: {
    int: Map<number, number>;
    float: Map<number, number>;
    str: Map<number, string>;
    ptr: Map<number, unknown>;
    floatPtr: Map<number, unknown>;
    strPtr: Map<number, unknown>;
  };
  engineValues: Map<number, number>;
  texSlots: Map<number, number>;
  texSlotFlags: Map<number, number>;
  dispatchQueues: number[][];
  scriptRequests: number[];
  waitFlags: number;
  effectFlags: number;
  gateWaitStart: number;
  gateWaitMs: number;
  sceneFreeze: boolean;
  scenePending: boolean;
  textItems: { records: unknown[]; pages: unknown[]; cursor: number; baseCursor: number };
  /** ★`routes` 经 `RoutePanel.snapshotState()/restoreState()` 走（**不** `structuredClone` 实例：那会丢原型）。 */
  routes: { snapshotState(): Record<string, unknown>; restoreState(s: Record<string, unknown>): void };
}

/** Map → **按键升序**的 `[k, v]` 数组（确定性：同样状态 ⇒ 逐字节相同的 JSON）。 */
function pairs<V>(m: Map<number, V>): [number, V][] {
  return [...m.entries()].sort((a, b) => a[0] - b[0]);
}
function toMap<V>(p: readonly [number, V][] | undefined): Map<number, V> {
  return new Map(p ?? []);
}
/** 池的深拷贝：`ptr` 族存的是 `Ref | 0`（结构化引用）⇒ 结构克隆，免得快照与活状态共享对象。 */
function pairsDeep<V>(m: Map<number, V>): [number, V][] {
  return pairs(m).map(([k, v]) => [k, v && typeof v === 'object' ? structuredClone(v) : v]);
}
function poolsOf(p: {
  int: Map<number, number>;
  float: Map<number, number>;
  str: Map<number, string>;
  ptr: Map<number, unknown>;
  floatPtr: Map<number, unknown>;
  strPtr: Map<number, unknown>;
}): PoolsSnapshot {
  return {
    int: pairs(p.int),
    float: pairs(p.float),
    str: pairs(p.str),
    ptr: pairsDeep(p.ptr),
    floatPtr: pairsDeep(p.floatPtr),
    strPtr: pairsDeep(p.strPtr),
  };
}
function applyPools(
  p: {
    int: Map<number, number>;
    float: Map<number, number>;
    str: Map<number, string>;
    ptr: Map<number, unknown>;
    floatPtr: Map<number, unknown>;
    strPtr: Map<number, unknown>;
  },
  s: PoolsSnapshot,
): void {
  p.int.clear();
  p.float.clear();
  p.str.clear();
  p.ptr.clear();
  p.floatPtr.clear();
  p.strPtr.clear();
  for (const [k, v] of s.int) p.int.set(k, v);
  for (const [k, v] of s.float) p.float.set(k, v);
  for (const [k, v] of s.str) p.str.set(k, v);
  for (const [k, v] of s.ptr) p.ptr.set(k, v);
  for (const [k, v] of s.floatPtr) p.floatPtr.set(k, v);
  for (const [k, v] of s.strPtr) p.strPtr.set(k, v);
}

/**
 * **抓一份引擎态快照**（`tickets/T-0122`）。只读：不改任何状态。
 *
 * @param nowMs 只用于 `header.at`；缺省取 `Date.now()`。
 * @param scene 宿主可给可给（`vm/` 不依赖 `renderer/`）；不给时 `scene` 分区缺席并在恢复时报 `skipped`。
 */
export function captureEngineSnapshot(
  e: SnapshotEngineLike,
  nowMs: number = Date.now(),
  scene?: SnapshotSceneLike,
): EngineSnapshotV1 {
  return {
    header: { format: 'amayui-engine-snapshot', version: ENGINE_SNAPSHOT_VERSION, at: new Date(nowMs).toISOString() },
    key: e.key | 0,
    cur: e.cur,
    globals: poolsOf(e.globals),
    frames: e.frames.slice(0, e.cur + 1).map((f) => ({
      name: f.name,
      scriptId: f.scriptId,
      ip: f.ip,
      caller: f.caller,
      frameArg: f.frameArg,
      curDwordOffset: f.curDwordOffset,
      retStack: [...f.retStack],
      strTable: [...f.strTable],
      locals: poolsOf(f.locals),
    })),
    engineValues: pairs(e.engineValues),
    texSlots: pairs(e.texSlots),
    texSlotFlags: pairs(e.texSlotFlags),
    dispatchQueues: e.dispatchQueues.map((q) => [...q]),
    scriptRequests: [...e.scriptRequests],
    gates: {
      waitFlags: e.waitFlags | 0,
      effectFlags: e.effectFlags | 0,
      gateWaitStart: e.gateWaitStart | 0,
      gateWaitMs: e.gateWaitMs | 0,
      sceneFreeze: e.sceneFreeze,
      scenePending: e.scenePending,
    },
    textItems: {
      records: structuredClone(e.textItems.records),
      pages: structuredClone(e.textItems.pages),
      cursor: e.textItems.cursor,
      baseCursor: e.textItems.baseCursor,
    },
    routes: e.routes.snapshotState(),
    ...(scene
      ? {
          scene: {
            render4: {
              transitions: pairs(scene.render4.transitions).map(([k, v]) => [k, [...v]] as [number, number[]]),
              slotModes: pairs(scene.render4.slotModes),
            },
          },
        }
      : {}),
  };
}

/** 顶层分区名 → 一份「当前值」摘要（`warnings` 里给读者看的现状）。 */
function currentValueNote(e: SnapshotEngineLike): string {
  return (
    `恢复后这些量的当前值（未被快照覆盖）：` +
    `l2dSlots=${(e as unknown as { l2dSlots?: Map<number, unknown> }).l2dSlots?.size ?? '?'}、` +
    `texSlots=${e.texSlots.size}、` +
    `cur=${e.cur}、frames=${e.frames.length}`
  );
}

/**
 * **把快照灌回去**（`tickets/T-0122`）。★帧边界调用（`capture` 的同一条纪律）。
 *
 * 关键口径：
 *  - **先校验版本**：不认识的 `header.version` ⇒ 抛（响亮拒绝，不许"尽力而为"地灌一半）；
 *  - `frames` 按快照**整段替换**（不是逐帧合并且不清尾）—— 多出来的帧必须被丢掉，否则会留下幽灵帧；
 *  - `key` 一并恢复（int 池里是**编码值**，key 不同 ⇒ 解出来全错）；
 *  - 返回的 `warnings` 逐条覆盖 `SNAPSHOT_EXCLUDED`，**调用方必须打出去**。
 */
export function restoreEngineSnapshot(
  e: SnapshotEngineLike,
  snap: EngineSnapshotV1,
  scene?: SnapshotSceneLike,
): SnapshotRestoreReport {
  if (snap?.header?.format !== 'amayui-engine-snapshot') {
    throw new Error(`不是引擎态快照（header.format=${String(snap?.header?.format)}）`);
  }
  if (snap.header.version !== ENGINE_SNAPSHOT_VERSION) {
    throw new Error(
      `快照版本不认识：文件 ${snap.header.version} vs 本程序 ${ENGINE_SNAPSHOT_VERSION}（拒绝"尽力而为"地灌）`,
    );
  }

  const restored: string[] = [];
  const skipped: string[] = [];

  e.key = snap.key | 0;
  applyPools(e.globals, snap.globals);
  restored.push('key', 'globals');

  // frames：整段替换（先按快照长度补齐对象，再逐帧灌；多余的直接截掉）
  const frames = e.frames;
  const want = snap.frames.length;
  // 补齐到 want（缺的用最后一个模板 clone 形状：直接调既有的 push 语义不可知 ⇒ 用浅建 + 逐字段灌）
  while (frames.length < want) {
    const tpl = frames[frames.length - 1];
    if (!tpl) throw new Error('快照里的 frames 比目标多，而目标一帧都没有 ⇒ 无法凭空造帧（请在同一脚本现场恢复）');
    // 用同一个类的构造形状：浅克隆模板会共享 script/locals ⇒ 这里只借"形状"，字段随后被覆盖
    frames.push(Object.assign(Object.create(Object.getPrototypeOf(tpl)), tpl));
  }
  if (frames.length > want) frames.length = want;
  for (let i = 0; i < want; i++) {
    const f = frames[i]!;
    const s = snap.frames[i]!;
    f.name = s.name;
    f.scriptId = s.scriptId;
    f.ip = s.ip;
    f.caller = s.caller;
    f.frameArg = s.frameArg;
    f.curDwordOffset = s.curDwordOffset;
    f.retStack.length = 0;
    for (const v of s.retStack) f.retStack.push(v);
    f.strTable.length = 0;
    for (const v of s.strTable) f.strTable.push(v);
    applyPools(f.locals, s.locals);
  }
  e.cur = snap.cur;
  restored.push('frames', 'cur');

  e.engineValues.clear();
  for (const [k, v] of snap.engineValues) e.engineValues.set(k, v);
  e.texSlots.clear();
  for (const [k, v] of snap.texSlots) e.texSlots.set(k, v);
  e.texSlotFlags.clear();
  for (const [k, v] of snap.texSlotFlags) e.texSlotFlags.set(k, v);
  restored.push('engineValues', 'texSlots', 'texSlotFlags');

  e.dispatchQueues.length = 0;
  for (const q of snap.dispatchQueues) e.dispatchQueues.push([...q]);
  e.scriptRequests.length = 0;
  for (const v of snap.scriptRequests) e.scriptRequests.push(v);
  restored.push('dispatchQueues', 'scriptRequests');

  e.waitFlags = snap.gates.waitFlags | 0;
  e.effectFlags = snap.gates.effectFlags | 0;
  e.gateWaitStart = snap.gates.gateWaitStart | 0;
  e.gateWaitMs = snap.gates.gateWaitMs | 0;
  e.sceneFreeze = !!snap.gates.sceneFreeze;
  e.scenePending = !!snap.gates.scenePending;
  restored.push('gates');

  e.textItems.records.length = 0;
  for (const r of snap.textItems.records) e.textItems.records.push(structuredClone(r));
  e.textItems.pages.length = 0;
  for (const p of snap.textItems.pages) e.textItems.pages.push(structuredClone(p));
  e.textItems.cursor = snap.textItems.cursor;
  e.textItems.baseCursor = snap.textItems.baseCursor;
  restored.push('textItems');
  skipped.push('textItems.groupStart（每窗一次性入队标记，见 SNAPSHOT_EXCLUDED）');

  e.routes.restoreState(snap.routes);
  restored.push('routes');

  if (snap.scene) {
    if (!scene) {
      skipped.push('scene.render4（快照里有，但本次恢复没给 scene）');
    } else {
      scene.render4.transitions.clear();
      for (const [k, v] of snap.scene.render4.transitions) scene.render4.transitions.set(k, [...v]);
      scene.render4.slotModes.clear();
      for (const [k, v] of snap.scene.render4.slotModes) scene.render4.slotModes.set(k, v);
      restored.push('scene.render4');
    }
  } else {
    skipped.push('scene.render4（快照里就没有：抓快照时没给 scene）');
  }

  const warnings = [...SNAPSHOT_EXCLUDED.map((x) => `未恢复：${x.what} —— ${x.why}`), currentValueNote(e)];
  return { restored: restored.sort(), warnings, skipped };
}

/** 快照 → JSON 文本（**稳定**：键序由本模块的字段序固定，Map 已按键排序）。 */
export function snapshotToJson(snap: EngineSnapshotV1): string {
  return JSON.stringify(snap, null, 2);
}

/** JSON 文本 → 快照（版本校验在 `restore` 里；这里只负责解析 + 形状基本检查）。 */
export function snapshotFromJson(text: string): EngineSnapshotV1 {
  const o = JSON.parse(text) as EngineSnapshotV1;
  if (!o || typeof o !== 'object' || !Array.isArray(o.frames)) throw new Error('快照 JSON 形状不对（缺 frames）');
  return o;
}
