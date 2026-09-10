/**
 * **闸门 C：死写检测（静态 ratchet）** —— 找出"写进模型、但没有任何消费者"的字段。
 *
 * 为什么需要：这类缺陷**完全无报错**，只是"实现了但没效果"。实测抓到两例：
 *  - `Item.blend`（引擎 `DrawItem+0x30` = `0x203` 的 op2 混合模式）：`applyDrawColorAlpha` 写它，**无人读**；
 *  - `Item.useWorld`（`+0x68`）：`0x1FF` 置 true，无人读。
 * 这正是用户描述的"看起来每个绘制指令都实现了，但渲染效果依然有 bug"的一类来源。
 *
 * 做法（有意保持**保守**：只报"写得明明白白、却一次都没被读"的字段）：
 *  1. 从模型文件里解析 `interface Item` / `interface MeshObj` 的字段名；
 *  2. 在这些文件里统计每个字段的出现：**声明**、**对象字面量键**、**赋值目标** 视为"写"，
 *     其余访问视为"读"；
 *  3. 有写无读 ⇒ 死写。
 *
 * 用 `dead-writes.baseline.json` 做 **ratchet**：基线内的已知死写不报错（它们已被登记为能力缺口），
 * **新增**死写则测试失败 ⇒ 保证"不会越写越多没人看的字段"。
 *
 * 局限（已知，写在这里免得被当成保证）：静态分析无法识别通过下标/动态键访问的消费者，
 * 因此**只用来防新增**，不作为"这个字段一定没人用"的证明；运行时版本（给 Item 套 Proxy 统计 get）
 * 是更准的后续手段，但成本高、只在 debug 模式下才值得开。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 一个死写条目。 */
export interface DeadWrite {
  /** `Item.blend` 形式（接口名 + 字段名）。 */
  id: string;
  /** 该字段被"写"的次数（声明/字面量键/赋值目标）。 */
  writes: number;
  /** 该字段被"读"的次数（0 才会进 dead 列表）。 */
  reads: number;
}

export interface DeadWriteReport {
  /** 全部被检查的字段（有写有读）。 */
  alive: DeadWrite[];
  /** 有写无读的字段。 */
  dead: DeadWrite[];
  /** 参与扫描的文件。 */
  files: string[];
}

/** 只扫这几个（模型 + 全部消费者）；模型字段的语义在这里闭环。 */
const DEFAULT_SCAN = [
  'src/renderer/drawItem.ts',
  'src/renderer/sceneModel.ts',
  'src/renderer/pixiBackend.ts',
  'src/renderer/headlessScene.ts',
];

/**
 * **诊断函数**：它们读字段只是为了"报告/快照"，**不代表渲染真的消费了它**。
 * 例：`Item.blend` 只被 `scSnapshot` 读（好让报告显示"脚本设过混合模式"），但渲染器从不用它
 * ⇒ 它仍然是"实现了但没效果"的死写。把这些函数体从扫描文本里剔除，结论才有意义。
 */
const DIAGNOSTIC_FNS = ['scSnapshot', 'snapshotToText', 'debugDrawItems', 'debugItemState', 'slotTable'];

/** 把指定函数（连带其上方文档注释与函数体）从源码里删掉（按大括号配平找结束）。 */
function stripFunctions(src: string, names: string[]): string {
  let out = src;
  for (const name of names) {
    const start = new RegExp(`(?:export )?function ${name}\\s*\\(`).exec(out);
    if (!start) continue;
    const braceAt = out.indexOf('{', start.index);
    if (braceAt < 0) continue;
    let depth = 0;
    let end = braceAt;
    for (; end < out.length; end++) {
      const c = out[end];
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) break;
      }
    }
    let head = start.index;
    const commentStart = out.lastIndexOf('/**', head);
    if (commentStart >= 0 && out.slice(commentStart, head).trimEnd().endsWith('*/')) head = commentStart;
    out = out.slice(0, head) + out.slice(end + 1);
  }
  return out;
}

