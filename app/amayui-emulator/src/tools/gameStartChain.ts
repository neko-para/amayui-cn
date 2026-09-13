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
import { resolveResourceDir } from '../arch/resourceDir.js';
import { OverlayDir } from '../arch/overlay.js';
import { effectiveIniText as readEffectiveIni, resolveSystemPaths } from '../arch/systemPaths.js';
import { Engine, SLEEP_GATE, type Frame } from '../vm/engine.js';
import { InputManager } from '../vm/input.js';
import { formatOperands, loadScriptData, NotImplementedOp, stepOnce, type StepTrace } from '../vm/interpreter.js';
import { ExitScript, ScriptReset } from '../vm/ops.js';
import { dec } from '../vm/bits.js';
import type { BinInstruction } from '../script/bin.js';
import { HeadlessScene } from '../renderer/headlessScene.js';
import { calcDiffuse, meshColor } from '../renderer/drawItem.js';
import { DropRecorder, withNativeTap, type DroppedIntent } from '../vm/nativeTap.js';
import { applyConfigToEngine, parseIni } from '../engineConfig.js';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..', '..');

/** 资源根 = `install/`（汉化版）；`AMAYUI_RESOURCE_DIR=raw` 可切回原版。 */
const RESOURCE_DIR = resolveResourceDir(ROOT);
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
  /** 场景快照统计（诊断/断言用）。 */
  scene: {
    drawItems: number;
    drawable: number;
    msgWins: { win: number; text: string; rect: { x: number; y: number; w: number; h: number }; vertical: boolean; mainSize: number }[];
    texSlots: number;
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
      /** 引擎 state0/state1（`0x322`/`0x323` 写的两端色）。★动画窗在 Node 侧无 present 驱动 ⇒
       *   `color` 停在 state0，判定"目标色对不对"要看 `state1`（SN0000 的回归点就在这里）。 */
      state0: string;
      state1: string;
      /** 逐顶点基础色（`0x320` 的 op5/op6 数组，DEC 解码后）。语料里应恒为 `#ffffffff`。 */
      baseColors: string[];
    }[];
  };
  /** 路径上命中且**未被实现**的 opcode（`stubUnknown: true` 时仍会采集，只是不抛）。 */
  unknown: UnknownOp[];
  /** 宿主未实现、调用被丢弃的 native 方法（仅 `recordDrops: true`）。 */
  drops?: DroppedIntent[];
  /** 与真实链路无关的内部时钟（ms），仅诊断。 */
  clockMs: number;
  /** 执行过的指令数（仅 `onStep` 未开时也统计）。 */
  steps: number;
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
  /** 到达 SN0000 首文案后是否继续跑到"没事干"（默认在首文案处停）。 */
  continueAfterTarget?: boolean;
}

/**
 * 跑一遍该链路。**不写任何玩家数据**（不注入 `onConfigChanged`/`onSaveDataChanged`）。
 */
