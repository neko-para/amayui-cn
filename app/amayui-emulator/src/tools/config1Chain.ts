/**
 * **CONFIG1 链路跑手（可复用）**：`SYSTEM4 → … → LOGO → TITLE →（点 CONFIG）→ CONFIG.BIN → CONFIG1.BIN`。
 *
 * 为什么单独成模块：E3 回归（`test/config1-chain.test.ts`）与**排查工具**
 * （`npm run diag:text`，见 `src/tools/diagText.ts`）需要**同一份**链路逻辑 ——
 * 否则"测试说对、排查工具说不对"这种漂移又要花时间分辨。
 *
 * 采样：ADV 样例窗只存在很短一段（CONFIG1 紧接着有条件的 `i301 9` 清场），
 * 所以每帧采一次样，记录"窗口还有内容"那一刻的排版结果、快照文本与**遮挡分析**。
 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeFileSource } from '../arch/nodeFileSource.js';
import { NodeAudioHost } from '../audio/nodeAudioHost.js';
import { decideResourceDir } from '../arch/resourceDir.js';
import { OverlayDir } from '../arch/overlay.js';
import { effectiveIniText as readEffectiveIni, resolveSystemPaths } from '../arch/systemPaths.js';
import { Engine, type Frame } from '../vm/engine.js';
import { InputManager } from '../vm/input.js';
import { loadScriptData, stepOnce, NotImplementedOp, type StepTrace } from '../vm/interpreter.js';
import { readIntOperand, refFromOperand } from '../vm/operand.js';
import { readRef, refAt } from '../vm/ref.js';
import type { BinInstruction } from '../script/bin.js';
import { runFrameLoop, type FrameLoopOptions } from '../frame/loop.js';
import type { FrameHost } from '../frame/host.js';
import { HeadlessScene } from '../renderer/headlessScene.js';
import { itemPivotLocal, itemScale } from '../renderer/drawItem.js';
import { DropRecorder, withNativeTap, type DroppedIntent } from '../vm/nativeTap.js';
import { parseIni, applyConfigToEngine } from '../engineConfig.js';
import { DEFAULT_EMULATOR_OPTIONS, applyEmulatorOptionsToEngine, normalizeEmulatorOptions, type EmulatorOptions } from '../emulatorOptions.js';
import { dec, enc } from '../vm/bits.js';
import type { SnapshotMsgWin } from '../renderer/sceneModel.js';
import { FIELD_VERTICAL } from '../vm/engineFieldIds.js';
// ★`bgrToRgb`：`engineValues[21664/21665]` 存的是引擎的 **COLORREF** 字段（`0x76`/`0x77` 把脚本 RGB 翻成
//   COLORREF 后存进去），屏幕上的颜色 = 再翻一次（`tickets/T-0102` 判据 4；口径见
//   `handlers/msgwin.ts` 的 `globalTextStyle`）⇒ 探针报告"渲染用色"必须与它同一口径。
import { bgrToRgb } from '../vm/handlers/msgwin.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..', '..');
/** 玩家数据（`SYS4REG.INI`）：系统存档目录 + overlay（读 overlay → 真游戏那份）。 */
const SYSTEM = resolveSystemPaths(ROOT);
const SYSTEM_FILES = new OverlayDir(SYSTEM);

/** 取当前生效的 `SYS4REG.INI` 文本（共享实现见 `arch/systemPaths.ts`）。 */
const effectiveIniText = (): string => readEffectiveIni(SYSTEM_FILES);

/** TITLE 菜单「CONFIG」项的命中点（由 i12e 的 baseX/baseY 数组算出：第 3 项 rect [729,885]×[543,699]）。 */
export const CONFIG_XY: [number, number] = [807, 621];

/** 与文本窗相交、且层序**高于**文本层的可绘制项（非空 ⇒ 文字会被盖住，属静默缺陷）。 */
export interface CoverInfo {
  layer: number;
  handle: number;
  dst: { x: number; y: number };
  size: { w: number; h: number };
  color: string;
}

/** 滚动条拇指的一段（上盖 / 中段 / 下盖）。 */export interface ThumbSeg {
  handle: number;
  dstX: number;
  dstY: number;
  srcW: number;
  srcH: number;
  /** 求值后的缩放（`itemScale`：无窗时 = 目标矩阵）。 */
  scaleX: number;
  scaleY: number;
  /** pivot 相对项原点的局部量（`itemPivotLocal`：pivot == 描画位置时为 0）。 */
  pivotRelX: number;
  pivotRelY: number;
  /**
   * 该段是否走**世界矩阵**路径（`DrawItem+0x68` = `useWorld`；只由 `0x1FD`/`0x1FF`/`0x21E`/
   * `0x21F`/`0x220` 置位）。未置位的段是纯 2D 项：只有描画位置 + 源矩形，`pivot/scale/rot/trans`
   * **一律不参与**（渲染器 `presenter.ts` 里的同一判据）。
   */
  useWorld: boolean;
}

/**
 * **CONFIG1 右侧滚动条拇指**的三段式几何（`0x1FD` 立即缩放的活证据）。
 *
 * 脚本（`src/CONFIG1.txt:2934-2971`，handle = `0x1d4c0 + 0x76c…0x778`）：
 * 上盖 `27×23` → **中段 `27×1`（源只有 1px，靠 `i1fd <obj> 100 <h*100> 100` 放大）** → 下盖 `27×24`。
 * 若 `0x1FD` 未落到渲染（或 pivot 坐标系用错），中段会退回 1px 并被挪出画面 ⇒ **只剩上下两段**。
 */
export interface ScrollThumb {
  /** 脚本里的 handle 基址（`0x1d4c0`）。 */
  base: number;
  top: ThumbSeg;
  middle: ThumbSeg;
  bottom: ThumbSeg;
}

/**
 * **滚动条状态**（`CONFIG1` 的列表滚动：`CONFIG1.txt:1195-1225` 的页设置 + `:2934-2971` 的拇指绘制）。
 *
 * 几何（raw 实测）：轨道 y = 106..534（高 428）、拇指高 `thumbH`（= `local5623`）、
 * 拇指顶 `thumbTop`（= `local3f6`）= `106 + (428 − thumbH) · start / maxStart`。
 *
 * ★不变量：`0 <= start <= maxStart` ⇒ `106 <= thumbTop` 且 `thumbTop + thumbH <= 534`。
 * 破坏它就会看到**拇指溢出轨道**（2026 实测：第一页滚到底后切分类，`start` 从上一页漏过来）。
 */
export interface ScrollStep {
  tag: string;
  /** 当前分类的项数（`local561f`）。 */
  itemCount: number;
  /** 每页行数（`local5622`）。 */
  rows: number;
  /** 滚动起点（`local5620`）。 */
  start: number;
  /** 最大起点（`local5624`；0 = 不需要滚动条）。 */
  maxStart: number;
  /** 拇指高（`local5623`）。 */
  thumbH: number;
  /** 拇指顶（`local3f6`）。 */
  thumbTop: number;
}

/**
 * `0x12F` 在真实脚本里的**输入/输出快照**（E3：可见行序 = 按 `B[x]+C[x]` 升序排出的索引序）。
 *
 * 为什么要在链路里抓它：`CONFIG1` 的列表顺序完全由这条指令决定，而它的两个历史错法
 * （双重编解码 / 用"位置上的值"当键）都**不报错**、只让顺序错，
 * 且"用位置上的值"还会让顺序**依赖数组残留**（首次进入与切 tab 回来不同）。
 * 有这份真实数据就能做独立复算比对（见 `test/config1-chain.test.ts`）。
 */
export interface Sort12fDump {
  /** 元素个数（`op4`）。 */
  n: number;
  /** 排序结果：索引数组 A（DEC 视角）。 */
  a: number[];
  /** 主键数组 B（按索引取值）。 */
  b: number[];
  /** 次键数组 C（按索引取值）。 */
  c: number[];
}

/**
 * **CONFIG1 设置列表的一行**（`CONFIG1.txt:2509-2520` 的可见行循环）。
 * 每行的三种图元各自成一条 handle 家族（基址 `0x1d4c0`）：
 *  - `+0x3e8+i` 行背景带 `832×40 @(320, 100+50i)`（槽 193）；
 *  - `+0x3fc+i` 数值/控件贴片 `80×30 @(332, y+5)`，**源 Y = (type−1)×31** ⇒ 源 Y < 0 就等于"这行没有描述符"；
 *  - `+0x410+i` 帮助图标 `40×40 @(285, y)`（槽 193）。
 *
 * ★`type` 来自"可见行序表"（`0x12F` 三数组排序的结果）→ 只有排序正确时每行才拿得到自己的描述符；
 * 排序一错，除第 0 行外全部读成 0 ⇒ 源 Y = −31（越界）⇒ 数值/◀▶ 控件**只有第一行画得出来**。
 */
