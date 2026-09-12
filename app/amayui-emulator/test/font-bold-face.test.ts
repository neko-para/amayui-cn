/**
 * **内置字体的「面」体检**：`Amayui CN` 必须是"真双面"（Regular + Bold），而不是同一份 Regular
 * 被登记两次 —— 后者会让 `i2bd/i2be`（`Font+218516` = 700/0）**静默失效**（见 `fontSet.ts` 的说明）。
 *
 * 本测试直接读 TTF 的 `name` / `OS/2` / `head` 表（不依赖浏览器），把 `docs/font-build.md`
 * §8.4「构建后必做」的校验固化成棘轮：
 *  - 族名/子族名与 `fontSet.ts` 的登记**对得上**（否则 Chrome/GDI 配不成一族的两面）；
 *  - Bold 面的 `usWeightClass=700` 且 `fsSelection.BOLD` 置位；
 *  - **OS/2 码页声明含 Shift-JIS 932**（§8.5.2 的坑：缺了它日文 locale 下字体枚举会漏掉这一面）；
 *  - Bold 面确实**更重**（用 glyf 点数近似：Bold 的轮廓点数应显著多于 Regular）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILTIN_FAMILIES, FONT_DIR, fontFileList } from '../src/text/fontSet.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');

/** 极简 TTF 解析：只需要 name / OS/2 / head / glyf+loca 的规模。 */
interface TtfFacts {
  names: Record<number, string>;
  weightClass: number;
  fsSelection: number;
  macStyle: number;
  codePage1: number;
  codePage2: number;
  glyphCount: number;
  /**
   * **全部字形的外接框面积之和**（Σ (xMax−xMin)·(yMax−yMin)，只算简单字形）。
   *
   * 用途：Bold 面的笔画更粗 ⇒ 字腔外扩、bbox 变大。同一基底的 Regular/Bold 两面，
   * 这个量有稳定的几个百分点差距（实测 +4.8%）——比"glyf 表字节数"可靠得多
   * （后者反而可能因为轮廓编码差异变小，早前的断言就是这样误报的）。
   */
  glyphBBoxArea: number;
}

function readTtf(file: string): TtfFacts {
  const b = fs.readFileSync(file);
  const u16 = (o: number): number => b.readUInt16BE(o);
  const u32 = (o: number): number => b.readUInt32BE(o);
  const tables = new Map<string, { off: number; len: number }>();
  const numTables = u16(4);
  for (let i = 0; i < numTables; i++) {
    const o = 12 + i * 16;
    tables.set(b.toString('ascii', o, o + 4), { off: u32(o + 8), len: u32(o + 12) });
  }
  const names: Record<number, string> = {};
  const name = tables.get('name');
  if (name) {
    const count = u16(name.off + 2);
    const strOff = name.off + u16(name.off + 4);
    for (let i = 0; i < count; i++) {
      const r = name.off + 6 + i * 12;
      const platform = u16(r);
      const lang = u16(r + 4);
      const nameId = u16(r + 6);
      const len = u16(r + 8);
      const off = u16(r + 10);
      // 只认 Windows/Unicode 平台的英文（0x409）记录：GDI/Chrome 用的就是这一条
      if (platform !== 3 || lang !== 0x409) continue;
      const raw = b.subarray(strOff + off, strOff + off + len);
      // ★必须拷贝再 swap16：Buffer.swap16() 是**就地**交换，同一段字符串会被多条记录复用
      //   （en/zh 两条记录 offset 相同）⇒ 不拷贝会把后续记录交换两次、解出乱码。
      names[nameId] = Buffer.from(raw).swap16().toString('utf16le');
    }
  }
  const os2 = tables.get('OS/2');
  const head = tables.get('head');
  const maxp = tables.get('maxp');
  const loca = tables.get('loca');
  const glyf = tables.get('glyf');
  if (!os2 || !head || !maxp || !loca) throw new Error(`${file}: 缺 OS/2 / head / maxp / loca 表`);
  const glyphCount = u16(maxp.off + 4);
  // 逐字形累加外接框面积（loca 的两种格式：head.indexToLocFormat 0=u16×2 / 1=u32）
  const longFormat = b.readInt16BE(head.off + 50) === 1;
  const locaOff = (i: number): number => (longFormat ? u32(loca.off + i * 4) : u16(loca.off + i * 2) * 2);
  let glyphBBoxArea = 0;
  if (glyf) {
    for (let gid = 0; gid < glyphCount; gid++) {
      const start = locaOff(gid);
      if (locaOff(gid + 1) <= start) continue; // 空字形
      if (b.readInt16BE(start) <= 0) continue; // 复合字形（无自有轮廓）
      const w = b.readInt16BE(start + 6) - b.readInt16BE(start + 2);
      const h = b.readInt16BE(start + 8) - b.readInt16BE(start + 4);
      if (w > 0 && h > 0) glyphBBoxArea += w * h;
    }
  }
  return {
    names,
    weightClass: u16(os2.off + 4),
    fsSelection: u16(os2.off + 62),
    macStyle: u16(head.off + 44),
    codePage1: u32(os2.off + 78),
    codePage2: u32(os2.off + 82),
    glyphCount,
    glyphBBoxArea,
  };
}

