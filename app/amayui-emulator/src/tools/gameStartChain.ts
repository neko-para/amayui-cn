/**
 * **「启动 → TITLE 右上角 Game Start → GAMESTART 配置界面 → ゲーム開始 → SN0000 首文案」链路跑手**。
 *
 * 为什么单独成模块（与 `config1Chain.ts` 同理由）：E3 回归（`test/game-start-chain.test.ts`）
 * 与**指令盘点工具**（`npm run op:inventory -- --path start`）需要**同一份**链路逻辑 ——
 * 否则"测试说对、盘点工具说不对"这种漂移又要花时间分辨。
 *
 * ## 这条路径的三段点击（坐标全部由脚本数据算出，不写死像素"魔法数"）
 * 1. **TITLE 菜单第 0 项 = Game Start**：`src/TITLE.txt:100`
 *    `i12e (local 3f5) 1 <mx> <my> (local cd) (local 5) (local 69) (local 0)`
 *    ⇒ 命中盒 `[0,0x9c,0,0x9c]`（156×156）、baseX `local 5 = [44e 3e0 365 2d9 453]`、
 *    baseY `local 69 = [126 192 1e5 21f 22a]`、count = `local 0 = 5`。
 *    第 0 项 = `(0x44e, 0x126)` = (1102, 294) ⇒ 中心 **(1180, 372)**（这就是"右上角 Game Start"）。
 * 2. **GAMESTART 的「ゲーム開始」**：`src/GAMESTART.txt:115` 同形状，命中盒 `(0,0xc1,0,0x3b)`
 *    = 193×59、baseX `local 195 = [2cb 3a3 44d]`、baseY `local 1f9 = [240 240 240]`。
 *    第 0 项 = `(0x2cb, 0x240)` = (715, 576) ⇒ 中心 **(811, 605)**。
 *    左键落在这个 hover 项上 ⇒ `GAMESTART.txt:146-155` 的 `label_00001528` → `label_00001564`
 *    写 `local 3f4 = 1` ⇒ 主循环（`:86-89`）走 `label_000050b8` ⇒ `INITGAME` + `SETFATE` + `exit`。
 * 3. 之后 TITLE 依 `global 0 != 0` 继续（`TITLE.txt:319-330`），最终进入 `SN0000.BIN`。
 *
 * ## 判据：**「SN0000 的第一条 `show-text`」**
 * `src/SN0000.txt:1224-1225` 是本次目标的第一个文案块（`// 输入原文：…` + `show-text 0 @"…"`）。
 * 它同时是 **SN0000.BIN 里第一条被汇编的 `show-text`** —— 文件里更早出现的 `show-text`
 * （`:1210` 等）全在 `/* 原文存档（对照用，不参与汇编） *​/` 注释块内。
 * 所以本跑手**不硬编码译文**（换 `AMAYUI_RESOURCE_DIR=raw` 跑原版日文时同样成立），
 * 而是记录"当前脚本 = SN0000 时执行到的第一条 0x6E"的 ip 与文本。
 */
import assert from 'node:assert/strict';
import { NodeFileSource } from '../arch/nodeFileSource.js';
import { NodeAudioHost } from '../audio/nodeAudioHost.js';
import { decideResourceDir } from '../arch/resourceDir.js';
import { OverlayDir } from '../arch/overlay.js';
import { effectiveIniText as readEffectiveIni, resolveSystemPaths } from '../arch/systemPaths.js';
import { Engine, type Frame } from '../vm/engine.js';
import { InputManager } from '../vm/input.js';
import { formatOperands, loadScriptData, NotImplementedOp, type StepTrace } from '../vm/interpreter.js';
import { readIntOperand } from '../vm/operand.js';
import { dec } from '../vm/bits.js';
import type { BinInstruction } from '../script/bin.js';
import { runFrameLoop, type FrameLoopGates, type FrameLoopOptions } from '../frame/loop.js';
import type { FrameHost } from '../frame/host.js';
import { Scenario, moveTo } from '../frame/scenario.js';
import { HeadlessScene } from '../renderer/headlessScene.js';
import { calcDiffuse, meshColor } from '../renderer/drawItem.js';
import { DropRecorder, withNativeTap, type DroppedIntent } from '../vm/nativeTap.js';
import { applyConfigToEngine, parseIni } from '../engineConfig.js';
// ★`bgrToRgb`：`engineValues[21664/21665]` = 引擎的 **COLORREF** 字段（`0x76`/`0x77` 把脚本 RGB 翻成
//   COLORREF 存进去），屏幕色 = 再翻一次（`tickets/T-0102` 判据 4）⇒ 采样与 `globalTextStyle` 同口径。
import { bgrToRgb } from '../vm/handlers/msgwin.js';
import {
  DEFAULT_EMULATOR_OPTIONS,
  applyEmulatorOptionsToEngine,
  normalizeEmulatorOptions,
  type EmulatorOptionsInput,
} from '../emulatorOptions.js';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..', '..');

/** 玩家数据（`SYS4REG.INI` / `SAVE.DAT`）：系统存档目录 + overlay（读 overlay → 真游戏那份）。 */
const SYSTEM = resolveSystemPaths(ROOT);
const SYSTEM_FILES = new OverlayDir(SYSTEM);

/** 取当前生效的 `SYS4REG.INI` 文本（共享实现见 `arch/systemPaths.ts`）。 */
const effectiveIniText = (): string => readEffectiveIni(SYSTEM_FILES);

/**
 * TITLE 菜单「Game Start」命中点 —— 由 `TITLE.txt:100` 的 `i12e` 数据数组算出：
 * 第 0 项 baseX = `local 5[0] = 0x44e`、baseY = `local 69[0] = 0x126`、盒 `156×156` ⇒ 中心。
 */
export const GAME_START_XY: [number, number] = [1180, 372];
/**
 * GAMESTART 配置界面「ゲーム開始」命中点 —— 由 `GAMESTART.txt:115` 的 `i12e` 数据数组算出：
 * 第 0 项 baseX = `local 195[0] = 0x2cb`、baseY = `local 1f9[0] = 0x240`、盒 `193×59` ⇒ 中心。
 */
export const START_GAME_XY: [number, number] = [811, 605];