export interface ConfigRow {
  i: number;
  /** 数值贴片（`+0x3fc+i`）的源矩形；`srcY < 0` ⇒ 该行描述符为 0（排序/搬运出错）。 */
  value: { handle: number; srcX: number; srcY: number; srcW: number; srcH: number; dstX: number; dstY: number };
  /** 该行是否画了行背景带。 */
  hasBand: boolean;
  /** 该行画了几个"控件贴片"（◀▶ / ON-OFF 那一族，handle 基址 `+0x514`/`+0x5dc`）。 */
  controls: number;
}

export interface ChainResult {
  script: string;
  unimplemented: string[];
  text: string;
  ruby: string[][];
  pane: number | undefined;
  msgField: number | undefined;
  /** ADV 样例窗的**排版结果**（内容对之外，位置/层序/字号/竖排/注音也要对）。 */
  sampleWin: SnapshotMsgWin | null;
  /** 采样那一刻的报告文本（快照里现在能看见文字）。 */
  snapshotText: string;
  /** 采样那一刻、层序高于文本层且与文本框相交的图元（**必须为空**）。 */
  coveredBy: CoverInfo[];
  /** 采样那一刻的绘制项总数 / 可绘制数（诊断）。 */
  itemCounts: { drawItems: number; drawable: number };
  /**
   * `0x300` 消息预览的**循环演示**证据（`CONFIG.txt:171 i300 9 1 3e8`）：
   * 该窗闸门状态 + 之后若干帧的"已显示字数"序列。
   *
   * 引擎语义（`sub_409400` 第一循环 raw 13838-13888）：整段贴出 → 记完成时刻 → 过 op3 ms
   * 清绘制项并把 `win+132` 归零（**闸门位仍为 1**）⇒ 下一帧从头再贴一遍，**无限循环**。
   * 因此序列里应当看到 `<全部>` → `0`（清场）→ 重新递增。
   */
  gateLoop: { enabled: boolean; autoHideMs: number; shown: number[] } | null;
  /** CONFIG1 右侧滚动条拇指的三段式几何（见 `ScrollThumb`）；没跑到那段时 null。 */
  scrollThumb: ScrollThumb | null;
  /** CONFIG1 设置列表的可见行（见 `ConfigRow`）—— `0x12F` 排序正确性的活证据。 */
  configRows: ConfigRow[];
  /** `0x204` 直绘进纹理槽的文本（每槽条数 + 抽样 + 全部文本）；CONFIG1 应当是槽 196 上的一串行文本。 */
  slotText: { slot: number; count: number; sample: string; texts: string[] }[];
  /** 最近一次 `0x12F` 的输入/输出（列表顺序的正确性判据，见 `Sort12fDump`）。 */
  sort12f: Sort12fDump | null;
  /** 滚动/切分类探针的逐步状态（仅 `scrollProbe: true` 时给出，见 `ScrollStep`）。 */
  scrollSteps?: ScrollStep[];
  /** 「角色名颜色溢到 ADV 样例窗」回归探针的结果（仅 `previewProbe: true` 时给出）。 */
  previewStyle?: PreviewStyleProbe;
  /** 「回 ADV 重派生」探针结果（仅 `advReturnProbe: true` 时给出）。 */
  advReturn?: AdvReturnProbe;
  /** 字体选择器探针结果（仅 `fontPickerProbe: true` 时给出）。 */
  fontPicker?: FontPickerProbe;
  /** 宿主未实现、调用被丢弃的 native 方法（仅 `recordDrops: true` 时给出）。 */
  drops?: DroppedIntent[];
  /** **音频事件序列**（`tickets/T-0006`；`[audio] …` 行）—— headless 与 Electron 音频表现的可比对象。 */
  audioEvents: string[];
  /** 每帧的文本窗诊断行（`diag:text` 用）。 */
  trace: string[];
}

/**
 * **「角色名颜色溢出」探针结果**（`previewProbe: true`）。
 *
 * 断言口径（`test/config1-chain.test.ts`）：
 *  1. `win9Fills` 里在角色设定页绘制期间只应出现**一个**颜色（入队时钉住的那一个）；
 *     预修复版本会随每行 `i076` 变化 ⇒ 出现 "…最后一个可见行" 的颜色；
 *  2. 该颜色必须**不等于** `lastRowFill`（最后一行 `draw-string` 直绘用的全局色）。
 */
export interface PreviewStyleProbe {
  /** 进入角色设定页之前，ADV 样例窗（win 9）的填充色。 */
  beforeFill: string;
  /** 角色设定页绘制期间，win 9 每帧的填充色（去重前的原始序列，便于看"何时被改"）。 */
  win9Fills: string[];
  /** 角色设定页各行 `draw-string` 直绘用的全局填充色（= 该行角色名的颜色）。 */
  rowFills: string[];
  /** 角色设定页每帧的**全局**填充色（`Font+1360` = `engineValues[21664]`）—— 逐行设色的痕迹。 */
  liveFills: string[];
  /** 切页前后 win 9 的排版结果是否还在（`false` = 样例被清掉了，断言要相应放宽）。 */
  win9Present: boolean;
}

/**
 * **「回 ADV 重派生」探针结果**（`advReturnProbe: true`）。
 *
 * 用途（`tickets/T-0102` 丁-2/丁-3）：用户实测「从 ADV 进设置界面、右键退出后回到 ADV，文字颜色仍是
 * 角色设定页最后一行那种颜色（紫）」，而真机不紫。引擎的「回 ADV」重派生路径是
 * `src/CONFIG.txt:225-269`：按当前消息号 `3f37` 重派生 `14acda`（旁白归 0）→ `call label_00001ae8`
 * （`372-407`：`f807b/f807c` 重算 + `i076/i077` 应用）→ `i071 2` → `i082`。
 *
 * 本探针把「右键退出」那一跳（设置页把 `12721e` 踢出 `[0,6)` ⇒ `CONFIG.txt:63` 的 `e==0` 分支
 * ⇒ `label_00000f6c` 回 ADV 路径）走完，并在**每一步前后** dump 关键量，用来区分两条候选：
 *   1. `14acda` 的重派生**算错**（`52a49c`/`14b0c4`/`14acdc` 三张表或 `3f37` 与引擎不同）；
 *   2. 这条路径**没跑到**（`i082` 那一笔的效果缺失 = `tickets/T-0104`）。
 */
