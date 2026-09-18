/**
 * **ADV/场景的 VM 侧状态快照**（`tickets/T-0063`）—— 读档时"画面之外"那些也会丢的东西。
 *
 * 为什么需要：读档把帧按 scriptId 装回**入口**再走栈到存档落点 ⇒ 入口到落点之间的初始化会重跑，
 * 但**存档时已有的**那批状态不会自己回来，而 `loadSlotIntoEngine` 为了清掉旧 UI 还会 `routes.reset()` /
 * `msgwin.reset()` ⇒ 2026-09 用户实测的四条症状都指向这里：
 *  - **侧边栏 hover 不展开**：热点区（`RoutePanel.entries`）没了；
 *  - **ADV 窗的遮罩 / 窗口态**不对：`MsgWindow` 的标量态（`showing`/`flags`/`skipMode`…）与文本项账本没了；
 *  - **背景不再移动**：阶梯动画时间表（`StageLoop` 的 `entries/cursor/index/t0`…）没了；
 *  - 一些开关位（`engineValues` 里的面板/淡入标志）被复位。
 *
 * 引擎那边这些状态是**读档流程自己搬回去**的（`sub_410160` 的装载段搬 `Engine+84088` 的 40 B 窗口态、
 * 复位两张面板、`sub_45F1B0` 额外块…）⇒ emulator 用"存一份、读档装回"达到同一效果。
 *
 * 只搬**纯数据**（数字/字符串/数组）；Map 类容器（`routes` 的 entries、`textItems.records`、
 * `stage.entries` 都是数组 ✓）逐条拷。
 */
import type { Engine } from './engine.js';
import type { RouteEntry } from './route.js';
import type { TextItemRecord } from './textItems.js';
import type { StageEntry } from './stageLoop.js';

/** 阶梯动画时间表（`StageLoop` 的可搬子集）。 */
export interface StageStateJson {
  entries: StageEntry[];
  cursor: number;
  index: number;
  t0: number;
  exitLabel: number;
  cur: number;
  scriptId: number;
  resumeDword: number;
}

/** ADV/场景的 VM 侧状态。 */
export interface AdvStateJson {
  /** `engineValues`（引擎字段表）里除"读档流程自己用"的几格之外的全部。 */
  fields?: [number, number][];
  routes?: RouteEntry[];
  /** `MsgWindow` 的标量字段（数字；Map 类容器不进这里）。 */
  msgwin?: Record<string, number>;
  textItems?: TextItemRecord[];
  stage?: StageStateJson;
}

/** 读档流程自己占用的字段：**不进快照、也不被快照覆盖**（否则会和装载流程打架）。 */
const LOAD_FLOW_FIELDS = new Set<number>([95776, 95777, 95780, 97054]); // cur/callRet/读档门/读档收尾标志

export function snapshotAdvState(e: Engine): AdvStateJson {
  const fields: [number, number][] = [];
  for (const [k, v] of e.engineValues) if (!LOAD_FLOW_FIELDS.has(k) && typeof v === 'number') fields.push([k, v]);
  const msgwin: Record<string, number> = {};
  for (const [k, v] of Object.entries(e.msgwin)) if (typeof v === 'number') msgwin[k] = v;
  const st = e.stage;
  return {
    fields,
    routes: e.routes.entries.map((r) => ({ ...r })),
    msgwin,
    textItems: e.textItems.records.map((r) => ({ ...r })),
    stage: {
      entries: st.entries.map((x) => ({ ...x })),
      cursor: st.cursor,
      index: st.index,
      t0: st.t0,
      exitLabel: st.exitLabel,
      cur: st.cur,
      scriptId: st.scriptId,
      resumeDword: st.resumeDword,
    },
  };
}

/** 装回（调用方已先做过 `routes.reset()`/`msgwin.reset()` —— 这里把**存档时**那份装回去）。 */
export function restoreAdvState(e: Engine, s: AdvStateJson): void {
  if (s.fields) for (const [k, v] of s.fields) e.engineValues.set(k, v);
  if (s.routes) {
    e.routes.entries.length = 0;
    for (const r of s.routes) e.routes.entries.push({ ...r });
  }
  if (s.msgwin) {
    for (const [k, v] of Object.entries(s.msgwin)) {
      (e.msgwin as unknown as Record<string, unknown>)[k] = v;
    }
  }
  if (s.textItems) {
    e.textItems.records.length = 0;
    for (const r of s.textItems) e.textItems.records.push({ ...r });
  }
  if (s.stage) {
    const st = e.stage;
    st.entries.length = 0;
    for (const x of s.stage.entries) st.entries.push({ ...x });
    st.cursor = s.stage.cursor;
    st.index = s.stage.index;
    st.t0 = s.stage.t0;
    st.exitLabel = s.stage.exitLabel;
    st.cur = s.stage.cur;
    st.scriptId = s.stage.scriptId;
    st.resumeDword = s.stage.resumeDword;
  }
}