/** 一条"未实现 opcode"的采集记录。 */
export interface UnknownOp {
  opcode: number;
  name: string;
  count: number;
  /** 命中过它的脚本名（去重）。 */
  scripts: string[];
  /** 首次命中时的操作数可读形式（`formatOperands`）。 */
  sample: string;
  /** 首次命中位置：`脚本:ip`。 */
  firstAt: string;
}

export interface GameStartResult {
  /** 链路结束时停在哪个脚本。 */
  script: string;
  /** 依次进入过的脚本名（去重，按首次出现顺序）。 */
  scriptTrail: string[];
  /** TITLE 菜单点击时命中的项（`local 3f7`）；**0 = Game Start**。 */
  titleHover: number;
  /** 是否进入了 `GAMESTART.BIN`（配置界面）。 */
  reachedGameStart: boolean;
  /** GAMESTART 点击时命中的项；**0 = ゲーム開始**、−1 = 右键取消（`local 3f4 = 2`）。 */
  gameStartHover: number;
  /** GAMESTART 退出时写的 `global 0`：**1 = 已选择开始游戏**（TITLE 据此继续进 INITGAME）。 */
  gameStartResult: number;
  /** 是否进入了 `INITGAME.BIN`（GAMESTART 的「ゲーム開始」分支 `:1338` 才会调它）。 */
  reachedInitGame: boolean;
  /** 是否在帧上限内进入了 SN0000。 */
  reachedSn0000: boolean;
  /** SN0000 第一条 `show-text` 是否执行到了（= 本次目标）。 */
  firstTextReached: boolean;
  /** 那条 `show-text` 的指令下标（`SN0000.txt` 的 1225 行 ⇒ 实测 ip = 901）。 */
  firstTextIp: number;
  /** 那条指令的字符串操作数（语言相关，仅作报告）。 */
  firstText: string;
  /** 该窗当前整页文本（`msgwin.textOf(0)`）。 */
  pageText: string;
  /**
   * **路径上发过的音效**（`0xB4 play-sound-effect` 的**统一文件 id** + 发起脚本），按发生顺序。
   *
   * 为什么需要：`play-sound-effect` 的 id 是**统一文件 id**（`SYS4INI` 下标），
   * 因此"点「ゲーム開始」应当由 `GAMESTART` 发 SE009（id 0x51e3 = 20963）"这类断言可以直接核对
   * 「谁在什么时候发了哪个音效」—— 它同时是"点击确实走了 GAMESTART 的分支"的独立证据
   * （另一个证据是 `gameStartResult` 与鼠标沿有没有被 `poll-input` 消费，见 §F.4-6）。
   */
  sePlays: { id: number; script: string; ip: number }[];
  /** 场景快照统计（诊断/断言用）。 */
  scene: {
    drawItems: number;
    drawable: number;
    msgWins: { win: number; text: string; rect: { x: number; y: number; w: number; h: number }; vertical: boolean; mainSize: number }[];
    texSlots: number;
    /**
     * ★`tickets/T-0144`（D1）：L2D 运行态计数。
     * 拆场（`0x1F6`/`0x1F7`）只该清 **572B 立绘节点表**（`nodes`）⇒ 走到 SN0000 时 `nodes === 0`；
     * **实例槽**（`slots`）归 `0x342`/读档装载段管，拆场不该清它。
     */
    l2d: { slots: number; nodes: number };
    /**
     * 场景里的 mesh（顶点色四边形）：引擎里这是"淡入淡出的黑幕/暗幕"，**全屏几何 + 真实颜色**。
     * `color` = 逐顶点基础色 × CalcDiffuse 插值态色（`#AARRGGBB`）—— SN0000 序章是
     * `alpha=0x80 黑`（背景压暗 50%），**不是**不透明黑（2026-09 修：旧实现恒画全屏不透明黑 ⇒ 整屏黑）。
     */
    meshes: {
      handle: number;
      color: string;
      alpha: number;
      rect: string;
      verts: number;
      flags: number;
      /** **脚本写的**两端色（`0x322`/`0x323` 在**写入那一刻**抓的值；见本文件 `writtenMeshColors`）。 */
      state0: string;
      state1: string;
      /**
       * **跑完那一刻的当前值**（`state0`/`state1` 字段在窗末收尾后可能已被烘焙 `state0 ← state1`）。
       * 用途：判断"这块幕布**最终**会是什么色"（`flags & 2` ⇒ 看 `nowState1`，否则看 `nowState0`）。
       */
      nowState0: string;
      nowState1: string;
      /** 逐顶点基础色（`0x320` 的 op5/op6 数组，DEC 解码后）。语料里应恒为 `#ffffffff`。 */
      baseColors: string[];
    }[];
  };
  /** 路径上命中且**未被实现**的 opcode（`stubUnknown: true` 时仍会采集，只是不抛）。 */
  unknown: UnknownOp[];
  /** 宿主未实现、调用被丢弃的 native 方法（仅 `recordDrops: true`）。 */
  drops?: DroppedIntent[];
  /**
   * **音频事件序列**（`tickets/T-0006`；`[audio] …` 行，两类来源：引擎的音频决策 + headless 宿主的起播记账）。
   * 这是"headless 与 Electron 的音频表现是否一致"的可比对象（G3 的一环）。
   */
  audioEvents: string[];
  /**
   * **等待泵派发序列**（`tickets/T-0003` 验收 3 / `T-0007`）：`kind` ∈
   * `key`/`click`/`hover-enter`/`hover-leave`/`headless`，附当时的脚本与 ip。
   * ★这是"悬停真的跑了"的**直接证据**（修前 headless 只有 `headless` = `forceAdvance` 旁路）。
   */
  dispatches: { kind: string; label: number; script: string; ip: number }[];
  /**
   * **`0x400` 门的驻留记录**（`tickets/T-0024` 的 acceptance ③）：每次"进等待 → 放行"一段，
   * 附引擎里装着的等待计时器（`timerMs` = `0x238` 写的 `Engine[92339]`）。
   * 判据："脚本 `i238 N` + `wait`"这段门的 `waitedMs` 应与 `N` 同量级（帧粒度 ⇒ 上偏一帧内）。
   * ★长时**平移**窗（如序章 `SN0000.txt:1043` 的 80 000 ms）不得出现在 `waitedMs` 里 ——
   * 脚本用 `i242 <handle> 1` 把它排除出池挂起位（见 `scPoolPending`）。
   */
  gateWaits: { script: string; ip: number; timerMs: number; waitedMs: number }[];
  /**
   * **文字逐字显现被"重放"的次数**（`tickets/T-0016`）：同一窗在**内容没变**的情况下显现游标被重置。
   *
   * 依据：悬停 label 带返回点（`sub_405360(Engine, -3)`）⇒ label 的 `ret` 回到门指令重跑 `0x72`；
   * 引擎的 `0x72` 不碰文字游标（raw 28539-28555），所以"重跑"必须幂等。
   * 判据 = `revealedOf(win)` 在 `contentRevOf(win)` 不变时变小（内容变了 = 新页/新文本，不算重放）。
   * ★正常链路里必须恒为 0；用户实测症状（ADV 页右侧悬停 ⇒ 中间文字不断重放）在这里落成可数指标。
   */
  revealRestarts: number;
  /** `routes.cursor` / `shown` 的变化轨迹（去重相邻同值）——"游标真的会随光标变"。 */
  cursorTrail: { cursor: number; shown: number }[];
  /** 本链路用的等待门策略：`'pump'` = 真泵（与产品同源）/`'force'` = 旧旁路（对照用）。 */
  advancePolicy: 'pump' | 'force';
  /** 悬停离开后把页面推回去用了多少帧（T-0057：此前算出来被 `void` 丢弃，意图丢失）。 */
  hoverLeaveFrames: number;
  /** 与真实链路无关的内部时钟（ms），仅诊断。 */
  clockMs: number;
  /** 执行过的指令数（仅 `onStep` 未开时也统计）。 */
  steps: number;
  /**
   * **ADV 里"有发言人"的那些帧**（`sampleAdvSpeakerLines: true`；`tickets/T-0102` 判据 4/5 的 E3 取证）。
   *
   * 为什么要它：判据 4/5 的期望值 = `bgrToRgb(adcd[14acda])`（角色名颜色），而**旁白**（`3f37 = -1`）恒走
   * `14acda = 0` 那一支 —— 那样采到的样本对"青 vs 橘"**没有辨别力**。本采样只在 `3f37 >= 0`
   * （= 真有一句"某某说"）时记一行，并按消息号去重（同一条消息的逐字过程只记首帧）。
   */
  advSpeakerLines: AdvSpeakerLine[];
}