/** 从 `interface <name> {` 块里取字段名。 */
function interfaceFields(src: string, iface: string): string[] {
  const m = new RegExp(`export interface ${iface}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(src);
  if (!m) return [];
  const body = m[1]!;
  const out: string[] = [];
  for (const line of body.split('\n')) {
    const f = /^\s{2}([A-Za-z_][A-Za-z0-9_]*)\??\s*:/.exec(line);
    if (f) out.push(f[1]!);
  }
  return out;
}

/**
 * 统计一个字段的"写"与"读"。
 *
 * **只认属性访问**（`.field` / `.field =`）：否则参数名/局部变量名与字段同名会造假读
 * （实测 `blend` 就被 `applyDrawColorAlpha(it, from, blend = 0)` 的参数名骗过一次）。
 *  - 写 = `.field = …`（赋值目标）/ 模型接口里的声明 / 对象字面量键 `{ field: … }`；
 *  - 读 = `.field` 的其余出现（含 `it.field[0]`、`it.field.x` 这种继续访问）。
 * 有写无读 ⇒ 死写。
 */
function countAccess(src: string, field: string): { writes: number; reads: number } {
  let writes = 0;
  let reads = 0;
  const propRe = new RegExp(`\\.\\s*${field}\\b`, 'g');
  const litRe = new RegExp(`[{,]\\s*${field}\\s*:`, 'g');
  for (const line of src.split('\n')) {
    // 声明行（模型接口 / 快照接口）：`  field: type;`
    if (/^\s{2}[A-Za-z_][A-Za-z0-9_]*\??\s*:/.test(line) && new RegExp(`^\\s{2}${field}\\??\\s*:`).test(line)) {
      writes++;
      continue;
    }
    // 对象字面量键
    writes += (line.match(litRe) ?? []).length;
    // 属性访问：区分赋值目标与读取
    let m: RegExpExecArray | null;
    propRe.lastIndex = 0;
    while ((m = propRe.exec(line)) !== null) {
      const after = line.slice(m.index + m[0].length);
      if (/^\s*(\+|-|\*|\/|\|\||&&|\?\?)?=([^=]|$)/.test(after)) writes++;
      else reads++;
    }
  }
  return { writes, reads };
}

/** 扫描并产出报告。 */
export function findDeadWrites(rootDir: string, files: string[] = DEFAULT_SCAN): DeadWriteReport {
  const sources = new Map<string, string>();
  for (const f of files) {
    const p = path.join(rootDir, f);
    if (fs.existsSync(p)) sources.set(f, fs.readFileSync(p, 'utf8'));
  }
  const model = sources.get('src/renderer/drawItem.ts') ?? '';
  // 剔除诊断函数：它们读字段只为报告，不算"渲染消费"
  const all = stripFunctions([...sources.values()].join('\n'), DIAGNOSTIC_FNS);
  const report: DeadWriteReport = { alive: [], dead: [], files: [...sources.keys()] };
  for (const iface of ['Item', 'MeshObj']) {
    for (const field of interfaceFields(model, iface)) {
      const { writes, reads } = countAccess(all, field);
      const entry: DeadWrite = { id: `${iface}.${field}`, writes, reads };
      if (writes > 0 && reads === 0) report.dead.push(entry);
      else report.alive.push(entry);
    }
  }
  report.dead.sort((a, b) => a.id.localeCompare(b.id));
  report.alive.sort((a, b) => a.id.localeCompare(b.id));
  return report;
}

export interface Baseline {
  /** 已登记为"能力缺口"的已知死写（不得新增）。 */
  known: string[];
  /** 每条已知死写为什么暂时是死写（供台账/README 引用）。 */
  reason?: Record<string, string>;
}

export function loadBaseline(p: string): Baseline {
  if (!fs.existsSync(p)) return { known: [] };
  return JSON.parse(fs.readFileSync(p, 'utf8')) as Baseline;
}

/** ratchet 比较：返回新增死写与已修复的基线项。 */
export function ratchet(report: DeadWriteReport, base: Baseline): { added: DeadWrite[]; fixed: string[] } {
  const known = new Set(base.known);
  const now = new Set(report.dead.map((d) => d.id));
  return {
    added: report.dead.filter((d) => !known.has(d.id)),
    fixed: [...known].filter((k) => !now.has(k)).sort(),
  };
}

/** 格式化成人可读文本。 */
export function formatReport(report: DeadWriteReport, base: Baseline): string {
  const { added, fixed } = ratchet(report, base);
  const L: string[] = [];
  L.push(`# 死写检测（扫描 ${report.files.length} 个文件；字段 ${report.alive.length + report.dead.length} 个）`);
  L.push(`已登记的死写（基线）${base.known.length} 个：${base.known.join(' ') || '无'}`);
  L.push(`当前死写 ${report.dead.length} 个：` + (report.dead.map((d) => `${d.id}(写${d.writes})`).join(' ') || '无'));
  for (const d of report.dead) {
    const why = base.reason?.[d.id];
    if (why) L.push(`  - ${d.id}：${why}`);
  }
  L.push(added.length ? `★ 新增死写（必须登记或修掉）：${added.map((d) => d.id).join(' ')}` : '★ 无新增死写');
  if (fixed.length) L.push(`基线已过期（这些字段现在有消费者了，可从基线移除）：${fixed.join(' ')}`);
  return L.join('\n');
}

async function main(): Promise<void> {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const basePath = path.join(root, 'dead-writes.baseline.json');
  const report = findDeadWrites(root);
  const base = loadBaseline(basePath);
  console.log(formatReport(report, base));
  const { added } = ratchet(report, base);
  if (added.length > 0) process.exitCode = 1;
}

const invokedDirectly =
  process.argv[1] !== undefined && path.resolve(process.argv[1]).replace(/\.(ts|js)$/, '').endsWith('deadWrites');
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
