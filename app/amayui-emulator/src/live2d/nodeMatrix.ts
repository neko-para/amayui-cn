/**
 * Live2D **572B 立绘节点的矩阵合成器** —— 引擎 `sub_4A07F0`（raw **121131-121655**）的逐句直译。
 *
 * ## 为什么单独一层
 * `0x346`–`0x34D`（复位 / 立即缩放·旋转·平移 / 3 个目标窗）写下的字段**本身不出画**：
 * 引擎在**逐节点绘制那一次调用**里把 4 个窗求值、组合成一个矩阵，再右乘进 D3D 世界矩阵
 * （`sub_4B0360` raw 134341 是唯一调用点，raw 134385-134386 `world = world · nodeMatrix`）。
 * 这层是纯逻辑（无 I/O、无渲染），所以「报告」与「画面」能共用同一份结果（同源纪律见
 * `sceneModel.ts` 顶部）；消费端只有 `live2d/render.ts` 的 `l2dNodeTransform`。
 *
 * ## 组合式（★左右序判据 = `.lst` 的 push 序，不是推断）
 * `.lst` 266233-266235 与 266271-266275 两组都是
 * `push <pM2>; push esi(pOut); push esi(pM1); call j_D3DXMatrixMultiply`
 * ⇒ 实参 `(pOut=a3, pM1=a3, pM2=…)`，D3DX 语义 `pOut = pM1 · pM2` ⇒ **右乘 / 追加**，`a3` 是纯累加器：
 *
 * ```
 * a3_out = a3_in · T(−p) · M_base(+508) · M_scale · M_rot · M_trans · T(+p)
 * ```
 *
 * D3DX 是**行向量**约定（`v' = v·M`、平移在第 4 行），`Affine` 是**列向量**
 * （`x' = a*x + c*y + tx`）⇒ **取转置**：`a = M11, b = M12, c = M21, d = M22, tx = M[3][0], ty = M[3][1]`。
 * 对模型点 `q0`（顶点流只有 `{x,y,alpha}` ⇒ z ≡ 0，raw 148038-148053），令 `A = M_base·M_scale·M_rot`：
 *
 * ```
 * q = (q0 − p) · A + p + t
 * ```
 *
 * ⇒ **pivot 是 `A` 的作用中心**（`T(+p)` 把坐标搬回去）；**平移窗的 t 在图里、但不在 p 一侧**
 * ⇒ ★**pivot 不是"支持点不动"的不动点**：把 `q0 = p` 代进去得 `p + t`、不是 `p`；
 * 真正的不动点是 `p − t/(s−1)`（`t` 把不动点也带走了）。
 * 该式已用**真实 `d3dx9_43.dll`** 逐步重放核对（`.tmp/t0096b/D3dxComposeProbe.cs`）：
 * `pivot=(10,20)、A=2I、t=(3,4)` ⇒ `(0,0)→(−7,−16)`、`pivot→(13,24)`、`(100,50)→(193,84)`，
 * 与 `a3` 第 4 行 `[-7,-16,0,1]` 逐位一致。★`t` **不**被 `A` 单独作用（它在 `T(+p)` 之前、
 * 与 `−p` 一起被 `A` 缩放，最后再 `+p`）—— 见 `mul` 的合并律注释。
 *
 * ## 4 个窗与两道门（逐条对齐 raw 行号）
 * | 窗 | 体行号 | delay/dur | from（矩阵） | to |
 * |---|---|---|---|---|
 * | 1 颜色 | 121294-121328 | `+28`/`+48` | `+68` | `+72` |
 * | 2 缩放 | 121329-121443 | `+32`/`+52` | `+20..35` | `+36..51` |
 * | 3 旋转 | 121444-121524 | `+36`/`+56` | 轴 `+464..472`+角 `+488` | 轴 `+476..484`+角 `+492` |
 * | 4 平移 | 121525-121633 | `+40`/`+60` | `+84..99` | `+100..115` |
 *
 * - **门①** `record[0] & 2`（121259）：没有窗在跑 ⇒ 直接跳到组合段（`M_scale/rot/trans` 取自
 *   `+20`/`+52`/`+84` 的**当前 from 矩阵**，也就是立即值写的那些）；窗指令各自还有
 *   `record[0] & 1` 的门（raw 134157/134202/134254，见 `runtime.ts` 的 `winGate`）。
 * - **门②** `record+24 == 0 ⇒ = now`（121261-121265）：`+24` 是**窗序列的绝对起点(ms)**（不是倒计时），
 *   窗指令把它置 0 ⇒ 下一条窗指令重新锁存。★emulator 里就是 `wins.startedAtMs`。
 * - **窗末吸附**（`now >= start+delay+dur` 或 `winSkip`）：把 to 值吸附进 from、**delay = dur = 0**、
 *   `to ← I`（121301-121308 / 121341-121361 / 121452-121483 / 121612-121630）⇒ **冻在终值**。
 *   都吸附完 ⇒ `flags &= ~2`、`gate504 &= ~1`、`+24 = 0`、`M[11627] = 1`（121634-121641）。
 * - **`LODWORD(v105) == 1`**（121299/121339/121450/121533）= 对 `M[46512]` 的**整数比较** ⇒ 这里是
 *   `winSkip` 入参（默认 `false`）。另见 `sub_407EA0` raw 12789-12801（`(M[46528] & 2) == 0 ⇒ M[46512] = 1`）
 *   ⇒ 语义是「跳过动画/立即完成」，**未在 emulator 建模**（本作语料 `0x34B`/`0x34C` 为 0 处、`0x34D`
 *   只在 BTL，见票面）。同一字段在 121274/121291 又被当 alpha 用 ⇒ 类型冲突，登记为未确证。
 *
 * ## ★颜色窗（窗1）：实现并记录副作用，但**输出无消费者**
 * 唯一调用方 raw 134347 在 `sub_4A07F0` 返回后**立刻**把颜色出参当整数槽下标用
 * （`LODWORD(v27) = LODWORD(v29[1]) + 13953;`）⇒ 插值出的颜色**被丢弃**。
 * 但**不能**因此整块忽略：吸附分支**有副作用**（121301-121308，`.lst` 004A0A96-004A0AB3 逐字：
 * `[ebx+1Ch] = 0`（delay）、`[ebx+30h] = 0`（dur）、`[ebx+44h] = [ebx+48h]`（from ← to）、
 * `dword [ebx+48h] = 0FFFFFFFFh`（to 置 -1，**不是 NAN** —— `a2[18] = NAN` 是 Hex-Rays 把
 * 位模式 `0xFFFFFFFF` 渲染成了 NaN，见 §未确证项 4 的钉死）、`[eax] = edx`（*a4 = 旧 to））
 * ⇒ 函数**不是无副作用的**。本模块按体做，`returns.color` 由调用方忽略（消费端 `render.ts` 不读它），
 * 副作用（delay/dur 归零 + from ← to）**照做并在守卫里断言**。
 *
 * ## 与 raw 的三处口径说明
 * 1. **旋转轴归一化**：raw 121496-121517 把 lerp 后的轴**原样**喂给 `j_D3DXMatrixRotationAxis`
 *    （不 normalize）；但 `d3dx9_43.dll` 的 `D3DXMatrixRotationAxis` **内部会归一化**
 *    （实测：轴 `(0,0,2)` 与 `(0,0,1)` 结果逐位相同、`(3,0,4)` 与 `(0.6,0,0.8)` 逐位相同 ——
 *    d3dx9_43 是第三方 DLL，这是对**外部库行为**的实测，不是"猜引擎"；
 *    探针见 `.tmp/t0096b/d3dx-axis-probe.ps1`）⇒ 本模块在构造矩阵前**归一化**。
 *    `axisFrom ∥ axisTo` 反向（lerp 后长度为 0）时给单位阵（D3DX 那头是 0 除 ⇒ 无定义）。
 * 2. **帧首 alpha 分支**（121266-121288，`+64` / `+124` / `sub_499B60`/`sub_499A70`）**未建模**：
 *    `dbl_51FB50` 已核 = **1000.0**（`.lst` 427476 `.data:0051FB50 dq 1000.0` —— design.md §1.3 猜的
 *    100.0 是错的）⇒ `+64` 的单位是「alpha×1000」；本作语料无写 `+64` 的指令（`0x342`-`0x352` 里
 *    没有写者）⇒ 不可观测、且它只影响"实例 alpha"这条休眠通道。合成器只读槽的**当前 alpha 比例**，
 *    不写模型对象（`Sub_499A70` 那一路需要模型 vtable，属渲染层）。
 * 3. **`M[13949] = M[11625] − M[11626]`**（121258）写后再无读者 ⇒ 死写，不复现。
 */