/** `GameStartResult.advSpeakerLines` 的一行（全部是**解码后**的脚本语义值）。 */
export interface AdvSpeakerLine {
  /** 采样时的累计帧号。 */
  frame: number;
  script: string;
  ip: number;
  /** 当前消息号（全局 `3f37`；`>= 0` 才是"有发言人"）。 */
  msg: number;
  /** 当前角色号（全局 `14acda`；= `adcd` 的下标，旁白恒 0）。 */
  c14acda: number;
  /** 脚本写下的样式实参（全局 `f807b` = 填充、`f807c` = 描边；**COLORREF/BGR 编码**）。 */
  f807b: number;
  f807c: number;
  /** `Font+1360`（= `engineValues[21664]`）的应用后填充色（**已 BGR→RGB**）。 */
  fill: string;
  /** `Font+1364`（= `engineValues[21665]`）的应用后描边色（**已 BGR→RGB**）。 */
  outline: string;
  /** 该窗当前的整页文本（`msgwin.textOf(0)`，截断 120 字）。 */
  text: string;
}

export interface GameStartOptions {
  /**
   * 遇到未实现 opcode 时的策略：
   *  - `'throw'`（默认）：立刻抛出 `NotImplementedOp` —— **测试用**（缺口必须让测试失败）；
   *  - `'stub'`：登记为运行时 no-op 桩并继续 —— **盘点用**（一次跑完即可枚举全部缺口）。
   */
  unknownPolicy?: 'throw' | 'stub';
  /** 只跑这么多"帧"（每条 `run` 调用的上限），默认不限。 */
  maxFrames?: number;
  /** 每条被执行指令的回调（盘点用）。默认关（数十万条指令，回调是实打实的开销）。 */
  onStep?: (t: StepTrace) => void;
  /** 用 `withNativeTap` 记录"脚本想调、宿主没实现"的方法（默认关）。 */
  recordDrops?: boolean;
  /**
   * 给 headless 宿主接**音频引擎**（默认 `true` = 真游戏行为）。
   * 置 `false` = 回到"宿主没有 `audio`"的状态（所有音频意图进 `drops`、链路上看不到发声时机），
   * **只为 before/after 对照**（`tickets/T-0006`）。
   */
  audio?: boolean;
  /**
   * 等待门的推进方式（`tickets/T-0003` 验收 3）：`'pump'`（默认）= **真泵** —— 与 Electron 同一条
   * `serviceAdvanceWait`（命中测试 + 键命中 + 点击 + 悬停两段式）；`'force'` = 修前的旁路
   * （不做命中测试、不看 `routes.shown`，`routes.cursor` 恒 −1），**只为 before/after 对照**。
   */
  advance?: 'pump' | 'force';
  /** 到达 SN0000 首文案后是否继续跑到"没事干"（默认在首文案处停）。 */
  continueAfterTarget?: boolean;
  /**
   * `continueAfterTarget` 那一段（默认 20000 帧）用的推进档。
   *
   * 为什么要能改：`'pump'`（默认 = 真游戏行为）要**每次点击**才翻页，两万帧也只走几条消息；
   * 而"采到一句有发言人的台词"需要跑很多页 ⇒ 取样时用 `'force'`（旧旁路：不做命中测试、直接推进）
   * 把 ADV 自动翻下去。**只在取证时用**；判据断言的那条链路仍走 `'pump'`。
   */
  advanceAfterTarget?: 'pump' | 'force';
  /** 是否采样"有发言人的 ADV 帧"（见 `GameStartResult.advSpeakerLines`）。默认关。 */
  sampleAdvSpeakerLines?: boolean;
  /**
   * 外置选项（`emulator.config.json` 的内容）。**省略 = 真游戏行为**（`boot.showLogo = true`）。
   * 为什么不让 library 自己读文件：`test/game-start-chain.test.ts` 直接调本函数 ⇒ 读本机配置文件会让
   * "测试结果取决于开发机上的一个 JSON"，那是不可复现的。只有 CLI 入口才 `loadEmulatorOptions()`。
   */
  /**
   * 宽松输入（`EmulatorOptionsInput`）：library 调用只需要给想改的那几格，其余取默认值。
   * ★这里**不该**收已归一化的 `EmulatorOptions` —— 那会逼调用方把 `resources`/`audio` 也编出来，
   * 反而更容易编错（`tickets/T-0126`）。归一化在内部（下一行的 `normalizeEmulatorOptions`）。
   */
  emulatorOptions?: EmulatorOptionsInput;
}

