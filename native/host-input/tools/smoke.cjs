'use strict';
/**
 * 烟测：**默认只读**（不动用户的光标），要验证"真能挪动"时显式开环境变量：
 *
 * ```
 * npm run smoke                                    # 只读：加载状态 / 光标 / 虚拟屏 / 平台专有查询
 * AMAYUI_HOST_INPUT_MOVE_TEST=1 npm run smoke      # 额外：+3px 挪一下再**挪回原位**（会看到光标抖一下）
 * ```
 *
 * 为什么要这个开关：`setCursorPos` 会真的移动玩家的鼠标 —— 自动化测试里默认不该做这种事
 * （emulator 侧的守卫也只做只读探测，见 app/amayui-emulator/test/native-host.test.ts）。
 *
 * ★平台差异只体现在"多测哪几项"，不是两套流程：win32 多测 `getSystemMetrics`/`getAsyncKeyState`，
 * darwin 多测 `isAccessibilityTrusted`（`postMouseMove` 只在 `AMAYUI_HOST_INPUT_POST_TEST=1` 且已授权时投一次，
 * 同样会先把光标挪回原位）。
 */

const host = require('..');

const line = (k, v) => console.log(`${k.padEnd(30)} ${typeof v === 'string' ? v : JSON.stringify(v)}`);

console.log('=== host_input 烟测 ===');
line('available', host.available);
line('supported', host.supported);
line('addonPath', host.addonPath);
line('platform/arch', `${host.platform}/${host.arch}`);
if (!host.available) line('reason', host.reason);

if (!host.supported) {
  console.log('\n（本平台没有实现 —— 属于预期：函数返回 null/false，调用方按"没有真实光标"降级）');
  process.exit(0);
}

const cur = host.getCursorPos();
const screen = host.getVirtualScreenRect();
line('getCursorPos()', cur);
line('getVirtualScreenRect()', screen);
if (process.platform === 'win32') {
  line('getSystemMetrics(SM_CXSCREEN=0)', host.getSystemMetrics(0));
  line('getSystemMetrics(SM_CYSCREEN=1)', host.getSystemMetrics(1));
  line('getAsyncKeyState(VK_LBUTTON=0x01)', host.getAsyncKeyState(0x01));
}
if (process.platform === 'darwin') {
  line('isAccessibilityTrusted()', host.isAccessibilityTrusted());
  line('getSystemMetrics(0)（本平台不存在）', host.getSystemMetrics(0)); // 门面兜成 null
}

if (process.env.AMAYUI_HOST_INPUT_MOVE_TEST === '1' && cur) {
  // ★读回的位置在 macOS 上可能是**小数**（触控板按亚像素累积），而 warp 落**整数点**（macOS 实现口径 5：
  // 小数会被四舍五入）⇒ 期望值按取整后的原点算，否则「挪到 x 再读回」会假红。
  const origin = { x: Math.round(cur.x), y: Math.round(cur.y) };
  const target = { x: origin.x + 3, y: origin.y + 3 };
  const ok = host.setCursorPos(target.x, target.y);
  const moved = host.getCursorPos();
  // ★无论成败都挪回原位：烟测不许把玩家的鼠标留在别处。
  const restored = host.setCursorPos(origin.x, origin.y);
  const back = host.getCursorPos();
  line('setCursorPos(+3,+3)', ok);
  line('  → getCursorPos()', moved);
  line('setCursorPos(原位)', restored);
  line('  → getCursorPos()', back);
  const reached = !!moved && Math.round(moved.x) === target.x && Math.round(moved.y) === target.y;
  const returned = !!back && Math.round(back.x) === origin.x && Math.round(back.y) === origin.y;
  console.log(`\n结论：setCursorPos ${reached ? '✅ 生效' : '❌ 未生效'}；复位 ${returned ? '✅' : '❌'}`);
  if (process.platform === 'darwin' && process.env.AMAYUI_HOST_INPUT_POST_TEST === '1') {
    const trusted = host.isAccessibilityTrusted();
    const posted = host.postMouseMove(target.x, target.y);
    line('postMouseMove(+3,+3)', `${posted}（授权=${trusted}）`);
    host.setCursorPos(origin.x, origin.y);
  }
  process.exit(reached && returned ? 0 : 1);
}

console.log('\n（只读烟测通过；加 AMAYUI_HOST_INPUT_MOVE_TEST=1 可验证真的能挪动光标）');