import type { Affine } from './deform.js';
import { AFFINE_IDENTITY, affineMul } from './deform.js';

/** `dbl_5263F0` = **180.0**（`.lst` 429459）。 */
const DEG_PER_HALF_TURN = 180;
/** `dbl_526C98` = **3.141592741012573**（`.lst` 430014）⇒ 角度→弧度 = π/180。 */
const PI = 3.141592741012573;

/** 三分量（`+80` 缩放 / `+336` 平移 / `+8/+12/+16` 轴心）。 */
export type Vec3 = readonly [number, number, number];

/** 窗2（缩放，`+32`/`+52` + `+20..35` ←→ `+36..51`）。 */
export interface L2dScaleWindow {
  delay: number;
  dur: number;
  /** `+80..83` = 缩放 from（那个矩阵的对角三元组）。 */
  from: Vec3;
  /** `+144..147` = 缩放 to（`0x34B` 写）。 */
  to: Vec3;
}

/** 窗3（旋转，`+36`/`+56` + 轴 `+464..492` ←→ `+476..492`）。 */
export interface L2dRotationWindow {
  delay: number;
  dur: number;
  /** `+464/+468/+472` = 轴 from、`+488` = 角 from（**度**）。 */
  from: { axis: Vec3; deg: number };
  /** `+476/+480/+484` = 轴 to、`+492` = 角 to（**度**）。 */
  to: { axis: Vec3; deg: number };
}

