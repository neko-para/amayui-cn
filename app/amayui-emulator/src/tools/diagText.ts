/**
 * **文本可见性诊断**（`npm run diag:text`）—— 回答"为什么画面上没有字"。
 *
 * 为什么需要它：文本渲染的失败**几乎全是静默的**（无异常、无控制台错误），可能的原因分布在
 * VM → 模型 → 层序 → 光栅化四个层次。本工具在 Node 里跑**真实链路**（与 E3 回归共用
 * `src/tools/config1Chain.ts`），把每一层的可观测证据一次打出来：
 *
 *  1. **链路**：走到哪个脚本 / 有没有未实现 opcode；
 *  2. **模型**：文本窗有几个、各自几何/层序/行数/字数；
 *  3. **层序**：有没有更高层的图元与文本框相交（**会盖住文字**）；
 *  4. **快照**：`npm run report` 里那段人可读的文本行。
 *
 * 浏览器侧独有的两层（字体注册 / 光栅化）无法在 Node 里查，工具会在末尾列出对应的
 * 排查入口（`.tmp/amayui-emulator.log` 的 `[font]` / `[text]` 日志）。
 */
import { runConfig1Chain } from './config1Chain.js';

/** 与 `TextLayer` 一致的回退层序（`TEXT_LAYER_BASE + win`）。 */
const TEXT_LAYER_BASE = 20;

function line(ch = '─'): void {
  console.log(ch.repeat(72));
}

async function main(): Promise<void> {
  line('═');
  console.log('文本可见性诊断（真实链路：SYSTEM4 → LOGO → TITLE → CONFIG → CONFIG1）');
  line('═');

  const t0 = Date.now();
  const r = await runConfig1Chain();
  console.log(`链路：${r.script}（${Date.now() - t0}ms）`);
  console.log(`未实现 opcode：${r.unimplemented.length === 0 ? '无 ✓' : r.unimplemented.join(', ')}`);
  console.log(`图元：${r.itemCounts.drawItems} 个（可绘制 ${r.itemCounts.drawable}）`);
  console.log(`文本窗模型：见下（窗 9 = CONFIG 的字体预览窗）`);
  line();

  const w = r.sampleWin;
  if (!w) {
    console.log('✗ 从没出现过有内容的文本窗 —— 问题在 VM/模型层，不在渲染：');
    console.log('  1) 链路是否真的走到 CONFIG1？（上面那行"链路："）');
    console.log('  2) CONFIG1.txt:2916-2932 的 i071/show-text/display-furigana 是否被执行？');
    console.log('     ⇒ 用 `npm run report` + 控制窗的「定向 trace」（opcode 白名单 71,6e,6f,196）确认');
    process.exitCode = 1;
    return;
  }

  const layer = w.itemId > 0 ? w.itemId : TEXT_LAYER_BASE + 9;
  console.log('窗 9 排版结果：');
  console.log(`  屏幕位置/尺寸 : (${w.rect.x},${w.rect.y}) ${w.rect.w}×${w.rect.h}`);
  console.log(`  层序          : ${layer}${w.itemId > 0 ? '（= 0x213 写的 win+104）' : '（⚠ 回退值：脚本没调 0x213，会被普通图元盖住）'}`);
  console.log(`  流向/对齐     : 横排（引擎排版恒横向）align=${w.align}`);
  console.log(`  0x261 标志    : vertical=${w.vertical ? 1 : 0}（★只记录、不参与排版：排版例程不读 Font+235108）`);
  console.log(`  字号/字重     : main=${w.mainSize}px weight=${w.mainWeight} ruby=${w.rubySize}px`);
  console.log(`  字族          : main="${w.mainFamily}" ruby="${w.rubyFamily}"（引擎 0x1A5/0x2FE 的解析结果）`);
  console.log(`  颜色          : 填充 ${w.mainFill} / 描边 ${w.mainOutline}`);
  console.log(`  描边档位/偏移 : mode=${w.outlineMode} dx=${w.outlineDx} dy=${w.outlineDy}`);
  console.log(`  底色          : ${w.background ?? '（无：透明）'}`);
  console.log(`  行数/字数     : ${w.lines.length} 行 / ${w.glyphCount} 字`);
  for (const [i, l] of w.lines.entries()) console.log(`    [${i}] w=${l.width} 字=${l.glyphs} 注音=${l.ruby} | ${l.text}`);
  line();

  console.log('层序检查（文字会不会被盖住）：');
  if (r.coveredBy.length === 0) {
    console.log('  ✓ 没有层序更高、且与文本框相交的图元');
  } else {
    console.log(`  ✗ ${r.coveredBy.length} 个更高层图元与文本框相交 ⇒ 文字会被盖住（视觉上"什么都没有"）：`);
    for (const c of r.coveredBy.slice(0, 10)) {
      console.log(`    layer=${c.layer} handle=0x${c.handle.toString(16)} dst=(${c.dst.x},${c.dst.y}) ${c.size.w}×${c.size.h} ${c.color}`);
    }
    console.log('  ⇒ 期望的层序来自 opcode 0x213（`i213 <win> <id基> <个数>`）；若为回退值说明脚本没设过。');
    process.exitCode = 1;
  }
  line();

  console.log('快照片段（`npm run report` 里能看到的部分）：');
  const snapLines = r.snapshotText.split('\n');
  const at = snapLines.findIndex((x) => x.includes('text win=9'));
  for (const l of at >= 0 ? snapLines.slice(at, at + 6) : ['（快照里没有 win=9 的文本行）']) {
    console.log('  ' + l);
  }
  line('═');
  console.log('浏览器侧才能查的两层（Node 里没有 DOM/Pixi）：');
  console.log('  1) 字体是否注册成功 → `.tmp/amayui-emulator.log` 里的 `[font] 内置字族就绪 N/M`');
  console.log('     失败会回退浏览器默认字体（**仍会画出字**，只是字形不同 ⇒ 不会表现为"什么都没有"）');
  console.log('  2) 纹理是否建立/上屏 → 同日志里的：');
  console.log('       `[msgwin] win=9 … N 行 M 字 竖排 30px`   ← VM 发布了内容');
  console.log('       `[text] win=9 layer=180500 N 行 M 字 → 纹理 WxH @(x,y)` ← 光栅化并建了纹理');
  console.log('     两条都缺 ⇒ 看 VM 侧；只有第一条 ⇒ 看 raster/fontLoader；两条都有但仍无字 ⇒ 看层序/alpha');
  line('═');
}

await main();