/**
 * 跑一遍该链路。**不写任何玩家数据**（不注入 `onConfigChanged`/`onSaveDataChanged`）。
 */
export async function runGameStartChain(opt: GameStartOptions = {}): Promise<GameStartResult> {
  const options = normalizeEmulatorOptions(opt.emulatorOptions ?? DEFAULT_EMULATOR_OPTIONS);
  // 资源根：`AMAYUI_RESOURCE_DIR` > `resources.path`（相对基准 = 仓库根；本库不读 config 文件，
  // 从文件读选项的 CLI 入口自己算好再传 emulatorOptions/环境变量）> 默认 install/。
  const resourceDir = decideResourceDir(ROOT, {
    env: process.env,
    ...(options.resources.path ? { configResourcePath: options.resources.path, configDir: ROOT } : {}),
  }).dir;
  const src = new NodeFileSource({ resourceDir });
  const input = new InputManager();
  // ★音频（`tickets/T-0006`/`T-0003`）：给宿主一个 `NodeAudioHost` ⇒ headless 也有**真 `AudioEngine`**
  //   （真字节 + 容器头推时长、不出声），帧驱动每帧的 tick 会把"延迟 SE 到期 / 语音排队 / BGM 淡变"推起来。
  //   修前不给宿主 ⇒ 所有音频意图都被闸门 A 记成"意图被丢弃"，链路上看不到任何发声时机。
  const audioEvents: string[] = [];
  const collectAudio = (m: string): void => {
    if (m.startsWith('[audio]')) audioEvents.push(m);
  };
  const scene = new HeadlessScene(
    opt.audio === false ? {} : { audioHost: new NodeAudioHost({ source: src, log: collectAudio }), onLog: collectAudio },
  );
  let engineRef: Engine | null = null;
  const drops = new DropRecorder(() => engineRef?.currentOpcode ?? 0);
  const e = new Engine(opt.recordDrops ? withNativeTap(scene, drops) : scene, input);
  engineRef = e;
  e.fileSource = src;
  // ★Live2D 运行态（T-0054）：槽/节点/动作三张表在 Engine 上，挂给场景宿主以便
  //   ① 帧末推进动作（scL2dTick，两宿主同一份）；② 快照能导出节点与出画判据。
  scene.scene.l2dHost = e;
  e.config = parseIni(effectiveIniText());
  applyConfigToEngine(e.config, e.engineValues);
  // 外置选项（`emulator.config.json`）：`boot.showLogo`（false = 预设 `_this[96983]=0` 跳过 LOGO）
  // + `resources.version`（字体面名解析策略）。
  // ★这条链路的**测试不得受本机配置文件影响** ⇒ library 调用一律 `opt.emulatorOptions ?? 默认值`，
  //   只有 CLI 入口（`opInventory.ts`）才去读文件。必须在 `loadScriptData` 之前套用（SYSTEM4 开头就查它）。
  applyEmulatorOptionsToEngine(e, options);

  const boot = await src.readScript(0);
  assert.ok(boot, '应能读到 index 0 = SYSTEM4.BIN');
  loadScriptData(e, boot.data, boot.name);

  /**
   * **脚本写的 mesh 两端色**（`0x322`/`0x323`）—— 在**写入那一刻**抓下来。
   *
   * ★为什么不能"跑完再读 state0/state1"（`tickets/T-0004` 的 G3 实测）：
   * mesh 的窗末收尾是 `state0 ← state1`、清 bit1（`drawitem/eval.ts` 的 `calcDiffuse`），而它现在发生在
   * **共享推进**（`scAdvance`，由驱动每帧的 `advanceModel` 调用）里 —— 于是跑完时 `state0` 已经是**终点色**，
   * 报告里"`0x322`/`0x323` 写的两端色"就不再是脚本写的东西（实测：淡入幕的 state0 从 `#ff000000` 变成
   * 收尾后的 `#00000000`）。报告要断言的恰恰是"脚本写了什么"，所以必须抓写入时刻的值。
   */
  const writtenMeshColors = new Map<number, { state0: number; state1: number }>();
  const captureMeshColors = (handle: number): void => {
    const m = scene.scene.meshes.get(handle);
    if (m) writtenMeshColors.set(handle, { state0: m.state0 >>> 0, state1: m.state1 >>> 0 });
  };
  {
    const origSetVertexColor = scene.setVertexColor.bind(scene);
    const origSetVertexColorAlpha = scene.setVertexColorAlpha.bind(scene);
    scene.setVertexColor = (handle, index, alpha, rgb): void => {
      origSetVertexColor(handle, index, alpha, rgb);
      captureMeshColors(handle);
    };
    scene.setVertexColorAlpha = (handle, delay, dur, alpha, rgb): void => {
      origSetVertexColorAlpha(handle, delay, dur, alpha, rgb);
      captureMeshColors(handle);
    };
  }

  const unknown = new Map<number, UnknownOp>();
  const scriptTrail: string[] = [];
  let steps = 0;
  let firstTextIp = -1;
  let firstText = '';
  /**
   * `GAMESTART` 以 `exit` 结束时写的 `global 0`（`GAMESTART.txt:1345` `mov (global-int 0) 1`）
   * —— **1 = 选了「ゲーム開始」**、0 = 取消。
   * ★必须在"脚本从 GAMESTART 换走"的那一刻读：TITLE 之后会反复改写 `global 0`
   * （`TITLE.txt:454/463/475…` 与 `:1066` 的 `eq … 6`），跑完再读会拿到别的值。
   */
  let gameStartResult = -1;
  let prevScript = '';
  /** 路径上发过的 SE（`0xB4`）：统一文件 id + 发起脚本 + ip。 */
  const sePlays: { id: number; script: string; ip: number }[] = [];

  /**
   * **`0x400` 门的驻留记录**（`tickets/T-0024` 的 acceptance ③）：每一次"进等待"到"放行"一段。
   *
   * 量法：`onGateWait`（每帧、门被访问时）报告当前 `脚本:ip` 与引擎里装着的计时器 `gateWaitMs`；
   * 同一 `脚本:ip` 的连续帧算一段；`onFrameEnd` 看到 `0x400` 位被清掉 ⇒ 闭合这一段。
   * 于是"脚本 `i238 N` + `wait`"这条门的驻留时长可以直接与 `N` 对照（实测见 `changes.md`）。
   */
  const gateWaits: { script: string; ip: number; timerMs: number; waitedMs: number }[] = [];
  /** 正在等待的那一段（未闭合）。 */
  let gateOpen: { script: string; ip: number; timerMs: number; at: number } | null = null;
  /**
   * **文字重放计数**（`tickets/T-0016`）：`revealedOf(win)` 在内容版本不变时变小 ⇒ 重放一次。
   * 内容变了（新页 / 新 show-text）会让 `contentRevOf` 变化 ⇒ 那是正常的重新逐字，不计。
   */
  let revealRestarts = 0;
  const lastReveal = new Map<number, { shown: number; rev: number }>();
  const sampleReveal = (): void => {
    for (const win of e.msgwin.reveal.keys()) {
      const shown = e.msgwin.revealedOf(win);
      const rev = e.msgwin.contentRevOf(win);
      const prev = lastReveal.get(win);
      if (prev && prev.rev === rev && shown >= 0 && prev.shown >= 0 && shown < prev.shown) revealRestarts++;
      lastReveal.set(win, { shown, rev });
    }
  };
  const closeGate = (nowMs: number): void => {
    if (!gateOpen) return;
    gateWaits.push({
      script: gateOpen.script,
      ip: gateOpen.ip,
      timerMs: gateOpen.timerMs,
      waitedMs: Math.round(nowMs - gateOpen.at),
    });
    gateOpen = null;
  };

  /**
   * **ADV「有发言人」帧采样**（`tickets/T-0102` 判据 4/5）：只在 `3f37 >= 0` 时记，按消息号去重。
   *
   * 取值口径（全部走 `Engine` 的**语义**访问，不碰内存布局）：
   *  - `f807b/f807c` = 脚本全局（**COLORREF/BGR**）；
   *  - `fill/outline` = `engineValues[21664/21665]`（`i076/i077` 应用后 = `bgrToRgb(f807b/f807c)`）；
   *  - `3f37` = 消息号、`14acda` = 角色号（= `adcd` 的下标；旁白恒 0）。
   * ⇒ 一行样本就能判"角色名取的是哪个下标、应用后是什么色"，这正是"青 vs 橘"的判决量。
   */
  const advSpeakerLines: AdvSpeakerLine[] = [];
  const seenSpeakerMsg = new Set<number>();
  const sampleAdvSpeakerLine = (): void => {
    if (!opt.sampleAdvSpeakerLines || advSpeakerLines.length >= 24) return;
    // ★`| 0` = 按**有符号 32 位**归一：脚本把 `-1`（旁白）存成 `0xFFFFFFFF`，
    //   不归一会把旁白当成 `msg = 4294967295` 的"有发言人"（实测踩过）。
    const msg = (dec(e.key, e.globals.int.get(0x3f37) ?? -1) | 0);
    if (msg < 0 || seenSpeakerMsg.has(msg)) return;
    seenSpeakerMsg.add(msg);
    const f = e.curScript();
    const c14acda = (dec(e.key, e.globals.int.get(0x14acda) ?? 0) | 0);
    const f807b = dec(e.key, e.globals.int.get(0xf807b) ?? 0) >>> 0;
    const f807c = dec(e.key, e.globals.int.get(0xf807c) ?? 0) >>> 0;
    advSpeakerLines.push({
      frame: harness.frames,
      script: f.name,
      ip: f.ip,
      msg,
      c14acda,
      f807b,
      f807c,
      fill: `#${(bgrToRgb(e.engineValues.get(21664) ?? 0xffffff) >>> 0).toString(16).padStart(6, '0')}`,
      outline: `#${(bgrToRgb(e.engineValues.get(21665) ?? 0) >>> 0).toString(16).padStart(6, '0')}`,
      text: e.msgwin.textOf(0).replace(/\s+/g, ' ').slice(0, 120),
    });
  };

  // ---- 悬停观察（`T-0003` 验收 3 / `T-0007`）：观察者与 Scenario 必须在 harness 之前建好 ----
  /** 等待泵派发序列（键命中/点击/悬停进入/悬停离开）。 */
  const dispatches: { kind: string; label: number; script: string; ip: number }[] = [];
  /** `routes.cursor` / `routes.shown` 的变化轨迹（去重相邻同值）。 */
  const cursorTrail: { cursor: number; shown: number }[] = [];
  let hoverEntered = 0;
  let hoverLeft = 0;
  /** 输入编排（步骤在下面"⑤ SN0000 悬停"一节里追加；harness 每帧应用一次）。 */
  const pumpScenario = new Scenario();

  const harness = createHarness({
    e,
    scene,
    input,
    ...(opt.maxFrames !== undefined ? { maxFrames: opt.maxFrames } : {}),
    ...(opt.onStep ? { onStep: opt.onStep } : {}),
    onGateWait: (script, ip, nowMs, timerMs) => {
      if (!gateOpen || gateOpen.script !== script || gateOpen.ip !== ip) {
        closeGate(nowMs); // 上一段（若还没闭合）以本帧为界
        gateOpen = { script, ip, timerMs, at: nowMs };
      }
    },
    onFrameEnd: (eng, now) => {
      // `0x400` 位本帧被清掉 ⇒ 门放行 ⇒ 闭合这一段
      if (gateOpen && (eng.waitFlags & 0x400) === 0) closeGate(now);
      // ★文字重放采样（T-0016）：内容没变而显现游标变小 ⇒ 记一次
      sampleReveal();
      // ★ADV「有发言人」帧采样（T-0102 判据 4/5）：只在 `3f37 >= 0` 时记，按消息号去重
      sampleAdvSpeakerLine();
    },
    onUnknown: (err, frame, instr) => {
      const key = err.opcode;
      let u = unknown.get(key);
      if (!u) {
        u = {
          opcode: key,
          name: err.name,
          count: 0,
          scripts: [],
          sample: instr ? formatOperands(e, frame, instr).join(' ') : '',
          firstAt: `${err.scriptName}:ip=${err.instrIndex}`,
        };
        unknown.set(key, u);
      }
      u.count++;
      if (!u.scripts.includes(err.scriptName)) u.scripts.push(err.scriptName);
      if (opt.unknownPolicy !== 'stub') throw err;
      e.unknownOpStubs.set(key, 1);
    },
    advance: opt.advance ?? 'pump',
    scenario: pumpScenario,
    onDispatch: (kind, label) => {
      const f = e.curScript();
      dispatches.push({ kind, label, script: f.name, ip: f.ip });
      if (kind === 'hover-enter') hoverEntered++;
      else if (kind === 'hover-leave') hoverLeft++;
    },
    onCursor: (cursor, shown) => {
      cursorTrail.push({ cursor, shown });
    },
    onScript: (name) => {
      // ★只在「GAMESTART → 它的调用者 TITLE」这一刻读 `global 0`：GAMESTART 内部还会
      //   `call-script INITGAME`（`:1338`，此刻 global 0 仍是 0），随后才在 `label_00005380`
      //   写 1 再 `exit`；之后 TITLE 会反复改写它（`:454/463/475` 与 `:1066` 的 `eq … 6`）。
      if (prevScript.startsWith('GAMESTART') && name.startsWith('TITLE')) {
        gameStartResult = dec(e.key, e.globals.int.get(0) ?? 0);
      }
      prevScript = name;
      if (!scriptTrail.includes(name)) scriptTrail.push(name);
    },
    onStepStart: (frame, instr) => {
      steps++;
      // ★`0xB4 play-sound-effect` 的 op1 = 该音效的**统一文件 id**（`0xB4` 只装载、`0xB5`/`0xBA` 起播，
      //   所以"发过哪个音效"看 op1 就够）。记下发起脚本 ⇒ 可断言"这条 SE 由谁发"。
      if (instr && instr.opcode === 0xb4 && frame.script) {
        let id = -1;
        try {
          id = readIntOperand(e, frame, instr, 1);
        } catch {
          /* 取不到就不记 id（诊断用，不影响链路） */
        }
        sePlays.push({ id, script: frame.name, ip: frame.ip });
      }
      // ★目标：SN0000 里**第一条被汇编的 show-text**（= `SN0000.txt:1225`）
      if (firstTextIp < 0 && instr && frame.name.startsWith('SN0000') && instr.opcode === 0x6e) {
        const s = instr.args.find((a) => a.type === 2);
        firstTextIp = frame.ip;
        firstText = s && typeof s.str === 'string' ? s.str : '';
      }
    },
  });

  const name = (): string => e.curScript().name;
  const hover = (): number => dec(e.key, e.curScript().locals.int.get(0x3f7) ?? -99);

  const run = harness.run;

  // ---- ① 启动 → TITLE ----
  assert.ok((await run(4000, () => name().startsWith('TITLE'))) < 4000, '应在帧上限内到达 TITLE');
  await run(4000); // TITLE 初始化（与 config1-chain 同口径）

  // ---- ② TITLE：悬停/点击「Game Start」（第 0 项）----
  input.setCursor(...GAME_START_XY);
  await run(2000, () => hover() === 0);
  const titleHover = hover();
  input.pressMouse(0);
  await run(400);
  input.releaseMouse(0);
  const reachedGameStart = (await run(4000, () => name().startsWith('GAMESTART'))) < 4000;

  // ---- ③ GAMESTART：悬停/点击「ゲーム開始」（第 0 项）----
  let gameStartHover = -99;
  if (reachedGameStart) {
    input.setCursor(...START_GAME_XY);
    await run(600, () => hover() === 0);
    gameStartHover = hover();
    input.pressMouse(0);
    await run(400);
    input.releaseMouse(0);
    await run(1200);
  }
  // GAMESTART 的「ゲーム開始」分支会在 `exit` 前 `call-script 51e4 = INITGAME`（`GAMESTART.txt:1338`）
  // —— 这是"确实选了开始游戏"的第二重证据（第一重 = 上面捕获的 `global 0 == 1`）。
  const reachedInitGame = scriptTrail.includes('INITGAME.BIN');

  // ---- ④ 跑到 SN0000 首文案 ----
  let reachedSn0000 = false;
  for (let round = 0; round < 40; round++) {
    // ★目标条件用"逐条"判（B2）：`firstTextIp` 一旦置上就永久为真 ⇒ 可以恰好停在首文案那一刻，
    //   而不是"越过目标最多一整批"（那会让"到达首文案时的场景状态"变成停止点伪影）。
    await run(
      2000,
      () => firstTextIp >= 0 && !opt.continueAfterTarget,
      () => firstTextIp >= 0 && !opt.continueAfterTarget,
    );
    if (name().startsWith('SN0000')) reachedSn0000 = true;
    if (firstTextIp >= 0 && !opt.continueAfterTarget) break;
    if (name() === '') break;
  }
  if (!reachedSn0000) reachedSn0000 = name().startsWith('SN0000') || scriptTrail.some((s) => s.startsWith('SN0000'));
  if (opt.continueAfterTarget)
    await run(20000, undefined, undefined, { advance: opt.advanceAfterTarget ?? 'pump' });

  // ---- ⑤ SN0000：等待态下的**悬停**（`T-0003` 验收 3 / `T-0007`）----
  //   修前 headless 走 `forceAdvance`（不做命中测试、不看 routes.shown）⇒ 游标恒 −1、悬停从不发生。
  //   这里：进等待态 → Scenario 把光标移到**表里真实存在的热点**中心（不写死坐标）→ 观察 hover-enter
  //   → 再移到表外 → 观察 hover-leave。两条都走 `serviceAdvanceWait`（与 Electron 同一条路由代码）。
  /** 表里第一个"有进入 label"的热点（`labelEnter` 不是 -1/0xffffffff）——**不写死坐标**，从表里取。 */
  const pickEnterable = (): { cx: number; cy: number } | null => {
    for (const en of e.routes.entries) {
      if (en.labelEnter !== -1 && en.labelEnter !== 0xffffffff) {
        return { cx: Math.floor((en.x0 + en.x1) / 2), cy: Math.floor((en.y0 + en.y1) / 2) };
      }
    }
    return null;
  };
  /** 表外的一个点（粗网格扫描；用于制造"离开"）。 */
  const pointOutside = (): { x: number; y: number } => {
    for (let y = 40; y < 720; y += 40) {
      for (let x = 40; x < 1280; x += 40) {
        if (!e.routes.entries.some((en) => en.x0 <= x && x <= en.x1 && en.y0 <= y && y <= en.y1)) return { x, y };
      }
    }
    return { x: 4, y: 4 };
  };
  pumpScenario
    .when(
      '等待态：光标移到热点中心',
      (c) => c.e.awaitingAdvance && pickEnterable() !== null,
      (c) => {
        const p = pickEnterable();
        if (p) moveTo(c, p.cx, p.cy);
      },
    )
    .when(
      // ★必须**在等待态里**移出：命中测试只发生在等待泵内部（`serviceAdvanceWait` 开头 `!awaitingAdvance` 直接返回）
      //   ⇒ 若在非等待态移光标，`hitTestPending` 会一直挂着，等下次等待态时表可能已被重置 ⇒ 观测不到"离开"。
      'hover-enter 已派发且再次进入等待态：光标移出所有热点',
      (c) => hoverEntered > 0 && hoverLeft === 0 && c.e.awaitingAdvance,
      (c) => {
        const p = pointOutside();
        moveTo(c, p.x, p.y);
      },
    );
  let hoverLeaveFrames = 0;
  if (reachedSn0000 && (opt.advance ?? 'pump') === 'pump') {
    await run(3000, () => e.awaitingAdvance, undefined, { advance: 'pump' });
    hoverLeaveFrames = await run(1200, () => hoverLeft > 0, undefined, { advance: 'pump' });
  }

  const items = [...scene.scene.drawItems.values()];
  const result: GameStartResult = {
    script: name(),
    scriptTrail,
    titleHover,
    reachedGameStart,
    gameStartHover,
    gameStartResult,
    reachedInitGame,
    reachedSn0000,
    firstTextReached: firstTextIp >= 0,
    firstTextIp,
    firstText,
    pageText: e.msgwin.textOf(0),
    sePlays,
    scene: {
      drawItems: items.length,
      drawable: items.filter((i) => (i.flags & 1) !== 0).length,
      msgWins: [...scene.scene.msgWins.entries()].map(([win, w]) => ({
        win,
        text: w.lines.map((l) => l.text).join('\n').trim(),
        rect: { x: w.style.x, y: w.style.y, w: w.style.w, h: w.style.h },
        vertical: w.style.vertical,
        mainSize: w.style.main.size,
      })),
      texSlots: e.texSlots.size,
      l2d: { slots: e.l2dSlots.size, nodes: e.l2dNodes.size },
      meshes: [...scene.scene.meshes.values()]
        .sort((a, b) => a.handle - b.handle)
        .map((m) => {
          // ★**脚本写的两端色**取自"写入那一刻"的抓取（`writtenMeshColors`，见上面的说明）：
          //   `calcDiffuse` 在窗末有烘焙副作用（`state0 ← state1`、清 bit1），而它现在发生在**共享推进**里
          //   （驱动每帧的 `advanceModel`）⇒ "跑完再读"读到的是收尾后的色，与字段说明不符。
          //   抓不到（该 mesh 没被 `0x322`/`0x323` 写过）时才退回当前值。
          const written = writtenMeshColors.get(m.handle);
          const state0 = written ? written.state0 : m.state0 >>> 0;
          const state1 = written ? written.state1 : m.state1 >>> 0;
          const flags = m.flags;
          const c = meshColor(m, calcDiffuse(m, harness.clock));
          const xs = m.verts.map((v) => v.x);
          const ys = m.verts.map((v) => v.y);
          return {
            handle: m.handle,
            color: `#${(c >>> 0).toString(16).padStart(8, '0')}`,
            alpha: (c >>> 24) & 0xff,
            rect: m.verts.length
              ? `${Math.min(...xs)},${Math.min(...ys)}..${Math.max(...xs)},${Math.max(...ys)}`
              : '无几何',
            verts: m.verts.length,
            flags,
            state0: `#${state0.toString(16).padStart(8, '0')}`,
            state1: `#${state1.toString(16).padStart(8, '0')}`,
            nowState0: `#${(m.state0 >>> 0).toString(16).padStart(8, '0')}`,
            nowState1: `#${(m.state1 >>> 0).toString(16).padStart(8, '0')}`,
            baseColors: m.baseColors.map((c) => `#${(c >>> 0).toString(16).padStart(8, '0')}`),
          };
        }),
    },
    unknown: [...unknown.values()].sort((a, b) => a.opcode - b.opcode),
    ...(opt.recordDrops ? { drops: drops.list() } : {}),
    audioEvents,
    dispatches,
    cursorTrail,
    gateWaits,
    revealRestarts,
    advancePolicy: opt.advance ?? 'pump',
    hoverLeaveFrames,
    clockMs: harness.clock,
    steps,
    advSpeakerLines,
  };
  await src.dispose?.();
  return result;
}

