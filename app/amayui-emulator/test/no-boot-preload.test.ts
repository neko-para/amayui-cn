/** @tier T0 @kind ratchet @subsystem frame */

/**
 * `T-0029` 守卫：**启动期预载清单必须消失，且"首帧不缺图"由帧屏障负责**。
 *
 * ## 为什么要删（票面四条理由，读一遍就知道该钉什么）
 * `boot.ts` 曾有 `const PRELOAD_IMAGES = [0x5245, 0x5246, 0x5272, 0x5273]` + 一张张 `await native.preloadImage`：
 *  ① **没有引擎依据** —— 引擎启动流程里没有这份清单；图的正统路径是脚本 `0x1F9 set-texture` →
 *     `PixiBackend.bindTexture` → `TextureCache.bind`（未命中即异步装载）→ 帧末 `texturesIdle` 屏障；
 *  ② **两宿主漂移** —— headless（`bootHeadless`/两份 chain/scenario）从不预载，只有 Electron 预载
 *     ⇒ 同一份脚本在两边"图文就绪时机"不同；
 *  ③ **白付启动成本**（`SO004.AGF` 1664×1536 无条件解码）；
 *  ④ **掩盖缺陷** —— "异步装载 ⇒ 紧随的 `0x208` 读到 0×0"会被预载盖住。
 *
 * ## 本守卫锁四件事
 *  ① 源码里**没有**预载清单（常量/数组/循环都算）；
 *  ② `preloadImage` 的调用点只剩**按需路径**（`TextureCache` 内部 + `PixiBackend` 的转发缝），
 *     不许出现"启动时遍历一张表"的新写法；
 *  ③ 帧屏障**真的存在且被合成路径等待**（`texturesIdle` 在 present 之前被 await）——
 *     这是"删了预载也不缺帧"的唯一依据；
 *  ④ 按需装载的语义没被顺手改掉（`bind` 未命中缓存时仍发起异步装载）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// ★剥注释/字符串的**唯一真源**：与死写闸门（`check:dead-writes`）共用同一个扫描器 ——
//   自造一个"够用"的行注释剥离会在块注释上假红（本守卫第一版就是这么红的：boot.ts 的**说明注释**里
//   提到了被删掉的清单，被当成"清单还在"）。
import { stripCommentsAndStrings } from '../src/tools/deadWrites.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, '..', 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

const FILES = walk(SRC).map((p) => ({
  rel: path.relative(SRC, p).replace(/\\/g, '/'),
  abs: p,
  src: fs.readFileSync(p, 'utf8'),
}));

/** 代码视图（剥注释与字符串字面量；保留行结构）。 */
const code = (s: string): string => stripCommentsAndStrings(s);

test('★T-0029 ①：源码里没有启动期预载清单（`PRELOAD_IMAGES` / 那张 imgid 表）', () => {
  const bad: string[] = [];
  for (const f of FILES) {
    const c = code(f.src);
    if (/PRELOAD_IMAGES/.test(c)) bad.push(`${f.rel}: 仍有 PRELOAD_IMAGES`);
    // 启动期预载的形态：一张 3 个以上 imgid 的字面量数组
    if (/\[\s*0x5[0-9a-f]{3}\s*,\s*0x5[0-9a-f]{3}\s*,\s*0x5[0-9a-f]{3}/i.test(c)) {
      bad.push(`${f.rel}: 出现"3 个以上 imgid 的字面量数组"（像预载清单）`);
    }
  }
  assert.deepEqual(bad, [], `启动期预载清单又长回来了（T-0029）：\n  ${bad.join('\n  ')}`);
});

test('★T-0029 ②：`preloadImage` 的调用点只剩按需路径（`TextureCache` 内部 + `PixiBackend` 转发缝）', () => {
  const allowed = new Set([
    'renderer/pixi/textureCache.ts', // 实现 + bind/size 的按需触发
    'renderer/pixiBackend.ts', // 转发缝（NativeBridge 的 preloadImage）
  ]);
  const bad: string[] = [];
  for (const f of FILES) {
    if (allowed.has(f.rel)) continue;
    const c = code(f.src);
    if (/\bpreloadImage\s*\(/.test(c) && !/preloadImage\??\s*\(/.test(c.split('\n').find((l) => l.includes('preloadImage')) ?? '')) {
      // 只有"调用"才算（接口声明/类型转发不算）
    }
    if (/\bvoid\s+this\.preloadImage|await\s+native\.preloadImage|await\s+[a-zA-Z.]*\.preloadImage\s*\(/.test(c)) {
      bad.push(`${f.rel}: 出现了对 preloadImage 的**主动调用**（按需路径之外的新入口）`);
    }
  }
  assert.deepEqual(bad, [], `按需装载之外又长出加载入口（T-0029 的 ①/④ 就是被这么掩盖的）：\n  ${bad.join('\n  ')}`);
});

test('★T-0029 ③：纹理帧屏障存在，且**合成路径在 present 之前等它**（删预载的唯一兜底）', () => {
  const tc = FILES.find((f) => f.rel === 'renderer/pixi/textureCache.ts');
  assert.ok(tc, 'textureCache.ts 必须在');
  assert.match(tc.src, /async waitIdle\(/, 'TextureCache.waitIdle 必须存在（等在途装载）');

  const pixi = FILES.find((f) => f.rel === 'renderer/pixiBackend.ts');
  assert.ok(pixi, 'pixiBackend.ts 必须在');
  assert.match(pixi.src, /texturesIdle/, 'PixiBackend 必须有 texturesIdle 缝（宿主等待纹理就绪）');

  const session = FILES.find((f) => f.rel === 'renderer/app/session.ts');
  assert.ok(session, 'session.ts 必须在');
  const s = code(session.src);
  const idxBarrier = s.indexOf('texturesIdle');
  assert.ok(idxBarrier >= 0, '★产品合成路径必须在 present 之前 await texturesIdle');
  // 屏障必须在 present 调用**之前**出现（顺序反了就等于没等）
  const idxPresent = s.indexOf('present(');
  assert.ok(
    idxPresent < 0 || idxBarrier < idxPresent,
    '★`texturesIdle` 必须排在 `present(` 之前（顺序反了 ⇒ 首帧照样缺图，预载就是被这么"需要"的）',
  );
});

test('★T-0029 ④：按需装载的语义没被改掉 —— `bind` 未命中缓存时仍发起异步装载', () => {
  const tc = FILES.find((f) => f.rel === 'renderer/pixi/textureCache.ts')!;
  const s = code(tc.src);
  const bindAt = s.indexOf('bind(imgid: number, slot: number)');
  assert.ok(bindAt >= 0, 'bind 必须存在');
  const body = s.slice(bindAt, bindAt + 1600);
  assert.match(body, /preloadImage\(imgid\)/, '★`bind` 未命中缓存时必须发起按需装载（这是删预载后的唯一入口）');
  assert.match(body, /onReady/, '装载到货必须通知宿主置脏（T-0102 的 H4；否则白占位块会留在屏上）');
});