/** 窗4（平移，`+40`/`+60` + `+84..99` ←→ `+100..115`）。 */
export interface L2dTranslationWindow {
  delay: number;
  dur: number;
  /** `+336..338` = 平移 from。 */
  from: Vec3;
  /** `+400..402` = 平移 to（`0x34D` 写）。 */
  to: Vec3;
}

/** ★窗1（颜色，`+28`/`+48` + `+68` ←→ `+72`）：**本作语料里没有设置端指令**（见模块头）。 */
export interface L2dColorWindow {
  delay: number;
  dur: number;
  /** `+68`（ARGB 内存序，低字节 = A，与 `sub_49CA10` 的 `+68 = 0xFF000000` 同口径）。 */
  from: number;
  /** `+72`。 */
  to: number;
}

/** 572B 记录的 4 个窗的**运行时**状态（合成器会就地改写它 —— 引擎 `a2` 不是拷贝）。 */
export interface L2dNodeWindows {  /** `+24`：窗序列**绝对起点(ms)**；`0` = 未激活 ⇒ 首次求值锁存 `nowMs`（不要拿它当倒计时）。 */
  startedAtMs: number;
  /**
   * 「`+24` 是否已锁存」—— ★emulator 专有的一个位，不是 572B 里的字段。
   *
   * 为什么必须有：引擎用 `+24 == 0` 当"未锁存"的哨兵，而 `+24 = 0` 同时**也是**一个合法的时钟值
   * （= 进程启动的那一毫秒）。emulator 的时钟从 0 开始（`scL2dTick(s, 0)` 就是首帧）⇒ 只按
   * `== 0` 判断会让首帧**每帧重新锁存**（窗永远开不了）。引擎里这个碰撞不可观测（`M[11625]`
   * 在真正出画时早已 ≫ 0），所以这里补一个显式位把语义写死：
   * `winGate`（窗指令写 `+24 = 0`）时置 `false`、首次求值置 `true`、全窗跑完置 `false`。
   */
  latched: boolean;
  /** `+24`（同上）。 */
  color: L2dColorWindow;
  scale: L2dScaleWindow;
  rotation: L2dRotationWindow;
  translation: L2dTranslationWindow;
}

/** 合成器要读/写的节点面（`L2dNode` 结构化满足它 ⇒ 不必转换）。 */
export interface L2dMatrixNode {
  /** `record[0]`：bit0 = `0x344` 建过（窗指令的门）；bit1 = `|= 2` 有窗在跑（合成器会清）。 */
  flags: number;
  /** `+8/+12/+16` = **pivot p**（缩/旋转中心）。 */
  baseOffset: Vec3;
  /** `+80..82`：立即缩放（`0x347`）。 */
  scale: Vec3;
  /** `+336..338`：立即平移（`0x349`）。 */
  translate: Vec3;
  /** `+208` 的轴角（`0x348`）。 */
  rotation: { axis: Vec3; deg: number };
  /** `+508..571`：基础矩阵（`0x346` 复位成单位阵）。 */
  matrixBase: Affine;
  /** `+504` bit0：置位 ⇒ 本帧 alpha 强制 0（除非 `alphaGateDisabled`）。 */
  gate504: number;
  /** `+76`：「节点矩阵有效」位（合成器置位；`0x346` 清）。 */
  matrixDirty: boolean;
  /** 合成结果（`sub_4A07F0` 写进 `Scene+46536` 的那块）。 */
  matrix: Affine;
  wins: L2dNodeWindows;
}

/** 合成器要读的 L2D 实例面（`L2dInstance` 结构化满足它的一部分）。 */
export interface L2dAlphaSlot {
  /** 例：`alpha1000 / 1000`（引擎缺省 `M[46512] = 1000` 对应 alpha = 1）。 */
  alpha?: number;
}

/** 帧级输入（`M` 上的两个标志；emulator 里都没有对应字段 ⇒ 调用方按缺省给）。 */
export interface L2dComposeFrame {
  /** `LODWORD(M[46512]) == 1` ⇒ 「跳过动画/立即完成」：4 个窗全部走吸附分支（未在 emulator 建模）。 */
  winSkip?: boolean;
  /** `(M[46528] & 4) != 0` ⇒ 关掉 `+504 bit0` 的 alpha 强制 0。 */
  alphaGateDisabled?: boolean;
}

/** 合成结果。 */
export interface L2dComposeResult {
  /** 节点矩阵（`Scene+46536`）；`matrixDirty` 为假时它是单位阵。 */
  matrix: Affine;
  /**
   * `*a4`：本帧 ARGB（低字节 = A，与 `+68`/`+72` 同序）。
   * ★**唯一调用方 raw 134347 把它丢弃**（当整数槽下标用）⇒ 消费端不要读它；见模块头。
   */
  color: number;
  /** 本帧节点 alpha（`+504 bit0` 门控；引擎把它写进顶点流的第 3 个 float）。 */
  alpha: number;
  /** **副作用**（`*a4` 之外）：合成器是否清掉了 `flags & 2`（全部窗跑完）。 */
  windowsFinished: boolean;
}

