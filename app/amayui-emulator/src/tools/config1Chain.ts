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
import { Engine, SLEEP_GATE } from '../vm/engine.js';
import { InputManager } from '../vm/input.js';
import { loadScriptData, stepOnce, NotImplementedOp } from '../vm/interpreter.js';
import { ExitScript, ScriptReset } from '../vm/ops.js';
import { HeadlessScene } from '../renderer/headlessScene.js';
import { parseIni, applyConfigToEngine } from '../engineConfig.js';
import { dec } from '../vm/bits.js';
import type { SnapshotMsgWin } from '../renderer/sceneModel.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..', '..');
const RAW = path.join(ROOT, 'raw');
const INI = path.join(ROOT, 'app', 'amayui-emulator', 'SYS4REG.INI');

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
  /** 每帧的文本窗诊断行（`diag:text` 用）。 */
  trace: string[];
}

export interface ChainOptions {
  /** 只跑这么多次 `stepOnce`（保底，默认不限）。 */
  maxFrames?: number;
}

export async function runConfig1Chain(opt: ChainOptions = {}): Promise<ChainResult> {
  const src = new NodeFileSource({ rawDir: RAW });
  const input = new InputManager();
  const native = new HeadlessScene({});
  const e = new Engine(native, input);
  e.fileSource = src;
  e.config = parseIni(fs.readFileSync(INI, 'utf8'));
  applyConfigToEngine(e.config, e.engineValues);
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
   * 跑到 `until()` 为真或达到帧上限。
   * ★不要用「固定跑 N 帧」——那会在已经到达目标后继续空转，把测试拖到几十秒。
   */
  const run = async (frames: number, until?: () => boolean): Promise<number> => {
    const cap = Math.min(frames, maxFrames);
    for (let i = 0; i < cap; i++) {
      if (until?.()) return i;
      e.nowMs = clock;
      // ★`0x300` 每窗「逐行贴出」闸门（CONFIG 消息预览的循环演示）——引擎主循环每帧都跑
      e.serviceWinReveal(e.nowMs);
      if (e.waitFlags & 0x400) e.waitFlags &= ~0x400;
      else if (e.waitFlags & SLEEP_GATE) {
        if (clock >= e.sleepUntil) e.waitFlags &= ~SLEEP_GATE;
      } else if (e.textRevealing) e.serviceTextReveal(e.nowMs);
      else if (e.awaitingAdvance) e.forceAdvance();
      else if (e.advActive) {
        e.serviceAdv();
        try {
          await stepOnce(e);
        } catch {
          /* ADV 分支的异常按"本帧无进展"处理 */
        }
      } else {
        for (let k = 0; k < 5000; k++) {
          const f = e.curScript();
          if (!f.script || f.ip >= f.script.instructions.length) return i;
          try {
            await stepOnce(e);
          } catch (err) {
            if (err instanceof ExitScript || err instanceof ScriptReset) return i;
            if (err instanceof NotImplementedOp) {
              // ★不登记用户桩：未实现 opcode 必须让测试失败，而不是被静默放行
              uninplementedPush(unimplemented, err);
              return i;
            }
            throw err;
          }
          if (e.waitFlags & (0x400 | SLEEP_GATE) || e.awaitingAdvance) break;
        }
      }
      sampleNow();
      clock += 1000 / 60;
    }
    return maxFrames;
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

  const m = e.msgwin;
  const out = {
    script: e.curScript().name,
    unimplemented,
    text: m.textOf(0),
    ruby: m.slot(m.resolveWin(0)).segments.flatMap((s) => s.ruby) as unknown as string[][],
    pane: e.engineValues.get(21631),
    msgField: e.engineValues.get(80101),
    sampleWin,
    snapshotText: sampleText,
    coveredBy,
    itemCounts: { drawItems: native.scene.drawItems.size, drawable: [...native.scene.drawItems.values()].filter((i) => (i.flags & 1) !== 0).length },
    gateLoop,
    trace,
  };
  await src.dispose?.();
  return out;
}

function uninplementedPush(list: string[], err: NotImplementedOp): void {
  list.push(`0x${err.opcode.toString(16)} ${err.name} @${err.scriptName}`);
}