export interface AdvReturnProbe {
  /** 退出设置页前（角色设定页跑完）：全局填充色 + 重派生相关的全局。 */
  before: AdvReturnSample;
  /** 铺完 ADV 语境（`3f38`/`g0`/`1397`/`3f37`）之后、还没触发退出时的采样。 */
  setup: AdvReturnSample;
  /** 退出路径跑完后的同一组量。 */
  after: AdvReturnSample;
  /**
   * **`14acda` 的派生链快照**（`tickets/T-0102` 判据 5）。
   *
   * 为什么单列：判据 5（「阿瓦罗的名字是青还是橘」）的判决量是 `adcd[14acda]`，而 `14acda` 由
   * `CONFIG.txt:234-241` 的三张表算出 —— `via = 14acdc[3f37]`、`idx = 14b0c4[via]`
   * （`idx != 0` ⇒ 取它；`idx == 0` ⇒ 按 `52a49c[3f37]`（单位性别表）回退到 1/2/3）。
   * 光看一个 `14acda` 判不了对错，必须同时看到：① 这三张表的取值；② 真实调色板 `adcd[idx±1]`；
   * ③ 这条消息**是谁说的**（消息表 `f612[3f37]` 的文本，取不到就是空串）。
   *
   * ★`idxPrev`/`idxNext` 是**"差一"假设**的判决量：若 `idx` 恰与相邻消息号的取值重合，
   *   「`3f37` 与表的对齐整体偏一格」就有了直接证据（青 vs 橘正是相邻的两条：`adcd[4]` 青 / `adcd[5]` 橘）。
   */
  derivation: {
    /** 被探查的消息号（= 探针铺的 `3f37`；`-1` = 旁白）。 */
    msg: number;
    /** `52a49c[msg]`（单位性别表；回退分支的输入）。 */
    sex: number;
    /** `14acdc[msg]`（消息 → 中间号）。 */
    via: number;
    /** `14b0c4[via]`（中间号 → `adcd` 下标）；**0 ⇒ 走回退分支**。 */
    idx: number;
    /** 同一条链在 `msg - 1` / `msg + 1` 上的结果（"差一"判决量）。 */
    viaPrev: number;
    idxPrev: number;
    viaNext: number;
    idxNext: number;
    /** 真实 `adcd[idx-1 .. idx+1]`（原值，COLORREF/BGR；越界给 0）。 */
    palette: number[];
    /** 消息表 `f612[msg]` 的文本（`global-string`；取不到 = 空串）。 */
    text: string;
  };
  /** 路径经过的锚点（按执行顺序，去重前的原始序列）——判「有没有跑到」。 */
  marks: string[];
  /** 是否观察到 `label_00001ae8` 的应用点（`i076` 在退出路径上被再执行一次）。 */
  reappliedStyle: boolean;
  /** 是否观察到 `i082`（= `CONFIG.txt:269`；`tickets/T-0104` 的落点）。 */
  sawI082: boolean;
  /**
   * **`i082` 这一笔自己触发了多少次文本窗重新发布**（`msgWinSync` 计数差）。
   *
   * 为什么单列：`i082` 的可见效果**只有**这一条通路（用 `op4`/`op5` 把已排版的文本重画一遍）——
   * 属 VM 不可观测类，所以要断言"它真的重画了"只能数发布次数。计数窗口是
   * **`0x82` 那一条指令自己的执行期**（`onStepStart` 置 opcode、`onStep` 清；`onStep` 是执行**之后**
   * 才回调，用它的前后计数差会恒得 0），否则别的指令（`set-texture`/`0x20A`…）
   * 的发布会把结论淹掉。桩（`STUB_NATIVE_OPS` 放行）时这里恒为 **0**。
   */
  republishByI082: number;
  /**
   * `i082` 执行那一刻 `Engine.textItems.records.length`（引擎 `Font+3364..3368` 的条数）。
   *
   * ★为什么要记它：引擎那道门是 `v8 > op2 && op2 >= 0`（raw 79502）—— **记录表为空时
   * `i082` 在引擎里也什么都不做**。本探针跑的是一条"没有 ADV 消息历史"的链路（CONFIG 页不 push
   * 文本项记录），所以这里多半是 0；`republishByI082` 必须与它**一致**（0 ⇒ 都不做；
   * >0 ⇒ 必须重发布），否则就是实现与引擎分叉。
   */
  recordsAtI082: number;
  /**
   * **`seedRecords`（`tickets/T-0102` 的判决实验）**：把「ADV 侧已经显示过一条消息」这一态铺出来。
   *
   * 为什么需要它：`0x82` 的门是 `records.length > op2`（引擎 raw 79502；emulator 同口径，见
   * `handlers/msgwin.ts` 的 `op_gdi_repaint_window`），而 `records`（引擎 `Font[841..842]` 的 72B 向量）
   * **只有文本项入队时才 push** ⇒ 「TITLE 菜单 → CONFIG」这条链里它是**空的**（引擎在那里同样什么都不做），
   * 而真实 **ADV → CONFIG** 路径上它**非空**。⇒ 这个开关就是"把 ADV 路径的差别补上"，
   * 用来回答「`i082` 到底会不会重画、用哪个颜色重画」。
   */
  seedRecords?: number;
  /**
   * **`i082` 那一笔重画时用的样式**（`msgWinSync` 载荷里 `style.main.fill/outline` + `revealed`）。
   *
   * 形状注意：颜色在 `style.main.*`（`MsgWinStyle` 的正文那一路；`style.ruby` 是注音），**不是** `style.*`。
   *
   * `null` = `i082` **执行期间没有**发生重发布（⇒ 那一笔没画：记录表空 / 门没过）。★这是判据 3 的关键数据：
   * 若这里的 `fill` 是**重派生后的新色**（`#ffffff`）⇒ 文本确实被按新颜色刷新（候选 2 修好了）；
   * 若仍是旧色（紫）⇒ 重发布用的是**入队时的样式快照**（`MsgSlot.fontStyle`），需要另开一条修法。
   */
  restyleByI082: {
    win: number;
    fill: string;
    outline: string;
    revealed: number;
    /** `true` ⇒ 该窗有入队快照（`styleOfWin` 的第一选择）。 */
    snapshot: boolean;
    /** 快照自己存的正文填充色（`null` = 没有快照）—— 与 `fill` 对照即可判"颜色到底从哪来"。 */
    snapFill: string | null;
    /** 那一刻的**实时**全局填充色（`Font+1360`）—— 与 `fill` 对照的另一半。 */
    liveFill: string;
  } | null;
  /**
   * `i076`（样式重新应用）**之后**发生的 `msgWinSync` 次数（任意窗）。
   *
   * ★判据 3 的最后一格：判据 3 问的是"`MsgSlot.fontStyle` 那条机制**哪一环**被绕过"。
   *   `i082` 那一笔的重画是**有门**的（记录表空就什么都不做，与引擎同口径 raw 79502）⇒ 在
   *   「TITLE → CONFIG → 戻る」这条链上它**恒不重画**。于是必答的问题是：
   *   **这条链上还有没有别的发布把新颜色带出去？** 0 ⇒ 该窗纹理在模拟器里根本没被按新色重建
   *   （⇒ 用户看到的紫 = 拿旧纹理上屏，属**发布触发点缺失**，不是取色错）；> 0 ⇒ 颜色带出去了，
   *   紫就只能出在宿主侧（光栅化/纹理键）。
   */
  syncsAfterI076: number;
  /** 上述发布里**最后一次**的载荷（`win` + 正文色）；`null` = `i076` 之后一次发布都没有。 */
  lastSyncAfterI076: { win: number; fill: string; outline: string; op: number } | null;
  /** 上述发布是**哪些指令**发起的（去重、按首次出现排序）—— 判"新颜色是被哪条指令带出去的"。 */
  opsSyncedAfterI076: number[];
}

/** `AdvReturnProbe` 的一次采样（全部是**解码后**的脚本语义值）。 */
export interface AdvReturnSample {
  /** `engineValues[21664]` = `Font+1360` 填充色（`i076` 写；BGR→RGB 已重排）。 */
  fill: string;
  /** `engineValues[21665]` = 描边色（`i077` 写）。 */
  outline: string;
  /** 脚本全局（全部 `dec()` 过）：`f807b`/`f807c` = 样式实参；`14acda` = 当前角色号；`3f37` = 当前消息号。 */
  f807b: number;
  f807c: number;
  c14acda: number;
  msg3f37: number;
  g3f38: number;
  g0: number;
  /**
   * 全局 `1397`（`CONFIG.txt:223` 的门）。
   *
   * ★**极性（实测 4×2 矩阵，`tickets/T-0102/notes.md`）**：`CONFIG.txt:219-225` 是
   *   `f = (1397 == 1)` → `10 = e & f`（`e = (g0==1) || (g0==6)`）→ `jcc 10, -1, label_000014ec`
   *   ⇒ **`g0 ∈ {1,6}` 且 `1397 == 1` 时重派生块才跑**（`10` 真 ⇒ 真分支 = `-1` = 落下句），
   *   否则跳 `14ec` **整块跳过** ⇒ `14acda`/`f807b` 保留 CONFIG2 的残留（用户报的紫）。
   *   ⚠本字段的注释曾写成「== 1 ⇒ 整个重派生块被跳过」，**极性是反的** —— 那是把 `jcc` 的
   *   操作数顺序读成了 `(cond, 跳转目标, 落下目标)`；真实约定见 `src/vm/handlers/control.ts:66-90`
   *   （`jcc cond, trueLabel, falseLabel`，`-1` = 该分支落下句）。
   */
  g1397: number;
  /** 全局 `3f36`（`CONFIG.txt:207` 的 `ne 3f36 2` 决定走不走 `label_00001144`）。 */
  g3f36: number;
  /** 当前脚本名（判"回到 ADV 了没有"）。 */
  script: string;
}