/** 节点缺省矩阵（`sub_49CA10` raw 118493 的 `+496` = 1.0 与 4 块单位阵）。 */
export const L2D_NODE_ALPHA_SCALE_DEFAULT = 1;
/** 引擎缺省 alpha（`M[46512]` 初始化成 1000 ⇒ 1.0）。 */
export const L2D_ALPHA_DEFAULT = 1;

/** `sub_49CA10`（raw 118402-118513）的窗缺省：delay/dur = 0、from = to = 单位值。 */
export function makeNodeWindows(): L2dNodeWindows {
  return {
    startedAtMs: 0,
    latched: false,
    color: { delay: 0, dur: 0, from: 0xff000000, to: 0xff000000 },
    scale: { delay: 0, dur: 0, from: [1, 1, 1], to: [1, 1, 1] },
    rotation: { delay: 0, dur: 0, from: { axis: [0, 0, 1], deg: 0 }, to: { axis: [0, 0, 1], deg: 0 } },
    translation: { delay: 0, dur: 0, from: [0, 0, 0], to: [0, 0, 0] },
  };
}

// ── 基本矩阵构造（D3DX 行向量 → `Affine` 列向量，取转置） ────────────────────────────

/** `D3DXMatrixScaling`：`[sx,0, 0,sy, 0,0]`（raw 134051 / 134172）。 */
function affineScaling(sx: number, sy: number): Affine {
  return [sx, 0, 0, sy, 0, 0];
}

/** `D3DXMatrixTranslation`：`[1,0, 0,1, tx,ty]`（raw 134122 / 134269；z 不进 2×3，见 §z 分量）。 */
function affineTranslation(tx: number, ty: number): Affine {
  return [1, 0, 0, 1, tx, ty];
}

/**
 * `m2 · m1`（D3DX 行向量口径的矩阵积）—— 与 `sub_4A07F0` 的 `a3 = a3 · M` 右乘**逐位一致**。
 *
 * ## 三个约定必须一次说清（否则 pivot 会算错）
 * 1. **D3DX 是行向量**：点变换 `q' = q · M`（`q = (x, y, 0, 1)`）、**平移在第 4 行**
 *    —— 实测：`D3DXMatrixTranslation(1,0,0)` 得到 `m30 = 1`、其余对角为 1
 *    （`.tmp/t0096b/d3dx-convention-probe`）。
 * 2. **`Affine`（本工程 `deform.ts`）是列向量**：`[a, b, c, d, tx, ty]`、
 *    `x' = a·x + c·y + tx`、`y' = b·x + d·y + ty`。两者互转只有一种写法：
 *    `a = M[0][0]`、`b = M[0][1]`、`c = M[1][0]`、`d = M[1][1]`、`tx = M[3][0]`、`ty = M[3][1]`
 *    （左上 2×2 **取转置**、平移取第 4 行）。
 * 3. **合并律**：行向量下 `q·(M1·M2) = (q·M1)·M2` ⇒ `M1` 先作用（**读法 = 从左到右**）。
 *    把 1+2 套进 `M1·M2`（`Mi = [[Ai|0],[ti|1]]`）⇒ 用 `Affine`（列向量）表示时
 *    **线性部分 = `A2·A1`、平移 = `t1`（在 `M2` 的线性部分里）`+ t2` = `A2·t1 + t2`**。
 *
 * ## 判据（不是推断；★平移项最容易写错，两个错误版本都得到过错值）
 * `.tmp/t0096b/D3dxComposeProbe.cs` 用**真实 `d3dx9_43.dll`** 逐步重放
 * `a3 = I · T(−p) · M_scale · T(t) · T(+p)`（pivot=(10,20)、s=2、t=(3,4)）：
 *
 * | 步 | `a3` 平移 | 说明 |
 * |---|---|---|
 * | `·T(−p)` | `(−10,−20)` | |
 * | `·M_scale` | `(−20,−40)` | = `2·(−10,−20)` ⇒ 平移被**后作用**的线性部分放大 |
 * | `·T(t)` | `(−17,−36)` | = `2·(−10,−20) + (3,4)` |
 * | `·T(+p)` | `(−7,−16)` | ★最终 `a3` 第 4 行 = `[-7, -16, 0, 1]` |
 *
 * ⇒ 点映射 `q = (q0 − p)·s + p + t`（`(0,0) → (−7,−16)`、`pivot → (13,24)`、`(100,50) → (193,84)`）
 * —— 与 design.md 的点公式**一致**。★但**pivot 不是"支持点不动"的缩/旋转中心**：
 * 它只出现在 `T(−p)`/`T(+p)` 里，而 `T(t)` 在 `T(+p)` 之前 ⇒ 不动点是 `p − t/(s−1)`（t 把不动点带走了）。
 */
