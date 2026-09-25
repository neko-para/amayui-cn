/**
 * **闸门 C：死写检测（静态 ratchet）** —— 找出"写进模型、但没有任何消费者"的字段。
 *
 * 为什么需要：这类缺陷**完全无报错**，只是"实现了但没效果"。实测抓到两例：
 *  - `Item.blend`（引擎 `DrawItem+0x30` = `0x203` 的 op2 混合模式）：`applyDrawColorAlpha` 写它，**无人读**；
 *  - `Item.useWorld`（`+0x68`）：`0x1FF` 置 true，无人读。
 * 这正是用户描述的"看起来每个绘制指令都实现了，但渲染效果依然有 bug"的一类来源。
 *
 * 做法（有意保持**保守**：只报"写得明明白白、却一次都没被读"的字段）：
 *  1. 按 **scope** 从模型声明里解析字段名（`interface` / `class` / 嵌套对象类型）；
 *  2. 在全部扫描文本里统计每个字段的出现：**声明**、**对象字面量键**、**赋值目标** 视为"写"，
 *     其余**属性访问**视为"读"；
 *  3. 有写无读 ⇒ 死写。
 *
 * 用 `dead-writes.baseline.json` 做 **ratchet**：基线内的已知死写不报错（它们已被登记为能力缺口），
 * **新增**死写则测试失败 ⇒ 保证"不会越写越多没人看的字段"。
 *
 * ## scope（`tickets/T-0150` 扩面）
 *
 * | scope | 声明处 | 为什么在这一批 |
 * |---|---|---|
 * | `Item` / `MeshObj` | `src/renderer/drawitem/model.ts` | 原始覆盖面（绘制项字段） |
 * | `Engine` | `src/vm/engine.ts`（`class Engine`，含构造函数参数属性） | 审计 `missing-consumer` 类 finding 的最大落点（`texSlotFlags`/`globalSlot97058`/`titleExit*`…） |
 * | `SceneState` | `src/renderer/scene/state.ts` | 同上（`render4.*` 的 A4 族记录、`commitQueue`…） |
 * | `SceneState.render4` | 同上（嵌套对象类型的字段） | A4 族"只记录、渲染器不消费"的那几条 |
 * | `SceneXform` | 同上 | `0x22A`/`0x22C`/`0x22D`/`0x22F` 的变换记录 |
 * | `TextFrame` | `src/text/layout.ts` | 文本对象（审计点名的第三类落点） |
 *
 * scope 表就是 `SCOPES`（导出的常量）：加一个模型面 = 往表里加一条，**不要**改统计逻辑。
 *
 * ## 消费方识别（★本票的核心，防假阳性）
 *
 * 只按字段名做全文计数会把**同名的别的对象的字段**算成消费者（例：`Item.blend` 被
 * `applyDrawColorAlpha(it, from, blend = …)` 的参数名骗过一次；`Engine.key` 与 `Frame.key` 同名）。
 * 于是统计读的时候加两道闸：
 *  1. **接收者必须是"像这个 scope 的实例"**：从全量扫描文本里收集类型注解线索
 *     （`e: Engine` / `engine: Engine` / `const x: SceneState` …，含 `a, b: T` 的连写形式），
 *     命中"`this` + 声明文件"或"带注解的接收者基名"才算读；
 *  2. **排除可证伪的别的类型**：接收者被注解成**另一个** scope 的类型（如 `g: SceneState` 里的
 *     `.key`）⇒ 那次访问不算 `Engine.key` 的读（否则一次跨 scope 同名就会把死写洗活）。
 * 闸 1 只可能造成**假阳性（报多了）**——那是安全的（进基线时人眼复核）；闸 2 防的是**假阴性**。
 *
 * ## 局限（已知，写在这里免得被当成保证）
 *
 *  - **只静态**：**诊断/报告函数**（`DIAGNOSTIC_FNS`）与**测试文件**（`test/**`）里的"读"都**不算消费**
 *    （报告读它只是为了让报告好看；测试读它只证明"值写进去了"，不证明**生产路径**有人消费）。
 *    所以扫描面刻意只含 `src/**` 的非报告文件。代价：一个字段若真的只被测试/快照读，会被报成死写
 *    —— 这正是审计 `missing-consumer` 类的定义（"实现了但没效果"），会走基线登记；
 *  - **不识别容器**：Map/Set 型字段（`texSizes`/`menuMap`/`advFields`…）与 `engineValues` 的**数字键**
 *    （含负键，如 `0x248` 的 `-248`）不在字段级统计内 —— 它们的键是**运行期枚举**的，
 *    静态无法判定"这个键没人读"。要覆盖它们需要一张"键 → 消费者"的登记表（见 `notes.md` 的缺口）；
 *  - ★**注释不算读**（`tickets/T-0039`）：统计前会剥掉 `//` 行注释与块注释（含文档注释）。修之前是逐行跑
 *    正则、注释里的 `.field` 会被算成"有人读" —— 一句文档注释就能把**已登记的能力缺口**洗成"已修"
 *    （实测：在 `model.ts` 里写一句「见 MeshObj.blend」即让两个字段从 dead 变 alive）。
 *    剥注释用带字符串/引号状态的小扫描器（不误伤 `'…//…'`、模板串、`http://`），并保持行结构不变。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 一个死写条目。 */
