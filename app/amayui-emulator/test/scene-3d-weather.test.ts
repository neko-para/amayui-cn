/** @tier T0 @kind core @subsystem render */

/**
 * ★★**3D 天气/粒子效果子系统**（审计 §4.2 #21 `scene-3d-weather-effects-rain-snow-leaf`，P1）
 * 与**每帧效果推进**（审计 §4.2 #18 `passive-camera-and-effect-render-state`，P1）。
 *
 * ## 引擎体（raw 锚点 = `engine/天结_unpacked.exe_utf8.c`）
 *
 * 管理器 = `Scene+50704`（`operator new(0x4F4)`，`sub_4530B0` raw 65345-65363；创建点
 * `sub_4A6EE0` raw 126541-126545）。三效果槽 `[258]` Rain / `[259]` Snow / `[260]` Leaf。
 *
 * **每帧推进 `sub_453540`（raw 65791-65839）** —— `#18` 的全部内容：
 * ```c
 * _this[312] = 0;                       // 本遍旗标
 * Time = timeGetTime();                 // ★墙钟
 * v5 = 60 * (Time - _this[314]);
 * v7 = 60 * (_this[313] - _this[314]) / 1000;
 * if (v5/1000 != v7) {
 *   v8 = v5/1000 - v7;
 *   if (v8 > 100) v8 = 100;             // ★★上限 100（raw 65816-65817）
 *   if (v8 > 0) do { [258]->vt+8; [259]->vt+8; [260]->vt+16; } while (--v9);   // ★三路各一次
 *   _this[313] = Time;
 * }
 * ```
 *
 * **销毁判据 `sub_4535F0`（raw 65890-65909）**：`key >= [+0x4D8]` ⇒ 释放 Rain；
 * `key >= [+0x4DC]` ⇒ 释放 Snow/Leaf（两个阈值由 `0x325` 写）。调用点 = `sub_4B06D0`
 * 的三表归并（raw 136903/136913/136924）与 `0x222`（137169/137208/137218）。
 *
 * ## 本轮做到哪 / 没做到哪（如实登记）
 *
 * **做了**：管理器 + 三槽 + 参数块 + 两个销毁阈值 + 旗标/时钟四格 + `sub_4535F0` 的销毁半边
 * + `sub_453540` 的**墙钟/上限 100/三路各推进一次**（三者全部逐字可断言）+ 一个确定性粒子场
 * （`weatherParticles`，让"推进之后状态确实变"可断言而不是空转）。
 *
 * **没做**（重开条件）：三个效果**对象本身**（`Rain`/`Snow`/`Leaf` 的 `operator new(0xE4)` +
 * vtable 体如 `sub_4B58C0`）：它们做的是 D3D 顶点缓冲填充 + `DrawPrimitive`。emulator 换成逐粒子
 * 点精灵，位置由时相 + 参数块重建（**不是**逐像素复刻）。重开条件 = 有真机 dump 可比对粒子轨迹。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newSceneState } from '../src/renderer/scene/state.js';
import {
  WEATHER_LEAF,
  WEATHER_MAX_STEPS,
  WEATHER_PARTICLE_COUNT,
  WEATHER_RAIN,
  WEATHER_SNOW,
  scSceneCommitRange,
  scWeatherCreate,
  scWeatherDestroyAll,
  scWeatherNodeKey,
  scWeatherSetDestroyThresholds,
  weatherCreate,
  weatherDestroyAll,
  weatherNodeKey,
  weatherParticles,
} from '../src/renderer/sceneModel.js';
import { HeadlessScene } from '../src/renderer/headlessScene.js';

test('★管理器形状：三槽（Rain/Snow/Leaf）+ 参数块 + 两个销毁阈值（`sub_4530B0`/`sub_4531B0`）', () => {
  const s = newSceneState();
  assert.equal(s.weather.slots.length, 3, '三路效果槽（`[258]`/`[259]`/`[260]`）');
  assert.deepEqual(
    s.weather.slots.map((x) => x.active),
    [false, false, false],
    '新建场景 = 三槽全空（`sub_4530B0` raw 65353-65355）',
  );
  assert.equal(s.weather.destroyRainAt, 0, '`[+0x4D8]` 初值 0');
  assert.equal(s.weather.destroyOthersAt, 0, '`[+0x4DC]` 初值 0');

  scWeatherCreate(s, WEATHER_RAIN, [1, 2, 3]);
  assert.equal(s.weather.slots[WEATHER_RAIN]!.active, true);
  assert.deepEqual(s.weather.slots[WEATHER_RAIN]!.params.slice(0, 3), [1, 2, 3], '16-dword 参数块原样保留');
  assert.equal(s.weather.slots[WEATHER_SNOW]!.active, false, '只建被点名的那一路');
});

test('★★开雨 ⇒ 推进 N 次后粒子状态**确实变**（#21/#18 的核心判据；修前恒不动）', () => {
  const s = newSceneState();
  scWeatherCreate(s, WEATHER_RAIN, [0, 1, 0]);
  const before = weatherParticles(s.weather);
  assert.ok(before.length > 0, '开了雨就有点可画（`WEATHER_PARTICLE_COUNT` 颗）');
  assert.equal(before.length, WEATHER_PARTICLE_COUNT);

  // 引擎每帧一次 `timeGetTime()`；这里注入虚拟时钟（headless 口径），1000ms ⇒ 60 步
  scWeatherSetClockForTest(s);
  scSceneCommitRange(s, 0);
  scSceneCommitRange(s, 1000);
  assert.equal(s.weather.slots[WEATHER_RAIN]!.phase, 60, '★1000ms ⇒ 60 步（60 步/秒）');
  const after = weatherParticles(s.weather);
  assert.notDeepEqual(after.slice(0, 20), before.slice(0, 20), '★粒子位置真的前进了（不是空转）');

  // 同一时刻重复推进 ⇒ 不再前进（"按时间推进"而不是"按调用次数推进"）
  scSceneCommitRange(s, 1000);
  assert.equal(s.weather.slots[WEATHER_RAIN]!.phase, 60, '时钟没走 ⇒ 不再推进');
});

test('★★上限 100 步/帧（raw 65816-65817：`if (v8 > 100) v8 = 100;`）', () => {
  const s = newSceneState();
  scWeatherCreate(s, WEATHER_RAIN, [0, 1, 0]);
  scWeatherSetClockForTest(s);
  scSceneCommitRange(s, 0);
  // 100 秒 = 6000 步，但一帧最多 100
  scSceneCommitRange(s, 100_000);
  assert.equal(s.weather.slots[WEATHER_RAIN]!.phase, WEATHER_MAX_STEPS, `★一帧最多 ${WEATHER_MAX_STEPS} 步`);
  assert.equal(WEATHER_MAX_STEPS, 100);
});

test('★`sub_4535F0` 的销毁判据：两个阈值各自一门（`0x325` 写；Rain 单独一门）', () => {
  const s = newSceneState();
  scWeatherCreate(s, WEATHER_RAIN, []);
  scWeatherCreate(s, WEATHER_SNOW, []);
  scWeatherCreate(s, WEATHER_LEAF, []);
  scWeatherSetDestroyThresholds(s, 100, 200);

  assert.deepEqual(scWeatherNodeKey(s, 50), [], '两门都未达 ⇒ 不销毁');
  assert.deepEqual(scWeatherNodeKey(s, 100), [WEATHER_RAIN], '`key >= [+0x4D8]` ⇒ 只销毁 Rain');
  assert.deepEqual(scWeatherNodeKey(s, 200), [WEATHER_SNOW, WEATHER_LEAF], '`key >= [+0x4DC]` ⇒ Snow + Leaf');
  assert.deepEqual(scWeatherNodeKey(s, 999), [], '★一次性：第二次调用不再重复释放（槽已空）');
  assert.deepEqual(scWeatherNodeKey(s, -1), [], '`key = -1`（帧级调用 raw 136828）⇒ 什么都不销毁');
});

test('★`0x324` 销毁全部效果 + 清旗标（`sub_453150` raw 65366-65394）', () => {
  const s = newSceneState();
  scWeatherCreate(s, WEATHER_RAIN, []);
  scWeatherCreate(s, WEATHER_SNOW, []);
  s.weather.advancedThisPass = true;
  scWeatherDestroyAll(s);
  assert.deepEqual(
    s.weather.slots.map((x) => x.active),
    [false, false, false],
  );
  assert.equal(s.weather.advancedThisPass, false, '`[312] = 0`（旗标清 0）');
});

test('★纯函数层与 SceneState 层同源（不是两份实现）', () => {
  const s = newSceneState();
  assert.equal(weatherCreate(s.weather, WEATHER_SNOW, [9]), true);
  assert.equal(s.weather.slots[WEATHER_SNOW]!.active, true);
  assert.deepEqual(weatherNodeKey(s.weather, 0), [WEATHER_SNOW], '阈值 0 ⇒ key 0 即命中');
  weatherDestroyAll(s.weather);
  assert.equal(s.weather.slots[WEATHER_SNOW]!.active, false);
});

test('★两个宿主每帧都推进同一个管理器（headless 走虚拟时钟；`advanceModel` 是唯一入口）', () => {
  const h = new HeadlessScene({});
  scWeatherCreate(h.scene, WEATHER_RAIN, [0, 1, 0]);
  h.advanceModel(0);
  h.advanceModel(1000);
  assert.equal(h.scene.weather.slots[WEATHER_RAIN]!.phase, 60, 'headless 的 advanceModel 也推进天气（共享实现）');
});

/** 把管理器时钟归零并让采样基线一致（等价"引擎刚构造完那一帧"）。 */
function scWeatherSetClockForTest(s: { weather: { lastAdvanceMs: number; lastSampleMs: number } }): void {
  s.weather.lastAdvanceMs = 0;
  s.weather.lastSampleMs = 0;
}
