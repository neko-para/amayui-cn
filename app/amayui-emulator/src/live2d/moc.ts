/**
 * Live2D **Cubism 2.x `.moc`** 解析器（本作 = SDK 2.0.06 for DirectX，文件 `version = 10`）。
 *
 * ## 来源（见 docs-new/04-app/live2d-support-assessment.md §3.5 的参考源纪律）
 *  - **S1** 官方 Cubism 2.1 Web SDK `live2d.min.js`（混淆；本作 exe 内嵌的 2.0.06 与之同代）
 *  - **S2** `EasyLive2D/live2d-v2`（S1 的 Python 直译，命名可读）
 *  - **S3** `NiaBie/FreeLive`（C# 独立实现）
 *  - **O** 反编译 oracle：`engine/天结_unpacked.exe_utf8.c`（本作真正用的那一版；行号标在各处）
 *  - **E** 资产实证：`test/live2d-moc.test.ts` 用**全部 335 个真实 `.MOC`** 校验（字节恰好读完 + EOF 标识 + 结构不变量）
 *
 * ## 容器（O: `sub_4BD560` raw 143843-143945）
 * ```
 * "moc" + u8 version + 对象图 +（version>=8）EOF 标识（大端 u32 = 0x88888888）
 * ```
 * ## 对象图（O: `sub_4C7220` raw 152026-152322）
 * `<varint 类型标签><载荷>`；**每个**对象（含 null / 字符串 / 数组）按**后序**进 refno 表；
 * 标签 33 = 引用：`u8 33` + **大端 i32** 下标（只能引用已读过的对象）。
 * ## 数值编码
 *  - 变长整数：**大端 base-128**（首字节 = 高 7 位；最高位 1 = 继续；≤4 字节）
 *  - 定宽数值：**大端**（i32/f32/f64）
 *  - 字符串：varint 字节长度 + 原始字节（实测全 ASCII；去重靠 refno）
 *  - 位读取：字节内 MSB→LSB（O: `sub_4C6E30` raw 151829-151853）；每次读对象前重置位游标
 */

// ───────────────────────────── 类型标签（O: 工厂 sub_4CA280 raw 154663-154764） ─────────────────────────────

export const MOC_TAG = {
  null: 0,
  string: 1,
  color: 10,
  rectD: 11,
  rectF: 12,
  pointD: 13,
  pointF: 14,
  objectArray: 15,
  intArray: 16,
  matrix2x3: 17,
  rect: 21,
  point: 22,
  intArray2: 25,
  doubleArray: 26,
  floatArray: 27,
  objectRef: 33,
  drawDataId: 50,
  baseDataId: 51,
  paramId: 60,
  partsDataId: 134,
  bdBoxGrid: 65,
  pivotManager: 66,
  paramPivots: 67,
  bdAffine: 68,
  affineEnt: 69,
  drawData: 70,
  paramDefFloat: 131,
  partsData: 133,
  modelImpl: 136,
  paramDefSet: 137,
  avatar: 142,
} as const;

// ───────────────────────────── 语义模型 ─────────────────────────────

export type MocIdClass = 'draw' | 'base' | 'param' | 'parts';
export interface MocId {
  kind: 'id';
  idClass: MocIdClass;
  name: string;
}

/** ParamPivots：某参数上的关键值列表（O: `sub_4CDE00` raw 157837-157849）。 */
export interface MocParamPivots {
  paramId: MocId | null;
  pivotCount: number;
  pivotValues: number[];
}

/** PivotManager：控制本对象的所有参数（O: `sub_4CA9B0` raw 155011-155018）。 */
export interface MocPivotManager {
  /** 组合数 = ∏ pivotCount；`params[0]` 是**最快变化**的一位（S2 `pivot_manager.py:99-133`） */
  params: MocParamPivots[];
}

export interface MocAffineEnt {
  originX: number;
  originY: number;
  scaleX: number;
  scaleY: number;
  rotationDeg: number;
  reflectX: boolean;
  reflectY: boolean;
}

interface DeformerCommon {
  id: MocId | null;
  /** 父变形器 */
  targetId: MocId | null;
  pivotManager: MocPivotManager | null;
  /** version>=10：每组合一个不透明度 */
  pivotOpacities: number[];
}

/** 旋转变形器（O: `sub_4CCB10` raw 156973-156980）。 */
export interface MocBdAffine extends DeformerCommon {
  kind: 'bdAffine';
  /** ∏pivots 个关键帧 */
  affines: MocAffineEnt[];
}