export interface DeadWrite {
  /** `<scope>.<字段>` 形式（scope 可为 `SceneState.render4` 这类点路径）。 */
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

/** 模型面：字段清单从哪来、叫什么名字。 */
export interface ScopeSpec {
  /** 报告里的前缀（`engine` 里是类名/接口名）。 */
  scope: string;
  /** 字段名从哪个类型的声明里取（类名/接口名）。 */
  type: string;
  /**
   * 嵌套对象类型的路径（如 `SceneState` 的 `render4`）；不给 = 取 `type` 自己的字段。
   * 给了 `path` 时，字段也可以用 `render4.<field>` 这种带路径的形式被访问。
   */
  path?: string;
  /** 声明所在文件（相对工程根）。 */
  file: string;
  /** 声明形式。 */
  kind: 'interface' | 'class';
  /** 成员行的缩进空格数（顶层 2；嵌套对象类型的成员 4）。默认 2。 */
  indent?: number;
  /**
   * **有意的诊断/报告字段**：它们本来就"只写不读"（读点在 `DIAGNOSTIC_FNS` 里或测试里），
   * 是**刻意的可观测性设计**而不是遗忘的消费者 ⇒ 不进基线、也不报新增。
   * 每条都必须写清"谁是它的读者、为什么不算生产消费者"。
   */
  ignore?: readonly string[];
}

/** 模型接口（`Item`/`MeshObj`）的声明所在文件 —— 字段清单从这里取（原覆盖面，勿删）。 */
export const MODEL_FILE = 'src/renderer/drawitem/model.ts';

/**
 * ★**扫描面（`tickets/T-0150` 起按 scope 声明）**：每个模型面的字段清单从哪里取。
 * 加一个面 = 往这里加一条；统计逻辑与这份表解耦。
 */
export const SCOPES: readonly ScopeSpec[] = [
  { scope: 'Item', type: 'Item', file: MODEL_FILE, kind: 'interface' },
  { scope: 'MeshObj', type: 'MeshObj', file: MODEL_FILE, kind: 'interface' },
  { scope: 'Engine', type: 'Engine', file: 'src/vm/engine.ts', kind: 'class' },
  { scope: 'SceneState', type: 'SceneState', file: 'src/renderer/scene/state.ts', kind: 'interface' },
  {
    scope: 'SceneState.render4',
    type: 'SceneState',
    path: 'render4',
    indent: 4,
    file: 'src/renderer/scene/state.ts',
    kind: 'interface',
  },
  { scope: 'SceneXform', type: 'SceneXform', file: 'src/renderer/scene/state.ts', kind: 'interface' },
  {
    scope: 'TextFrame',
    type: 'TextFrame',
    file: 'src/text/layout.ts',
    kind: 'interface',
    // 这是**刻意的缺口可见标志**（"拿不到字体度量 ⇒ 回退并置真"），读者是测试
    // （`test/op-205-blank-extent.test.ts` 断言 mode 0/mode 1 下为真），生产渲染器不用它 ⇒ 不算遗漏的消费者。
    ignore: ['blankExtentFallback'],
  },
];

/**
 * **只扫这几个（模型层 + 全部消费者）**：模型字段的语义在这里闭环。
 * ★`tickets/T-0150` 之后，`Engine`/`SceneState`/`TextFrame` 的消费者遍布 `src/**`（VM、宿主、报告），
 * 所以默认扫描面 = 这张表 ∪ 全部 `src/**` 的文件（报告/诊断目录除外，见 `EXCLUDED_DIRS`）。
 */
const DEFAULT_SCAN = [
  MODEL_FILE,
  'src/renderer/drawitem/animWindow.ts',
  'src/renderer/drawitem/colorMath.ts',
  'src/renderer/drawitem/eval.ts',
  'src/renderer/drawitem/setters.ts',
  'src/renderer/drawitem/cgDigit.ts',
  'src/renderer/scene/state.ts',
  'src/renderer/scene/ops.ts',
  'src/renderer/scene/snapshot.ts',
  'src/renderer/pixiBackend.ts',
  'src/renderer/pixi/presenter.ts',
  'src/renderer/pixi/textureCache.ts',
  'src/renderer/headlessScene.ts',
];

/**
 * 扫描时**排除**的路径片段：报告/工具（诊断读者）与编译产物。
 * 排除报告目录 = "报告读它只是为了让报告好看，不算渲染/行为消费"（见文件头）。
 */
const EXCLUDED_DIRS = ['src/tools/', 'src/report.ts', 'dist/', 'node_modules/', '.tmp/'];

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

/** 取某个成员块的起始位置：`path` 给了就取 `path: {` 那块，否则取整个类型体。 */
export function memberBlock(src: string, spec: ScopeSpec): string | null {
  if (spec.kind === 'class') {
    const start = new RegExp(`export class ${spec.type}\\b`).exec(src);
    if (!start) return null;
    return braceBlock(src, src.indexOf('{', start.index));
  }
  const m = new RegExp(`export interface ${spec.type}\\s*\\{`).exec(src);
  if (!m) return null;
  const body = braceBlock(src, m.index + m[0].length - 1);
  if (body == null) return null;
  if (!spec.path) return body;
  // `render4: {` 的 `{` 可能在下一行（`SceneState.render4` 的声明就是这种写法）⇒ 向后找第一个 `{`
  const declAt = new RegExp(`^\\s*${reEscape(spec.path)}\\s*:`, 'm').exec(body);
  if (!declAt) return null;
  const openAt = body.indexOf('{', declAt.index + declAt[0].length - 1);
  if (openAt < 0) return null;
  return braceBlock(body, openAt);
}

/** 从 `openAt`（必须指向 `{`）开始做大括号配平，返回花括号**内部**的文本。 */
function braceBlock(src: string, openAt: number): string | null {
  if (openAt < 0) return null;
  let depth = 0;
  for (let i = openAt; i < src.length; i++) {
    const c = src[i]!;
    if (c === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i);
      if (nl < 0) break;
      i = nl;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      i++;
      while (i < src.length) {
        if (src[i] === '\\') {
          i += 2;
          continue;
        }
        if (src[i] === q) break;
        i++;
      }
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return src.slice(openAt + 1, i);
    }
  }
  return null;
}

