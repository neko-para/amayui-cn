/**
 * **`SYSTEM4 → … → TITLE → CONFIG → CONFIG1` 路径的指令盘点**（`npm run op:inventory`）。
 *
 * 回答的问题：**这条路径上，哪些指令"没完全实现"，其中哪些涉及图像渲染 / 文字输出？**
 *
 * 为什么要有它：`report.ts` 只看**单个脚本**（且用固定时钟空跑），看不到"跨脚本的真实链路"；
 * 而"某个 UI 元素画不出来"的排查，第一步永远是**先列出这条路走过哪些指令、各自什么状态**。
 * 没有这份清单就只能靠猜（历史上就是这样错过 `0x1FD` 的：它被登记成"已实现"，
 * 实际只是把参数转发给宿主、渲染端只记一行日志）。
 *
 * 输出三张表：
 *  1. **指令表**：执行到的 opcode → handler 来源（implemented / native / engine-internal）、次数、出现的脚本、
 *     实参样例、以及「闸门 B」缺口次数（被当 no-op 跳过却收到非平凡实参）；
 *  2. **宿主未实现（闸门 A）**：`NativeBridge` 方法被调用但宿主没有实现 ⇒ 调用被静默丢弃；
 *  3. **渲染 / 文字候选**：按 opcode-table 的家族归类，把"图像渲染/文字输出"相关且**非全实现**的挑出来，
 *     附上"缺了会怎样"的一句话，便于直接排优先级。
 *
 * 判据（与 `src/vm/interpreter.ts` 一致）：
 *  - `handlerKind !== 'implemented'`（native / engine-internal）不必然是缺陷 —— `native` 里既有真实现
 *    （0x1FB draw-texture）也有纯记录桩（0x204 draw-string）；`engine-internal` 是"确认对 VM 不可观测"的跳过。
 *    所以本工具**只列事实**（来源 + 实参 + 是否丢弃），定性在最后一张表里按引擎语义给出。
 */
import { runConfig1Chain } from './config1Chain.js';
import { OPS, NATIVE_OPS, ENGINE_INTERNAL_OPS } from '../vm/ops.js';
import type { StepTrace } from '../vm/interpreter.js';

interface Row {
  opcode: number;
  name: string;
  kind: string;
  count: number;
  scripts: Set<string>;
  sample: string;
  gaps: number;
  gapSample: string;
}

/** 渲染 / 文字输出相关的 opcode 家族（据 `docs-new/03-engine/opcode-table.md` 归类）。 */
const RENDER_TEXT = new Map<number, string>([
  [0x1f6, '清空绘制容器'],
  [0x1f7, 'detach-texture（删绘制项区间）'],
  [0x1f8, 'create-texture（程序化纹理）'],
  [0x1f9, 'set-texture（唯一纹理绑定）'],
  [0x1fa, 'release-texture'],
  [0x1fb, 'draw-texture（唯一的图元绘制）'],
  [0x1fc, '复位图元变换'],
  [0x1fd, '立即缩放（work 矩阵）'],
  [0x1fe, '图元/纹理变换（4 浮点）'],
  [0x1ff, 'DrawItem 像素平移'],
  [0x202, 'set-draw-color'],
  [0x203, 'set-draw-color-alpha'],
  [0x204, 'draw-string（GDI 直绘文本）'],
  [0x205, 'GDI 数字文本绘制'],
  [0x207, '槽→槽 StretchRect 拷贝'],
  [0x208, '纹理尺寸 getter'],
  [0x20b, '纯色+α 矩形填充'],
  [0x20c, '绘图帧控制'],
  [0x20e, '图形提交'],
  [0x20f, 'play-movie'],
  [0x217, '绘制项 pivot'],
  [0x218, '绘制项 pivot getter'],
  [0x219, '绘制项描画位置'],
  [0x21a, '绘制项描画位置 getter'],
  [0x21e, '缩放动画窗'],
  [0x21f, '旋转动画窗'],
  [0x220, '平移动画窗'],
  [0x239, 'flipbook 窗'],
  [0x23b, 'CG 数字条'],
  [0x320, 'create-mesh'],
  [0x322, 'mesh 顶点色'],
  [0x323, 'mesh 顶点色窗'],
  [0x32f, 'D3D 灯光开关'],
  [0x340, '渲染状态下发'],
  [0x341, 'L2D 模型加载'],
  [0x342, 'L2D 实例槽销毁'],
  [0x344, '纹理槽变换'],
  [0x345, '图形模型加载'],
  [0x346, '变换复位'],
  [0x347, '缩放'],
  [0x348, '缩放+汇总'],
  [0x349, '平移'],
  [0x34a, '基础平移偏移'],
  [0x34e, '图形模型加载'],
  [0x352, 'L2D 槽参数'],
  [0x70, '消息窗几何'],
  [0x71, '消息窗开始新段'],
  [0x73, '字格 + 逐字节拍'],
  [0x74, '消息速度（字段）'],
  [0x75, '主字号'],
  [0x79, '文字起点'],
  [0x196, 'display-furigana 注音'],
  [0x197, '注音字号'],
  [0x198, '窗位置'],
  [0x1a5, '主面名'],
  [0x1c1, '换行边界'],
  [0x1ce, '逐字显现开关'],
  [0x260, '竖排矩形'],
  [0x2bd, '加粗'],
  [0x2be, '加粗'],
  [0x2fe, '注音面名'],
  [0x300, '消息窗逐行贴出闸门'],
  [0x301, '消息窗槽清场'],
  [0x303, '对齐'],
  [0x6e, 'show-text'],
  [0x6f, 'end-text-line'],
  [0x204, 'draw-string'],
]);