export interface ChainOptions {
  /** 只跑这么多次 `stepOnce`（保底，默认不限）。 */
  maxFrames?: number;
  /**
   * 每条被执行指令的回调（盘点用，见 `src/tools/opInventory.ts`）。
   * 默认关 —— 单次链路有数十万条指令，留一个 no-op 调用也要花时间。
   */
  onStep?: (t: StepTrace) => void;
  /** 用 `withNativeTap` 记录"脚本想调、宿主没实现"的方法（默认关；开了才付 Proxy 的代价）。 */
  recordDrops?: boolean;
  /**
   * 给 headless 宿主接**音频引擎**（默认 `true` = 真游戏行为）。
   * 置 `false` = 回到"宿主没有 `audio`"的状态（音频意图进 `drops`），**只为 before/after 对照**（`T-0006`）。
   */
  audio?: boolean;
  /**
   * 跑完 CONFIG1 后额外做一遍**滚动/切分类**探针（默认关）：
   * 记录初始态 → 滚轮滚到底 → 点左侧第 2 个分类 → 各记录一次滚动条状态。
   * 这是"切页后拇指溢出轨道"的回归路径（见 `ScrollStep`）。
   */
  scrollProbe?: boolean;
  /**
   * 跑完 CONFIG1 后切到左侧第 5 个分类（**角色设定 = CONFIG2**）并采样样式（默认关）。
   *
   * 这是"角色名的颜色溢到下方 ADV 样例窗"的回归路径：
   * `CONFIG2` 逐行 `i076 <该行颜色>`（颜色取自 `adcd[]` 表）画角色名，
   * 而这些是**全局**样式字段 ⇒ 若"写全局色"被当成"给所有窗换色"，
   * 已排版的 ADV 样例窗（win 9）就会被染成**最后一个可见行**的颜色（用户实测）。
   */
  previewProbe?: boolean;
  /**
   * 在 `previewProbe` 之后继续走**「右键退出设置页 → 回 ADV」**那条重派生路径并 dump 关键量
   * （`tickets/T-0102` 丁-2/丁-3 的判决实验）。默认关；需要 `previewProbe: true` 才有意义。
   *
   * 给对象时可以铺 **ADV 语境**（TITLE 菜单进 CONFIG 与 ADV 进 CONFIG 的差别就在这几个全局上）：
   *  - `fromAdv`（默认 true）= 置 `3f38 = 1`（`src/SC0000.txt:998` 的场景入口 `label_00003774` 会置它）；
   *  - `g0`（默认 1）= 置脚本全局 0（`src/SC0000.txt:1023` 的 `mov (global-int 0) 1`；另一处真实取值是
   *    `:1292` 的 `6` —— 后者会让 `CONFIG.txt:262` 的 `eq … 1` 走假分支、**跳过重新入队**）；
   *  - `g1397`（默认 0）= 置全局 `1397`（`CONFIG.txt:223` 的门：**`1397 == 1` 且 `g0 ∈ {1,6}` ⇒ 重派生块才跑**；
   *    否则 `:225` 跳 `label_000014ec` 整块跳过）。★极性别写反 —— 见 `AdvReturnSample.g1397` 的注释与
   *    `test/config1-chain.test.ts` 的两组（`g1397: 1` ⇒ 会重派生；`g1397: 0` ⇒ 保持原色）；
   *  - `msg` = 置全局 `3f37`（引擎里它是**当前发言者/消息索引**；`52a49c` 是单位性别表，
   *    见 `docs-new/02-data/training-speakers.md:11`）。
   */
  advReturnProbe?: boolean | { fromAdv?: boolean; g0?: number; g1397?: number; msg?: number; seedRecords?: number };
  /**
   * **字体选择器探针**（默认关）：跑完 CONFIG1 后，把光标移到第一行字体项的「变更」按钮并点击
   * ⇒ 打开 `$1$SELFONT`（`CONFIG1.txt:1049 call-script 51dd`）⇒ 采两份滚动条几何 + 列表里画出的面名。
   *
   * 用途（2026-09 用户实测）：**先滚动主列表、再点开字体设置**时，选择器自己那条滚动条的
   * **中段**（`0x1FD` 拉伸出来的 1px 源）会漂到屏幕左边。修前/修后都能用本探针复现与回归：
   * 不变量 = 三段的 `dstX` 必须一致（同一列）、且都在轨道内。
   */
  fontPickerProbe?: boolean;
  /** 字体选择器探针前**先把主列表滚到底**（复现"先滚动再打开"的那条路径）。 */
  fontPickerScrollFirst?: boolean;
  /**
   * 打开选择器**之后**再滚几次滚轮（用户实测的触发条件之一）。给了就额外采一份 `afterWheel` 快照。
   */
  fontPickerWheelAfter?: number;
  /**
   * **用户实测的完整复现路径**：打开选择器 → **右键退出**回设置页 → 再滚主列表。
   *
   * 根因（2026-09）：`CONFIG1.txt:1045` 在打开选择器前把脚本全局 `707ffa`（弹窗原点 x）置成 348
   * 且**从不复位**；而滚动条中段的 `0x217` pivot 被算成 `707ffa + 32e`（`CONFIG1.txt:2960`、
   * `CONFIG2.txt:1424`），描画位置却是 `32e` ⇒ pivot ≠ pos。渲染侧若把位置写成 `pos` 而不是
   * `pivot`，被 `0x1FD` 拉伸的中段就整体左移 `707ffa`（用户实测「中段漂到左边」）。
   */
  fontPickerCloseThenScroll?: boolean;
  /** 外置选项（`emulator.config.json` 的内容）；省略 = 真游戏行为（`boot.showLogo=true`）。 */
  emulatorOptions?: EmulatorOptions;
}

/**
 * **生效资源根**（与 `runConfig1Chain` 同口径：`AMAYUI_RESOURCE_DIR` > `resources.path` > 默认 `install/`）。
 *
 * 导出给测试用：判断"本地化产物（`install/<ID>.BIN`）是否已安装"——否则链路会**静默**读到 ALF 里的
 * 日文原版，让"文案断言"变成环境问题而不是回归（`tickets/T-0043`②）。
 */
export function chainResourceDir(emulatorOptions?: EmulatorOptions): string {
  const options = normalizeEmulatorOptions(emulatorOptions ?? DEFAULT_EMULATOR_OPTIONS);
  return decideResourceDir(ROOT, {
    env: process.env,
    ...(options.resources.path ? { configResourcePath: options.resources.path, configDir: ROOT } : {}),
  }).dir;
}