/**
 * 从一个类型体里取**顶层**成员名（按大括号/圆括号/方括号深度，只在深度 0 处按缩进取）。
 * `indent` = 成员行的缩进空格数（接口体是 2）。
 */
export function memberNames(body: string, indent: number, prefix = ''): string[] {
  const pad = ' '.repeat(indent);
  const chunkRe = new RegExp(
    `^(?:(?:private|public|protected|readonly|static|declare)\\s+)*([A-Za-z_][A-Za-z0-9_]*)[?!]?\\s*(?::[^=;]*)?(=[\\s\\S]*|;|\\{)`,
  );
  const methodRe = /^[A-Za-z_$#][A-Za-z0-9_$]*[?!]?\s*(?:<[^>]*>\s*)?\(/;
  const out: string[] = [];
  let cur: string | null = null;
  let depth = 0;
  const flush = (): void => {
    if (cur === null) return;
    const chunk = cur;
    cur = null;
    const first = chunk.trimEnd();
    if (methodRe.test(first)) return; // 方法 / 访问器不是"字段"
    const m = chunkRe.exec(first);
    if (!m) return;
    out.push(prefix + m[1]!);
  };
  for (const line of body.split('\n')) {
    const atTop = depth === 0 && line.startsWith(pad) && !line.startsWith(pad + ' ');
    if (atTop && /[A-Za-z_#]/.test(line[pad.length] ?? '')) {
      flush();
      cur = line.slice(pad.length);
    } else if (cur !== null) {
      cur += '\n' + line;
    }
    depth += bracketDelta(line);
    if (depth < 0) depth = 0;
  }
  flush();
  return out;
}

/** 一行的括号净增量（跳过字符串与行注释）。 */
function bracketDelta(line: string): number {
  let d = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (c === '/' && line[i + 1] === '/') break;
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      i++;
      while (i < line.length) {
        if (line[i] === '\\') {
          i += 2;
          continue;
        }
        if (line[i] === q) break;
        i++;
      }
      continue;
    }
    if (c === '{' || c === '(' || c === '[') d++;
    else if (c === '}' || c === ')' || c === ']') d--;
  }
  return d;
}