/** 已知"来源非 implemented"时的定性（缺了会怎样）；没登记的就是"需要人读一眼"。 */
const QUALITATIVE = new Map<number, string>([
  [0x204, '★纯记录桩：字符串被丢给宿主 hander 未实现 ⇒ **这 9 次文本一行都不会画出来**（CONFIG1 右侧说明条画进槽 196）'],
  [0x20f, '桩：影片不播（LOGO 黑屏一帧），无报错'],
  [0x341, '桩：Live2D 模型不加载（无立绘），无报错'],
  [0x345, '桩：3D 模型槽不加载，无报错'],
  [0x34e, '桩：模型/立绘槽不加载，无报错'],
  [0x2ce, '宿主未实现（记录式）'],
  [0x1f7, '真实现（区间删项）'],
  [0x1f9, '真实现（绑定纹理）'],
  [0x1fb, '真实现（建/覆盖绘制项）；★源矩形越界裁剪与目标位置补偿未建模'],
  [0x202, '真实现（颜色窗）'],
  [0x203, '真实现（FROM 色）；★+0x30 混合模式未消费（见 dead-writes 基线）'],
  [0x217, '真实现（pivot 已按绝对坐标换算成局部量）'],
  [0x1f8, '真实现（槽缓存失效）；★程序化纹理内容未生成'],
  [0x320, '真实现（颜色窗）；★顶点几何未建模'],
  [0x344, '转发到宿主未实现 ⇒ 丢弃（纹理槽变换不生效）'],
]);

async function main(): Promise<void> {
  const rows = new Map<number, Row>();
  const r = await runConfig1Chain({
    recordDrops: true,
    onStep: (t: StepTrace) => {
      let row = rows.get(t.opcode);
      if (!row) {
        row = { opcode: t.opcode, name: t.name, kind: t.handlerKind, count: 0, scripts: new Set(), sample: '', gaps: 0, gapSample: '' };
        rows.set(t.opcode, row);
      }
      row.count++;
      row.scripts.add(t.script);
      if (!row.sample && t.operands.length) row.sample = t.operands.join(' ');
      if (t.gap) {
        row.gaps++;
        if (!row.gapSample) row.gapSample = t.operands.join(' ');
      }
    },
  });

  const all = [...rows.values()].sort((a, b) => a.opcode - b.opcode);
  console.log(`# 链路：SYSTEM4 → … → TITLE → CONFIG → ${r.script}（未实现 opcode: ${r.unimplemented.length}）`);
  console.log(`# 执行到的 opcode：${all.length} 个；三张表 = ${OPS.size} implemented / ${NATIVE_OPS.size} native / ${ENGINE_INTERNAL_OPS.size} engine-internal\n`);

  console.log('## 1. 非 implemented 的指令（native / engine-internal）');
  for (const x of all.filter((x) => x.kind !== 'implemented')) {
    console.log(
      `  0x${x.opcode.toString(16).padEnd(5)} ${x.kind.padEnd(16)} n=${String(x.count).padStart(5)}  ${x.name.padEnd(22)} ${[...x.scripts].join(',')}`,
    );
    if (x.sample) console.log(`        实参: ${x.sample}`);
    if (x.gaps) console.log(`        ★闸门 B 缺口 ×${x.gaps}: ${x.gapSample}`);
  }

  console.log('\n## 2. 宿主未实现 ⇒ 调用被丢弃（闸门 A）');
  for (const d of r.drops ?? []) {
    console.log(`  ${d.method.padEnd(22)} n=${String(d.count).padStart(5)}  ops=${d.opcodes.join(',')}  ${d.sample}`);
    console.log(`        ${d.why}`);
  }

  console.log('\n## 3. 图像渲染 / 文字输出相关、且**未完全实现**的指令');
  for (const x of all) {
    if (!RENDER_TEXT.has(x.opcode)) continue;
    const q = QUALITATIVE.get(x.opcode);
    const dropped = (r.drops ?? []).some((d) => d.opcodes.includes(`0x${x.opcode.toString(16)}`));
    if (!q && !dropped && x.kind === 'implemented' && !x.gaps) continue;
    console.log(`  0x${x.opcode.toString(16).padEnd(5)} ${RENDER_TEXT.get(x.opcode)}`);
    console.log(`        来源=${x.kind} 次数=${x.count} 脚本=${[...x.scripts].join(',')}`);
    if (x.sample) console.log(`        实参样例: ${x.sample}`);
    if (q) console.log(`        ${q}`);
    else if (dropped) console.log('        ★宿主未实现该 native 方法 ⇒ 调用被丢弃');
    else if (x.gaps) console.log(`        ★被当 no-op 跳过但收到非平凡实参 ×${x.gaps}`);
    else console.log('        （已实现，未见缺口）');
  }
  console.log('\n（提示：第 3 表只按族归类并给已知定性；"是否真的缺"以 opcode-table + 症状为准。）');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
