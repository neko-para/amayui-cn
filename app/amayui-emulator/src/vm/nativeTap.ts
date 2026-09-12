/**
 * **闸门 A：`?.` 不再静默** —— 记录"脚本表达了意图、但宿主没实现"的调用。
 *
 * ## 为什么需要它
 * `NativeBridge` 的方法几乎都是可选的（`foo?()`），于是 `c.native.setLight?.(idx, false)` 在宿主没实现时
 * **静默变成一句空操作**：既没有日志、也没有计数、也不进控制窗。结果就是
 * 「opcode 标着'真实现'、VM 也正常推进，但画面上什么都没发生」——这正是"看起来都实现了、效果却有 bug"
 * 的主要来源之一（实测：11 个被 `ops.ts` 调用、宿主未实现的方法）。
 *
 * 本模块把它变成**可数的显式事件**：谁被调用、被调了几次、典型实参是什么、是在哪条 opcode 下发生的。
 *
 * ## 用法
 * ```ts
 * const rec = new DropRecorder();
 * const native = withNativeTap(pixiBackend, rec, () => engine.currentOpcode);
 * // 之后任何 native.notImplemented?.(a, b) 都会进 rec，而不再是空操作
 * rec.list(); // → [{ method, count, sample, opcodes, why }]
 * ```
 *
 * 注意：**只包"未实现"的那些**。宿主已实现的方法原样转发（不做任何拦截、无性能影响）。
 */

import type { NativeBridge } from './native.js';

/** 一条「意图被丢弃」事件。 */
export interface DroppedIntent {
  /** 未被宿主实现的 NativeBridge 方法名（如 `setLight`）。 */
  method: string;
  /** 被调用次数。 */
  count: number;
  /** 最近一次实参的字符串化（供人判断"脚本到底想干什么"）。 */
  sample: string;
  /** 触发它的 opcode 集合（十六进制字符串，升序）。取自 `Engine.currentOpcode`。 */
  opcodes: string[];
  /** 一句话解释（为什么这条缺失会产生"无报错但效果不对"）。 */
  why: string;
}

/** 未实现方法的「为什么缺失不会报错」说明表（键 = 方法名）。 */
const WHY: Record<string, string> = {
  setLight: 'D3D 灯光开关：不实现 ⇒ 依赖灯光的 3D 元素亮度恒定，无报错',
  destroyL2DSlot: 'Live2D 实例槽销毁：不实现 ⇒ 立绘不消失/资源泄漏，无报错',
  l2dSlotSet: 'Live2D 槽参数（待纹理/待动作）：不实现 ⇒ 立绘永不出现或动作不切换，无报错',
  releaseMovieSlots: '销毁 movie/纹理槽 42..999：不实现 ⇒ 后续引用的图元仍画旧图，无报错',
  clearMeshSlots: '清 D3DX 网格层级槽：不实现 ⇒ 旧网格残留，无报错',
  clearSlotRecords: '清两张 1000×2 记录表：不实现 ⇒ 记录表残留，无报错',
  setRenderState: '渲染状态下发（设备状态 #22）：不实现 ⇒ 混合/裁剪等状态不生效，无报错',
  setTextureTransform: '纹理槽变换：不实现 ⇒ 图元变换不生效，无报错',
  drawString: '直绘文本到纹理槽：不实现 ⇒ 该离屏槽永远是空的（宿主只能当程序化纹理画成白块）⇒ UI 上整片文字消失，无报错',
  gfxSubsystem: '图形子系统参数：不实现 ⇒ 该图形对象行为不变，无报错',
  playMovie: '影片起播：不实现 ⇒ 黑屏/停在上一帧，无报错',
  playSound: '音效播放：不实现 ⇒ 无声，无报错',
  playBgm: 'BGM 播放：不实现 ⇒ 无 BGM，无报错',
  playVoice: '语音播放：不实现 ⇒ 无语音，无报错',
  preloadImage: '图像预载：不实现 ⇒ 首次绘制时才加载（闪一帧空图）或永远取不到纹理',
  sleep: '帧让步：不实现 ⇒ 节流失效/忙等，无报错',
  setFont: '字体设置：不实现 ⇒ 字形回退，无报错',
  setString: '字符串写入：不实现 ⇒ 文本内容不更新，无报错',
  stringResourceId: '字符串→资源 id：不实现 ⇒ 返回 -1 ⇒ 取不到图/串，无报错',
  getInputType: '输入类型查询：不实现 ⇒ 恒 0（可能走错输入分支）',
  menuBind: '菜单项登记：不实现 ⇒ 菜单查表失败 ⇒ 跳转到回退 label',
  menuReset: '菜单表复位：不实现 ⇒ 菜单项跨场景残留',
  unhandled: '未处理上报：不实现 ⇒ 未知指令不再进控制窗',
  present: '帧合成：不实现 ⇒ 画面永不刷新',
  frameTick: '帧刷新泵：不实现 ⇒ 动画/转场不推进',
  startFrameLoop: '帧循环启动：不实现 ⇒ 无每帧驱动',
};