/**
 * **容器型字段的变更方法**（`map.set(…)`/`set.clear()`/`arr.push(…)` …）：这些调用是"写"。
 * ★`tickets/T-0150` 扩面时补的：`Engine.texSlotFlags`（`0x258` 写、`0x259` 整表清）在修前
 * **一个"写"都统计不到**（体内全是 `.set()`/`.clear()`）⇒ 永远不进死写列表，闸门对
 * Map/Set/Array 型字段等于瞎的（审计 `0x259` 正是这个形状）。
 */
const MUTATING_METHODS = new Set([
  'set',
  'add',
  'push',
  'unshift',
  'pop',
  'shift',
  'splice',
  'sort',
  'reverse',
  'fill',
  'clear',
  'delete',
  'reset',
]);

/**
 * 统计一个字段的"写"与"读"。
 *
 * **只认属性访问**（`.field` / `.field =`）：否则参数名/局部变量名与字段同名会造假读
 * （实测 `blend` 就被 `applyDrawColorAlpha(it, from, blend = 0)` 的参数名骗过一次）。
 *  - 写 = `.field = …`（赋值目标）/ 模型接口里的声明 / 对象字面量键 `{ field: … }` /
 *    `.field.<MUTATING_METHODS>(…)`（容器变更）；
 *  - 读 = `.field` 的其余出现（含 `it.field[0]`、`it.field.x` 这种继续访问）。
 * 有写无读 ⇒ 死写。
 *
 * `qualifier`（给嵌套 scope 用）：字段也可以写成 `<path>.field`（如 `render4.primReset`），
 * 这种带路径的写法**无论接收者是谁都算数**（路径本身就是限定符）。
 */
export function countAccess(
  src: string,
  field: string,
  qualifier: string | null,
  isConsumer: (dotPos: number) => boolean,
  /** 声明行的缩进（接口 2、类成员 2 也成立；见 `memberNames` 的 `indent`）。 */
  indent = 2,
): { writes: number; reads: number } {
  let writes = 0;
  let reads = 0;
  const propRe = new RegExp(`\\.\\s*${field}\\b`, 'g');
  const litRe = new RegExp(`[{,]\\s*${field}\\s*:`, 'g');
  const pad = ' '.repeat(indent);
  const declRe = new RegExp(`^${pad}${field}\\??\\s*(?::|=)`);
  const mutRe = /^\s*\??\.\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/;
  const qualTailRe = qualifier ? new RegExp(`\\.\\s*${qualifier}\\s*$`) : null;
  let lineOffset = 0;
  for (const line of src.split('\n')) {
    // 声明行（模型接口 / 类成员）：`  field: type;` 或 `  field = 0;`
    if (/^\s{2}[A-Za-z_][A-Za-z0-9_]*\??\s*(?::|=)/.test(line) && declRe.test(line)) {
      writes++;
      lineOffset += line.length + 1;
      continue;
    }
    // 对象字面量键
    writes += (line.match(litRe) ?? []).length;
    // 属性访问：区分赋值目标与读取
    let m: RegExpExecArray | null;
    propRe.lastIndex = 0;
    while ((m = propRe.exec(line)) !== null) {
      const dotPos = lineOffset + m.index + (m[0].length - 1 - field.length);
      const after = line.slice(m.index + m[0].length);
      // 带路径的限定访问（`render4.primReset`）：路径本身就是限定符 ⇒ 一定算消费者。
      // ★回看窗口要够宽：`s.render4.\n  commits++;` 这种跨行写法要把 `\n` 与缩进都算进去。
      const qualified =
        qualTailRe !== null &&
        qualTailRe.test(src.slice(Math.max(0, dotPos - (qualifier!.length + 40)), dotPos));
      const mut = mutRe.exec(after);
      const isWrite =
        /^\s*(\+|-|\*|\/|\|\||&&|\?\?)?=([^=]|$)/.test(after) ||
        /^\s*(\+\+|--)/.test(after) || // `x.f++` / `x.f--`：容器计数器的常见写法
        (mut !== null && MUTATING_METHODS.has(mut[1]!));
      if (isWrite) {
        writes++;
        continue;
      }
      // 读：带路径的限定写法（`render4.primReset`）**一定**算消费者（路径本身就是限定符）；
      // 其余走接收者判据（防"同名的别人的字段"把死写洗活）。
      if (!qualified && !isConsumer(dotPos)) continue;
      reads++;
    }
    lineOffset += line.length + 1;
  }
  return { writes, reads };
}