function mul(m2: Affine, m1: Affine): Affine {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

/**
 * `D3DXMatrixRotationAxis` 的 **2×2 部分**（取 z ≡ 0 的行/列）。
 *
 * ★**先归一化**：`.c` 里轴是原样传进去的（raw 121504-121517），归一化发生在 `d3dx9_43.dll` 内部
 * （实测，见模块头第 1 条）。`Affine` 是列向量、D3DX 是行向量 ⇒ `a = M11`、`b = M12`（即 −sin）、
 * `c = M21`（sin）、`d = M22`。
 */
function affineRotation(axis: Vec3, deg: number): Affine {
  const len = Math.sqrt(axis[0] * axis[0] + axis[1] * axis[1] + axis[2] * axis[2]);
  if (len === 0) return AFFINE_IDENTITY; // D3DX 那头是 0 除 ⇒ 无定义（axisFrom ∥ axisTo 反向时可达）
  const x = axis[0] / len;
  const y = axis[1] / len;
  const z = axis[2] / len;
  const rad = (deg * PI) / DEG_PER_HALF_TURN;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const t = 1 - c;
  // D3D 行向量矩阵的 M11/M12/M21/M22（标准 Rodrigues，与 d3dx9_43 实测逐位一致）
  const m11 = t * x * x + c;
  const m12 = t * x * y + s * z;
  const m21 = t * x * y - s * z;
  const m22 = t * y * y + c;
  return [m11, m12, m21, m22, 0, 0];
}

/** 立即缩放矩阵（`0x347` 写的 `+80`）。 */
function immediateScaleMatrix(node: L2dMatrixNode): Affine {
  return affineScaling(node.scale[0], node.scale[1]);
}

/** 立即旋转矩阵（`0x348` 写的 `+208` 轴角）。 */
function immediateRotationMatrix(node: L2dMatrixNode): Affine {
  return affineRotation(node.rotation.axis, node.rotation.deg);
}

/** 立即平移矩阵（`0x349` 写的 `+336`）。 */
function immediateTranslationMatrix(node: L2dMatrixNode): Affine {
  return affineTranslation(node.translate[0], node.translate[1]);
}

// ── 颜色（窗1）：D3DCOLOR 口径，逐字节整数插值（raw 121311-121327） ─────────────────────

/**
 * 颜色分量的字节序 —— **两个独立证据都指向同一个结论**：
 *  - `sub_49CA10` raw 118478 把 `record+68` 初始化成 **`0xFF000000`**（不透明的黑）；
 *  - `.lst` 004A0A50-004A0A65 从 `[ebx+48h]` 取 **`shr edx,18h`** 当"red"（`+0x48` = `+72` = **to**）、
 *    从 `[ebx+44h]`（= `+68` = from）取分量 ⇒ Hex-Rays 的 `HIBYTE` = **最高字节**。
 * ⇒ 内存 dword 的字节序 = **`0xAARRGGBB`**（低字节 = B、最高字节 = A），逐字节插值**按字节**做
 * （`+0`=B / `+1`=G / `+2`=R / `+3`=A —— 与颜色窗无关，结果都是同一组 4 个字节的线性组合）。
 */
export function colorBlue(c: number): number {
  return c & 0xff;
}
/** 绿（`+1`）。 */
export function colorGreen(c: number): number {
  return (c >>> 8) & 0xff;
}
/** 红（`+2`）。 */
export function colorRed(c: number): number {
  return (c >>> 16) & 0xff;
}
/** 不透明分量（`+3`，最高字节）—— `sub_49CA10` 的初值 `0xFF000000` 就是"alpha = 0xFF"。 */
export function colorAlpha(c: number): number {
  return (c >>> 24) & 0xff;
}

/** 4 个分量 → dword（与上面四个函数互逆；`0xAARRGGBB`）。 */
export function packColor(a: number, r: number, g: number, b: number): number {
  return (((a & 0xff) << 24) | ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff)) >>> 0;
}

/**
 * `(to*elapsed + from*remaining) / dur` —— 引擎对**每一个字节**分别做的整数运算
 * （raw 121315-121324，`.lst` 004A09F2-004A0A80：`imul` + `add` + `xor edx,edx` + `div` 后 `and 0FFh`）
 * ⇒ 截断取整、单字节权重都按 int 算。
 */
function lerpByte(from: number, to: number, elapsed: number, remaining: number, dur: number): number {
  return Math.trunc((to * elapsed + from * remaining) / dur) & 0xff;
}

function lerpColor(from: number, to: number, elapsed: number, remaining: number, dur: number): number {
  return packColor(
    lerpByte(colorAlpha(from), colorAlpha(to), elapsed, remaining, dur),
    lerpByte(colorRed(from), colorRed(to), elapsed, remaining, dur),
    lerpByte(colorGreen(from), colorGreen(to), elapsed, remaining, dur),
    lerpByte(colorBlue(from), colorBlue(to), elapsed, remaining, dur),
  );
}

// ── 4 个窗 ────────────────────────────────────────────────────────────────────────