export async function runConfig1Chain(opt: ChainOptions = {}): Promise<ChainResult> {
  const options = normalizeEmulatorOptions(opt.emulatorOptions ?? DEFAULT_EMULATOR_OPTIONS);
  // 资源根：`AMAYUI_RESOURCE_DIR` > `resources.path`（相对基准 = 仓库根；本库不读 config 文件）> 默认 install/。
  const resourceDir = chainResourceDir(opt.emulatorOptions);
  const src = new NodeFileSource({ resourceDir });
  const input = new InputManager();
  // ★音频（`tickets/T-0006`）：真 `AudioEngine` + headless 宿主（真字节 + 容器头推时长，不出声）。
  //   不给宿主时所有音频意图都会进闸门 A 的「意图被丢弃」清单（修前就是这样 ⇒ 链路上看不到发声时机）。
  const audioEvents: string[] = [];
  const collectAudio = (m: string): void => {
    if (m.startsWith('[audio]')) audioEvents.push(m);
  };
  const scene = new HeadlessScene(
    opt.audio === false ? {} : { audioHost: new NodeAudioHost({ source: src, log: collectAudio }), onLog: collectAudio },
  );
  // 归因用：DropRecorder 需要"当前 opcode"，而 Engine 在 native 之后才建 ⇒ 用可变持有者打破循环。
  let engineRef: Engine | null = null;
  const drops = new DropRecorder(() => engineRef?.currentOpcode ?? 0);
  const e = new Engine(opt.recordDrops ? withNativeTap(scene, drops) : scene, input);
  const native = scene;
  engineRef = e;
  e.fileSource = src;
  // ★Live2D 运行态（T-0054）：槽/节点/动作三张表在 Engine 上，挂给场景宿主以便
  //   ① 帧末推进动作（scL2dTick，两宿主同一份）；② 快照能导出节点与出画判据。
  scene.scene.l2dHost = e;
  e.config = parseIni(effectiveIniText());
  applyConfigToEngine(e.config, e.engineValues);
  // 外置选项（`emulator.config.json`）：`boot.showLogo` + `resources.version`（字体面名解析策略）。
  // library 省略时 = 真游戏行为（播 LOGO）；只有 CLI 入口读文件（理由见 `gameStartChain.ts` 同名字段）。
  applyEmulatorOptionsToEngine(e, options);
  const boot = await src.readScript(0);
  assert.ok(boot, '应能读到 index 0 = SYSTEM4.BIN');
  loadScriptData(e, boot.data, boot.name);

  const unimplemented: string[] = [];
  let clock = 0;
  // ★样例窗只存在很短一段（CONFIG1 紧接着有条件的 `i301 9` 清场）⇒ 在跑的过程中采样
  let sampleWin: SnapshotMsgWin | null = null;
  let sampleText = '';
  let coveredBy: CoverInfo[] = [];
  const trace: string[] = [];
  const maxFrames = opt.maxFrames ?? Number.POSITIVE_INFINITY;
  /** 最近一次 `0x12F` 的输入/输出（CONFIG1 的列表顺序由它决定）。 */
  let sort12f: Sort12fDump | null = null;
  /** 单步 + 可选的盘点回调（`onStep` 关闭时与直接 `stepOnce` 等价）；`0x12F` 的输入/输出另存。 */
  const sampleNow = (): void => {
    const f = native.scene.msgWins.get(9);
    // ★`0x300` 闸门会让样例"贴出 → 停留 op3 ms → 消失 → 再来一遍"**循环**：
    //   只在**整段贴出**的那一帧采样，否则采到的是循环中途（revealed=0）的态。
    const fullyShown = f ? f.revealed < 0 || f.revealed >= f.glyphCount : false;
    if (f && f.glyphCount > 0 && (fullyShown || !sampleWin)) {
      sampleWin = native.snapshot().msgWins.find((w) => w.win === 9) ?? sampleWin;
      // 快照文本也要在"窗口还有内容"的那一刻取（CONFIG1 紧接着有条件的 `i301 9` 清场）
      sampleText = native.snapshotText();
      // ★"文字会不会被盖住"不变量：与文本框相交且层序更高的可绘制项必须为空
      const layer = f.style.itemId > 0 ? f.style.itemId : 20 + 9;
      coveredBy = native
        .snapshot()
        .drawItems.filter(
          (d) =>
            d.drawable &&
            d.layer > layer &&
            parseInt(d.color.slice(1, 3), 16) > 0 &&
            d.dst.x <= f.style.x + f.style.w &&
            d.dst.x + d.src.w >= f.style.x &&
            d.dst.y <= f.style.y + f.style.h &&
            d.dst.y + d.src.h >= f.style.y,
        )
        .map((d) => ({ layer: d.layer, handle: d.handle, dst: d.dst, size: { w: d.src.w, h: d.src.h }, color: d.color }));
      trace.push(
        `[采样] ${native.scene.msgWins.size} 个文本窗；窗 9：层序=${layer} 行=${f.lines.length} 字=${f.glyphCount} ` +
          `竖排=${f.style.vertical} 遮挡项=${coveredBy.length}`,
      );
      trace.push(
        `[采样] 窗9 层序=${layer} 图元=${native.scene.drawItems.size} 文本窗=${native.scene.msgWins.size}` +
          (coveredBy.length ? ` ★被 ${coveredBy.length} 个更高层图元遮挡` : ''),
      );
    }
  };
  /**
   * **帧宿主 + 驱动配置** —— B1：逐项照抄本文件原来的帧循环（`tickets/T-0001`，不许"顺手统一"）。
   *  - `gates.anim: 'wait'`（B2 起）= 与产品同源：按引擎语义放行（池挂起位 + `0x238` 计时器，`T-0024`），不再无条件清 `0x400`
   *  - `gates.sleep: 'wait'`   = `else if (waitFlags & SLEEP_GATE) { if (clock >= sleepUntil) clear }`
   *  - `gates.advance: 'force'`= `else if (e.awaitingAdvance) e.forceAdvance();`（无输入源；B3 解决）
   *  - `host.present/poolPending` = headless 的合成（推进模型）与池挂起位（B2 起每帧推进一次）
   *  - `advErrors: 'swallow'`  = ADV 分支外层的 `catch {}`
   *  - `maxStepsPerFrame: 5000`= 内批的 `k < 5000`
   *  - `onUnknown → 'stop'`    = 记录 `unimplemented` 后 `return i`（**不登记用户桩**：未实现 opcode 必须让测试失败）
   *  - `onFrameEnd`            = `sampleNow(); clock += 1000 / 60;`
   */
  const host: FrameHost = {
    now: () => clock,
    advanceModel: (t) => { native.advance(t); },
    poolPending: () => native.poolPending(),
  };
  let lastInstr: BinInstruction | undefined;
  /**
   * 探针用的逐条钩子（默认 null ⇒ 零开销）。`base.onStep` 里调用它 —— 探针靠它收集
   * 「`i076`/`i082` 在退出路径上有没有被再执行一次」（`tickets/T-0102` 的判据）。
   */
  let advStepHook: ((opcode: number) => void) | null = null;
  /**
   * 同上的**前置**钩子（`onStepStart` 时机 = 指令**尚未执行**）。
   *
   * ★为什么非要有它：`onStep` 是**执行之后**才回调（见 `frame/loop.ts:211/229`），所以"某条指令自己
   * 产生了哪些副作用"不能靠 `onStep` 里的计数差来量 —— 在 `onStep` 里读到的计数**已经含它自己**了。
   * 要精确圈定"这条指令执行期间发生的宿主同步"，只能在 `onStepStart` 记下当前 opcode、
   * 在 `onStep` 清掉（窗口 = 该指令的整个执行期，见 `AdvReturnProbe.republishByI082`）。
   */
  let advPreHook: ((opcode: number) => void) | null = null;
  const base: Omit<FrameLoopOptions, 'until' | 'maxFrames'> = {
    gates: { anim: 'wait', sleep: 'wait', advance: 'force' },
    advFrame: true,
    advErrors: 'swallow',
    maxStepsPerFrame: 5000,
    onStepStart: (_f, instr) => {
      lastInstr = instr;
      advPreHook?.(instr ? instr.opcode : -1);
    },
    onStep: (t) => {
      opt.onStep?.(t);
      advStepHook?.(t.opcode);
      if (lastInstr && t.opcode === 0x12f) sort12f = captureSort12f(e, lastInstr);
    },
    onUnknown: (err) => {
      uninplementedPush(unimplemented, err);
      return 'stop';
    },
    onFrameEnd: () => {
      sampleNow();
      clock += 1000 / 60;
    },
  };
  /**
   * 跑到 `until()` 为真或达到帧上限。
   * ★不要用「固定跑 N 帧」——那会在已经到达目标后继续空转，把测试拖到几十秒。
   */
  /**
   * 跑帧。
   * @param until 帧开头的提前结束条件（**引擎状态可能在帧内后段才定型**，如悬停下标 `3f7` 是命中测试之后才写
   *              ⇒ 这类条件只能在帧边界判；逐条判会读到"半成品"状态）
   * @param stopStep 可选的**逐条**结束条件 —— 只对"一旦为真就永久为真"的条件用（B2 加的；
   *                 逐条判才能恰好停在目标，否则会越过目标最多一整批）
   */
  const run = async (frames: number, until?: () => boolean, stopStep?: () => boolean): Promise<number> => {
    const r = await runFrameLoop(e, host, {
      ...base,
      ...(until ? { until } : {}),
      ...(stopStep ? { stopAfterStep: () => stopStep() } : {}),
      maxFrames: Math.min(frames, maxFrames),
    });
    // ★B2 起与 `gameStartChain` **统一**（C5：同一语义两处写法不同）：跑满上限 ⇒ 返回调用方给的 `frames`；
    //   提前结束（until/脚本尾/异常）⇒ 返回**已跑完的帧数**。调用方判据一律 `(await run(N, f)) < N`。
    //   （修前这里返回 `maxFrames`（默认 `+∞`），靠"`Infinity < N` 为假"侥幸与判据相容。）
    return r.stopReason === 'cap' ? frames : r.frames;
  };

  const onTitle = () => e.curScript().name.startsWith('TITLE');
  const onConfig1 = () => e.curScript().name.startsWith('CONFIG1');
  // 启动 → LOGO → TITLE。★帧上限只是兜底：`until` 命中即返回（实测到 TITLE 只需 ~20 帧，
  //   但 TITLE 的 `sleep 1` 让步使 1 帧≈1 条指令，所以补一段固定帧让它把菜单/hover 状态初始化完）。
  assert.ok((await run(4000, onTitle)) < 4000, '应在帧上限内到达 TITLE');
  assert.ok(onTitle(), `应停在 TITLE，实际 ${e.curScript().name}`);
  await run(4000); // TITLE 初始化（与 title-exit.test.ts 同口径）
  const hover = (): number => dec(e.key, e.curScript().locals.int.get(0x3f7) ?? 0);
  input.setCursor(...CONFIG_XY);
  await run(2000, () => hover() === 3);
  assert.equal(hover(), 3, '悬停点应命中 TITLE 菜单第 3 项（CONFIG）');
  input.pressMouse(0);
  await run(400); // 按住期间让 VM 轮询到
  input.releaseMouse(0);
  await run(4000, onConfig1); // CONFIG.BIN → CONFIG1.BIN
  assert.ok(onConfig1(), `应进入 CONFIG1，实际 ${e.curScript().name}`);
  // CONFIG1 里继续跑到"ADV 样例窗口"被执行（文本槽被写入）
  await run(4000, () => e.msgwin.slots.size > 0);
  // ★`CONFIG.txt:171 i300 9 1 3e8` 让这个样例窗走闸门泵：先跑到整段贴出（采样才有意义），
  //   再跑一段观察**循环**（贴出 → 停留 1000ms → 清场 → 重新贴出）。
  await run(600, () => {
    const r = e.msgwin.revealedOf(9);
    return r < 0 || r >= 19;
  });
  const gate = e.msgwin.gates.get(9);
  const shownSeq: number[] = [];
  for (let i = 0; i < 90; i++) {
    await run(1);
    const r = e.msgwin.revealedOf(9);
    shownSeq.push(r < 0 ? 19 : r);
  }
  const gateLoop = { enabled: gate?.enabled === true, autoHideMs: gate?.autoHideMs ?? 0, shown: shownSeq };

  // ★滚动/切分类探针（默认关）：第一页滚到底 → 点左侧第 2 个分类 → 看滚动条是否还在轨道里。
  //   这是"切页后拇指溢出轨道"的回归路径（根因：脚本载入没重建帧局部池 ⇒ 5620 从上一页漏过来）。
  const scrollSteps: ScrollStep[] = [];
  if (opt.scrollProbe) {
    const snap = (tag: string): void => {
      scrollSteps.push({
        tag,
        itemCount: dec(e.key, e.curScript().locals.int.get(0x561f) ?? 0),
        rows: dec(e.key, e.curScript().locals.int.get(0x5622) ?? 0),
        start: dec(e.key, e.curScript().locals.int.get(0x5620) ?? 0),
        maxStart: dec(e.key, e.curScript().locals.int.get(0x5624) ?? 0),
        thumbH: dec(e.key, e.curScript().locals.int.get(0x5623) ?? 0),
        thumbTop: dec(e.key, e.curScript().locals.int.get(0x3f6) ?? 0),
      });
    };
    snap('进入 CONFIG1');
    for (let i = 0; i < 8; i++) {
      input.addWheel(-120); // 下滚一格 = −120（与引擎 WM_MOUSEWHEEL 同口径）
      await run(30);
    }
    snap('滚到底');
    // 左侧分类列表第 2 项的中心：贴片画在 `(24, 106+50i)`、190×26 ⇒ i=1 的中心 y=169。
    // ★实测订正见下面「第 5 项」那段的注释（真命中带 `y = 100+50i .. 149+50i`，比 26 高的贴片高）。
    input.setCursor(120, 156);
    await run(60);
    input.pressMouse(0);
    await run(120);
    input.releaseMouse(0);
    await run(600);
    snap('切到第 2 个分类');
    input.setCursor(120, 106); // 再切回第 1 个分类（项数多、且刚才滚到底过）
    await run(60);
    input.pressMouse(0);
    await run(120);
    input.releaseMouse(0);
    await run(600);
    snap('切回第 1 个分类');
  }

  // ★「角色名颜色溢到 ADV 样例窗」探针（默认关）：切到左侧第 5 个分类（角色设定 = CONFIG2），
  //   看样例窗的颜色会不会被逐行设色带走。根因：把"写全局字体色"当成"给所有窗换色"。
  let previewStyle: PreviewStyleProbe | undefined;
  if (opt.previewProbe) {
    const fillOf = (): string | null => native.scene.msgWins.get(9)?.style.main.fill ?? null;
    const liveFillOf = (): string =>
      '#' + (bgrToRgb(e.engineValues.get(21664) ?? 0xffffff) & 0xffffff).toString(16).padStart(6, '0');
    const beforeFill = fillOf() ?? '';
    const win9Fills: string[] = [];
    const liveFills: string[] = [];
    const rowFills = new Set<string>();
    // 左侧分类列表第 5 项（角色设定）的中心：贴片画在 `(24, 106+50i)`、尺寸 190×26 ⇒ i=4 的中心 y=319。
    //
    // ★**实测订正**（`tickets/T-0141`，2026-09-23；x=120 逐 y 扫、每次读全局 `12721e`）：
    //   真实的**命中带**是 `y = 100+50i .. 149+50i`（每项**整 50 高**、无缝隙），比上面那个 26 高的
    //   贴片**高**（贴片只是绘制矩形，不是命中矩形）。所以：
    //   * 本文件里用到的那几个 y（106 / 156 / 306 / 319 …）**都落在正确项内**，实测 6/6 命中正确分类；
    //   * 反过来 `y = 150` 已经不是第 1 项而是第 2 项了 ⇒ **别把绘制矩形当命中矩形**去推算边界；
    //   * 分类 ↔ 脚本：`src/CONFIG.txt:51` 判 `12721e == 4` ⇒ 只有 **i=4（角色设定）** call-script
    //     CONFIG2，**i=0..3 与 i=5 全部是 CONFIG1**（所以"点 ADV 设定 ⇒ 进 CONFIG2"是错的）。
    input.setCursor(120, 306);
    await run(60);
    input.pressMouse(0);
    await run(120);
    input.releaseMouse(0);
    // 采样：切页后若干帧（CONFIG2 逐行设色 + 逐行直绘都在这一段里发生）
    for (let i = 0; i < 400; i++) {
      await run(1);
      const f = fillOf();
      if (f !== null) win9Fills.push(f);
      liveFills.push(liveFillOf());
      // `create-texture` 每帧会清掉槽 196 的直绘表 ⇒ 每帧整体收一遍（色值去重即可）
      for (const s of native.scene.slotText.get(196) ?? []) rowFills.add(s.fill);
    }
    previewStyle = {
      beforeFill,
      win9Fills,
      rowFills: [...rowFills],
      liveFills,
      win9Present: fillOf() !== null,
    };
  }

  // ★「右键退出设置页 → 回 ADV 重派生」探针（默认关；`tickets/T-0102` 丁-2/丁-3 的判决实验）。
  //   为什么要它：用户实测「退出设置回 ADV 后文字仍是角色设定页最后一行的颜色（紫）」，真机不紫。
  //   引擎的「回 ADV」路径 = `src/CONFIG.txt:225-269`（按当前消息号 `3f37` 重派生 `14acda` →
  //   `call label_00001ae8` 重算并 `i076` 应用 → `i071 2` → `i082`）。本探针把那一跳走完并 dump。
  let advReturn: AdvReturnProbe | undefined;
  if (opt.advReturnProbe) {
    const sample = (): AdvReturnSample => ({
      fill: '#' + (bgrToRgb(e.engineValues.get(21664) ?? 0xffffff) & 0xffffff).toString(16).padStart(6, '0'),
      outline: '#' + (bgrToRgb(e.engineValues.get(21665) ?? 0) & 0xffffff).toString(16).padStart(6, '0'),
      f807b: dec(e.key, e.globals.int.get(0xf807b) ?? 0),
      f807c: dec(e.key, e.globals.int.get(0xf807c) ?? 0),
      c14acda: dec(e.key, e.globals.int.get(0x14acda) ?? 0),
      msg3f37: dec(e.key, e.globals.int.get(0x3f37) ?? 0),
      g3f38: dec(e.key, e.globals.int.get(0x3f38) ?? 0),
      g0: dec(e.key, e.globals.int.get(0) ?? 0),
      g1397: dec(e.key, e.globals.int.get(0x1397) ?? 0),
      g3f36: dec(e.key, e.globals.int.get(0x3f36) ?? 0),
      script: e.curScript().name,
    });
    const before = sample();
    // ★铺 **ADV 语境**（可选）：`TITLE 菜单 → CONFIG` 与 `ADV → CONFIG` 的差别就在这几个全局上，
    //   而 `CONFIG.txt:225-269` 的重派生块只在前者之外才跑（`3f38 != 0`、`local10 == 0`）。
    const cfg = typeof opt.advReturnProbe === 'object' ? opt.advReturnProbe : {};
    e.globals.int.set(0x3f38, enc(e.key, cfg.fromAdv === false ? 0 : 1));
    e.globals.int.set(0, enc(e.key, cfg.g0 ?? 1));
    e.globals.int.set(0x1397, enc(e.key, cfg.g1397 ?? 0));
    if (cfg.msg !== undefined) e.globals.int.set(0x3f37, enc(e.key, cfg.msg));
    const setup = sample();
    /**
     * **派生链表**（见 `AdvReturnProbe.derivation`）：`lookup-array (ptr) (global TBL) (idx)` 的读法就是
     * `globals.int[TBL + idx]`（`GlobalArrays` 以全局下标为键、稀疏存储）⇒ 直接按下标读即可。
     */
    const gInt = (i: number): number => dec(e.key, e.globals.int.get(i) ?? 0);
    const gStr = (i: number): string => e.globals.str.get(i) ?? '';
    const TBL_SEX = 0x52a49c;
    const TBL_VIA = 0x14acdc;
    const TBL_IDX = 0x14b0c4;
    const TBL_ADCD = 0xadcd;
    const chainAt = (m: number): { sex: number; via: number; idx: number } => {
      const via = gInt(TBL_VIA + m);
      return { sex: gInt(TBL_SEX + m), via, idx: gInt(TBL_IDX + via) };
    };
    const derivation = ((): AdvReturnProbe['derivation'] => {
      const msg = cfg.msg ?? gInt(0x3f37);
      const cur = chainAt(msg);
      const prev = chainAt(msg - 1);
      const next = chainAt(msg + 1);
      return {
        msg,
        sex: cur.sex,
        via: cur.via,
        idx: cur.idx,
        viaPrev: prev.via,
        idxPrev: prev.idx,
        viaNext: next.via,
        idxNext: next.idx,
        palette: [gInt(TBL_ADCD + cur.idx - 1), gInt(TBL_ADCD + cur.idx), gInt(TBL_ADCD + cur.idx + 1)],
        text: gStr(0xf612 + msg),
      };
    })();
    const marks: string[] = [];
    let sawI082 = false;
    let sawI076 = false;
    let lastScript = '';
    // ★数"`i082` 自己重发布了几次窗"（见 `AdvReturnProbe.republishByI082`）：把宿主的
    //   `msgWinSync` 包一层计数，窗口 = **正在执行的那条指令就是 `0x82`**（`advPreHook` 置、
    //   `onStep` 清）—— 不能用 `onStep` 前后计数差：`onStep` 在执行**之后**才回调，差值恒为 0。
    let preOp = -1;
    let republishByI082 = 0;
    let recordsAtI082 = -1;
    /** `i082` **执行期间**最后一次 `msgWinSync` 的样式载荷（判决实验要看的"重发布用了哪个颜色"）。 */
    let restyleByI082: AdvReturnProbe['restyleByI082'] = null;
    /** `i076` 之后的发布计数/末次载荷（见 `AdvReturnProbe.syncsAfterI076`）。 */
    let syncsAfterI076 = 0;
    let lastSyncAfterI076: { win: number; fill: string; outline: string; op: number } | null = null;
    const opsSyncedAfterI076: number[] = [];
    /** ★`seedRecords`（`tickets/T-0102` 的判决实验）：见下方 `AdvReturnProbe.seedRecords` 的说明。 */
    if (cfg.seedRecords && cfg.seedRecords > 0) {
      // 找**真实** `i082` 指令（在任意帧的脚本里），用**它的操作数**决定"给哪个窗、从哪个下标起"有记录
      //   —— 不能猜：门是 `records.length > op2`，而记录要落在 `op1` 那个窗上才可能被重画。
      let owner: { frame: Frame; ins: BinInstruction } | null = null;
      for (const f of e.frames) {
        const ins = f.script?.instructions.find((x) => x.opcode === 0x82);
        if (ins) {
          owner = { frame: f, ins };
          break;
        }
      }
      const winIdx = owner ? readIntOperand(e, owner.frame, owner.ins, 1) : 2;
      for (let i = 0; i < cfg.seedRecords; i++) {
        e.textItems.records.push({ win: winIdx, v20: 0, v24: 0, v32: 0, flags: 0 } as never);
      }
      marks.push(`[probe] seedRecords=${cfg.seedRecords}（win=${winIdx}）⇒ records=${e.textItems.records.length}`);
    }
    const nativeAny = native as unknown as { msgWinSync?: (...a: unknown[]) => void };
    const origSync = nativeAny.msgWinSync?.bind(native);
    nativeAny.msgWinSync = (...a: unknown[]) => {
      const winArg = Number(a[0]);
      const input2 = a[1] as
        | { style?: { main?: { fill?: string; outline?: string } }; revealed?: number }
        | undefined;
      const mainStyle = input2?.style?.main;
      // ★`i076` 之后的每一次发布都记一笔（判据 3 的最后一格：见 `AdvReturnProbe.syncsAfterI076`）
      if (sawI076 && mainStyle) {
        syncsAfterI076++;
        lastSyncAfterI076 = {
          win: winArg,
          fill: String(mainStyle.fill ?? '?'),
          outline: String(mainStyle.outline ?? '?'),
          op: preOp,
        };
        if (!opsSyncedAfterI076.includes(preOp)) opsSyncedAfterI076.push(preOp);
      }
      if (preOp === 0x82) {
        republishByI082++;
        // 正文色在 `style.main.*`（不是 `style.*`，也不是注音的 `style.ruby`）
        if (input2?.style) {
          const snap = e.msgwin.slot(winArg).fontStyle;
          restyleByI082 = {
            win: winArg,
            fill: String(input2.style.main?.fill ?? '?'),
            outline: String(input2.style.main?.outline ?? '?'),
            revealed: input2.revealed ?? -1,
            // ★判决实验的核心：`true` ⇒ 颜色取自 `MsgSlot.fontStyle`（**入队时的快照**，
            //   `styleOfWin` 的第一选择）；`false` ⇒ 走了 `globalFontSnapshot` 回退（重派生后的实时色）。
            //   ★注意快照的"没有"是 `null` 而**不是** `undefined`（`vm/msgwin.ts:673` 初始化成 null）
            //   —— 只判 `!== undefined` 会把"任何存在的槽"都当成有快照（本探针第一版就栽在这）。
            snapshot: snap !== undefined && snap !== null,
            snapFill: snap ? snap.main.fill : null,
            liveFill: '#' + (bgrToRgb(e.engineValues.get(21664) ?? 0xffffff) & 0xffffff).toString(16).padStart(6, '0'),
          };
        }
      }
      origSync?.(...a);
    };
    advPreHook = (op) => {
      preOp = op;
    };
    advStepHook = (op) => {
      const nm = e.curScript().name;
      preOp = -1; // 一条指令的执行期到此结束（`i082` 的发布只可能落在它自己那一格里）
      if (op === 0x76) sawI076 = true;
      if (op === 0x82) {
        sawI082 = true;
        recordsAtI082 = e.textItems.records.length;
      }
      // 只记 CONFIG 系脚本的指令 + 每次脚本切换 ⇒ 退出的那一小段不被 TITLE 的逐帧循环淹掉
      if (nm.startsWith('CONFIG')) marks.push(`${nm.replace('.BIN', '')}:${op.toString(16)}`);
      if (nm !== lastScript) {
        marks.push(`→${nm}`);
        lastScript = nm;
      }
    };
    // ★`CONFIG.txt:63` 的 `e = (12721e >= 0) & (12721e < 6)` ⇒ 把 `12721e` 踢出 `[0,6)` 就走
    //   「回 ADV」分支（`label_00000f6c`）。真实 UI 是右键「戻る」把**同一个全局**置成界外值
    //   ⇒ 这里直接置同一个量（不改脚本、不改语义；写入按全局池口径 `enc()`）。
    e.globals.int.set(0x12721e, enc(e.key, 6));
    // ★还要让**当前子页**（CONFIG2）自己返回：它的主循环 `label_00000388` 看 `local 7dd`
    //   （1 ⇒ 跳 `label_00006d1c`，那里 `exit` 回 CONFIG.BIN）。真实 UI 由「戻る」热点置它；
    //   这里直接置同一个量（不改脚本、不改语义）。
    e.curScript().locals.int.set(0x7dd, enc(e.key, 1));
    await run(1200, () => sawI082 || e.curScript().name.startsWith('SN0000'));
    await run(300); // 让 i082 之后的部分也走完
    advStepHook = null;
    advPreHook = null;
    nativeAny.msgWinSync = origSync;
    advReturn = {
      before,
      setup,
      after: sample(),
      derivation,
      marks: marks.slice(-160),
      reappliedStyle: sawI076,
      sawI082,
      republishByI082,
      recordsAtI082,
      restyleByI082,
      syncsAfterI076,
      lastSyncAfterI076,
      opsSyncedAfterI076,
    };
  }

  // ★字体选择器探针（默认关）：先（可选）滚主列表 → 点第一行字体项的「变更」→ 开 `$1$SELFONT`
  //   → 采两份滚动条几何。用户实测：**先滚动再打开**时选择器的中段（`0x1FD` 拉伸条）会漂到左边。
  let fontPicker: FontPickerProbe | undefined;
  let pickerOpenY = 0;
  if (opt.fontPickerProbe) {
    if (opt.fontPickerScrollFirst) {
      for (let i = 0; i < 8; i++) {
        input.addWheel(-120); // 下滚一格 = −120（与引擎 WM_MOUSEWHEEL 同口径）
        await run(30);
      }
    }
    // 系统设定页里**字体行**的判据：数值贴片的源矩形 `srcY = 217`（开关行是 0）——见本文件的
    // collectConfigRows。滚动后行位置会变，所以按当前几何找，而不是写死 y。
    const rows = collectConfigRows(native);
    const fontRow = rows.find((r) => r.value.srcY === 217);
    const clickY = fontRow ? fontRow.value.dstY + 15 : 370;
    pickerOpenY = clickY;
    input.setCursor(1113, clickY);
    await run(60);
    input.pressMouse(0);
    await run(120);
    input.releaseMouse(0);
    // 选择器里每帧重画列表 ⇒ 边跑边收候选面名（槽 198 = `draw-string c6 …`）
    const names = new Set<string>();
    for (let i = 0; i < 300; i++) {
      await run(1);
      for (const s of native.scene.slotText.get(198) ?? []) names.add(s.text);
    }
    const handles: FontPickerProbe['handles'] = [];
    for (const it of native.scene.drawItems.values()) {
      if (it.handle < 0x2e630 || it.handle >= 0x2e630 + 0x100) continue;
      const sc = itemScale(it, e.nowMs);
      handles.push({
        handle: `0x${it.handle.toString(16)}`,
        dstX: it.posX,
        dstY: it.posY,
        srcW: it.srcW,
        srcH: it.srcH,
        scaleX: sc.x,
        scaleY: sc.y,
      });
    }
    fontPicker = {
      scrolled: opt.fontPickerScrollFirst === true,
      list: collectScrollThumb(e, native),
      picker: collectThumbAt(e, native, 0x2e630, [0x6e, 0x6f, 0x70]),
      names: [...names],
      handles: handles.sort((a, b) => a.handle.localeCompare(b.handle)),
      clickY: pickerOpenY,
      opened: e.curScript().name.startsWith('SELFONT'),
    };

    // ★用户实测路径：右键退出选择器 → 回设置页 → 再滚主列表（此时 `707ffa` 仍是 348）
    if (opt.fontPickerCloseThenScroll) {
      input.setCursor(650, 300);
      await run(30);
      input.pressMouse(1); // 右键 = 取消（引擎 bit1）
      await run(120);
      input.releaseMouse(1);
      await run(900, () => e.curScript().name.startsWith('CONFIG1'));
      for (let i = 0; i < 3; i++) {
        input.addWheel(-120);
        await run(40);
      }
      await run(300);
      fontPicker.afterCloseScroll = collectScrollThumb(e, native);
      fontPicker.scriptAfterClose = e.curScript().name;
      fontPicker.popupOrigin = {
        x: dec(e.key, e.globals.int.get(0x707ffa) ?? 0),
        y: dec(e.key, e.globals.int.get(0x707ffb) ?? 0),
      };
    }
  }

  // ★滚动条拇指（`0x1FD` 的回归不变量）：三段式几何必须首尾相接。
  const scrollThumb = collectScrollThumb(e, native);
  // ★设置列表的可见行（`0x12F` 排序正确性的回归不变量）+ 直绘进槽的文本（`0x204`）
  const configRows = collectConfigRows(native);
  const slotText = [...native.scene.slotText.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([slot, list]) => ({
      slot,
      count: list.length,
      sample: list[0]?.text ?? '',
      texts: list.map((t) => t.text),
    }));

  const m = e.msgwin;
  const out = {
    script: e.curScript().name,
    unimplemented,
    text: m.textOf(0),
    ruby: m.slot(m.resolveWin(0)).segments.flatMap((s) => s.ruby) as unknown as string[][],
    // ★默认窗的唯一真源 = `msgwin.defaultWin`（= 引擎 `Font+1228`；`tickets/T-0101` 的 D5 收敛后
    //   `engineValues[21631]` 不再是存放处 ⇒ 这里必须读它，否则恒 `undefined`）。
    pane: e.msgwin.defaultWin,
    msgField: e.engineValues.get(FIELD_VERTICAL),
    sampleWin,
    snapshotText: sampleText,
    coveredBy,
    itemCounts: { drawItems: native.scene.drawItems.size, drawable: [...native.scene.drawItems.values()].filter((i) => (i.flags & 1) !== 0).length },
    gateLoop,
    scrollThumb,
    configRows,
    slotText,
    sort12f,
    ...(opt.scrollProbe ? { scrollSteps } : {}),
    ...(fontPicker ? { fontPicker } : {}),
    ...(opt.previewProbe && previewStyle ? { previewStyle } : {}),
    ...(advReturn ? { advReturn } : {}),
    ...(opt.recordDrops ? { drops: drops.list() } : {}),
    audioEvents,
    trace,
  };
  await src.dispose?.();
  return out;
}