/**
 * **剥掉注释与字符串内容**（`tickets/T-0039`）：`//` 行注释、`/* … *\/` 块注释（含 `/** *\/` 文档注释）
 * 里的字段名不算"访问"；**字符串字面量的内容**同理（否则一句 `log('Item.blend 未消费')` 也能把死写洗活）。
 * 带引号状态的小扫描器：不误伤 `'…//…'`、模板串、`http://`（`:` 后的 `//` 保留），
 * 并**保持行结构**（注释/模板串里的换行原样留下）——因为下游统计是按行跑的。
 */
export function stripCommentsAndStrings(src: string): string {
  let out = '';
  let i = 0;
  let mode: 'code' | 'line' | 'block' = 'code';
  let quote: string | null = null;
  while (i < src.length) {
    const c = src[i]!;
    const n = src[i + 1];
    if (mode === 'line') {
      if (c === '\n') {
        mode = 'code';
        out += c;
      }
      i++;
      continue;
    }
    if (mode === 'block') {
      if (c === '*' && n === '/') {
        mode = 'code';
        i += 2;
      } else {
        if (c === '\n') out += c; // 保留行数
        i++;
      }
      continue;
    }
    if (quote) {
      if (c === '\\') {
        i += 2; // 转义序列整体丢弃
        continue;
      }
      if (c === '\n') {
        out += c; // 模板串里的换行要留（保行结构）
        i++;
        continue;
      }
      if (c === quote) {
        quote = null;
        out += c; // 保留收尾引号（配对，便于人读）
      }
      i++;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c;
      out += c;
      i++;
      continue;
    }
    if (c === '/' && n === '/') {
      // `http://` 这类 URL（前一非空字符是 `:`）不算注释起始
      if (out.trimEnd().endsWith(':')) {
        out += c;
        i++;
        continue;
      }
      mode = 'line';
      i += 2;
      continue;
    }
    if (c === '/' && n === '*') {
      mode = 'block';
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** 递归列出 `src/**` 下的 `.ts` 文件（相对工程根，正斜杠）。 */
function listSourceFiles(rootDir: string): string[] {
  const srcDir = path.join(rootDir, 'src');
  if (!fs.existsSync(srcDir)) return [];
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.ts')) out.push(path.relative(rootDir, p).replace(/\\/g, '/'));
    }
  };
  walk(srcDir);
  return out;
}

/** 拼出默认扫描面：显式清单 ∪ 全部 `src/**`，去重并剔除排除项。 */
export function defaultScan(rootDir: string): string[] {
  const all = [...DEFAULT_SCAN, ...listSourceFiles(rootDir)];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of all) {
    if (seen.has(f)) continue;
    if (EXCLUDED_DIRS.some((x) => f.startsWith(x) || f.includes('/' + x))) continue;
    seen.add(f);
    out.push(f);
  }
  return out.sort();
}

/** 从属性访问的 `.` 位置往回取接收者基名（`e.ctx.menuMap` ⇒ `e.ctx`；`this.foo` ⇒ `this`；取不到 ⇒ null）。 */
export function receiverBase(src: string, lineStart: number, dotAt: number): string | null {
  let e = dotAt - 1;
  while (e >= lineStart && /\s/.test(src[e]!)) e--;
  const end = e + 1;
  while (e >= lineStart && /[A-Za-z0-9_$.\]]/.test(src[e]!)) e--;
  const text = src.slice(e + 1, end);
  if (text.length === 0) return null;
  const parts = text.replace(/[[\]]/g, '').split('.');
  if (parts.some((p) => p === '')) return null;
  if (parts[0] === 'this') return 'this';
  if (parts[0] === 'super') return null;
  if (/^[0-9]/.test(parts[0]!)) return null; // 数值/索引对象：拿不到类型
  return parts.join('.');
}