/** 曲面（弯曲）变形器（O: `sub_4CEDF0` raw 158689-158702）。 */
export interface MocBdBoxGrid extends DeformerCommon {
  kind: 'bdBoxGrid';
  /** **先读**：列数 */
  columnCount: number;
  /** **后读**：行数（网格底层数组的快变方向长度为 rowCount+1） */
  rowCount: number;
  /** ∏pivots 个网格，每个 `(row+1)*(col+1)*2` 个 float（x,y 交错） */
  pivotPoints: number[][];
}

export type MocDeformer = MocBdAffine | MocBdBoxGrid;

/** 网格（O: `sub_4C9E20` raw 154439-154458 + `sub_4C8A60` raw 153283-153342）。 */
export interface MocDrawData {
  kind: 'drawData';
  id: MocId | null;
  /** 绑定的变形器 */
  targetId: MocId | null;
  pivotManager: MocPivotManager | null;
  averageDrawOrder: number;
  /** ∏pivots 个绘制序（内联 i32 数组） */
  pivotDrawOrders: number[];
  /** ∏pivots 个不透明度（内联 f32 数组） */
  pivotOpacities: number[];
  /** version>=11 的裁剪遮罩 ID（本作 v10 恒为空） */
  clipId: MocId | null;
  /** 纹理槽号（0..9；-1 = 无） */
  textureNo: number;
  pointCount: number;
  polygonCount: number;
  /** 三角索引（应为 `polygonCount*3` 个） */
  indexArray: number[];
  /** ∏pivots 组顶点坐标（每组 `pointCount*2` 个，x,y 交错） */
  pivotPoints: number[][];
  /** `pointCount*2` 个 UV */
  uvs: number[];
  optionFlag: number;
  colorGroupNo: number | null;
  /** `(optionFlag & 30) >> 1`：0 正常 / 1 加算 / 2 乘算 */
  colorCompositionType: number;
  /** `optionFlag & 32` ⇒ 不剔除 */
  culling: boolean;
}

/** 部件（O: `sub_4C9EF0` raw 154476-154489）。 */
export interface MocParts {
  kind: 'parts';
  locked: boolean;
  visible: boolean;
  id: MocId | null;
  deformers: MocDeformer[];
  drawables: MocDrawData[];
}

export interface MocParamDef {
  kind: 'paramDef';
  min: number;
  max: number;
  defaultValue: number;
  id: MocId | null;
}

export interface MocStats {
  version: number;
  objects: number;
  byTag: Record<string, number>;
  bytesRead: number;
  bytesTotal: number;
  eofMarker: boolean;
}

export interface MocModel {
  kind: 'model';
  params: MocParamDef[];
  parts: MocParts[];
  canvasWidth: number;
  canvasHeight: number;
  stats: MocStats;
}

// ───────────────────────────── 读取器 ─────────────────────────────

export class MocParseError extends Error {
  constructor(
    message: string,
    readonly pos: number,
    readonly total: number,
  ) {
    super(`${message} @ byte ${pos}/${total}`);
  }
}

type Raw = unknown;

class Reader {
  pos = 0;
  private readonly objects: Raw[] = [];
  private bitByte = 0;
  private bitLeft = 0;
  readonly byTag: Record<string, number> = {};
  /** 读过的类型标签（= refno 表顺序，诊断用） */
  readonly trace: number[] = [];

  constructor(
    private readonly buf: Uint8Array,
    readonly version: number,
  ) {}

  private fail(msg: string): never {
    throw new MocParseError(msg, this.pos, this.buf.length);
  }

  /** 位游标复位（每次读对象前；不后退字节流） */
  private checkBits(): void {
    this.bitLeft = 0;
  }

  private need(n: number, what: string): void {
    if (this.pos + n > this.buf.length) this.fail(`read past end (${what})`);
  }

  private u8Raw(): number {
    this.need(1, 'u8');
    return this.buf[this.pos++]!;
  }

  u8(): number {
    this.checkBits();
    return this.u8Raw();
  }

