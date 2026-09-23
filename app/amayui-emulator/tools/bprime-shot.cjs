'use strict';
/**
 * **B′ 判据实验驱动器**（`tickets/T-0134` §7；设计来源 `tickets/T-0133` §B.4.4）。
 *
 * ## 它回答什么
 *
 * "**隐藏窗口**（`show:false`、从不 `showInactive()`）里的 Pixi 页面，能不能仍然产出**页面内合成**
 * 的帧？" —— 即 `PixiBackend.captureFrame()` 走的 `renderer.extract.canvas`（WebGL 读回）
 * 这条管线，在 `T-0133` §B.4.2 的调研口径下（macOS：`paintWhenInitiallyHidden` 默认 true
 * 且 `NativeWidgetMac` 跑 headless 模式）是否可用。
 *
 * ★**为什么不用 `capturePage()`**：那是**形态 C**（Electron 的窗口截图管线，有 `#42378` 白屏史）。
 *   B′ 与 C 是两条不同管线，本脚本存在的意义就是区分二者 —— 所以取帧只走 `shot` 命令
 *   （= 渲染窗里的 `capturePng(host)`），**不碰** `capturePage()`。
 *
 * ## 用法
 *
 * ```bash
 * cd app/amayui-emulator
 * npm run build:electron                 # 守护进程要 require dist/electron/main.cjs
 * node tools/bprime-shot.cjs             # 起隐藏档守护 → 取 N 帧 → 判据 → 收工（默认）
 * node tools/bprime-shot.cjs --keep      # 保留守护进程（自己接着用 dbg.cjs）
 * node tools/bprime-shot.cjs --shots 5 --interval-ms 1000
 * ```
 *
 * ## 四条判据（与 `T-0134/notes.md` §7.3 同口径）
 *
 * 1. 每次 `capture` 都能拿到 `png` 且 base64 可解码（PNG 魔数）；
 * 2. 尺寸 = **1280×720**（读 IHDR）；
 * 3. 字节数显著大于"纯色 PNG"的量级（脚本只用阈值告警，不代替人看）；
 * 4. **至少一对帧不同** —— "帧是活的"的强证据，不依赖任何像素解码。
 *
 * 判据 4 的诚实边界：若游戏此刻停在**真正静止**的画面（无动画、无输入），全部帧相等是**合理**结果，
 * 本脚本会打 `INCONCLUSIVE(static)` 而不是 FAIL —— 此时应改用"注入输入后再比"的版本
 * （那需要 Phase 2 的输入桥，见 `T-0134` §7.2 的链路表）。
 */
const { spawn } = require('node:child_process');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');

const APP = path.resolve(__dirname, '..');
const HOST = '127.0.0.1';
const PORT = Number(process.env.AMAYUI_DEBUG_PORT || 39427);

const argv = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
};
const SHOTS = Number(argOf('--shots', '3'));
const INTERVAL_MS = Number(argOf('--interval-ms', '2000'));
const BOOT_TIMEOUT_MS = Number(argOf('--boot-timeout-ms', '180000'));
const KEEP = argv.includes('--keep');
const OUT_DIR = path.resolve(APP, argOf('--out', '../../.tmp/bprime'));

/** 连一次调试服务器（短连接；与 tools/dbg.cjs 同一手法）。 */
function connect(timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: HOST, port: PORT });
    const timer = setTimeout(() => {
      sock.destroy();
      reject(new Error('connect timeout'));
    }, timeoutMs);
    sock.once('connect', () => {
      clearTimeout(timer);
      resolve(sock);
    });
    sock.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 等端口可连（守护进程起来要几秒）。 */
async function waitPort(timeoutMs) {
  const t0 = Date.now();
  for (;;) {
    try {
      const s = await connect();
      s.destroy();
      return Date.now() - t0;
    } catch (err) {
      if (Date.now() - t0 > timeoutMs) throw new Error(`等调试服务器超时（${timeoutMs}ms）：${err.message}`);
      await sleep(500);
    }
  }
}

/**
 * 发一条命令、收它的结果（**按 id 配对**；忽略 `event=*` 的推送）。
 * @returns {Promise<{ok: boolean, lines: string[], png?: string}>}
 */
function command(id, text, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    connect()
      .then((sock) => {
        let buf = '';
        const timer = setTimeout(() => {
          sock.destroy();
          reject(new Error(`命令超时（${timeoutMs}ms）：${text}`));
        }, timeoutMs);
        sock.on('data', (c) => {
          buf += c.toString('utf8');
          let nl;
          while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl);
            buf = buf.slice(nl + 1);
            if (!line.trim()) continue;
            let o;
            try {
              o = JSON.parse(line);
            } catch {
              continue;
            }
            if (o.event) continue; // 推送不是答案
            if (o.id !== undefined && o.id !== id) continue;
            clearTimeout(timer);
            sock.end();
            resolve(o);
            return;
          }
        });
        sock.on('error', (err) => {
          clearTimeout(timer);
          reject(err);
        });
        sock.write(JSON.stringify({ id, text }) + '\n');
      })
      .catch(reject);
  });
}