/** 把实参串成一行短文本（截断，避免刷屏；只用于人看）。 */
export function formatArgs(args: unknown[]): string {
  const one = (v: unknown): string => {
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(3);
    if (typeof v === 'string') return JSON.stringify(v.length > 32 ? v.slice(0, 32) + '…' : v);
    if (v === null || v === undefined) return String(v);
    if (Array.isArray(v)) return `[${v.slice(0, 6).map(one).join(',')}${v.length > 6 ? ',…' : ''}]`;
    if (typeof v === 'object') {
      const keys = Object.keys(v as object).slice(0, 6);
      return `{${keys.map((k) => `${k}:${one((v as Record<string, unknown>)[k])}`).join(',')}}`;
    }
    return String(v);
  };
  const s = args.map(one).join(', ');
  return s.length > 120 ? s.slice(0, 120) + '…' : s;
}

/** 「意图被丢弃」记录器：按方法名聚合。 */
export class DropRecorder {
  private readonly events = new Map<string, DroppedIntent>();

  constructor(
    /** 取当前 opcode（用于把事件归因到指令）。返回 0 表示"不在指令上下文中"。 */
    private readonly currentOpcode: () => number = () => 0,
  ) {}

  note(method: string, args: unknown[]): void {
    const op = this.currentOpcode();
    const opHex = op > 0 ? `0x${op.toString(16)}` : '?';
    const e = this.events.get(method);
    if (e) {
      e.count++;
      e.sample = formatArgs(args);
      if (!e.opcodes.includes(opHex)) e.opcodes.push(opHex);
    } else {
      this.events.set(method, {
        method,
        count: 1,
        sample: formatArgs(args),
        opcodes: [opHex],
        why: WHY[method] ?? '宿主未实现该 native 方法 ⇒ 调用被静默丢弃',
      });
    }
  }

  /** 事件清单（按次数降序，便于先看影响最大的）。 */
  list(): DroppedIntent[] {
    return [...this.events.values()]
      .map((e) => ({ ...e, opcodes: [...e.opcodes].sort() }))
      .sort((a, b) => b.count - a.count || a.method.localeCompare(b.method));
  }

  count(): number {
    return this.events.size;
  }

  totalCalls(): number {
    let n = 0;
    for (const e of this.events.values()) n += e.count;
    return n;
  }

  clear(): void {
    this.events.clear();
  }
}