// ---------------------------------------------------------------------------
// 内部：帧循环（与 `config1Chain.ts` 的 run() 同形状；两者都遵循「等条件、不睡固定秒数」）
// ---------------------------------------------------------------------------

interface HarnessOptions {
  e: Engine;
  scene: HeadlessScene;
  input: InputManager;
  maxFrames?: number;
  /**
   * 等待门的推进方式（`T-0003` 验收 3）：`'pump'`（默认）= 真泵（`serviceAdvanceWait`：
   * 命中测试 + 键命中 + 点击 + 悬停两段式）；`'force'` = 修前的旁路（只在 before/after 对照里用）。
   */
  advance?: 'pump' | 'force';
  /** 输入编排（每帧 `onFrameStart` 应用一次）。 */
  scenario?: Scenario;
  /** 派发观察（等待泵的三条出口：键命中/点击/悬停进入/悬停离开）。 */
  onDispatch?: (kind: string, label: number, e: Engine) => void;
  /** `routes.cursor` 变化观察（`T-0007` 的"游标真的会变"）。 */
  onCursor?: (cursor: number, shown: number, e: Engine) => void;
  onStep?: (t: StepTrace) => void;
  /**
   * **`0x400` 门被访问**（每帧一次，`tickets/T-0024` 的 acceptance ③）：报出当前脚本:ip、
   * 本帧时钟、以及引擎里**装着的等待计时器**（`gateWaitMs` = `0x238` 写的那一格）。
   * 与 `onFrameEnd` 合起来就能量出"每道门实际驻留了多少毫秒"，与脚本里的 `i238` 对照。
   */
  onGateWait?: (script: string, ip: number, nowMs: number, timerMs: number, e: Engine) => void;
  /** 帧末（`clock` 尚未 +1/60；用于闭合"门驻留"区间）。 */
  onFrameEnd?: (e: Engine, clock: number) => void;
  onUnknown: (err: NotImplementedOp, frame: Frame, instr: BinInstruction | undefined) => void;
  onScript: (name: string) => void;
  onStepStart: (frame: Frame, instr: BinInstruction | undefined) => void;
}