  i32(): number {
    this.checkBits();
    this.need(4, 'i32');
    const v = new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, 4).getInt32(0, false);
    this.pos += 4;
    return v;
  }

  f32(): number {
    this.checkBits();
    this.need(4, 'f32');
    const v = new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, 4).getFloat32(0, false);
    this.pos += 4;
    return v;
  }

  f64(): number {
    this.checkBits();
    this.need(8, 'f64');
    const v = new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, 8).getFloat64(0, false);
    this.pos += 8;
    return v;
  }

  /** 大端 base-128 变长整数（O: `sub_4C1000` raw 147036-147116）。 */
  varint(): number {
    this.checkBits();
    let v = this.u8Raw();
    if ((v & 0x80) === 0) return v;
    let acc = (v & 0x7f) << 7;
    v = this.u8Raw();
    if ((v & 0x80) === 0) return (acc | (v & 0x7f)) >>> 0;
    acc = ((acc | (v & 0x7f)) << 7) >>> 0;
    v = this.u8Raw();
    if ((v & 0x80) === 0) return (acc | v) >>> 0;
    acc = ((acc | (v & 0x7f)) << 7) >>> 0;
    v = this.u8Raw();
    if ((v & 0x80) !== 0) this.fail('varint too long (readNum error)');
    return (acc | v) >>> 0;
  }

  /** 位读取：字节内 MSB→LSB（O: `sub_4C6E30` raw 151829-151853）。 */
  bit(): boolean {
    if (this.bitLeft === 0) {
      this.need(1, 'bit');
      this.bitByte = this.buf[this.pos++]!;
      this.bitLeft = 8;
    }
    const b = (this.bitByte >> (this.bitLeft - 1)) & 1;
    this.bitLeft -= 1;
    return b !== 0;
  }

  str(): string {
    this.checkBits();
    const n = this.varint();
    this.need(n, 'string');
    const bytes = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return Buffer.from(bytes).toString('utf8');
  }

  /** 内联 i32 数组（O: `sub_4C14E0` raw 147268-147337）。 */
  intArrayInline(): number[] {
    this.checkBits();
    const n = this.varint();
    if (n < 0 || n > this.buf.length) this.fail(`int array length out of range (${n})`);
    const out: number[] = new Array(n);
    for (let i = 0; i < n; i++) out[i] = this.i32();
    return out;
  }

  /** 内联 f32 数组（O: `sub_4C1660` raw 147339-147404）。 */
  floatArrayInline(): number[] {
    this.checkBits();
    const n = this.varint();
    if (n < 0 || n > this.buf.length) this.fail(`float array length out of range (${n})`);
    const out: number[] = new Array(n);
    for (let i = 0; i < n; i++) out[i] = this.f32();
    return out;
  }

  private reg<T>(v: T, tag: string): T {
    this.objects.push(v);
    this.byTag[tag] = (this.byTag[tag] ?? 0) + 1;
    return v;
  }

  /** 读一个对象（O: `sub_4C7220` raw 152026-152322）。 */
  object(): Raw {
    this.checkBits();
    const tag = this.varint();
    this.trace.push(tag);
    if (tag === MOC_TAG.objectRef) {
      const idx = this.i32();
      if (idx < 0 || idx >= this.objects.length) this.fail(`illegal refno ${idx} (objects=${this.objects.length})`);
      return this.objects[idx];
    }
    return this.reg(this.make(tag), String(tag));
  }

  private make(tag: number): Raw {
    switch (tag) {
      case MOC_TAG.null:
        return null;
      case MOC_TAG.string:
        return this.str();
      case MOC_TAG.color:
        return { kind: 'color', value: this.i32() };
      case MOC_TAG.rectD:
        return { kind: 'rectD', items: [this.f64(), this.f64(), this.f64(), this.f64()] };
      case MOC_TAG.rectF:
        return { kind: 'rectF', items: [this.f32(), this.f32(), this.f32(), this.f32()] };
      case MOC_TAG.pointD:
        return { kind: 'pointD', x: this.f64(), y: this.f64() };
      case MOC_TAG.pointF:
        return { kind: 'pointF', x: this.f32(), y: this.f32() };
      case MOC_TAG.matrix2x3:
        return { kind: 'matrix2x3', items: [this.f64(), this.f64(), this.f64(), this.f64(), this.f64(), this.f64()] };
      case MOC_TAG.rect:
        return { kind: 'rect', items: [this.i32(), this.i32(), this.i32(), this.i32()] };
      case MOC_TAG.point:
        return { kind: 'point', x: this.i32(), y: this.i32() };
      case MOC_TAG.objectArray: {
        const n = this.varint();
        if (n < 0 || n > this.buf.length) this.fail(`object array length out of range (${n})`);
        const out: Raw[] = new Array(n);
        for (let i = 0; i < n; i++) out[i] = this.object();
        return { kind: 'objectArray', items: out };
      }
      case MOC_TAG.intArray:
      case MOC_TAG.intArray2:
        return { kind: 'intArray', items: this.intArrayInline() };
      case MOC_TAG.floatArray:
        return { kind: 'floatArray', items: this.floatArrayInline() };
      case MOC_TAG.doubleArray: {
        const n = this.varint();
        const out: number[] = new Array(n);
        for (let i = 0; i < n; i++) out[i] = this.f64();
        return { kind: 'doubleArray', items: out };
      }
      case MOC_TAG.drawDataId:
      case MOC_TAG.baseDataId:
      case MOC_TAG.paramId:
      case MOC_TAG.partsDataId:
        return this.reg<MocId>({ kind: 'id', idClass: idClassOf(tag), name: this.str() }, `id:${idClassOf(tag)}`);
      case MOC_TAG.modelImpl:
        return this.readModel();
      case MOC_TAG.paramDefSet:
        return { kind: 'paramDefSet', items: asArray(this.object()) };
      case MOC_TAG.paramDefFloat:
        return this.readParamDef();
      case MOC_TAG.partsData:
        return this.readParts();
      case MOC_TAG.bdAffine:
        return this.readBdAffine();
      case MOC_TAG.bdBoxGrid:
        return this.readBdBoxGrid();
      case MOC_TAG.affineEnt:
        return this.readAffineEnt();
      case MOC_TAG.pivotManager:
        return this.readPivotManager();
      case MOC_TAG.paramPivots:
        return this.readParamPivots();
      case MOC_TAG.drawData:
        return this.readDrawData();
      case MOC_TAG.avatar:
        return {
          kind: 'avatar',
          id: this.object(),
          drawDataList: asArray(this.object()),
          baseDataList: asArray(this.object()),
        };
      default:
        this.fail(`unsupported moc type tag ${tag}`);
    }
  }

  private readModel(): Raw {
    const paramDefSet = this.object();
    const partsArr = asArray(this.object());
    const canvasWidth = this.i32();
    const canvasHeight = this.i32();
    const params = ((paramDefSet as { items?: Raw[] } | null)?.items ?? []).filter(
      (p): p is MocParamDef => !!p && (p as { kind?: string }).kind === 'paramDef',
    );
    const parts = partsArr.filter((p): p is MocParts => !!p && (p as { kind?: string }).kind === 'parts');
    return { kind: 'model', params, parts, canvasWidth, canvasHeight } satisfies Omit<MocModel, 'stats'>;
  }

  private readParamDef(): MocParamDef {
    const min = this.f32();
    const max = this.f32();
    const defaultValue = this.f32();
    const id = this.object() as MocId | null;
    return { kind: 'paramDef', min, max, defaultValue, id };
  }

  private readParts(): MocParts {
    const locked = this.bit();
    const visible = this.bit();
    const id = this.object() as MocId | null;
    const baseList = asArray(this.object());
    const drawList = asArray(this.object());
    return {
      kind: 'parts',
      locked,
      visible,
      id,
      deformers: baseList.filter((d): d is MocDeformer => !!d && isDeformer(d)),
      drawables: drawList.filter((d): d is MocDrawData => !!d && (d as { kind?: string }).kind === 'drawData'),
    };
  }

  private readPivotManager(): MocPivotManager {
    const arr = asArray(this.object()).filter(
      (p): p is MocParamPivots => !!p && (p as { kind?: string }).kind === 'paramPivots',
    );
    return { params: arr };
  }

  private readParamPivots(): MocParamPivots {
    const paramId = this.object() as MocId | null;
    const pivotCount = this.i32();
    const pivotValues = asFloatArray(this.object());
    return { paramId, pivotCount, pivotValues };
  }

  private readAffineEnt(): MocAffineEnt {
    const originX = this.f32();
    const originY = this.f32();
    const scaleX = this.f32();
    const scaleY = this.f32();
    const rotationDeg = this.f32();
    let reflectX = false;
    let reflectY = false;
    if (this.version >= 10) {
      reflectX = this.u8() !== 0;
      reflectY = this.u8() !== 0;
    }
    return { originX, originY, scaleX, scaleY, rotationDeg, reflectX, reflectY };
  }

  private readBdAffine(): MocBdAffine {
    const id = this.object() as MocId | null;
    const targetId = this.object() as MocId | null;
    const pivotManager = this.object() as MocPivotManager | null;
    const affines = asArray(this.object()).filter(
      (a): a is MocAffineEnt => !!a && (a as { kind?: string }).kind === 'affineEnt',
    );
    const pivotOpacities = this.version >= 10 ? this.floatArrayInline() : [];
    return { kind: 'bdAffine', id, targetId, pivotManager, affines, pivotOpacities };
  }

  private readBdBoxGrid(): MocBdBoxGrid {
    const id = this.object() as MocId | null;
    const targetId = this.object() as MocId | null;
    const columnCount = this.i32();
    const rowCount = this.i32();
    const pivotManager = this.object() as MocPivotManager | null;
    const pivotPoints = asArray(this.object()).map(asFloatArray);
    const pivotOpacities = this.version >= 10 ? this.floatArrayInline() : [];
    return { kind: 'bdBoxGrid', id, targetId, columnCount, rowCount, pivotManager, pivotPoints, pivotOpacities };
  }

  private readDrawData(): MocDrawData {
    const id = this.object() as MocId | null;
    const targetId = this.object() as MocId | null;
    const pivotManager = this.object() as MocPivotManager | null;
    const averageDrawOrder = this.i32();
    const pivotDrawOrders = this.intArrayInline();
    const pivotOpacities = this.floatArrayInline();
    const clipId = this.version >= 11 ? (this.object() as MocId | null) : null;
    const textureNo = this.i32();
    const pointCount = this.i32();
    const polygonCount = this.i32();
    const indexArray = asIntArray(this.object());
    const pivotPoints = asArray(this.object()).map(asFloatArray);
    const uvs = asFloatArray(this.object());
    const optionFlag = this.version >= 8 ? this.i32() : 0;
    const colorGroupNo = (optionFlag & 1) !== 0 ? this.i32() : null;
    return {
      kind: 'drawData',
      id,
      targetId,
      pivotManager,
      averageDrawOrder,
      pivotDrawOrders,
      pivotOpacities,
      clipId,
      textureNo,
      pointCount,
      polygonCount,
      indexArray,
      pivotPoints,
      uvs,
      optionFlag,
      colorGroupNo,
      colorCompositionType: (optionFlag & 30) !== 0 ? (optionFlag & 30) >> 1 : 0,
      culling: (optionFlag & 32) !== 0,
    };
  }
}