function fontPath(file: string): string {
  const p = path.join(ROOT, FONT_DIR, file);
  assert.ok(fs.existsSync(p), `内置字体文件不存在：${file}（${p}）`);
  return p;
}

test('★Amayui CN 是真双面：Regular(400) + Bold(700)，两文件不同且都带 932 码页声明', () => {
  const regular = readTtf(fontPath('Amayui-CN_cnjp.ttf'));
  const bold = readTtf(fontPath('Amayui-CN_cnjp-Bold.ttf'));

  // 1) 同一族的两面：family/typographic family 都是 Amayui CN，子族名区分 Regular/Bold
  //    （GDI 的字体枚举与 CSS 的 font-matching 都靠这一对配对）
  assert.equal(regular.names[1], 'Amayui CN');
  assert.equal(bold.names[1], 'Amayui CN');
  assert.equal(regular.names[16], 'Amayui CN');
  assert.equal(bold.names[16], 'Amayui CN');
  assert.equal(regular.names[2], 'Regular');
  assert.equal(bold.names[2], 'Bold');
  assert.equal(bold.names[17], 'Bold');
  assert.notEqual(regular.names[6], bold.names[6], 'PostScript 名必须不同（否则装机会互相覆盖）');

  // 2) 字重声明：Bold 面必须真的是 700/BOLD（不是把 Regular 改个名）
  assert.equal(regular.weightClass, 400);
  assert.equal(bold.weightClass, 700);
  assert.equal(regular.fsSelection & 0x20, 0, 'Regular 的 fsSelection.BOLD 不该置位');
  assert.equal(bold.fsSelection & 0x20, 0x20, 'Bold 的 fsSelection.BOLD 必须置位');
  assert.equal(bold.macStyle & 1, 1, 'Bold 的 head.macStyle.BOLD 必须置位');

  // 3) OS/2 码页声明（§8.5.2 的坑）：两面都要含 Shift-JIS 932，否则日文 locale 下会被枚举漏掉
  for (const [tag, f] of [
    ['Regular', regular],
    ['Bold', bold],
  ] as const) {
    assert.equal((f.codePage1 >>> 17) & 1, 1, `${tag} 面缺少 Shift-JIS(932) 码页声明`);
    assert.equal(f.codePage1, 0x603e019f, `${tag} 面 ulCodePageRange1 应与其他面一致`);
    assert.equal(f.codePage2, 0xdfd70000, `${tag} 面 ulCodePageRange2 应与其他面一致`);
  }

  // 4) 轮廓确实是"更重的一面"（同 glyph 数下外接框总面积明显更大），不是同一份轮廓改名
  assert.equal(bold.glyphCount, regular.glyphCount, '两面应来自同一基底（glyph 数一致）');
  assert.ok(
    bold.glyphBBoxArea > regular.glyphBBoxArea * 1.02,
    `Bold 面的字形外接框总面积应明显更大（粗笔画外扩）：bold=${bold.glyphBBoxArea} regular=${regular.glyphBBoxArea}`,
  );
});

test('★fontSet 的登记与磁盘文件一一对应：声明的每个面都存在，且 400/700 不共用同一文件', () => {
  const listed = fontFileList();
  for (const f of listed) fontPath(f.file); // 存在性
  for (const fam of BUILTIN_FAMILIES) {
    const w400 = fam.files[400];
    const w700 = fam.files[700];
    if (w400 && w700) assert.notEqual(w400, w700, `${fam.family}: 400/700 指向同一文件 ⇒ 粗体不会有视觉差别`);
  }
  const amayui = listed.filter((f) => f.family === 'Amayui CN').map((f) => `${f.weight}:${f.file}`);
  assert.deepEqual(amayui, ['400:Amayui-CN_cnjp.ttf', '700:Amayui-CN_cnjp-Bold.ttf']);
});
