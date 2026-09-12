/**
 * 回归测试：**纹理的销毁时机**（`0x1F8 create-texture` / `0x1FA release-texture` 换掉旧纹理时）。
 *
 * 症状（2026 实测，最终靠 `npm run shot` 的自动截图定位）：
 * **切到「角色设定」页后整屏只剩 Pixi 的背景色**，而 VM 照跑、日志里没有任何异常、
 * 切回别的页也不再恢复。
 *
 * 根因：Pixi 的 ticker 每帧自己 `app.render()`，而我们的 `present()` 只在 **VM 跑完一批指令之后**
 * 才重建舞台。于是 `create-texture`/`release-texture` 里当场 `texture.destroy(true)` 时，
 * **舞台上仍挂着上一帧引用该纹理的 Sprite** ⇒ 紧接着的一次 ticker 渲染去画已销毁的纹理
 * ⇒ WebGL 批次状态损坏且此后无法恢复（异常发生在 ticker 回调里，不在我们的调用栈上，所以日志空白）。
 *
 * 修法（两条，`TextureCache` 里）：
 *  1. **同尺寸的 `create-texture` 复用画布**（清空 + `source.update()`）——引擎语义是"新建空表面"，
 *     像素结果一致，但从根上少一次销毁/新建；
 *  2. 换尺寸 / `release-texture` 时把旧纹理推进 **`DestroyQueue`**，由 `present()` **之后**的
 *     `collectGarbage()` 统一销毁（那时舞台已经换成新纹理）。
 *
 * 本文件只用假对象测**队列语义**（销毁必须是"延迟 + 一次性 + 传 `destroy(true)`"）；
 * 真实像素由 `npm run shot` 做 E4 目视回归。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DestroyQueue } from '../src/renderer/pixi/textureCache.js';

/** 记录销毁调用的假纹理。 */
function fakeTex(log: string[], id: string): { id: string; destroy(d?: boolean): void } {
  return {
    id,
    destroy(d?: boolean) {
      log.push(`${id}:destroy(${String(d)})`);
    },
  };
}

test('DestroyQueue：push 不销毁，flush 才销毁且传 destroy(true)', () => {
  const log: string[] = [];
  const q = new DestroyQueue();
  q.push(fakeTex(log, 'a'));
  q.push(fakeTex(log, 'b'));
  assert.equal(q.size, 2, '入队后应可数');
  assert.deepEqual(log, [], '★ push 阶段绝不能真的销毁（舞台可能还引用着它）');
  assert.equal(q.flush(), 2, 'flush 返回销毁个数');
  assert.deepEqual(log, ['a:destroy(true)', 'b:destroy(true)'], '销毁要带上 destroySource=true');
  assert.equal(q.size, 0, 'flush 后队列清空');
  assert.equal(q.flush(), 0, '空队列 flush 返回 0（调用方据此决定要不要记日志）');
});

test('DestroyQueue：重复 flush 不会重复销毁（幂等）', () => {
  const log: string[] = [];
  const q = new DestroyQueue();
  q.push(fakeTex(log, 'x'));
  q.flush();
  q.flush();
  assert.deepEqual(log, ['x:destroy(true)'], '第二次 flush 不应再销毁');
});

test('TextureCache：待销毁计数初始为 0，collectGarbage 可安全空跑（Node 无 DOM）', async () => {
  const { TextureCache } = await import('../src/renderer/pixi/textureCache.js');
  const logs: string[] = [];
  const tc = new TextureCache((m) => logs.push(m));
  assert.equal(tc.pendingDestroyCount, 0);
  assert.equal(tc.collectGarbage(), 0);
  // Node 里没有 document ⇒ create/release 不会建画布，也就没有待销毁纹理（不抛错即可）
  tc.create(196, 628, 360, 0);
  tc.release(196);
  assert.equal(tc.pendingDestroyCount, 0);
  assert.equal(tc.collectGarbage(), 0);
});