/** 类型注解线索：`e: Engine` / `const x: SceneState` / 连写 `a, b: Engine`。 */
function typedNames(src: string, typeName: string): string[] {
  const re = new RegExp(`(?:^|[^A-Za-z0-9_$])([A-Za-z_$][A-Za-z0-9_$]*)\\s*:\\s*${typeName}\\b`, 'gm');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) out.push(m[1]!);
  return out;
}

/** 正则元字符转义。 */
function reEscape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 一个 scope 的读判定上下文。 */
export interface ReadCtx {
  /** 全量扫描文本（接收者基名与"它是不是这个 scope 的实例"都在这里找）。 */
  text: string;
  /** 该 scope 的**类型注解线索**（`e: Engine` ⇒ `e`）。 */
  hints: Set<string>;
  /** 其它 scope 的类型名（用于"可证伪是别的类型"）。 */
  otherTypes: readonly string[];
  /** 声明所在文件 —— `this.foo` 只在该文件里算这个 scope 的字段。 */
  declFile: string;
  /**
   * `receiver.<本 scope 的任一字段>` 的探测器：类型注解线索覆盖不到的地方（如 `it.posZ`，
   * 全仓没有 `it: Item`）靠它判"这个接收者至少在这一处被当成本 scope 用过"。
   * 命中结果带回**命中的字段名**，避免"用正在判定的字段自己证明自己"。
   */
  scopeMemberRe: RegExp;
}

/** 接收者基名的注解类型是不是**另一个** mode 类型（只认其它 scope 的类型名，避免误判）。 */
function annotatedAsOther(ctx: ReadCtx, names: readonly string[]): boolean {
  for (const s of names) {
    for (const t of ctx.otherTypes) {
      const re = new RegExp(`(?:^|[^A-Za-z0-9_$])${reEscape(s)}\\s*:\\s*${reEscape(t)}\\b`);
      if (re.test(ctx.text)) return true;
    }
  }
  return false;
}

/** 收窄的判据（保守：拿不准就算读，假阳性靠基线人眼复核）。 */
export function receiverVerdict(
  ctx: ReadCtx,
  base: string,
  file: string,
  field: string,
): 'consumer' | 'other' | 'unknown' {
  if (base === 'this') return file === ctx.declFile ? 'consumer' : 'other';
  const parts = base.split('.');
  const first = parts[0]!;
  const leaf = parts[parts.length - 1]!;
  // ① 这个接收者被注解成本 scope 的类型（`e: Engine`）⇒ 直接算消费者
  //   （复合接收者 `s.sceneXform` 的基名 `s: SceneState` 也走这一支：**拥有**该记录的那个类型）
  if (ctx.hints.has(first) || ctx.hints.has(base)) return 'consumer';
  // ② 可证伪：**单段**接收者被注解成别的 scope 类型 ⇒ 这次访问不是本 scope 的字段。
  //   ★只对单段接收者做这一步：复合接收者（`s.sceneXform`）里 `sceneXform` 本身就是有个类型的字段，
  //   拿它去比对"别的 scope 类型名"必然自伤（`sceneXform: SceneXform`）⇒ 复合接收者一律放行走读。
  //   ★只认"其它 scope 的类型名"（`e: SceneState`），不认 `x: number` 这类普通注解
  //   （否则模型里的 `posZ: number` 会把 `it.posZ` 判成别人的）。
  if (first === leaf && annotatedAsOther(ctx, [first])) return 'other';
  // 没有类型注解线索 ⇒ 看"这个接收者被本 scope 的**别的**字段用过没有"
  const memberRe = new RegExp(`(?:^|[^A-Za-z0-9_$.])${reEscape(first)}\\??\\.([A-Za-z_$][A-Za-z0-9_$]*)`, 'g');
  let m: RegExpExecArray | null;
  while ((m = memberRe.exec(ctx.text)) !== null) {
    const used = m[1]!;
    if (used !== field && ctx.scopeMemberRe.test('.' + used)) return 'consumer';
  }
  return 'unknown';
}

/** 扫描并产出报告。
 *
 * `files` = 参与统计的文本（消费者 **与** 模型声明 —— 模型文件也要在里面，否则它的字段声明不计入"写"）；
 * `scopes` = 要检查哪些模型面（字段清单从 `scopes[].file` 取，默认是全工程的那张表）。
 */
