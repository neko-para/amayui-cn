/** 启动器：搭建文件代理 + 引擎，装载 index 0 = SYSTEM4.BIN，逐条执行到 TITLE。 */
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeFileSource } from './arch/nodeFileSource.js';
import { describeResourcesLine } from './arch/resourceDir.js';
import { OverlayDir } from './arch/overlay.js';
import { SAVE_DAT_REL, describeSystemPaths, resolveSystemPaths } from './arch/systemPaths.js';
import { decodeSaveData, encodeSaveData } from './vm/saveData.js';
import { StubNative } from './vm/native.js';
import { Engine } from './vm/engine.js';
import { loadScriptData } from './vm/interpreter.js';
import { audioBootIntents } from './vm/handlers/audio.js';
import { OPCODE_TABLE, type BinInstruction } from './script/bin.js';
import { runFrameLoop } from './frame/loop.js';
import type { FrameHost } from './frame/host.js';
import { formatIni, parseIni, applyConfigToEngine } from './engineConfig.js';
import { applyEmulatorOptionsToEngine } from './emulatorOptions.js';
import { describeEmulatorOptions, loadEmulatorOptions, resourceDirOf } from './emulatorOptionsFile.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..'); // app/amayui-emulator/src -> 仓库根

async function main() {
  // ★外置选项（`emulator.config.json`）要在**建 FileSource 之前**读：`resources.path` 决定资源根
  //   （优先序 CLI > AMAYUI_RESOURCE_DIR > resources.path > install/，见 arch/resourceDir.ts）。
  const loaded = loadEmulatorOptions(REPO_ROOT);
  for (const l of describeEmulatorOptions(loaded)) console.log(l);
  const resourceDir = resourceDirOf(loaded, REPO_ROOT);
  console.log(`[options] ${describeResourcesLine(loaded.options, resourceDir)}`);

  // ★玩家数据（`SYS4REG.INI` / `SAVE\SAVE.DAT`）走「系统存档目录 + overlay」：
  //   读 overlay → base（真游戏），写只写 overlay ⇒ 能继承真游戏设置，又不会写坏它。
  //   `--no-save-config` / `--no-save-data` 可关回写（关掉后完全不写盘）。
  const saveConfig = !process.argv.includes('--no-save-config');
  const saveData = !process.argv.includes('--no-save-data');
  const system = resolveSystemPaths(REPO_ROOT);
  const overlay = new OverlayDir(system);
  console.log(`[overlay] ${describeSystemPaths(system)}`);
  const src = new NodeFileSource({
    resourceDir: resourceDir.dir,
    ...(saveConfig || saveData ? { system } : {}),
    log: (m) => console.log(`[overlay] ${m}`),
  });
  const native = new StubNative(() => {}); // 安静：run.ts 自己打印结构化摘要
  const e = new Engine(native);
  e.fileSource = src;
  if (saveConfig) {
    e.onConfigChanged = (cfg) => {
      void src.saveConfig?.(formatIni(cfg));
    };
  }

  // 装载引擎配置（与 Electron 侧 `renderer/app/configBoot.ts` 同一份逻辑：读 INI → 灌引擎字段）。
  // 有了它，`0x2EB`（set:GameVersion）与 `0x131/0x2E6/0xC5…` 这些"读配置"指令在无界面跑时也有真值。
  const ini = await src.readConfig();
  if (ini) {
    const cfg = parseIni(ini.text);
    e.config = cfg;
    const applied = applyConfigToEngine(cfg, e.engineValues);
    console.log(
      `[config] ${ini.path}（${ini.side}）分节=[${cfg.sections.join(',')}] 键=${cfg.values.size} 个` +
        `（写入引擎字段 ${applied.length} 个；回写=${saveConfig ? '开' : '关'}）`,
    );
  } else {
    console.log('[config] overlay/base 都没有 SYS4REG.INI（引擎字段用默认值）');
  }

  // 外置选项 → 引擎：`boot.showLogo`（LOGO/版权页开关）+ `resources.version`（字体面名解析策略）。
  // ★必须在装载脚本之前套用：SYSTEM4 的 `load-show-logo`（`src/SYSTEM4.txt:144-146`）在开头就据它分派。
  for (const n of applyEmulatorOptionsToEngine(e, loaded.options)) console.log(`[options] ${n}`);

  // 装载 SAVE.DAT（`save-int`/`save-string` 表）—— 必须在装载脚本之前：
  // `SYSTEM4.txt:71` 的 `load-int (global 5)` 决定走 LOADCONFIG（恢复设置）还是 INITCONFIG（写默认值）。
  if (saveData) {
    const hit = await src.readSystemFile(SAVE_DAT_REL);
    if (!hit) {
      console.log(`[save] ${overlay.overlayFile(SAVE_DAT_REL)} / ${overlay.baseFile(SAVE_DAT_REL)} 都不存在` +
        '（首次启动：走 INITCONFIG 默认值分支）');
    } else {
      const r = decodeSaveData(hit.data);
      if (r.ok) {
        e.applySaveDataTables(r.data.tables);
        // ★鉴赏/解锁进度（FileDB 的「已使用文件」表）：两侧并集（overlay 那份可能是旧版本写的空块）
        const merged = await src.readSaveFlags();
        const flags = merged && merged.length > 0 ? merged : [...r.data.usage.usedFileIds];
        e.setUsedFileIds(flags);
        console.log(
          `[save] ${hit.path}（${hit.side}）「${r.data.title}」format=${r.data.format}：` +
            `${r.data.tables.ints.size} 个 int / ${r.data.tables.strings.size} 个 string / ` +
            `已使用文件 ${flags.length} 个［本文件 ${r.data.usage.layout}:${r.data.usage.usedFileIds.size}` +
            `${merged ? ` / 并集 ${merged.length}` : ''}］⇒ 走 LOADCONFIG 分支`,
        );
      } else {
        console.log(`[save] 无法解析 ${hit.path}（${r.reason}）⇒ 当作首次启动`);
      }
    }
    e.onSaveDataChanged = () => {
      void src.writeSaveData?.(
        encodeSaveData({ tables: e.saveDataTables(), usedFileIds: e.usedFileIds }),
      );
    };
  }

  // 装载首脚本：index 0 = SYSTEM4.BIN（WinMain 的 a4=0，见 docs/04）
  const boot = await src.readScript(0);
  if (!boot) {
    console.error('无法装载索引 0 (SYSTEM4.BIN)');
    return;
  }
  // 启动时把声音设置灌进音频引擎（与 Electron 侧 `renderer/app/boot.ts` 同一步；这里只有记录式桩）
  for (const intent of audioBootIntents(e.config)) native.audio(intent);
  // 音乐表（SYS4INI 尾部）：headless 直接用 NodeFileSource 读，语义与渲染侧一致
  {
    const music = await src.musicTables();
    e.musicTable = { other: music.other, base: music.base, groups: [] };
    console.log(`[music] 曲号表 ${e.musicTable.base.length} 条`);
  }
  loadScriptData(e, boot.data, boot.name);
  console.log(`[boot] index 0 -> ${boot.name} (${e.curScript().script!.instructions.length} 条指令)`);

  // 逐条执行（事件聚焦打印）。N=0 表示一直跑到退出/异常/未实现 opcode。
  const maxSteps = Number(process.env.STEPS ?? 0);
  let executed = 0;
  let cfg = 0;
  let advanceWaits = 0;
  /** 虚拟时钟（ms）：每帧末 +1000/60（B2/C1：修前只在逐字分支里前进，其余时间冻结）。 */
  let clock = 0;
  let lastSig = '';
  const markScript = () => {
    const f = e.curScript();
    const key = `${f.name}@cur${e.cur}`;
    if (key !== lastSig) {
      lastSig = key;
      console.log(`  > 进入脚本 ${f.name} (${f.script ? f.script.instructions.length : 0} instr, cur=${e.cur})`);
    }
  };
  markScript();
  /**
   * **帧驱动配置**（`tickets/T-0002` 的 G3/C1/C3/C4：本文件原来那份循环的四处漂移在这里收敛）。
   *
   * 修前的四处（都已在 B2 处理）：
   *  - **C3** 逐字分支排在 `serviceWinReveal` **之前**、且两者永不同帧 ⇒ 现在用驱动的产品顺序；
   *  - **C1** 时钟只在逐字分支里 `+= 16`（其余时间**冻结** ⇒ `sleep` 门永不满足）⇒ 现在每帧末推进；
   *  - **C4** 没有 `serviceCharGrid` / `advActive` 分支 ⇒ 现在按产品打开（`advFrame: true` + 两个服务）；
   *  - **G3** 没有 `0x400`/`SLEEP` 门 ⇒ 现在吃驱动统一后的门。
   *
   * ★`gates.anim` 仍传 `'clear'`：本 CLI 的宿主是 `StubNative`（**没有场景模型**），
   * `host.animationsDone` 无从计算 ⇒ 传 `'wait'` 会永远等不到放行。这是**宿主能力缺口**
   * （登记在 `tickets/T-0013`：能力面要入桥，驱动才能统一询问"这个宿主能不能报动画跑完"）。
   */
  const host: FrameHost = { now: () => clock };
  /** 打印用：`stepOnce` 之后帧/ip 可能已变，所以在 step **之前**抓住当前指令。 */
  let lastInstr: BinInstruction | undefined;
  const result = await runFrameLoop(e, host, {
    gates: { anim: 'clear', sleep: 'wait', advance: 'force' },
    services: { winReveal: true, charGrid: true },
    advFrame: true,
    maxStepsPerFrame: 20000,
    onStepStart: (_frame, instr) => {
      lastInstr = instr;
    },
    onStep: (trace) => {
      executed++;
      if (trace.handlerKind === 'engine-internal' || trace.handlerKind === 'native' || trace.handlerKind === 'user-stub') {
        cfg++;
        return; // 引擎内部/子系统/用户登记的桩：跳过，不逐条打印（cfg 计数）
      }
      if (trace.opcode === 0x3) {
        // call-script：打印目标（加载新脚本后当前帧已是新脚本）
        markScript();
        const sc2 = e.curScript().script;
        console.log(`  call-script -> ${sc2 ? e.curScript().name : '?'} (loaded ${sc2 ? sc2.instructions.length : 0} instr)`);
        return;
      }
      const instr = lastInstr;
      const labelName =
        instr && OPCODE_TABLE.has(instr.opcode) ? OPCODE_TABLE.get(instr.opcode)!.name : `0x${trace.opcode.toString(16)}`;
      console.log(
        `  #${String(executed).padStart(5)} ip=${String(trace.ip).padStart(4)} op 0x${trace.opcode.toString(16).padStart(3, '0')} ${labelName}` +
          ` [${(instr?.args ?? []).map((a) => (a.type === 2 ? `"${a.str}"` : `0x${a.raw.toString(16)}`)).join(' ')}]`,
      );
    },
    onGate: (branch) => {
      if (branch === 'advance') {
        advanceWaits++;
        if (e.forceAdvance() !== null) markScript();
      }
    },
    onUnknown: (err) => {
      console.error(`\n[stop] ${err.message}`);
      return 'stop';
    },
    onError: (err) => {
      console.error(`\n[stop] ${(err as Error).message}`);
      return 'stop';
    },
    until: () => maxSteps !== 0 && executed >= maxSteps,
    // ★`STEPS=n` 必须**逐条**生效：只在帧开头判 `until` 时，一帧能派发 20000 条 ⇒ `STEPS=300` 会跑成 20000 条
    stopAfterStep: () => maxSteps !== 0 && executed >= maxSteps,
    onFrameEnd: () => {
      clock += 1000 / 60;
    },
  });
  if (result.stopReason === 'script-end') console.log(`  ip ${e.curScript().ip} 越界, 停止`);
  else if (result.stopReason === 'reset') console.log('\n[reset] exit-script(0x9) 全量清栈/重置（回到干净根态）');
  else if (result.stopReason === 'exit') console.log('\n[abort] abort(0x1)/程序退出');

  console.log(`\n[done] 共执行 ${executed} 条指令（其中引擎内部/子系统 ${cfg} 条已插桩跳过；等待推进门自动放行 ${advanceWaits} 次）。cur=${e.cur} caller=${e.curScript().caller}`);
  await src.dispose?.();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
