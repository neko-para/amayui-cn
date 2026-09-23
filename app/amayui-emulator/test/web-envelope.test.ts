/** @tier T0 @kind core @subsystem host */

/**
 * **web 信封线格式守卫**（`tickets/T-0134` Phase 2）—— `src/web/envelope.ts`。
 *
 * 这条格式是"浏览器宿主"与"Node 宿主"之间唯一的字节协议：它错一位，症状会离现场很远
 * （图像花屏、字体损坏、存档解不开）⇒ 边界与畸形输入都要在这里钉死。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_SEGMENTS,
  decodeEnvelope,
  encodeEnvelope,
  formatMeta,
  parseMeta,
} from '../src/web/envelope.js';

test('★单段往返：字节与长度都不变（图像/音频/字体/脚本的常见形态）', () => {
  const src = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 255]);
  const out = decodeEnvelope(encodeEnvelope([src]));
  assert.equal(out.length, 1);
  assert.deepEqual(Array.from(out[0]!), Array.from(src));
});

test('★多段往返：段边界不串（`readSaveDataBoth` 那种"一次两份"）', () => {
  const a = new Uint8Array([1, 2, 3]);
  const b = new Uint8Array([]);
  const c = new Uint8Array([9]);
  const out = decodeEnvelope(encodeEnvelope([a, b, c]));
  assert.equal(out.length, 3);
  assert.deepEqual(Array.from(out[0]!), [1, 2, 3]);
  assert.equal(out[1]!.length, 0);
  assert.deepEqual(Array.from(out[2]!), [9]);
});

test('★零段合法（"读不到"也要有回应；不能靠"空 body"表达）', () => {
  const out = decodeEnvelope(encodeEnvelope([]));
  assert.equal(out.length, 0);
});

test('★`number[]` 入参按同一口径编码（与 `Uint8Array` 等价）', () => {
  const a = encodeEnvelope([[1, 2, 3]]);
  const b = encodeEnvelope([new Uint8Array([1, 2, 3])]);
  assert.deepEqual(Array.from(a), Array.from(b));
});

test('★畸形输入必须抛错（半懂的信封比失败更坏）', () => {
  // 太短
  assert.throws(() => decodeEnvelope(new Uint8Array([])), /信封太短/);
  assert.throws(() => decodeEnvelope(new Uint8Array([0, 0, 0])), /信封太短/);
  // 段数越界
  const tooMany = new Uint8Array(4);
  new DataView(tooMany.buffer).setUint32(0, MAX_SEGMENTS + 1, false);
  assert.throws(() => decodeEnvelope(tooMany), /段数过多/);
  // 长度前缀越界
  assert.throws(() => decodeEnvelope(new Uint8Array([0, 0, 0, 1, 0, 0])), /长度前缀越界/);
  // 段体截断
  assert.throws(() => decodeEnvelope(new Uint8Array([0, 0, 0, 1, 0, 0, 0, 9, 1, 2])), /截断/);
  // 尾部多余
  assert.throws(() => decodeEnvelope(new Uint8Array([0, 0, 0, 1, 0, 0, 0, 1, 7, 7])), /多余/);
});

test('★编码端也拦段数（不能只靠解码端防守）', () => {
  const many = Array.from({ length: MAX_SEGMENTS + 1 }, () => new Uint8Array([1]));
  assert.throws(() => encodeEnvelope(many), /段数过多/);
});

test('★长度按 big-endian（跨端一致性：不能用平台字节序）', () => {
  const buf = encodeEnvelope([new Uint8Array([0xaa, 0xbb])]);
  // [00000001][00000002][aabb]
  assert.deepEqual(Array.from(buf), [0, 0, 0, 1, 0, 0, 0, 2, 0xaa, 0xbb]);
});

test('★元数据头：URL 编码的 JSON 往返；坏输入当"没有元数据"而不是抛', () => {
  const meta = { name: 'SO020.AGF', width: 1280, height: 720, index: 3 };
  assert.deepEqual(parseMeta(formatMeta(meta)), meta);
  assert.deepEqual(parseMeta(null), {});
  assert.deepEqual(parseMeta('%7Bnot json'), {});
  assert.deepEqual(parseMeta(encodeURIComponent('[1,2]')), {}); // 数组不是对象 ⇒ 当没有
});

test('★`subarray` 视图（非零 byteOffset）也能解码（响应 body 可能是切片）', () => {
  const full = encodeEnvelope([new Uint8Array([1, 2, 3])]);
  const padded = new Uint8Array(full.length + 5);
  padded.set(full, 3);
  const slice = padded.subarray(3, 3 + full.length);
  assert.notEqual(slice.byteOffset, 0);
  assert.deepEqual(Array.from(decodeEnvelope(slice)[0]!), [1, 2, 3]);
});