/** 窗的三种结果（`v107` / `goto LABEL_40` / `v107 = 1` 三支）。 */
export type L2dWindowState = 'absorb' | 'inside' | 'waiting';

/**
 * **窗1 颜色**（raw 121294-121328）。返回本帧颜色（吸附时 = 旧 to）。
 *
 * ★副作用（吸附时）：`delay = dur = 0`、`from ← to`、`to ← 0xFFFFFFFF`（照体；`*a4` 由调用方丢弃）。
 */
export function advanceColorWindow(w: L2dColorWindow, startMs: number, nowMs: number, winSkip: boolean): {
  color: number;
  state: L2dWindowState;
} {
  if (w.dur <= 0) return { color: w.from, state: 'absorb' };
  const delay = w.delay;
  if (nowMs >= startMs + delay + w.dur || winSkip) {
    const to = w.to;
    w.delay = 0;
    w.dur = 0;
    w.from = to; // 121305 `*((_DWORD *)a2 + 17) = v21`
    w.to = 0xffffffff; // 121306 `a2[18] = NAN` = 位模式 0xFFFFFFFF（不是浮点 NaN）
    return { color: to, state: 'absorb' };
  }
  if (nowMs > startMs + delay) {
    const elapsed = nowMs - startMs - delay;
    const remaining = startMs + w.dur + delay - nowMs;
    return { color: lerpColor(w.from, w.to, elapsed, remaining, w.dur), state: 'inside' };
  }
  return { color: w.from, state: 'waiting' };
}

/** **窗2 缩放**（raw 121329-121443）：from/to 是三分量，插值后**现算矩阵**（与 `+20`/`+36` 等价）。 */
export function advanceScaleWindow(w: L2dScaleWindow, startMs: number, nowMs: number, winSkip: boolean): {
  matrix: Affine;
  state: L2dWindowState;
} {
  if (w.dur <= 0) return { matrix: affineScaling(w.from[0], w.from[1]), state: 'absorb' };
  const delay = w.delay;
  if (nowMs >= startMs + delay + w.dur || winSkip) {
    const to = w.to;
    w.delay = 0;
    w.dur = 0;
    w.from = to; // 121343 `qmemcpy(a2 + 20, a2 + 36, 0x40u)`
    w.to = [1, 1, 1]; // 121344-121361 `M_scale_to := I`
    return { matrix: affineScaling(to[0], to[1]), state: 'absorb' };
  }
  if (nowMs > startMs + delay) {
    const elapsed = nowMs - startMs - delay;
    const remaining = startMs + w.dur + delay - nowMs;
    const v: number[] = [];
    for (let i = 0; i < 3; i++) v.push((w.to[i]! * elapsed + w.from[i]! * remaining) / w.dur);
    return { matrix: affineScaling(v[0]!, v[1]!), state: 'inside' };
  }
  return { matrix: affineScaling(w.from[0], w.from[1]), state: 'waiting' };
}

/**
 * **窗3 旋转**（raw 121444-121524）：★**不是矩阵插值** —— 轴与角分别 lerp 后**重算矩阵**
 * （121496-121517），轴**不归一化地 lerp**（归一化发生在 D3DX 内部，见模块头）。
 */
export function advanceRotationWindow(w: L2dRotationWindow, startMs: number, nowMs: number, winSkip: boolean): {
  matrix: Affine;
  state: L2dWindowState;
} {
  if (w.dur <= 0) return { matrix: affineRotation(w.from.axis, w.from.deg), state: 'absorb' };
  const delay = w.delay;
  if (nowMs >= startMs + delay + w.dur || winSkip) {
    const to = w.to;
    w.delay = 0;
    w.dur = 0;
    w.from = to; // 121467 `qmemcpy(a2 + 52, a2 + 68, 0x40u)` + 轴角（121459-121466 复制的就是 to 的轴角）
    w.to = { axis: [0, 0, 1], deg: 0 }; // 121468-121483 `M_rot_to := I`
    return { matrix: affineRotation(to.axis, to.deg), state: 'absorb' };
  }
  if (nowMs > startMs + delay) {
    const elapsed = nowMs - startMs - delay;
    const remaining = startMs + w.dur + delay - nowMs;
    const axis: number[] = [];
    for (let i = 0; i < 3; i++) axis.push((w.to.axis[i]! * elapsed + w.from.axis[i]! * remaining) / w.dur);
    const deg = (w.to.deg * elapsed + w.from.deg * remaining) / w.dur;
    return { matrix: affineRotation([axis[0]!, axis[1]!, axis[2]!], deg), state: 'inside' };
  }
  return { matrix: affineRotation(w.from.axis, w.from.deg), state: 'waiting' };
}

