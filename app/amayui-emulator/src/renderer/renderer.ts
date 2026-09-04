/**
 * Renderer 入口：宿主画布 + VM（与 run.ts 同流程，但 native 换成 Canvas 2D 后端、FileSource 换成 IPC）。
 * 目标：跑启动链，把 draw 调用画到 canvas，HUD 显示当前脚本/ip/step。
 */
import { Engine } from '../vm/engine.js';
import { loadScriptData, stepOnce } from '../vm/interpreter.js';
import { ScriptReset } from '../vm/ops.js';
import { IpcFileSource } from './ipcFileSource.js';
import { PixiBackend, type RenderStatus } from './pixiBackend.js';

async function main(): Promise<void> {
  const status: RenderStatus = { scriptName: '…', ip: 0, steps: 0, log: [] };
  const native = await PixiBackend.create(status); // WebGL 渲染后端（PixiJS v8）
  const src = new IpcFileSource();
  const e = new Engine(native);
  e.fileSource = src;

  // 预载标题所需的图像（LOGO 背景/版权 + 主菜单），避免 set-texture 后 draw 立即执行时的异步竞态。
  for (const imgid of [0x5245, 0x5246, 0x5272, 0x5273]) {
    await native.preloadImage(imgid);
  }

  try {
    const boot = await src.readScript(0);
    if (!boot) {
      native.log('无法装载 index 0 (SYSTEM4.BIN)');
      native.unhandled(0, 'boot-fail: no script 0');
      native.drawHud();
      return;
    }
    status.scriptName = boot.name;
    loadScriptData(e, boot.data, boot.name);

    const MAX_STEPS = 400000;
    let titleSteps = 0;
    let reachedTitle = false;
    for (let i = 0; i < MAX_STEPS; i++) {
      const f = e.curScript();
      const name = f.name || status.scriptName;
      status.scriptName = name;
      status.ip = f.ip;
      status.steps = i + 1;
      if (/^TITLE/i.test(name)) {
        titleSteps++;
        if (!reachedTitle) {
          reachedTitle = true;
          native.log(`>> 到达 ${name}`);
        }
      }
      try {
        await stepOnce(e);
      } catch (err) {
        if (err instanceof ScriptReset) {
          native.log('exit-script teardown (reset)');
          break;
        }
        native.log(`stop: ${(err as Error).message}`);
        break;
      }
      if (titleSteps > 1200) break; // 已进入 TITLE 一段时间（含菜单轮询），停止
      if (i % 250 === 0) native.drawHud();
    }
    native.drawHud();
    // 供无界面验证：把终态打到控制台（--enable-logging 可见）
    console.log(`[boot] done script=${status.scriptName} ip=${status.ip} steps=${status.steps} reachedTitle=${reachedTitle}`);
  } catch (err) {
    const msg = `boot error: ${(err as Error).message}`;
    native.log(msg);
    native.drawHud();
    console.error(`[boot] ${msg}`);
  }
}

main().catch((err) => {
  console.error(err);
  const body = document.body;
  if (body) body.textContent = `启动失败: ${(err as Error).message}`;
});