/**
 * 抓一次 `0x12F`（`i12f A B C n`）的输入/输出：按三个指针操作数取基址，读回 A/B/C 的**解码值**。
 * 只在链路里出现一次（CONFIG1 建可见项表时），所以"最后一次"就是那一次。
 */
function captureSort12f(e: Engine, instr: BinInstruction): Sort12fDump | null {
  try {
    const frame = e.curScript();
    const a = refFromOperand(e, frame, instr, 1);
    const b = refFromOperand(e, frame, instr, 2);
    const cc = refFromOperand(e, frame, instr, 3);
    const n = readIntOperand(e, frame, instr, 4);
    if (n <= 0 || n > 4096) return null;
    const dump = (r: ReturnType<typeof refFromOperand>): number[] =>
      Array.from({ length: n }, (_, i) => readRef(e, frame, refAt(r, i)));
    return { n, a: dump(a), b: dump(b), c: dump(cc) };
  } catch {
    return null; // 诊断用：取不到就算了，不影响链路
  }
}

/** 取滚动条拇指三段（`CONFIG1.txt:2934-2971` 的 handle 布局：`0x1d4c0 + 0x76c / 0x776 / 0x777 / 0x778`）。 */
/** 字体选择器（`$1$SELFONT`）探针结果（`fontPickerProbe: true`）。 */
export interface FontPickerProbe {
  /** 打开选择器之前是否先滚过主列表（含滚动后的主列表拇指，用于对照）。 */
  scrolled: boolean;
  /** 主列表拇指（base `0x1d4c0`；选择器打开后仍应留在轨道里）。 */
  list: ScrollThumb | null;
  /** 选择器自己的拇指（base `0x2e630` + `0x6e/0x6f/0x70`：顶 / **中(0x1FD 拉伸)** / 底）。 */
  picker: ScrollThumb | null;
  /** 列表里画出的候选面名（`0x2DD` → `set-font` → `draw-string c6 …`）。 */
  names: string[];
  /** 选择器基址区间（`0x2e630 .. +0x100`）内实际存在的图元（诊断：确认三段用的到底是哪几个 handle）。 */
  handles: { handle: string; dstX: number; dstY: number; srcW: number; srcH: number; scaleX: number; scaleY: number }[];
  /** 点「变更」用的 y（按当时几何找到的字体行）。 */
  clickY: number;
  /** 点击后当前脚本是否真的是 `SELFONT`（选择器开没开）。 */
  opened: boolean;
  /** **右键退出选择器、再滚主列表之后**的主列表拇指（`fontPickerCloseThenScroll` 时才有）。 */
  afterCloseScroll?: ScrollThumb | null;
  /** 关掉选择器之后的脚本名（应回到 CONFIG1）。 */
  scriptAfterClose?: string;
  /** 探查时刻的"弹窗原点" `global 707ffa/707ffb`（脚本从不复位它 ⇒ 会一直是 348/78）。 */
  popupOrigin?: { x: number; y: number };
}

