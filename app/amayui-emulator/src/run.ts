/** 启动器：搭建文件代理 + 引擎，装载 index 0 = SYSTEM4.BIN，逐条执行到 TITLE。 */
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeFileSource } from './arch/nodeFileSource.js';
import { StubNative } from './vm/native.js';
import { Engine } from './vm/engine.js';
import { loadScriptData, stepOnce, NotImplementedOp } from './vm/interpreter.js';
import { ScriptReset } from './vm/ops.js';
import { OPCODE_TABLE } from './script/bin.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..'); // app/amayui-emulator/src -> 仓库根
const RAW_DIR = path.join(REPO_ROOT, 'raw');

async function main() {
  const src = new NodeFileSource({ rawDir: RAW_DIR });
  const native = new StubNative(() => {}); // 安静：run.ts 自己打印结构化摘要
  const e = new Engine(native);
  e.fileSource = src;

  // 装载首脚本：index 0 = SYSTEM4.BIN（WinMain 的 a4=0，见 docs/04）
  const boot = await src.readScript(0);
  if (!boot) {
    console.error('无法装载索引 0 (SYSTEM4.BIN)');
    return;
  }
  loadScriptData(e, boot.data, boot.name);
  console.log(`[boot] index 0 -> ${boot.name} (${e.curScript().script!.instructions.length} 条指令)`);

  // 逐条执行（事件聚焦打印）。N=0 表示一直跑到退出/异常/未实现 opcode。
  const maxSteps = Number(process.env.STEPS ?? 0);
  let executed = 0;
  let cfg = 0;
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
    const labelName = OPCODE_TABLE.has(instr.opcode) ? OPCODE_TABLE.get(instr.opcode)!.name : `0x${instr.opcode.toString(16)}`;
    try {
      const trace = await stepOnce(e);
      executed++;
      if (trace.handlerKind === 'engine-internal' || trace.handlerKind === 'native') {
        cfg++;
        continue; // 引擎内部/子系统：插桩跳过，不逐条打印（cfg 计数）
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
      if (err instanceof NotImplementedOp) {
        console.error(`\n[stop] ${err.message}`);
        break;
      }
      console.error(`\n[stop] ${(err as Error).message}`);
      break;
    }
  }

  console.log(`\n[done] 共执行 ${executed} 条指令（其中引擎内部/子系统 ${cfg} 条已插桩跳过）。cur=${e.cur} caller=${e.curScript().caller}`);
  await src.dispose?.();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