/** 解析 PNG 的 IHDR（不做像素解码：判据 1/2 只需要魔数 + 尺寸）。 */
function pngInfo(buf) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const magicOk = buf.length > 33 && sig.every((b, i) => buf[i] === b);
  if (!magicOk) return { magicOk: false };
  const type = buf.slice(12, 16).toString('ascii');
  return {
    magicOk: true,
    ihdrOk: type === 'IHDR',
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    bitDepth: buf[24],
    colorType: buf[25],
  };
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const logPath = path.join(OUT_DIR, 'server.log');
  const log = fs.createWriteStream(logPath);

  // ① 起隐藏档守护。★AMAYUI_WINDOW_HIDDEN 是 T-0134 新增的档（windows.ts）：只 show:false、不 showInactive。
  console.log(`[bprime] 起隐藏档守护（AMAYUI_WINDOW_HIDDEN=1，静音）→ 日志 ${logPath}`);
  const child = spawn('npm', ['run', 'dbg:srv'], {
    cwd: APP,
    env: { ...process.env, AMAYUI_WINDOW_HIDDEN: '1', AMAYUI_AUDIO_ENABLED: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  child.stdout.pipe(log);
  child.stderr.pipe(log);

  let cleaned = false;
  const cleanup = async () => {
    if (cleaned || KEEP) return;
    cleaned = true;
    // 让守护进程自己收工（它收到 op:'quit' 会关 app）——比 SIGTERM 干净。
    try {
      await new Promise((resolve) => {
        const s = net.connect({ host: HOST, port: PORT });
        s.once('connect', () => {
          s.write(JSON.stringify({ op: 'quit', id: 1 }) + '\n');
          setTimeout(() => {
            s.destroy();
            resolve();
          }, 300);
        });
        s.once('error', () => resolve());
      });
    } catch {
      /* 尽力而为 */
    }
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      try {
        child.kill('SIGTERM');
      } catch {
        /* 已经没了 */
      }
    }
  };

  try {
    const waited = await waitPort(BOOT_TIMEOUT_MS);
    console.log(`[bprime] 调试服务器就绪（等了 ${waited}ms）`);

    // ② 取帧：capture 是渲染窗里的 `capturePng(host)`（页面内 extract.canvas，**不是** capturePage）。
    //    页面还没跑到能出图之前 `shot` 会失败 ⇒ 重试（首帧还要等脚本跑到 TITLE）。
    const frames = [];
    for (let i = 0; i < SHOTS; i++) {
      let r = null;
      const t0 = Date.now();
      for (;;) {
        try {
          r = await command(100 + i, 'capture', 30000);
        } catch (err) {
          r = { ok: false, lines: [String(err.message)] };
        }
        if (r && r.ok !== false && typeof r.png === 'string' && r.png.length > 0) break;
        if (Date.now() - t0 > BOOT_TIMEOUT_MS) break;
        await sleep(2000);
      }
      if (!r || r.ok === false || typeof r.png !== 'string') {
        console.log(`[bprime] ✗ 第 ${i + 1} 帧取不到：${JSON.stringify(r && r.lines)}`);
        continue;
      }
      const buf = Buffer.from(r.png, 'base64');
      const info = pngInfo(buf);
      const file = path.join(OUT_DIR, `shot-${i + 1}.png`);
      fs.writeFileSync(file, buf);
      frames.push({ buf, info, file });
      console.log(
        `[bprime] 帧 ${i + 1}：${buf.length}B ${info.width}×${info.height} bitDepth=${info.bitDepth} colorType=${info.colorType} → ${file}`,
      );
      if (i + 1 < SHOTS) await sleep(INTERVAL_MS);
    }

    // ③ 判据
    console.log('\n===== B′ 判据 =====');
    const c1 = frames.length === SHOTS && frames.every((f) => f.info.magicOk);
    const c2 = frames.length > 0 && frames.every((f) => f.info.width === 1280 && f.info.height === 720);
    const c3 = frames.length > 0 && frames.every((f) => f.buf.length > 20000);
    const sizes = frames.map((f) => f.buf.length);
    const uniq = new Set(frames.map((f) => f.buf.toString('base64')));
    const c4 = frames.length >= 2 ? uniq.size > 1 : null;

    console.log(`① PNG 魔数/可解码：${c1 ? 'PASS' : 'FAIL'}（${frames.length}/${SHOTS} 帧）`);
    console.log(`② 尺寸 1280×720：${c2 ? 'PASS' : 'FAIL'}`);
    console.log(`③ 字节数 > 20KB（非纯色图）：${c3 ? 'PASS' : 'FAIL'}（${sizes.join(', ')}B）`);
    console.log(
      `④ 帧间有差异（活的）：${c4 === null ? 'N/A（只取到 1 帧）' : c4 ? 'PASS' : 'INCONCLUSIVE(static)'}（去重后 ${uniq.size}/${frames.length}）`,
    );
    const verdict = c1 && c2 && c3 && c4 === true ? 'PASS' : c1 && c2 && c3 ? 'INCONCLUSIVE' : 'FAIL';
    console.log(`\n⇒ B′ 结论：${verdict}`);
    if (verdict === 'FAIL') {
      console.log('   （失败 ⇒ 退回 T-0133 §B.4.1 的 OSR 方案：offscreen:true + paint + setFrameRate）');
    } else if (verdict === 'INCONCLUSIVE') {
      console.log('   （画面可能真的静止 ⇒ 需注入输入后再比；那要 Phase 2 的输入桥）');
    }
  } catch (err) {
    console.log(`[bprime] ✗ ${err.message}`);
  } finally {
    await cleanup();
    log.end();
    console.log(`[bprime] 收工（日志 ${logPath}）${KEEP ? '；守护进程按 --keep 保留' : ''}`);
  }
})();