/**
 * 取「三段式滚动条」的几何（`CONFIG1` 与 `SELFONT` 用的是同一套画法，只是 handle 基址不同）。
 *
 * @param base   handle 基址（CONFIG1 = `0x1d4c0`，选择器 = `0x2e630`）
 * @param offs   顶/中/底三段的 handle 偏移
 */
function collectThumbAt(e: Engine, native: HeadlessScene, base: number, offs: [number, number, number]): ScrollThumb | null {
  const seg = (off: number): ThumbSeg | null => {
    const it = native.scene.drawItems.get(base + off);
    if (!it) return null;
    const sc = itemScale(it, e.nowMs);
    const pv = itemPivotLocal(it);
    return {
      handle: it.handle,
      dstX: it.posX,
      dstY: it.posY,
      srcW: it.srcW,
      srcH: it.srcH,
      scaleX: sc.x,
      scaleY: sc.y,
      pivotRelX: pv.x,

      pivotRelY: pv.y,

      useWorld: it.useWorld,
    };
  };
  const top = seg(offs[0]);
  const middle = seg(offs[1]);
  const bottom = seg(offs[2]);
  if (!top || !middle || !bottom) return null;
  return { base, top, middle, bottom };
}

function collectScrollThumb(e: Engine, native: HeadlessScene): ScrollThumb | null {
  const base = 0x1d4c0;
  const seg = (off: number): ThumbSeg | null => {
    const it = native.scene.drawItems.get(base + off);
    if (!it) return null;
    const sc = itemScale(it, e.nowMs);
    const pv = itemPivotLocal(it);
    return {
      handle: it.handle,
      dstX: it.posX,
      dstY: it.posY,
      srcW: it.srcW,
      srcH: it.srcH,
      scaleX: sc.x,
      scaleY: sc.y,
      pivotRelX: pv.x,

      pivotRelY: pv.y,

      useWorld: it.useWorld,
    };
  };
  const top = seg(0x776);
  const middle = seg(0x777);
  const bottom = seg(0x778);
  if (!top || !middle || !bottom) return null;
  return { base, top, middle, bottom };
}