export function findDeadWrites(
  rootDir: string,
  files: string[] = defaultScan(rootDir),
  scopes: readonly ScopeSpec[] = SCOPES,
): DeadWriteReport {
  const sources = new Map<string, string>();
  for (const f of files) {
    const p = path.join(rootDir, f);
    if (fs.existsSync(p)) sources.set(f, fs.readFileSync(p, 'utf8'));
  }
  // 剔除诊断函数：它们读字段只为报告，不算"渲染消费"（这一步要看文档注释，必须在剥注释之前）
  // ★顺序要紧：先 stripFunctions（靠 `/**` 找函数头）→ 再 stripComments（`T-0039`：注释不算读）。
  const all = stripCommentsAndStrings(stripFunctions([...sources.values()].join('\n'), DIAGNOSTIC_FNS));
  const report: DeadWriteReport = { alive: [], dead: [], files: [...sources.keys()] };
  const allTypes = [...new Set(scopes.map((s) => s.type))];
  for (const spec of scopes) {
    const decl = sources.get(spec.file);
    if (decl === undefined) continue;
    const declClean = stripCommentsAndStrings(decl);
    const block = memberBlock(declClean, spec);
    if (block == null) continue;
    const names = memberNames(block, spec.indent ?? 2);
    const ignore = new Set(spec.ignore ?? []);
    const hints = new Set(typedNames(all, spec.type));
    const ctx: ReadCtx = {
      text: all,
      hints,
      otherTypes: allTypes.filter((t) => t !== spec.type),
      declFile: spec.file,
      scopeMemberRe: new RegExp(`\\.\\s*(?:${names.map(reEscape).join('|')})\\b`),
    };
    for (const field of names) {
      if (ignore.has(field)) continue;
      const qualifier = spec.path ?? null;
      const { writes, reads } = countAccess(
        all,
        field,
        qualifier,
        (dotPos) => {
          const lineStart = all.lastIndexOf('\n', dotPos) + 1;
          const base = receiverBase(all, lineStart, dotPos);
          if (base === null) return false;
          const verdict = receiverVerdict(ctx, base, spec.file, field);
          return verdict !== 'other'; // 拿不准（unknown）算读：只报"写得明明白白、却一次都没被读"
        },
        spec.indent ?? 2,
      );
      const entry: DeadWrite = { id: `${spec.scope}.${field}`, writes, reads };
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
  /**
   * ★**每条已知死写为什么暂时是死写**（必填）：写清"谁是它唯一的读者、为什么那不算消费者"。
   * 只写"已知/暂不修"会被 `test/no-dead-writes.test.ts` 判成不合格的登记。
   */
  reason?: Record<string, string>;
  /**
   * ★**承接票号**（必填）：修复这条死写归哪张票（`tickets/<id>/`）；确实没有对应票就写 `"none"`，
   * 并在 `reason` 里说明为什么还没有票。
   */
  tickets?: Record<string, string>;
}

/** 基线本身的体检结果（缺 why / 缺票号 / 理由太短 ⇒ 登记不合格）。 */
export function auditBaseline(base: Baseline): string[] {
  const problems: string[] = [];
  for (const id of base.known) {
    const why = base.reason?.[id];
    if (why === undefined || why.trim().length === 0) problems.push(`${id}：缺少 reason（必须写清为什么暂时是死写）`);
    else if (why.trim().length < 20) problems.push(`${id}：reason 太短（${why.trim().length} 字）—— 写清"谁在读、为什么不算消费者"`);
    const t = base.tickets?.[id];
    if (t === undefined || t.trim().length === 0) problems.push(`${id}：缺少 tickets（承接票号；没有票就写 none）`);
  }
  return problems;
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
  const problems = auditBaseline(base);
  if (problems.length) L.push(`★ 基线登记不合格（必须补 why/票号）：\n  - ${problems.join('\n  - ')}`);
  return L.join('\n');
}

async function main(): Promise<void> {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const basePath = path.join(root, 'dead-writes.baseline.json');
  const report = findDeadWrites(root);
  const base = loadBaseline(basePath);
  console.log(formatReport(report, base));
  const { added } = ratchet(report, base);
  if (added.length > 0 || auditBaseline(base).length > 0) process.exitCode = 1;
}

const invokedDirectly =
  process.argv[1] !== undefined && path.resolve(process.argv[1]).replace(/\.(ts|js)$/, '').endsWith('deadWrites');
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
