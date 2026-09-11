/**
 * **纹理帧屏障回归**（`TextureCache.waitIdle` + `PixiBackend.texturesIdle`）。
 *
 * 引擎的 `set-texture`(0x1F9 → `sub_422CB0` → `sub_4559C0`) 是**同步**读文件 + 解码：
 * 指令返回时图像已在内存 ⇒ 同一帧"绑定 + 画"必然一致。
 * renderer 侧走 `window.api.image()` 的 IPC 异步加载 ⇒ 若不设屏障，会出现
 * 「新一屏的文本已经出现、背景还没切换」（2026 实测：首次从主界面进设置时 ADV 样例先出现）。
 *
 * 本测试只碰 `TextureCache` 的纯逻辑（不接 Pixi/DOM）：`window.api.image` 用可控 promise 顶替，
 * 且返回 `null`（跳过 `rgbaToTexture` 那条 DOM 路径）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TextureCache } from '../src/renderer/pixi/textureCache.js';

/** 装一个可控的 `window.api.image`：每次调用都挂在一个手动 resolve 的闸门上。 */
function stubWindow(): { release: () => void; calls: number[] } {
  const gates: Array<() => void> = [];
  const calls: number[] = [];
  const api = {
    image: (imgid: number): Promise<null> => {
      calls.push(imgid);
      return new Promise<null>((resolve) => {
        gates.push(() => resolve(null));
      });
    },
  };
  (globalThis as unknown as { window: unknown }).window = { api };
  return {
    release: (): void => {
      for (const g of gates.splice(0)) g();
    },
    calls,
  };
}

test('★帧屏障：bind 触发的载入计入 inflight，waitIdle 等它结束（不让背景缺帧）', async () => {
  const w = stubWindow();
  try {
    const logs: string[] = [];
    const cache = new TextureCache((m) => logs.push(m));
    cache.bind(0x1d4c0, 0xc0); // set-texture：背景图
    assert.equal(cache.pendingCount, 1, 'bind 应立即登记在途载入');
    assert.equal(cache.slotTex.has(0xc0), false, '载入未完成 ⇒ 槽里还没有纹理（这正是"背景没切换"的来源）');

    let done = false;
    const wait = cache.waitIdle().then(() => {
      done = true;
    });
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(done, false, 'waitIdle 必须等载入结束才放行本帧合成');

    w.release();
    await wait;
    assert.equal(done, true, '载入结束后放行');
    assert.equal(cache.pendingCount, 0);
    assert.deepEqual(w.calls, [0x1d4c0], '同一个 imgid 只载一次（幂等）');
  } finally {
    delete (globalThis as unknown as { window?: unknown }).window;
  }
});

test('★帧屏障：无在途载入时立即放行（热路径不 await）', async () => {
  const cache = new TextureCache(() => {});
  assert.equal(cache.pendingCount, 0);
  let done = false;
  await cache.waitIdle().then(() => {
    done = true;
  });
  assert.equal(done, true);
});

test('★帧屏障：载入异常也必须放行（不能让帧循环挂死）', async () => {
  (globalThis as unknown as { window: unknown }).window = {
    api: {
      image: (): Promise<null> => Promise.reject(new Error('IPC 断了')),
    },
  };
  try {
    const logs: string[] = [];
    const cache = new TextureCache((m) => logs.push(m));
    cache.bind(0x51cd, 0xc1);
    await cache.waitIdle();
    assert.equal(cache.pendingCount, 0, '失败也要从在途表里摘掉');
    assert.ok(
      logs.some((l) => l.includes('fail')),
      `失败应记日志（实际 ${JSON.stringify(logs)}）`,
    );
  } finally {
    delete (globalThis as unknown as { window?: unknown }).window;
  }
});