/**
 * 取设置列表的可见行（`CONFIG1.txt:2509-2520` 的每行三种图元）：
 * 行背景 `+0x3e8+i`、数值贴片 `+0x3fc+i`、控件贴片 `+0x514/+0x528/+0x5dc/+0x5f0 +i`。
 * 行数不写死：以"实际存在的数值贴片"为准（脚本用 `local5622` 决定画几行）。
 */
function collectConfigRows(native: HeadlessScene): ConfigRow[] {
  const base = 0x1d4c0;
  const rows: ConfigRow[] = [];
  for (let i = 0; i < 32; i++) {
    const v = native.scene.drawItems.get(base + 0x3fc + i);
    if (!v) break;
    let controls = 0;
    for (const off of [0x514, 0x528, 0x5dc, 0x5f0]) if (native.scene.drawItems.has(base + off + i)) controls++;
    rows.push({
      i,
      value: { handle: v.handle, srcX: v.srcX, srcY: v.srcY, srcW: v.srcW, srcH: v.srcH, dstX: v.posX, dstY: v.posY },
      hasBand: native.scene.drawItems.has(base + 0x3e8 + i),
      controls,
    });
  }
  return rows;
}

function uninplementedPush(list: string[], err: NotImplementedOp): void {
  list.push(`0x${err.opcode.toString(16)} ${err.name} @${err.scriptName}`);
}

