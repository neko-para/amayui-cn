'use strict';
/**
 * 烟测：**默认只读**（不动用户的光标），要验证"真能挪动"时显式开环境变量：
 *
 * ```
 * npm run smoke                                  # 只读：加载状态 / 光标 / 虚拟屏 / 键态
 * AMAYUI_WIN32_INPUT_MOVE_TEST=1 npm run smoke   # 额外：+3px 挪一下再**挪回原位**（会看到光标抖一下）
 * ```
 *
 * 为什么要这个开关：`setCursorPos` 会真的移动玩家的鼠标 —— 自动化测试里默认不该做这种事
 * （emulator 侧的守卫也只做只读探测，见 app/amayui-emulator/test/native-win32.test.ts）。
 */

const w32 = require('..');

const line = (k, v) => console.log(`${k.padEnd(22)} ${typeof v === 'string' ? v : JSON.stringify(v)}`);

console.log('=== win32_input 烟测 ===');
line('available', w32.available);
line('supported', w32.supported);
line('addonPath', w32.addonPath);
line('platform/arch', `${w32.platform}/${w32.arch}`);
if (!w32.available) line('reason', w32.reason);

if (!w32.supported) {
  console.log('\n（本平台没有实现 —— 属于预期：函数返回 null/false，调用方按"没有真实光标"降级）');
  process.exit(0);
}

const cur = w32.getCursorPos();
line('getCursorPos()', cur);
line('getVirtualScreenRect()', w32.getVirtualScreenRect());
line('getSystemMetrics(SM_CXSCREEN=0)', w32.getSystemMetrics(0));
line('getSystemMetrics(SM_CYSCREEN=1)', w32.getSystemMetrics(1));
line('getAsyncKeyState(VK_LBUTTON=0x01)', w32.getAsyncKeyState(0x01));

if (process.env.AMAYUI_WIN32_INPUT_MOVE_TEST === '1' && cur) {
  const target = { x: cur.x + 3, y: cur.y + 3 };
  const ok = w32.setCursorPos(target.x, target.y);
  const moved = w32.getCursorPos();
  // ★无论成败都挪回原位：烟测不许把玩家的鼠标留在别处。
  const restored = w32.setCursorPos(cur.x, cur.y);
  const back = w32.getCursorPos();
  line('setCursorPos(+3,+3)', ok);
  line('  → getCursorPos()', moved);
  line('setCursorPos(原位)', restored);
  line('  → getCursorPos()', back);
  const reached = !!moved && moved.x === target.x && moved.y === target.y;
  const returned = !!back && back.x === cur.x && back.y === cur.y;
  console.log(`\n结论：setCursorPos ${reached ? '✅ 生效' : '❌ 未生效'}；复位 ${returned ? '✅' : '❌'}`);
  process.exit(reached && returned ? 0 : 1);
}

console.log('\n（只读烟测通过；加 AMAYUI_WIN32_INPUT_MOVE_TEST=1 可验证真的能挪动光标）');
