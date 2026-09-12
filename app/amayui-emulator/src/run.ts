/** 启动器：搭建文件代理 + 引擎，装载 index 0 = SYSTEM4.BIN，逐条执行到 TITLE。 */
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeFileSource } from './arch/nodeFileSource.js';
import { resolveResourceDir } from './arch/resourceDir.js';
import { OverlayDir } from './arch/overlay.js';
import { SAVE_DAT_REL, describeSystemPaths, resolveSystemPaths } from './arch/systemPaths.js';
import { decodeSaveData, encodeSaveData } from './vm/saveData.js';
import { StubNative } from './vm/native.js';
import { Engine } from './vm/engine.js';
import { loadScriptData, stepOnce, NotImplementedOp } from './vm/interpreter.js';
import { ScriptReset, ExitScript } from './vm/ops.js';
import { audioBootIntents } from './vm/handlers/audio.js';
import { OPCODE_TABLE } from './script/bin.js';
import { formatIni, parseIni, applyConfigToEngine } from './engineConfig.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..'); // app/amayui-emulator/src -> 仓库根
// 资源根 = `install/`（汉化版）；对比原版用 `AMAYUI_RESOURCE_DIR=raw`（见 arch/resourceDir.ts）
const RESOURCE_DIR = resolveResourceDir(REPO_ROOT);

async function main() {
  // ★玩家数据（`SYS4REG.INI` / `SAVE\SAVE.DAT`）走「系统存档目录 + overlay」：
  //   读 overlay → base（真游戏），写只写 overlay ⇒ 能继承真游戏设置，又不会写坏它。
  //   `--no-save-config` / `--no-save-data` 可关回写（关掉后完全不写盘）。
  const saveConfig = !process.argv.includes('--no-save-config');
  const saveData = !process.argv.includes('--no-save-data');
  const system = resolveSystemPaths(REPO_ROOT);
  const overlay = new OverlayDir(system);
  console.log(`[overlay] ${describeSystemPaths(system)}`);
  const src = new NodeFileSource({
    resourceDir: RESOURCE_DIR,
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
  while (maxSteps === 0 || executed < maxSteps) {
    const frame = e.curScript();
    const instr = frame.script!.instructions[frame.ip];
    if (!instr) {
      console.log(`  ip ${frame.ip} 越界, 停止`);
      break;
    }
    // ★逐字显现：无界面时按固定步进推进（引擎每帧一步）—— 显现未完不放行等待门。
    if (e.textRevealing) {
      e.serviceTextReveal(e.nowMs);
      e.nowMs += 16; // 固定步进（headless 用假时钟）
      continue;
    }
    // ★`0x300` 每窗「逐行贴出」闸门（不阻塞脚本，引擎主循环每帧都跑）
    e.serviceWinReveal(e.nowMs);
    // ★等待推进门：CLI 无输入源 ⇒ 确定性自动放行（计数），否则剧本一旦进入"等玩家点击"就永不前进。
    if (e.awaitingAdvance) {
      advanceWaits++;
      if (e.forceAdvance() !== null) markScript();
      continue;
    }
    const labelName = OPCODE_TABLE.has(instr.opcode) ? OPCODE_TABLE.get(instr.opcode)!.name : `0x${instr.opcode.toString(16)}`;
    try {
      const trace = await stepOnce(e);
      executed++;
      if (trace.handlerKind === 'engine-internal' || trace.handlerKind === 'native' || trace.handlerKind === 'user-stub') {
        cfg++;
        continue; // 引擎内部/子系统/用户登记的桩：跳过，不逐条打印（cfg 计数）
      }
      if (trace.opcode === 0x3) {
        // call-script：打印目标（加载新脚本后当前帧已是新脚本）
        markScript();
        const sc2 = e.curScript().script;
        console.log(`  call-script -> ${sc2 ? e.curScript().name : '?'} (loaded ${sc2 ? sc2.instructions.length : 0} instr)`);
        continue;
      }
      console.log(
        `  #${String(executed).padStart(5)} ip=${String(trace.ip).padStart(4)} op 0x${instr.opcode.toString(16).padStart(3, '0')} ${labelName} [${instr.args.map((a) => a.type === 2 ? `"${a.str}"` : `0x${a.raw.toString(16)}`).join(' ')}]`,
      );
    } catch (err) {
      if (err instanceof ScriptReset) {
        console.log('\n[reset] exit-script(0x9) 全量清栈/重置（回到干净根态）');
        break;
      }
      if (err instanceof ExitScript) {
        console.log('\n[abort] abort(0x1)/程序退出');
        break;
      }
      if (err instanceof NotImplementedOp) {
        console.error(`\n[stop] ${err.message}`);
        break;
      }
      console.error(`\n[stop] ${(err as Error).message}`);
      break;
    }
  }

  console.log(`\n[done] 共执行 ${executed} 条指令（其中引擎内部/子系统 ${cfg} 条已插桩跳过；等待推进门自动放行 ${advanceWaits} 次）。cur=${e.cur} caller=${e.curScript().caller}`);
  await src.dispose?.();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