/** **窗4 平移**（raw 121525-121633）。★注意吸附分支在 `now >= start+delay+dur` **或** `winSkip` 时走。 */
export function advanceTranslationWindow(
  w: L2dTranslationWindow,
  startMs: number,
  nowMs: number,
  winSkip: boolean,
): { matrix: Affine; state: L2dWindowState } {
  if (w.dur <= 0) return { matrix: affineTranslation(w.from[0], w.from[1]), state: 'absorb' };
  const delay = w.delay;
  if (nowMs >= startMs + delay + w.dur || winSkip) {
    const to = w.to;
    w.delay = 0;
    w.dur = 0;
    w.from = to; // 121614 `qmemcpy(a2 + 84, a2 + 100, 0x40u)`
    w.to = [0, 0, 0]; // 121615-121630 `M_trans_to := I`
    return { matrix: affineTranslation(to[0], to[1]), state: 'absorb' };
  }
  if (nowMs > startMs + delay) {
    const elapsed = nowMs - startMs - delay;
    const remaining = startMs + w.dur + delay - nowMs;
    const v: number[] = [];
    for (let i = 0; i < 3; i++) v.push((w.to[i]! * elapsed + w.from[i]! * remaining) / w.dur);
    return { matrix: affineTranslation(v[0]!, v[1]!), state: 'inside' };
  }
  return { matrix: affineTranslation(w.from[0], w.from[1]), state: 'waiting' };
}

// ── 合成器 ────────────────────────────────────────────────────────────────────────

/** 取节点 alpha：`+64` 未建模 ⇒ 用槽的 alpha（缺省 1）× `+496` 的 alpha 比例。 */
function nodeAlpha(node: L2dMatrixNode, slot?: L2dAlphaSlot): number {
  return (slot?.alpha ?? L2D_ALPHA_DEFAULT) * L2D_NODE_ALPHA_SCALE_DEFAULT;
}

/**
 * 「窗的 from 侧 ↔ 节点的立即值」双向同步（emulator 侧的结构性辅助，不是 raw 的一步）。
 *
 * 引擎里它们是**同一块内存**（`0x347`/`0x348`/`0x349` 写 `+20`/`+52`/`+84`，窗读的也是它）；
 * `L2dNode` 把它们拆成了 `node.scale/rotation/translate`（立即值）与 `wins.*.from`（窗起点）。
 * 本函数让两者**先按"立即值是当前值"对齐**（写窗时的那一次），合成结束时再反向灌回
 * （`syncWindowsBack`）⇒ 语义与"同一块内存"等价。
 */
export function syncWindowsFromFields(node: L2dMatrixNode): void {
  node.wins.scale.from = node.scale;
  node.wins.rotation.from = { axis: node.rotation.axis, deg: node.rotation.deg };
  node.wins.translation.from = node.translate;
}

/** 反向同步（合成器跑完后）：把窗的 from 写回节点的立即字段（= 引擎同一块内存的读法）。 */
export function syncWindowsBack(node: L2dMatrixNode): void {
  node.scale = [...node.wins.scale.from] as [number, number, number];
  node.rotation = {
    axis: [...node.wins.rotation.from.axis] as [number, number, number],
    deg: node.wins.rotation.from.deg,
  };
  node.translate = [...node.wins.translation.from] as [number, number, number];
}

/**
 * **`sub_4A07F0`（raw 121131-121655）**：求值 4 个窗 + 组合节点矩阵 + 就地推进窗状态。
 *
 * @param node 572B 记录的镜像（**会被就地改写**：窗的 delay/dur/from/to、`flags`、`gate504`、
 *             `startedAtMs`、`matrixDirty`、`matrix` —— 与引擎 `a2` 不是拷贝一致）
 * @param nowMs 帧时钟（毫秒；引擎 `M[11625]`，`scL2dTick` 已收）
 * @param frame `M` 上的两个标志（`winSkip` / `alphaGateDisabled`），缺省全 `false`
 * @param slot 实例槽（只读 alpha；`+64` 那条休眠通道不建模）
 */
/**
 * **本节点的窗还在跑吗**（纯读、**不推进也不改窗**）—— 合成判据 `scAnimationsPending` 用
 * （`tickets/T-0054` 的 M3 `live2d-slot-probe`；引擎的等价物 = `sub_40BE10` 读 `Scene+55812`
 * 的 10 个实例槽，raw 16022 那一带）。
 *
 * 为什么不能靠"跑一次合成看返回值"来问：合成器**会就地吸收**跑完的窗（`dur = 0` 且 `from ← to`，
 * raw 121305/121343/121467/121614）—— 用它当探针就等于把这一帧的推进提前吃掉。
 *
 * 判据逐条对齐 `advance*Window` 的 `state`：
 *  - `flags & 2 == 0`（没有窗配置）⇒ 不在跑；
 *  - `!wins.latched`（窗指令刚写过、还没锁存起点）⇒ **在跑**（引擎那一路是 `waiting`，118261 的 `v107 = 1`）；
 *  - 某个窗 `dur > 0` 且 `nowMs < startedAtMs + delay + dur` ⇒ 在跑（`waiting`/`inside`）；
 *  - 到点或 `dur <= 0` ⇒ 不在跑（`absorb`，与引擎"吸附分支不置 v107"同口径）。
 */
