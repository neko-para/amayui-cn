/**
 * **调试服务器客户端**（`tickets/T-0114`）—— 连上 `tools/debugsrv.cjs`，发命令、收结果、断开。
 *
 * ```
 * node tools/dbg.cjs global 0                       # 一条查询
 * node tools/dbg.cjs 'b event global-int-write idx == 3318'
 * node tools/dbg.cjs bl                             # 列断点（等推送）
 * node tools/dbg.cjs c                              # 继续
 * node tools/dbg.cjs click 807 621                  # 远程点一下（输入坐标；见 debugsrv.cjs 文件头）
 *                                                   # ★默认走主进程 `sendInputEvent`（真 DOM 事件，内容是**内容区 CSS 像素**）；
 *                                                   #   设 `AMAYUI_DEBUG_INPUT=vm` ⇒ 走渲染窗命令表（与 web 宿主同源，T-0142），
 *                                                   #   ★那时坐标是**虚拟 0..1280 / 0..720**，回执写"已注入 N 个输入事件"
 * node tools/dbg.cjs clickimg 400 325               # 远程点一下，★坐标 = **内容区 CSS 像素**（T-0142 ⑦）
 *                                                   #   DOM 通道恒等；VM 通道按 getContentSize() 折成虚拟坐标。
 *                                                   #   回执里会印出这次折算（点了没反应先看它）
 *                                                   #   —— 从前它是"整窗截图图像像素"（要一次 capturePage 现算，
 *                                                   #   随窗口尺寸/DPI 漂）；那条路已废，`screencap` 只作目视
 * node tools/dbg.cjs move 1240 300                  # 只移动光标（悬停门控）
 * node tools/dbg.cjs shot 名字                      # 截图（★默认走渲染窗 FrameHost.capture = 舞台，恒 1280×720）
 *                                                   #   → .tmp/dbg-<名字>.png（回执写明管线 + 内容区尺寸）
 * node tools/dbg.cjs screencap 名字                 # 旧的整窗那条（主进程 capturePage，随窗口几何；只作目视）
 * node tools/dbg.cjs capture [路径]                 # 同 `shot` 那条管线，但路径任选（相对路径按**仓库根**）；
 *                                                   #   给了路径 ⇒ 直接落盘（回执报字节数/图像尺寸）；
 *                                                   #   不给 ⇒ 只回 base64（在回执的 png 字段）
 * node tools/dbg.cjs save .tmp/x.snap.json          # ★引擎态快照落盘（`tickets/T-0122`）
 * node tools/dbg.cjs load .tmp/x.snap.json          # ★把该快照灌回去（回执里逐条列出"没恢复的量"）
 * node tools/dbg.cjs snapshot                       # 只取快照 JSON（不落盘；`restore <base64>` 是它的逆）
 * node tools/dbg.cjs --wait 5000 global 0           # 等最多 5s 把推送也收进来
 * node tools/dbg.cjs --json global 0                # 原样打 JSONL（不给人类看的排版）
 * node tools/dbg.cjs --ping / --quit             # --ping 还会报**守护进程的代码新鲜度**：
 *                                                 #   对面跑的是旧代码（改了 tools/*.cjs 却没重启）会被点破
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
  /** `--ping` 的回执里有没有那条**新鲜度自述**（没有 ⇒ 对面是旧代码，它那版还没有这个字段）。 */
  let sawFreshness = false;
  let buf = '';
  const dump = (o) => {
    if (asJson) {
      console.log(JSON.stringify(o));
      return;
    }
    if (o.event === 'hello') {
      console.log(`# ${o.text}（game=${o.game}）`);
      // ★守护进程是**唯一长期活着的**进程：`tools/*.cjs` 在 require 那一刻定死，改了磁盘上的文件
      //   不会影响已经在跑的它（本客户端每次都是新进程，所以永远是新的）。这里把"要不要重启"
      //   从猜变成查 —— 否则"我改了代码却看不到效果"会被误读成"代码写错了"。
      if (o.stale) {
        console.error('★ 本守护进程跑的是**旧代码**（磁盘上的 tools/debugsrv.cjs 比它新）⇒ 改了工具行为看不到效果就是这里。');
        console.error('  ⇒ 重启：`node tools/dbg.cjs --quit`，然后重跑 `npm run dbg:srv`（tools/*.cjs 不参与编译）。');
      }
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
    for (const l of o.lines ?? []) {
      const s = String(l);
      if (s.includes('守护进程起于')) sawFreshness = true;
      console.log(s);
    }
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
  // ★`--ping` 是对面**唯一无法自救**的一种情形：旧代码的 ping 回执里当然没有新鲜度字段
  //   ⇒ 由**永远新鲜的**客户端（本文件每次都是新进程）来判定"对面不报告版本 = 对面是旧代码"。
  //   没有这一条，"改了 capture 却没落盘"会被当成"capture 写错了"（本工程真实发生过一次）。
  if (ping && gotResult && !sawFreshness) {
    console.error('★ 对面的守护进程**不报告版本** ⇒ 它跑的是**旧代码**（`tools/*.cjs` 只在启动时加载）。');
    console.error('  ⇒ 重启它：`node tools/dbg.cjs --quit`，然后重跑 `npm run dbg:srv`。');
  }
  sock.end();
  process.exit(failed ? 1 : gotResult || ping || quit ? 0 : 0);
})();
