/**
 * **调试服务器客户端**（`tickets/T-0114`）—— 连上 `tools/debugsrv.cjs`，发命令、收结果、断开。
 *
 * ```
 * node tools/dbg.cjs global 0                       # 一条查询
 * node tools/dbg.cjs 'b event global-int-write idx == 3318'
 * node tools/dbg.cjs bl                             # 列断点（等推送）
 * node tools/dbg.cjs c                              # 继续
 * node tools/dbg.cjs click 807 621                  # 远程点一下（输入坐标；见 debugsrv.cjs 文件头）
 *                                                   # ★默认走主进程 `sendInputEvent`（真 DOM 事件）；
 *                                                   #   设 `AMAYUI_DEBUG_INPUT=vm` ⇒ 走渲染窗命令表（与 web 宿主同源，T-0142）
 * node tools/dbg.cjs clickimg 400 325               # 远程点一下（截图图像坐标）
 * node tools/dbg.cjs move 1240 300                  # 只移动光标（悬停门控）
 * node tools/dbg.cjs save .tmp/x.snap.json          # ★引擎态快照落盘（`tickets/T-0122`）
 * node tools/dbg.cjs load .tmp/x.snap.json          # ★把该快照灌回去（回执里逐条列出"没恢复的量"）
 * node tools/dbg.cjs snapshot                       # 只取快照 JSON（不落盘；`restore <base64>` 是它的逆）
 * node tools/dbg.cjs --wait 5000 global 0           # 等最多 5s 把推送也收进来
 * node tools/dbg.cjs --json global 0                # 原样打 JSONL（不给人类看的排版）
 * node tools/dbg.cjs --ping / --quit
 * ```
 *
 * ★为什么是"短连接"：守护进程长期活着（adb 的形），每次调用只连上→发→收→断，
 *   这样"我"的每一次工具调用都不受上一次的状态影响。
 *
 * 退出码：0 = 命令成功（`ok !== false`）；1 = 服务端回了失败；2 = 连不上/协议错。
 */
const net = require('node:net');

const HOST = '127.0.0.1';
const PORT = Number(process.env.AMAYUI_DEBUG_PORT || 39427);

const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const ping = argv.includes('--ping');
const quit = argv.includes('--quit');
const waitIdx = argv.indexOf('--wait');
const waitMs = waitIdx >= 0 ? Number(argv[waitIdx + 1] ?? 1000) : 400;
/** 去掉开关后的剩余参数就是命令文本（多个参数用空格拼回一条）。 */
const words = argv.filter((a, i) => !a.startsWith('--') && (waitIdx < 0 || i !== waitIdx + 1));

function connect() {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: HOST, port: PORT });
    sock.once('connect', () => resolve(sock));
    sock.once('error', reject);
  });
}

(async () => {
  let sock;
  try {
    sock = await connect();
  } catch (err) {
    console.error(`✗ 连不上调试服务器 ${HOST}:${PORT}（${err.message}）`);
    console.error('  先起它：npm run dbg:srv');
    process.exit(2);
  }

  let failed = false;
  let gotResult = false;
  let buf = '';
  const dump = (o) => {
    if (asJson) {
      console.log(JSON.stringify(o));
      return;
    }
    if (o.event === 'hello') {
      console.log(`# ${o.text}（game=${o.game}）`);
      return;
    }
    if (o.event === 'status') return; // 状态推送太吵，默认不打
    if (o.event) {
      // 断点命中 / 断点表
      if (o.event === 'paused') {
        console.log(`⏸ 断点 #${o.id} 命中 @ ${o.where}${o.detail ? `（${o.detail}）` : ''}`);
      } else if (o.event === 'break-list') {
        const rows = o.list ?? [];
        console.log(rows.length ? `断点 ${rows.length} 条：` : '（断点表为空）');
        for (const b of rows) {
          console.log(`  #${b.id} ${b.kind === 'step' ? '条件断点' : `事件断点(${b.where})`} ${b.condition || '(无条件)'}  命中 ${b.hits}`);
        }
        if (o.error) console.log(`✗ ${o.error}`);
        if (o.paused) console.log(`⏸ 当前暂停：#${o.paused.id} @ ${o.paused.where}`);
      } else {
        console.log(`# ${o.event}: ${JSON.stringify(o)}`);
      }
      return;
    }
    // 命令结果
    gotResult = true;
    if (o.ok === false) failed = true;
    console.log(o.ok === false ? '✗' : '');
    for (const l of o.lines ?? []) console.log(String(l));
  };

  sock.on('data', (c) => {
    buf += c.toString('utf8');
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      try {
        dump(JSON.parse(line));
      } catch (err) {
        console.error(`✗ 协议错误：${err.message}：${line}`);
      }
    }
  });

  const text = words.join(' ');
  const msg = quit ? { op: 'quit', id: 1 } : ping ? { op: 'ping', id: 1 } : { id: 1, text };
  sock.write(JSON.stringify(msg) + '\n');

  // 给一点时间把（异步）推送也收进来 —— 命令台里 `bl` / `c` 的结果就是推送形态。
  await new Promise((r) => setTimeout(r, waitMs));
  sock.end();
  process.exit(failed ? 1 : gotResult || ping || quit ? 0 : 0);
})();