/** 帧循环句柄：`clock`/`frames` 是**活值**（每次读都是当前值）。 */
interface Harness {
  /** `until` = 帧边界条件；`stopStep` = 逐条条件（只用于"一真即永真"的目标判定，见 `run` 的说明）。 */
  run(frames: number, until?: () => boolean, stopStep?: () => boolean, gates?: FrameLoopGates): Promise<number>;
  readonly clock: number;
  /** 已跑的**总帧数**（跨多次 `run()` 累计）。 */
  readonly frames: number;
}

function createHarness(o: HarnessOptions): Harness {
  const { e } = o;
  const maxFrames = o.maxFrames ?? Number.POSITIVE_INFINITY;
  let clock = 0;
  let lastScript = '';
  /** 跨 `run()` 调用的**单调帧号**（Scenario 的帧号/诊断都用它，避免每轮从 0 重来）。 */
  let totalFrames = 0;

  /** 帧宿主：虚拟时钟（由 `onFrameEnd` 每帧 +1000/60）+ headless 的模型推进/门判据。 */
  const host: FrameHost = {
    now: () => clock,
    advanceModel: (t) => {
      o.scene.advance(t);
    },
    poolPending: () => o.scene.poolPending(),
  };
  /**
   * 驱动配置 —— **B2 起与产品（Electron）同源**：`0x400` 不再无条件清，而是按引擎语义放行
   * （池挂起位 + `0x238` 等待计时器，见 `tickets/T-0024`；`host.poolPending` 每帧推进后取一次）；
   * 模型每帧经 `host.advanceModel()` 推进一次（修前两份 chain **从不推进动画窗** ⇒ 与产品/E4 不同源）。
   * ★等待推进（B3/`T-0003`）：默认 `'pump'` = **真泵**（`serviceAdvanceWait`：命中测试 + 键命中 + 点击 +
   * 悬停两段式）；`'force'` 是修前的旁路（不做命中测试、不看 `routes.shown`）——保留它只为 before/after 对照。
   */
  const base: Omit<FrameLoopOptions, 'until' | 'maxFrames'> = {
    gates: { anim: 'wait', sleep: 'wait', advance: o.advance ?? 'pump' },
    advFrame: true,
    advErrors: 'swallow',
    maxStepsPerFrame: 20000,
    onFrameStart: (_nowMs, _idx) => {
      totalFrames++;
      // ★Scenario（`T-0003` 验收 3）：输入编排由**数据**驱动，而不是散在各处的 `input.setCursor(...)`
      if (o.scenario) o.scenario.apply({ e, input: o.input, frame: totalFrames });
      sampleDispatch();
      recordCursor();
    },
    onStepStart: (frame, instr) => o.onStepStart(frame, instr),
    onStep: (t) => {
      // ★每次派发之后尽早采样：`lastDispatch` 是"最近一次"，同一帧里可能被后续派发覆盖 ⇒
      //   只在帧边界采样会漏掉点击/悬停（实测：pump 模式下的 `click` 就漏了）。
      sampleDispatch();
      o.onStep?.(t);
    },
    onUnknown: (err, frame, instr) => {
      o.onUnknown(err, frame, instr);
      return 'continue'; // stub 策略：已登记桩 ⇒ 下一条；throw 策略已在 onUnknown 里上抛
    },
    onScriptChange: (name) => {
      lastScript = name;
      o.onScript(name);
    },
    onGate: (branch) => {
      if (branch === 'anim') {
        const f = e.curScript();
        o.onGateWait?.(f.name, f.ip, e.nowMs, e.gateWaitMs, e);
      }
    },
    onFrameEnd: () => {
      o.onFrameEnd?.(e, clock);
      clock += 1000 / 60;
    },
  };

  // ---- 观察者：派发序列（等待泵的三条出口）与 `routes.cursor` 变化 ----
  let lastDispatch: unknown = null;
  const sampleDispatch = (): void => {
    const d = e.lastDispatch;
    if (!d || d === lastDispatch) return;
    lastDispatch = d;
    o.onDispatch?.(d.kind, d.label, e);
  };
  let lastCursor = Number.NaN;
  const recordCursor = (): void => {
    const c = e.routes.cursor;
    if (c !== lastCursor) {
      lastCursor = c;
      o.onCursor?.(c, e.routes.shown, e);
    }
  };

  /**
   * 跑帧。
   * @param until 帧开头的提前结束条件（**引擎状态可能在帧内后段才定型**，如 `hover()` 读的 `local 3f7`
   *              是在 `i12e` 命中测试之后才写 ⇒ 这类条件只能在帧边界判）
   * @param stopStep 可选的**逐条**结束条件 —— 只对"一旦为真就永久为真"的条件用（如"首文案已执行"）；
   *                 逐条判才能**恰好停在目标**，否则会越过目标最多一整批（B2 实测：283100 步 / 停在 CHARMEDIT）
   * @param gates 覆盖门档（默认取 harness 的 `advance`；悬停阶段要显式传 `'pump'`）
   */
  const run = async (
    frames: number,
    until?: () => boolean,
    stopStep?: () => boolean,
    gates?: FrameLoopGates,
  ): Promise<number> => {
    const r = await runFrameLoop(e, host, {
      ...base,
      ...(gates ? { gates: { ...base.gates, ...gates } } : {}),
      ...(until ? { until } : {}),
      ...(stopStep ? { stopAfterStep: () => stopStep() } : {}),
      initialScript: lastScript,
      maxFrames: Math.min(frames, maxFrames),
    });
    // 与原 `run` 的返回语义一致：条件达成/中途结束 ⇒ 返回**已跑完的帧数**（< frames）；跑满上限 ⇒ 返回 frames
    return r.stopReason === 'cap' ? frames : r.frames;
  };

  lastScript = e.curScript().name;
  o.onScript(lastScript);
  return {
    run,
    get clock(): number {
      return clock;
    },
    get frames(): number {
      return totalFrames;
    },
  };
}