export async function runGameStartChain(opt: GameStartOptions = {}): Promise<GameStartResult> {
  const src = new NodeFileSource({ resourceDir: RESOURCE_DIR });
  const input = new InputManager();
  const scene = new HeadlessScene({});
  let engineRef: Engine | null = null;
  const drops = new DropRecorder(() => engineRef?.currentOpcode ?? 0);
  const e = new Engine(opt.recordDrops ? withNativeTap(scene, drops) : scene, input);
  engineRef = e;
  e.fileSource = src;
  e.config = parseIni(effectiveIniText());
  applyConfigToEngine(e.config, e.engineValues);

  const boot = await src.readScript(0);
  assert.ok(boot, '应能读到 index 0 = SYSTEM4.BIN');
  loadScriptData(e, boot.data, boot.name);

  const unknown = new Map<number, UnknownOp>();
  const scriptTrail: string[] = [];
  let clock = 0;
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

  const harness = createHarness({
    e,
    scene,
    input,
    ...(opt.maxFrames !== undefined ? { maxFrames: opt.maxFrames } : {}),
    ...(opt.onStep ? { onStep: opt.onStep } : {}),
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
      // ★目标：SN0000 里**第一条被汇编的 show-text**（= `SN0000.txt:1225`）
      if (firstTextIp < 0 && instr && frame.name.startsWith('SN0000') && instr.opcode === 0x6e) {
        const s = instr.args.find((a) => a.type === 2);
        firstTextIp = frame.ip;
        firstText = s && typeof s.str === 'string' ? s.str : '';
      }
    },
  });
  void clock;
  void harness;

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
    await run(2000, () => firstTextIp >= 0 && !opt.continueAfterTarget);
    if (name().startsWith('SN0000')) reachedSn0000 = true;
    if (firstTextIp >= 0 && !opt.continueAfterTarget) break;
    if (name() === '') break;
  }
  if (!reachedSn0000) reachedSn0000 = name().startsWith('SN0000') || scriptTrail.some((s) => s.startsWith('SN0000'));
  if (opt.continueAfterTarget) await run(20000);

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
      meshes: [...scene.scene.meshes.values()]
        .sort((a, b) => a.handle - b.handle)
        .map((m) => {
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
            flags: m.flags,
            state0: `#${(m.state0 >>> 0).toString(16).padStart(8, '0')}`,
            state1: `#${(m.state1 >>> 0).toString(16).padStart(8, '0')}`,
            baseColors: m.baseColors.map((c) => `#${(c >>> 0).toString(16).padStart(8, '0')}`),
          };
        }),
    },
    unknown: [...unknown.values()].sort((a, b) => a.opcode - b.opcode),
    ...(opt.recordDrops ? { drops: drops.list() } : {}),
    clockMs: harness.clock,
    steps,
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
  onStep?: (t: StepTrace) => void;
  onUnknown: (err: NotImplementedOp, frame: Frame, instr: BinInstruction | undefined) => void;
  onScript: (name: string) => void;
  onStepStart: (frame: Frame, instr: BinInstruction | undefined) => void;
}

/** 帧循环句柄：`clock` 是**活值**（每次读都是当前虚拟时钟）。 */
interface Harness {
  run(frames: number, until?: () => boolean): Promise<number>;
  readonly clock: number;
}

function createHarness(o: HarnessOptions): Harness {
  const { e } = o;
  const maxFrames = o.maxFrames ?? Number.POSITIVE_INFINITY;
  let clock = 0;
  let lastScript = '';

  const stepAll = async (): Promise<void> => {
    const frame = e.curScript();
    const instr = frame.script?.instructions[frame.ip];
    o.onStepStart(frame, instr);
    try {
      const t = await stepOnce(e);
      o.onStep?.(t);
    } catch (err) {
      if (err instanceof NotImplementedOp) {
        o.onUnknown(err, frame, instr);
        return; // 已登记桩（stub 策略）⇒ 下一条指令；throw 策略已在上抛
      }
      throw err;
    }
  };

  const run = async (frames: number, until?: () => boolean): Promise<number> => {
    const cap = Math.min(frames, maxFrames);
    for (let i = 0; i < cap; i++) {
      if (until?.()) return i;
      e.nowMs = clock;
      e.serviceWinReveal(e.nowMs);
      e.serviceCharGrid(e.nowMs); // 0x73 的 ▼ 图标：每 op10 ms 换一格（无字格时内部直接返回）
      if (e.waitFlags & 0x400) e.waitFlags &= ~0x400;
      else if (e.waitFlags & SLEEP_GATE) {
        if (clock >= e.sleepUntil) e.waitFlags &= ~SLEEP_GATE;
      } else if (e.textRevealing) e.serviceTextReveal(e.nowMs);
      else if (e.awaitingAdvance) e.forceAdvance();
      else if (e.advActive) {
        e.serviceAdv();
        try {
          await stepAll();
        } catch {
          /* ADV 分支的异常按"本帧无进展"处理 */
        }
      } else {
        for (let k = 0; k < 20000; k++) {
          const f = e.curScript();
          if (!f.script || f.ip >= f.script.instructions.length) return i;
          if (f.name !== lastScript) {
            lastScript = f.name;
            o.onScript(f.name);
          }
          try {
            await stepAll();
          } catch (err) {
            if (err instanceof ExitScript || err instanceof ScriptReset) return i;
            throw err;
          }
          if (e.waitFlags & (0x400 | SLEEP_GATE) || e.awaitingAdvance) break;
        }
      }
      clock += 1000 / 60;
    }
    return frames;
  };

  lastScript = e.curScript().name;
  o.onScript(lastScript);
  return {
    run,
    get clock(): number {
      return clock;
    },
  };
}