// ───────────────────────────── 小工具 ─────────────────────────────

function idClassOf(tag: number): MocIdClass {
  switch (tag) {
    case MOC_TAG.drawDataId:
      return 'draw';
    case MOC_TAG.baseDataId:
      return 'base';
    case MOC_TAG.paramId:
      return 'param';
    default:
      return 'parts';
  }
}

function asArray(v: Raw): Raw[] {
  const o = v as { kind?: string; items?: Raw[] } | null;
  return o && o.kind === 'objectArray' ? (o.items ?? []) : [];
}

function asIntArray(v: Raw): number[] {
  const o = v as { kind?: string; items?: number[] } | null;
  return o && o.kind === 'intArray' ? (o.items ?? []) : [];
}

function asFloatArray(v: Raw): number[] {
  const o = v as { kind?: string; items?: number[] } | null;
  return o && (o.kind === 'floatArray' || o.kind === 'doubleArray') ? (o.items ?? []) : [];
}

function isDeformer(v: Raw): boolean {
  const k = (v as { kind?: string }).kind;
  return k === 'bdAffine' || k === 'bdBoxGrid';
}

// ───────────────────────────── 入口 ─────────────────────────────

/** 解析一个 `.moc`（O: `sub_4BD560` raw 143843-143945）。 */
export function parseMoc(bytes: Uint8Array): MocModel {
  if (bytes.length < 8) throw new MocParseError('file too small', 0, bytes.length);
  if (bytes[0] !== 0x6d || bytes[1] !== 0x6f || bytes[2] !== 0x63) {
    throw new MocParseError('bad magic (expected "moc")', 0, bytes.length);
  }
  const version = bytes[3]!;
  if (version > 11) throw new MocParseError(`unsupported moc version ${version} (max 11)`, 3, bytes.length);

  const rv = new Reader(bytes, version);
  rv.pos = 4;
  const root = rv.object() as MocModel;
  if (!root || root.kind !== 'model') {
    throw new MocParseError(
      `root object is not ModelImpl (got ${String((root as { kind?: string })?.kind)})`,
      rv.pos,
      bytes.length,
    );
  }

  let eofMarker = false;
  if (version >= 8) {
    if (rv.pos + 4 > bytes.length) throw new MocParseError('missing EOF marker (version>=8)', rv.pos, bytes.length);
    const marker = new DataView(bytes.buffer, bytes.byteOffset + rv.pos, 4).getUint32(0, false);
    if (marker !== 0x88888888) {
      throw new MocParseError(`bad EOF marker 0x${marker.toString(16)} (expected 0x88888888)`, rv.pos, bytes.length);
    }
    rv.pos += 4;
    eofMarker = true;
  }
  if (rv.pos !== bytes.length) {
    throw new MocParseError(`trailing bytes (${bytes.length - rv.pos} left)`, rv.pos, bytes.length);
  }

  root.stats = {
    version,
    objects: rv.trace.length,
    byTag: rv.byTag,
    bytesRead: rv.pos,
    bytesTotal: bytes.length,
    eofMarker,
  };
  return root;
}