export function l2dNodeWindowsPending(node: L2dMatrixNode, nowMs: number): boolean {
  if ((node.flags & 2) === 0) return false;
  const wins = node.wins;
  if (!wins.latched) return true;
  const start = wins.startedAtMs;
  const live = (w: { delay: number; dur: number }): boolean => w.dur > 0 && nowMs < start + w.delay + w.dur;
  return live(wins.color) || live(wins.scale) || live(wins.rotation) || live(wins.translation);
}

export function l2dComposeNode(
  node: L2dMatrixNode,
  nowMs: number,
  frame: L2dComposeFrame = {},
  slot?: L2dAlphaSlot,
): L2dComposeResult {
  const winSkip = frame.winSkip === true;
  const alphaGateDisabled = frame.alphaGateDisabled === true;
  const wins = node.wins;
  // 引擎里窗的 from 与立即值是同一块内存 ⇒ 每次求值前按"立即值是当前值"对齐（结构性辅助）
  syncWindowsFromFields(node);
  let color = wins.color.from;
  let alpha = nodeAlpha(node, slot);

  // 门①（121259）：没有窗在跑 ⇒ 只走组合段（立即值写的矩阵就是"当前值"）
  if ((node.flags & 2) !== 0) {
    // 门②（121261-121265）：`+24` 为 0 ⇒ 锁存绝对起点（不是倒计时）
    if (!wins.latched) {
      wins.startedAtMs = nowMs;
      wins.latched = true;
      // ★此处引擎还做「帧首 alpha 分支」（121266-121288，读 `+64`/`+124` 写实例 alpha）——
      //   本作语料无可达写者，未建模；见模块头口径说明 2。
    }
    // alpha 门（121290-121293）：`+504 bit0` 置位且 `(M[46528] & 4) == 0` ⇒ alpha = 0
    if ((node.gate504 & 1) !== 0 && !alphaGateDisabled) alpha = 0;

    const start = wins.startedAtMs;
    // `v107`：本轮"还有窗在跑"（吸附分支**不**置 1；窗内与"窗未开"都置 1）
    let running = false;

    const c1 = advanceColorWindow(wins.color, start, nowMs, winSkip);
    color = c1.color;
    if (c1.state !== 'absorb') running = true; // 121326 `v107 = 1`

    const c2 = advanceScaleWindow(wins.scale, start, nowMs, winSkip);
    if (c2.state !== 'absorb') running = true; // 121441

    const c3 = advanceRotationWindow(wins.rotation, start, nowMs, winSkip);
    if (c3.state !== 'absorb') running = true; // 121522

    const c4 = advanceTranslationWindow(wins.translation, start, nowMs, winSkip);
    if (c4.state !== 'absorb') running = true; // 121610 `goto LABEL_40`（标注 121441/121522 形态）

    // 组合（121649-121654）：`a3 = T(−p) · M_base · M_scale · M_rot · M_trans · T(+p)`
    const p = node.baseOffset;
    let m = affineTranslation(-p[0], -p[1]);
    m = mul(m, node.matrixBase);
    m = mul(m, c2.matrix);
    m = mul(m, c3.matrix);
    m = mul(m, c4.matrix);
    m = mul(m, affineTranslation(p[0], p[1]));
    node.matrix = m;
    // ★`+76`（`matrixDirty`）**不**在这里置位：引擎里它只由 `0x347`-`0x34D` 的写者置、`0x346` 清；
    //   求值本身不写它。emulator 的 `l2dNodeTransform` 直接读 `node.matrix`（不拿 `+76` 当门）
    //   ⇒ 这里保持它是"写者语义的镜像"即可，免得诊断字段与引擎对不上。

    if (!running) {
      // 121634-121641：全窗跑完 ⇒ `flags &= ~2`、`+504 &= ~1`、`+24 = 0`、`M[11627] = 1`
      node.flags &= ~2;
      node.gate504 &= ~1;
      wins.startedAtMs = 0;
      wins.latched = false;
    } else if ((node.gate504 & 1) === 0) {
      // 121644-121645：`if ((record[+504] & 1) == 0) M[11629] = 1;`（M 级"有节点在动"位；emulator 无对应字段）
    }
    syncWindowsBack(node);
    return { matrix: m, color, alpha, windowsFinished: !running };
  }

  // 门① 未开 ⇒ 121649-121654 照跑，但三个窗矩阵取**立即值**（= `+20`/`+52`/`+84` 的当前内容）；
  // ★`+76` **不置位**（那是 `0x347`-`0x34D` 的写者干的），与引擎一致
  const p = node.baseOffset;
  let m = affineTranslation(-p[0], -p[1]);
  m = mul(m, node.matrixBase);
  m = mul(m, immediateScaleMatrix(node));
  m = mul(m, immediateRotationMatrix(node));
  m = mul(m, immediateTranslationMatrix(node));
  m = mul(m, affineTranslation(p[0], p[1]));
  node.matrix = m;
  syncWindowsBack(node);
  return { matrix: m, color, alpha, windowsFinished: false };
}