/**
 * `NativeBridge` 的**方法名清单**（`log` 与 `input` 之外的全部；`input` 是数据属性）。
 *
 * 为什么要显式列出来：Proxy 无法在 `get` 时区分"取一个方法"和"取一个数据属性"。
 * 如果对所有缺失属性都返回一个"记录器函数"，那么 `native.某个未实现的标志` 会变成**真值**，
 * 可能悄悄改变 `if (native.x)` 这类判断。列成白名单后：
 *  - 白名单内且宿主未实现 ⇒ 返回记录器（`?.()` 正常调用 + 留痕）；
 *  - 白名单外 ⇒ 返回 `undefined`（与"没有这个属性"完全一致）。
 *
 * 下面的 `_exhaustive` 是**编译期穷尽性检查**：`NativeBridge` 一旦新增方法而没加进本列表，
 * `Missing` 就非 `never`，赋值会立刻报类型错误。
 */
const BRIDGE_METHODS = [
  'bindTexture',
  'clearDrawContainer',
  'clearMeshSlots',
  'clearSlotRecords',
  'configureDrawItem',
  'createMesh',
  'createTexture',
  'destroyL2DSlot',
  'detachTexture',
  'drawCgNumber',
  'drawString',
  'drawTexture',
  'frameTick',
  'getInputType',
  'getTextureSize',
  'gfxSubsystem',
  'l2dSlotSet',
  'log',
  'menuBind',
  'menuReset',
  'msgWinClear',
  'msgWinClearAll',
  'msgWinSync',
  'playBgm',
  'playMovie',
  'playSound',
  'playVoice',
  'present',
  'releaseMovieSlots',
  'releaseTexture',
  'setDrawColor',
  'setDrawColorAlpha',
  'setDrawPivot',
  'setDrawPos',
  'setDrawTranslation',
  'setFlipbook',
  'setFont',
  'setLight',
  'setRenderState',
  'setRotationAnim',
  'setScale',
  'setScaleAnim',
  'setString',
  'setTexture',
  'setTextureTransform',
  'setTranslationAnim',
  'setVertexColor',
  'setVertexColorAlpha',
  'setWaitFlag',
  'sleep',
  'startFrameLoop',
  'stringResourceId',
  'texturesIdle',
  'unhandled',
] as const;

type BridgeMethodName = (typeof BRIDGE_METHODS)[number];
type ActualMethodName = {
  [K in keyof NativeBridge]-?: NonNullable<NativeBridge[K]> extends (...a: never[]) => unknown ? K : never;
}[keyof NativeBridge];
/** 编译期穷尽性检查：漏了任何 NativeBridge 方法，这里会报错。 */
type MissingMethod = Exclude<ActualMethodName, BridgeMethodName>;
const _exhaustive: MissingMethod extends never ? true : ['nativeTap 漏了方法', MissingMethod] = true;
void _exhaustive;

const BRIDGE_METHOD_SET: ReadonlySet<string> = new Set<string>(BRIDGE_METHODS);

/**
 * 用 Proxy 包一层 `inner`：**未实现的方法**（`inner[p] === undefined`）不再静默 ——
 * 记录事件后返回 `undefined`（与 `?.` 的语义一致：调用被丢弃，但留下了痕迹）。
 * 已实现的方法原样转发（`this` 绑定到 inner）。
 *
 * 两个细节：
 *  - `then` 一律返回 `undefined`（除非 inner 自己有），否则 Proxy 会被当成 thenable，`await` 会挂住；
 *  - 只有 `BRIDGE_METHODS` 白名单里的缺失属性才会得到"记录器"，其它属性保持 `undefined`。
 */
export function withNativeTap<T extends object>(inner: T, rec: DropRecorder): T {
  return new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop === 'then' && !(prop in target)) return undefined;
      const v = Reflect.get(target, prop, receiver) as unknown;
      if (typeof v === 'function') return (v as (...a: unknown[]) => unknown).bind(target);
      if (v !== undefined) return v;
      if (typeof prop !== 'string' || !BRIDGE_METHOD_SET.has(prop)) return v; // 非桥方法 ⇒ 与"不存在"一致
      return (...args: unknown[]): undefined => {
        rec.note(prop, args);
        return undefined;
      };
    },
    has(target, prop) {
      // 让 `p in native` 仍反映真实实现情况（便于自检/测试）
      return Reflect.has(target, prop);
    },
  });
}
