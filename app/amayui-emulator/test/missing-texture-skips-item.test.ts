/** @tier T0 @kind ratchet @subsystem texture */

/**
 * ★★`tickets/T-0102` 轮 20：**"未配置纹理 ⇒ 引擎整笔忽略"** 的判据（引擎侧语义 + emulator 侧同构）。
 *
 * ## 这条规则是什么（引擎原文，不是推断）
 *
 * 用户在真机上用 inspector 量到 `global 0 = 1`（= 与 emulator 同值），但**真机 ADV 背景仍是黑**，
 * 于是提出：会不会引擎**允许**拿一个"没配纹理"的槽去画，并且**忽略整笔操作**？——**成立**：
 *
 * | 环节 | 引擎行为 | 证据（`engine/天结_unpacked.exe_utf8.c` raw） |
 * |---|---|---|
 * | **入队** | `0x1FB draw-texture` 的 handler `sub_422E70` **完全不校验槽**：只读操作数 + `sub_4ACE50(...)` 建绘制项 | 31271-31300（体内对槽表 `+42456` **零引用**） |
 * | **出画** | 渲染器 `sub_4A2D50` 取 `CTexture* = Scene[slot]`；为 0 ⇒ 打 `関数：DrawTexture エラー：描画元テクスチャが作成されていません． TEXTURE=%d` + `sub_4034D0` + **`return 0`**（**什么都不画**，且**没有替代纹理**） | 122952-122963 |
 * | **"报错"有多严重** | **不致命**：`sub_4034D0`→`sub_4976A0`（加脚本行号）→`sub_497620`→`sub_438CC0` = **`WriteFile` 到 `Error.log`**（`aErrorLog = "Error.log"`，`CreateFileA(..., OPEN_ALWAYS)` 追加）。不抛、不弹窗、不退出 | 45660-45667 / 45647-45656 / 4512 |
 * | **全引擎一致性** | 同型"未创建纹理 ⇒ 报一行 + 跳过"的串 **25+ 处**（Blend/Copy/Stretch/Fill/Blur/Mosaic/MonoTone/Mirror/Capture/SetClipRect/Set3DEffectSnow…）；`draw-string` 同口径 | 各 site；draw-string 68478-68480 |
 *
 * ⇒ **引擎没有"替代纹理/占位块"这个概念**。emulator 此前用 1×1 白占位块顶上 = 在"引擎什么都不画"
 * 的场合**多画一块白的** —— 这正是 `T-0102` 那一类"白底"的形状（15:XX 之前那批 E4 日志里
 * `未绑定纹理槽 → 占位块` 就是它）。
 *
 * ## 本测试钉什么
 *
 *  1. **引擎棘轮**：上面那三条引擎事实仍在（错误串 + 紧随的 `return 0`；错误汇是 `WriteFile`；入队 handler 不碰槽表）。
 *  2. **emulator 棘轮**：`presenter.itemSprite` 在"没有纹理"时 **`return null`**，且 `#placeholder` 已不存在
 *     （防有人"为了看得见"把它加回来 —— 那会重新引入这一整类假症状）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Container, Texture } from 'pixi.js';
import { ScenePresenter } from '../src/renderer/pixi/presenter.js';
import { TextureCache } from '../src/renderer/pixi/textureCache.js';
import { newSceneState } from '../src/renderer/scene/state.js';
import { scConfigureDrawItem } from '../src/renderer/scene/ops.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const ENGINE = path.join(ROOT, 'engine', '天结_unpacked.exe_utf8.c');
const PRESENTER = path.join(ROOT, 'app', 'amayui-emulator', 'src', 'renderer', 'pixi', 'presenter.ts');

test('★T-0102 引擎棘轮：`DrawTexture` 对没有纹理的槽「报一行 + return 0」（不画、无替代纹理）', () => {
  const c = fs.readFileSync(ENGINE, 'utf8');
  const needle = '関数：DrawTexture エラー：描画元テクスチャが作成されていません．';
  const at = c.indexOf(needle);
  assert.ok(at > 0, `反编译里应还有这条错误串（${needle}）`);
  // 同一处必须在**紧接着**的几行里 `return 0`（那就是"什么都不画"）—— 而不是继续用别的纹理接手
  const after = c.slice(at, at + 260);
  assert.ok(/return 0;/.test(after), '错误串之后必须紧跟 `return 0`（= 整笔放弃）');
  assert.ok(
    !/DrawTexture[\s\S]{0,600}(CreateTexture|Texture\.WHITE|default|fallback)/i.test(after),
    '这一段**不得**出现任何"替代/兜底纹理"的痕迹（引擎没有这个概念）',
  );

  // "报错"只是写日志，不是致命错：sub_4034D0 → sub_4976A0 → sub_497620 → sub_438CC0 = WriteFile
  const sink = c.indexOf('//----- (00438CC0)'); // ★用**定义**的分节线，不用原型声明（原型在前 400 字里没有 WriteFile）
  assert.ok(sink > 0, '应能找到错误汇 `sub_438CC0` 的定义');
  assert.ok(/WriteFile\(/.test(c.slice(sink, sink + 600)), '`sub_438CC0` 必须是 WriteFile（写日志），不是弹窗/退出');
  assert.ok(c.includes('"Error.log"'), '错误落点应是 `Error.log`（`aErrorLog`）');

  // 入队侧不校验槽：`sub_422E70`（0x1FB 的 handler）体里**不引用**槽表 `+42456`
  const h = c.indexOf('//----- (00422E70)'); // ★用定义的**分节线**（原型声明在文件前部，会切出一大段无关代码）
  assert.ok(h > 0, '应能找到 `draw-texture` 的 handler `sub_422E70` 的定义');
  const body = c.slice(h, c.indexOf('//----- (00422F80)', h));
  assert.ok(/sub_4ACE50\(/.test(body), 'handler 应把绘制项交给 `sub_4ACE50`');
  assert.ok(!body.includes('42456'), '★入队时**不校验**槽纹理（引擎把校验留到出画那一刻）');
});

test('★T-0102 行为守卫：槽没有纹理 ⇒ `itemSprite` 返回 null（整项不画，**不许有替代纹理**）', () => {
  // ★2026-09-23 重写（`tickets/T-0125`）：原版是对 `presenter.ts` **源码文本**的正则棘轮
  //   （认 `#placeholder(it: Item)` 这个签名、查日志文案、还要求分支注释里含 `raw 122952`）——
  //   改名/重构即假红，而"把白占位块换个名字塞回来"可能假绿。现在断**行为**：
  //   引擎的判据是「槽解析不到纹理 ⇒ 整笔不画」（raw 122952-122963 的 `return 0`），
  //   emulator 的对应物就是 `ScenePresenter.itemSprite(...) === null`。
  //
  // ★自带**反面控制**：把同一个槽绑上图之后必须立刻画得出来 ⇒ 上一条"返回 null"不可能是恒真。
  const root = new Container();
  const cache = new TextureCache(() => {});
  // 刻意**不**绑槽 3（引擎里 `CTexture* = 0` ⇒ DrawTexture 报错 + return 0，无替代纹理）
  const presenter = new ScenePresenter(root, cache, Texture.WHITE, () => {}, 1280, 720);
  const scene = newSceneState();
  scConfigureDrawItem(scene, {
    handle: 0x100, layer: 101000, tex: 3, srcX: 0, srcY: 0, srcW: 8, srcH: 8, dstX: 0, dstY: 0,
  });
  const it = [...scene.drawItems.values()][0]!;
  assert.equal(
    presenter.itemSprite(scene, it, 0, 'normal'),
    null,
    '★槽没有纹理 ⇒ 整项不画（不是白色占位块；引擎没有"替代纹理"这个概念）',
  );
  // 反面控制：绑上图 ⇒ 必须画得出来（否则"返回 null"可能是因为别的原因，这条守卫就没有判别力）
  cache.slotTex.set(3, Texture.WHITE);
  assert.ok(presenter.itemSprite(scene, it, 0, 'normal'), '绑上纹理后必须返回精灵（证明上一条不是恒真）');
});

