/** 子系统/系统调用的抽象接口 + 桩实现。
 *  VM 里所有引擎子系统调用（声音/渲染/字体/输入/睡眠/日志）都经此 bridge。
 *  桩实现只记录（无界面）；PixiBackend 实现真实渲染。
 *
 *  Plan A：改为「引擎式」模型——指令只**配置对象**（draw-item/mesh/纹理槽/颜色），
 *  由渲染器每帧 `present()` 合成整个场景图；渲染与 VM 指令解耦。
 *  约定：桥对渲染对象做**严格 flag 校验**——配置了未逐字段解码的 flag 位 → 抛 `UnknownFlagError`，绝不静默忽略。
 */
import type { InputManager } from './input.js';
import type { MsgWinInput } from '../text/layout.js';
import type { AudioIntent } from '../audio/audioEngine.js';
import type { Item } from '../renderer/drawItem.js';

/**
 * 已知 draw-item flag 位（引擎实测）：bit0 存在 | bit1 A 层动画窗 | **bit2 B 层周期/循环动画**。
 *
 * ★bit2 于 2026-09（B3）**逐字段解码完成**：唯一读取点 = 渲染器 `sub_4AEEA0` raw 133390
 * （`(flags & 4) == 0 ⇒ 跳过整层`），命中时 raw 133395 强制"世界矩阵有效"；写点 = `0x231`–`0x235`
 * 五个 setter（raw 132229/132250/132274/132301/132330）、清点 = `0x230`（raw 132173）；
 * 5 条通道的消费端 = `sub_49BCC0` raw 117944-118365。
 * 模型/求值 = `renderer/drawitem/model.ts`（`loops`/`loopTo`/`loopScale`/`loopAxis`/`loopTrans`）
 * 与 `drawitem/eval.ts`；规格 = `docs-new/03-engine/b3-bit2-model-spec-2026-09.md`。
 */
export const KNOWN_DRAW_ITEM_FLAGS = 0b111;
/** 已知 mesh flag 位：bit0 存在 | bit1 颜色动画。 */
export const KNOWN_MESH_FLAGS = 0b011;

/**
 * **B 层（`Item.flags` bit2）周期/循环动画层的写入请求** —— `0x230`–`0x235` 六条的共用载荷。
 *
 * 为什么六条共用一个桥方法（而不是六个）：它们写的是**同一个机制**（同一个 bit2 + 同一组
 * `+524..+576`/`+592`/`+656` 格子 + 同一个消费端 `drawitem/eval.ts`），工程里已有同样口径的先例
 * （`setTransition` 承载 `0x24F`/`0x250`/`0x251`、`setTextureObjectParam` 承载 `0x246`/`0x249`）。
 * 各 `op` 的字段偏移与 raw 依据见 `renderer/drawitem/setters.ts` 的 `apply*Loop*` 注释。
 */
export type DrawItemLoopRequest =
  /** `0x230`（`sub_4AD580` raw 132151-132217）：停全部 B 层通道（清 bit2 + 5 个周期 + `+540` 起点槽）。 */
  | { op: 'reset'; handle: number }
  /** `0x231`（`sub_4AD690` raw 132219-132239）：贴图换格循环（`period`→`+560`、`frames`→`+568`、`cols`→`+572`）。 */
  | { op: 'flipbook'; handle: number; period: number; frames: number; cols: number }
  /** `0x232`（`sub_4AD730` raw 132241-132258）：颜色往复（`period`→`+544`、`alpha`/`rgb`→`+576`；负值 = 取当前色）。 */
  | { op: 'color'; handle: number; period: number; alpha: number; rgb: number }
  /** `0x233`（`sub_4AD7B0` raw 132260-132286）：缩放往复（`period`→`+548`、`sx/sy/sz`→`+592`，**已 ÷100**）。 */
  | { op: 'scale'; handle: number; period: number; sx: number; sy: number; sz: number }
  /** `0x234`（`sub_4AD850` raw 132289-132314）：匀速旋转（`period`→`+552`、轴→`+580/584/588`，**不除**）。 */
  | { op: 'rotate'; handle: number; period: number; ax: number; ay: number; az: number }
  /** `0x235`（`sub_4AD900` raw 132316-132343）：平移往复（`period`→`+556`、位移→`+656`，**不除**）。 */
  | { op: 'translate'; handle: number; period: number; tx: number; ty: number; tz: number };

/** 配置了不认识的 flag → 硬中断（与 NotImplementedOp 互补，杜绝静默误渲染）。 */
export class UnknownFlagError extends Error {
  constructor(
    public readonly kind: 'drawitem' | 'mesh',
    public readonly handle: number,
    public readonly flags: number,
    public readonly unknown: number,
  ) {
    super(
      `unknown ${kind} flag 0x${flags.toString(16)} @ handle 0x${handle.toString(16)} : ` +
        `未解码位 0x${unknown.toString(16)} —— 严格校验要求：配置了不认识的 flag 必须立即中断`,
    );
    this.name = 'UnknownFlagError';
  }
}

export function assertFlags(kind: 'drawitem' | 'mesh', handle: number, flags: number): void {
  const mask = kind === 'drawitem' ? KNOWN_DRAW_ITEM_FLAGS : KNOWN_MESH_FLAGS;
  const unknown = flags & ~mask;
  if (unknown !== 0) throw new UnknownFlagError(kind, handle, flags, unknown);
}

/**
 * **引擎在体内抛 `Command_ShowMessage` ⇒ emulator 也硬中断并把原文展示出来**（`tickets/T-0098`）。
 *
 * 引擎里这类分支的样子是（`0xFE` 的 `sub_421CA0` raw 30449-30457 逐字）：
 * ```c
 * result = sub_41BF50(_this, 1);            // 无符号
 * if ( result > 0x1F ) { pExceptionObject[0] = (int)aSetkeytotal; … _CxxThrowException(…); }
 * _this[517] = result;                      // ★抛了就到不了这里 ⇒ 字段不变
 * ```
 * ⇒ 引擎**不写字段**（不是"先写再报错"），并且**停在那里把消息给玩家**。
 * emulator 的等价物就是"抛 ⇒ `session.#onError` 粘住文本 + 控制窗横幅 + 停止"
 * （与 `NotImplementedOp`/`UnknownFlagError` **同一条既有通路**，不新造机制、不静默）。
 */
export class ShowMessageError extends Error {
  constructor(
    /** 引擎里那条消息的原文（如 `aSetkeytotal` = 「SetKeyTotalの引数が不正です．」）。 */
    public readonly engineText: string,
    public readonly opcode: number,
    public readonly detail: string,
  ) {
    super(`${engineText}（opcode 0x${opcode.toString(16)}：${detail}）`);
    this.name = 'ShowMessageError';
  }
}

/** draw-item（图像）配置。layer = op2（2a/2b）；dst 为屏幕位置。 */
export interface DrawItemConfig {
  handle: number;
  layer: number;
  srcX: number;
  srcY: number;
  srcW: number;
  srcH: number;
  dstX: number;
  dstY: number;
  /** 纹理号（仅日志；实际按 slot 绑定的 imgid 取图） */
  tex: number;
  /**
   * **画这一项的那一帧**（emulator 记账；引擎没有这一格）。读档装载点用它丢掉"被放弃的调用方那一层 UI"
   * （`tickets/T-0083` 的 (B) 步）—— 语义与依据见 `renderer/drawitem/model.ts` 的 `Item.ownerFrame`。
   */
  ownerFrame?: number;
}

/**
 * `0x320` create-mesh 的一个顶点。
 * 引擎 VB 记录 36 字节 = `x,y,z,w(=1),DWORD diffuse,u,v,attr,attr`；`x/y/z` 是**屏幕像素**
 * （投影 `D3DXMatrixOrthoLH(显示宽, -显示高)`），`u/v` 是纹理坐标（语料里 = `(0,1,0,1)/(0,0,1,1)`）。
 */
export interface MeshVertexSpec {
  x: number;
  y: number;
  z: number;
  u: number;
  v: number;
}

export interface MeshCreateSpec {
  handle: number;
  layer: number;
  vcount: number;
  verts: MeshVertexSpec[];
  /** 逐顶点基础色（ARGB；`0x320` 的 op5/op6 两个全局 int 数组 DEC 解码后合成）。 */
  baseColors: number[];
}

/** `0x204` draw-string 的样式载荷（handler 从引擎全局样式字段组装；宿主只光栅化，见 `globalTextStyle`）。 */
export interface DrawStringStyle {
  /** 字族（已由 `fontSet.resolveFace` 解析成浏览器可用族名）。 */
  family: string;
  /** 字号 px（引擎 `Font+201684`，`0x75` 写）。 */
  size: number;
  /**
   * 字重（400/700）。引擎侧 `0x2BD` 只是把 `Font+1248`/`+218516` 的 `lfWeight` 写成 700 或 0，
   * 再交给 **GDI 的族内选面**（`CreateFontIndirectA`）—— 引擎**不做**合成加粗；
   * "同一串多画几遍"是**描边**档位（`Font+1372`），见 `raster.ts` 的对照表。
   * 证据：`engine/天结_unpacked.exe_utf8.c` raw 33385-33402 / 70941-71191 / 68095-68120。
   */
  weight: number;
  /** 填充色 `#rrggbb`（引擎 `Font+1360`，`0x76` 写）。 */
  fill: string;
  /** 描边色 `#rrggbb`（引擎 `Font+1364`，`0x77` 写）。 */
  outline: string;
  /** 描边档位（引擎 `Font+1372`）：0 无 / 1 单向 / 2 同位叠 / 3 四向。 */
  outlineMode: 0 | 1 | 2 | 3;
  outlineDx: number;
  outlineDy: number;
  /**
   * ★抗锯齿（引擎 `Font+1352` = `Engine[21662]`；`tickets/T-0035`）。
   * `false` = 引擎的 GDI/dd 锯齿字形路径（本机 INI 的实际取值）⇒ 宿主须把边缘阈值化，别用 canvas 的 AA。
   */
  antiAlias: boolean;
}

export interface NativeBridge {
  log(msg: string): void;
  /** 共享输入状态（Engine 构造时赋值；渲染器经它写 / VM 经它读）。 */
  input?: InputManager;
  /**
   * **音频意图**（引擎「设备 + SE/Voice/Music 三模块」模型的唯一入口，2026-09 落地）。
   *
   * 音频族的 opcode 只产生"意图"，不等待、不回写操作数（详见 `src/vm/handlers/audio.ts`
   * 与 `docs-new/03-engine/sound-system.md`）。宿主实现方式：
   *  - Electron 渲染进程：`AudioEngine`（Web Audio，见 `src/renderer/audio/webAudioHost.ts`）；
   *  - headless/测试：`StubNative` 只记一行日志；未实现 ⇒ 闸门 A 记 `audio` 一次（不再静默）。
   */
  audio?(intent: AudioIntent): void;
  /** @deprecated 旧的三条粗粒度音频缝（只写日志）。真实现走 `audio`；保留以免破坏既有宿主/测试。 */
  playSound?(id: number, volume: number): void;
  /** @deprecated 见 `playSound`。 */
  playBgm?(id: number): void;
  /** @deprecated 见 `playSound`。 */
  playVoice?(id: number): void;
  /** 0x1FB draw-texture（sub_422E70）：8 操作数 `[slot, layer, srcX, srcY, srcW, srcH, dstX, dstY]`。
   *  ★与 `configureDrawItem` 的关系：draw-texture 是"**按纹理槽绘制**"；`op_draw_texture` 解析操作数后
   *  经本方法转发（默认实现即转 `configureDrawItem`）。宿主可覆写本方法做"槽→实际图像"的额外解析。 */
  drawTexture?(args: number[]): void;
  /** 0x1F9 set-texture（sub_422CB0）：`[imgid, slot, color]` —— 引擎里**唯一的槽↔图像绑定**。
   *  ★与 `bindTexture` 的关系：本方法默认转发 `bindTexture(imgid, slot)`。 */
  setTexture?(args: number[]): void;
  /** 0x1F8 create-texture：`[slot, w, h, mode]` —— 释放该槽旧纹理对象并**新建**一张（程序化纹理）。
   *  emulator 建模为"该槽的图像缓存失效并重取"（见 PixiBackend）。 */
  createTexture?(slot: number, w: number, h: number, mode: number): void;
  /**
   * 0x20D **设置渲染目标**（`sub_423770` raw 31594-31602 → `sub_4A50C0` raw 124819-124912）：
   * `op1` = 纹理槽；引擎里 `-1` = 回到后台缓冲。
   * ★它决定 `0x203`/`0x322` 混合选择子**值 2 的门控**（`tickets/T-0017`，见 `renderer/scene/blend.ts`）。
   */
  setRenderTarget?(slot: number): void;
  /**
   * 0x33F op1 = **场景默认混合选择子**（引擎 `Scene+1260` → 消费点 `sub_4535F0` raw 65858-65889）。
   * ★raw 65907 还会把 op2/op3 组出的颜色（`Scene+1264`）下发给效果对象 —— 那条**效果通路** emulator
   * 未建模（登记在 `tickets/T-0017`），本方法只承载混合选择子。
   */
  setSceneBlend?(blend: number): void;
  /**
   * 0x204 draw-string（sub_423390 → `sub_456710`）：把一整串文本**直绘进纹理槽** `slot`（GDI 路径）。
   * `(x, y)` = 文本左上角（引擎在 `Font+201680 == 1` 时会再加一次 ascent 修正）。
   * 宿主只负责光栅化：用 `style` 把 `text` 画到该槽的表面（保留原有像素，不清底）。
   */
  drawString?(slot: number, x: number, y: number, text: string, style: DrawStringStyle): void;
  /**
   * **读一个纹理槽的像素**（`0x1AE` 写 `SAVE%2.2d.STH` 缩略图用；`tickets/T-0036`）。
   *
   * 引擎那条链是 `sub_43BF20(Engine+1978, op3, handle)`（raw 47838）= 把该槽的 surface 写成 BMP。
   * 宿主侧只有"canvas 表面"能读回像素：`create-texture` 出来的槽就是一张 canvas（见 TextureCache）。
   * 返回 `null` = 该槽没有可读表面（headless、或该槽不是程序化纹理）⇒ 调用方写一个空块。
   */
  getSlotPixels?(slot: number): { w: number; h: number; rgba: Uint8Array } | null;
  /**
   * **把像素写进一个纹理槽**（`0x1AF` 读 `.STH` 缩略图用；`tickets/T-0036`）。
   *
   * 引擎那条链是 `sub_40BF20(Engine+1978, op3, -1, handle, size)`（raw 16072）→
   * `sub_43E9F0`（raw 49926，ddReadBmp）把 BMP 解进该槽的 dd 表面。宿主把 `rgba`（顶行在前）铺进
   * 该槽的画布即可；该槽不存在（没先 `create-texture`）⇒ 宿主可忽略（引擎那条 `&&` 门也直接返回）。
   */
  setSlotPixels?(slot: number, w: number, h: number, rgba: Uint8Array): void;
  /** 0x1FD（sub_422FD0 → `sub_4AC5F0`）：**立即缩放**（无动画窗）。op2/3/4 = sx/sy/sz（**÷100**，`dbl_5201F0`）。
   *  引擎写 `DrawItem+0x68 = 1`（用世界矩阵）与 `+0x6C`（缩放 work 矩阵）。 */
  setScale?(handle: number, sx: number, sy: number, sz: number): void;
  /**
   * **`0x22A`（sub_424080 → `sub_49A720`）：Scene 级立即缩放**（`op1/2/3` 三个 float **各 ÷100**，
   * **无 handle**）→ Scene 世界矩阵的缩放组（引擎 `D3DXMatrixScaling(Scene+307)` + `Scene[306] = 1`）。
   *
   * ★与 `setScale`（`0x1FD`，改**某个 DrawItem** 的 `+0x6C` work 矩阵）**不是一回事**：
   * 本方法改的是 Scene 自己的变换块，只经 `sub_4A1E90` → `sub_49AA30` 合成进 `Scene+46600`，
   * 再被 RenderScene 只作用于**层号 ∈ [20,30)** 的项（raw 133405 的 `(层号 − 20) > 9` 取反）。
   */
  setSceneScale?(sx: number, sy: number, sz: number): void;
  /**
   * **`0x22C`（sub_424180 → `sub_49A820`）：Scene 级立即平移**（`op1/2/3` 三个 float，**不除** = 像素）
   * → Scene 世界矩阵的平移组（引擎 `D3DXMatrixTranslation(Scene+371)`）。作用范围同 `setSceneScale`。
   */
  setSceneTranslation?(x: number, y: number, z: number): void;
  /**
   * **`0x22D`（sub_4241F0 → `sub_49A870`）：Scene 级带轴缩放**：`op1`/`op2` 是 **int**（→ `Scene[295]`/`[300]`），
   * `op3/4/5` 是 float **各 ÷100**（→ `D3DXMatrixScaling(Scene+323)`）。作用范围同 `setSceneScale`。
   */
  setSceneAxisScale?(a: number, b: number, sx: number, sy: number, sz: number): void;
  /**
   * **`0x22F`（sub_424330 → `sub_49A9C0`）：Scene 级带轴平移**：`op1`/`op2` 是 **int**（→ `Scene[297]`/`[302]`），
   * `op3/4/5` 是浮点轴分量、**不除**（→ **`D3DXMatrixTranslation(Scene+387)`**，★以体订正过筛体的「Scaling」）。
   */
  setSceneAxisTranslation?(a: number, b: number, x: number, y: number, z: number): void;
  /**
   * 0x1FF（sub_4230F0 → `sub_4AC750`）：**DrawItem 的像素平移**（op2/op3/op4 = x/y/z float，像素单位）。
   * 引擎：`DrawItem+0x68 = 1`（用世界矩阵）+ `D3DXMatrixTranslation(元素+0x16C, x,y,z)` 写**平移 work 矩阵**，
   * **立即生效、无动画窗**（与 0x220 写 target + 开窗不同）。对照：**平移用像素、缩放用百分数**。
   */
  setDrawTranslation?(handle: number, x: number, y: number, z: number): void;
  /**
   * 0x208（sub_4302E0 → `sub_49ED60`）：**纹理尺寸查询**，返回该槽纹理的原始宽高。
   * 引擎读 `CTexture+1040/+1044`；槽越界/未创建时返回 0/0（引擎只记日志、不改控制流）。
   * ★这是 getter：调用方会把结果**写回脚本操作数 2/3**，漏掉会造成脚本层逻辑错误。
   */
  getTextureSize?(slot: number): { w: number; h: number };
  /**
   * 0x245（sub_4251E0 → `sub_4081B0`）：**纹理对象的浮点参数**（`op2` 按常量缩放后写进该槽的 CTexture）。
   * emulator 无 CTexture 对象 ⇒ 宿主可选实现（不实现 = 只落字段、缺口由闸门记）。
   * ★语料用量（2026-09 实测）：`i245` = **0**、`i246` = **0**、`i249` = **20**（`i249` 已接线）。
   */
  setTextureObjectFloat?(slot: number, value: number): void;
  /**
   * 0x246（sub_425250：`obj+1044` 子对象的 `vtable+56`，参数 = `op2 ÷ 100`）与
   * 0x249（sub_425310：绑定时的颜色 `op3`）：**纹理对象/槽的参数下发**。宿主可选实现。
   */
  setTextureObjectParam?(slot: number, value: number): void;

  // ---- A4 图元 / 网格 / 纹理 / 渲染状态族（2026-09 落地；语义见 handlers/gfx-state.ts）----
  /** `0x1FC`（sub_422F80 → `sub_4AC470`）：**复位图元变换**（清 DrawItem 的缩放/旋转/平移等字段）。 */
  resetPrimTransform?(handle: number): void;
  /** `0x1FE`（sub_423060 → `sub_4AC660`）：**图元变换 4 浮点**（op2..op5 原样，不除 100）。 */
  setPrimTransform4?(handle: number, a: number, b: number, c: number, d: number): void;
  /**
   * **槽 → 槽转送**（源/目标矩形各 4 个 int，`[x1,y1,x2,y2]`；宿主返回「是否真的转了像素」，headless 只记模型）：
   *  - `0x207`（`sub_423480` → `sub_4A3980`）：**同尺寸** StretchRect；
   *  - `0x32`（`i032`，`sub_41E2D0` → `sub_4A87A0` raw 127933-128129，引擎名 **StretchTexture**）：**缩放**
   *    转送，且两个矩形各自按所在 surface 的边界**夹取**（一侧被夹时另一侧按比例跟随，见
   *    `renderer/scene/ops.ts` 的 `clampScaledBlit`）。源/目标 surface 不存在 ⇒ 引擎分别打
   *    「コピー元/コピー先テクスチャが作成されていません． TEXTURE=%d」。
   *    语料 `i032 2 e 0 0 500 2d0 0 0 140 b4`（337 处）＝ 全屏槽 2 缩成 320×180 的槽 0xe ⇒ 存档缩略图
   *    （随后 `0x1AE` 写 .STH）。
   */
  blitSlotToSlot?(srcSlot: number, dstSlot: number, srcRect: number[], dstRect: number[]): boolean | void;
  /** `0x20E`（sub_41A200）：**图形提交**——包一层渲染状态 38 后对设备做 `Clear(0,0,3,0,1.0,0)`（清 target+z）。 */
  commitGraphics?(): void;
  /** `0x224`（sub_41A290 → `sub_4AA180`）：**清转场表**（Scene+1048 的转场容器）。 */
  clearTransitions?(): void;
  /**
   * **转场（wipe）记录逐格写入**（`0x24F`/`0x250`/`0x251` → `sub_4AF6A0`/`sub_4AF880`/`sub_4AFA30`）：
   * `id` = 记录键（引擎 `Scene+1048` 的 map key，来自 `op1`），`writes` = `[[格下标, 值]…]`，
   * 与引擎的 `sub_4AAE10(Scene+1048, &id)[i] = v` 一一对应（记录 = 24 个 dword；已存在的记录只改被写的格）。
   * 语义与未建模部分（扫描带绘制、`0x400` 门挂起）见 `handlers/gfx-state.ts` 的族注释。
   */
  setTransition?(id: number, writes: ReadonlyArray<readonly [number, number]>): void;
  /** `0x229`（sub_423FE0 → `sub_49A690/6C0/6F0`）：**绘制模式 5 元组**（op1/op2 两个 int + op3..op5 三个 float）。 */
  setDrawModeBlock?(a: number, b: number, x: number, y: number, z: number): void;
  /** `0x242`（sub_4251A0 → `sub_4AD9A0`）：**写 DrawItem `+720`**（同时写相邻对象的 `+504`）。 */
  setDrawEntryParam?(entry: number, value: number): void;
  /** `0x256`（sub_425C30 → `sub_4ACD10`）：**按 id 找 DrawItem 并写两个 int + 三个 float**。 */
  setSlotParams?(slot: number, a: number, x: number, y: number, z: number): void;
  /** `0x321`（sub_426BD0 → `sub_4AE280`）：**MeshEntry 属性**（`entry[a3 + 7] = a4`）。 */
  setMeshEntryAttr?(mesh: number, index: number, value: number): void;
  /** `0x32A`（sub_426F80 → `sub_4A0750`）：**释放 3D 模型槽**（`Scene[op1 + 12677]` 析构 + delete + 置 0）。 */
  release3DSlot?(slot: number): void;
  /** `0x32D`（sub_427040 → `sub_499DF0`）：**3D 颜色**（op1 截断为 alpha、op2 低 3 字节为 RGB，四分量各 ÷255）。 */
  set3DColor?(r: number, g: number, b: number, a: number): void;
  /**
   * 0x23B（sub_424970）：**按 CG 数字条画数值**。
   * 实现方负责：先删 DrawItem/Mesh 的 `[id, id+digits)` 区间，再按记录逐位建 DrawItem。
   * `rec` = 7 dword（[0] 纹理槽 / [1] x0 / [2] y0 / [3] 单字宽 / [4] 字高 / [5] 字内空隙 / [6] 字距）；
   * `flags` bit0 = 补前导零、bit1 = 居中、bit2 = 左对齐。
   */
  drawCgNumber?(id: number, rec: readonly number[], value: number, x: number, y: number, digits: number, flags: number): void;
  /** 0x32F（sub_4272B0 → `sub_49A150`）：**D3D 灯光开关** `LightEnable(idx, on)`（idx=0..9；同族 sub_49A080=SetLight）。 */
  setLight?(idx: number, on: boolean): void;
  /** 0x23D（sub_41A300）：**销毁 movie/纹理槽 42..999**（CMovieToTexture 族析构 + Scene 卸槽）。 */
  releaseMovieSlots?(): void;
  /** 0x32B（sub_41A4A0）：**清 D3DX 网格层级槽表**（Scene+50708 区 1000 槽，逐项 delete）。 */
  clearMeshSlots?(): void;
  /** 0x259（sub_41A3A0）：清两张 1000×2 组 5-DWORD 记录表（只清记录、不 delete 对象）。 */
  clearSlotRecords?(): void;
  /**
   * **取场景「呈现态」快照**（`tickets/T-0063`）：读档要还原画面（引擎存了绘制/槽记录并在读档时重放）。
   * 实现方返回 JSON 可序列化的纯数据（见 `renderer/scene/present.ts` 的 `PresentSnapshot`）。
   */
  snapshotPresent?(): unknown;
  /** **还原场景呈现态快照**（`0x1A1` 读档时由 VM 交回宿主；引擎读档也会用存档里的记录重画）。 */
  restorePresent?(snap: unknown): void;
  /** 0x340（sub_427B60 → `sub_49A2D0`）：下发渲染状态（设备 vtable+228，状态 #22）。 */
  setRenderState?(state: number, value: number): void;
  setFont?(args: number[]): void;
  setString?(s: string): void;
  stringResourceId?(s: string): number;
  getInputType?(): number;
  sleep?(ms: number): void;
  // ★菜单派发（0xA1/0xA2/0xA3）**没有**宿主方法：表是 VM 状态（`Engine.menuMap`），
  //   查表跳转在同文件的 handlers/menu.ts 里完成 —— 见那里的说明（曾因多余的桥方法产生"假缺口"）。
  unhandled?(opcode: number, name: string): void;

  // ---- 消息窗文本（引擎「每窗一张离屏表面」的等价物）----
  /**
   * **同步一个消息窗的文本内容**（引擎 `0x6E`/`0x6F`/`0x71`/`0x196` 与各属性指令之后）。
   * 宿主负责：排版在共享层 `scene/ops.ts` 里做（两宿主同一份语义），宿主只做光栅化/记录。
   */
  msgWinSync?(win: number, input: MsgWinInput): void;
  /**
   * 清空一个消息窗（引擎 `0x301`（删该窗绘制项区间）/ `0x71`（开始新一段）/ `sub_404F80`）。
   * ★订正（`T-0095`）：这里曾写 `0x85` —— `0x85`（`sub_418F50` → `sub_45EBE0` raw 74182-74194）
   * 清的是**回看页索引表 + 72B 记录表**两张 vector，**不碰**消息窗的绘制项。
   */
  msgWinClear?(win: number): void;
  /** 全部清空（`op_exit_script` 的 `msgwin.reset()`）。 */
  msgWinClearAll?(): void;

  /**
   * **把系统的真实光标挪到「引擎虚拟坐标 `(x, y)`」对应的屏幕位置**（引擎 `0x10A` 的宿主侧动作）。
   *
   * 引擎在 `sub_421EA0`（raw 30530-30598）里就是 `ClientToScreen` + **`SetCursorPos`**：
   * 参数是**虚拟屏坐标**，宿主负责换算到屏幕（Electron 主进程用
   * `BrowserWindow.getContentBounds()` + **Windows 才有**的 `screen.dipToScreenPoint()`，
   * 见 `electron/nativeAddon.ts`；macOS 没有后一跳 —— 它的屏幕坐标本来就是点）。
   *
   * ★两种宿主天生做不到 / 不需要做：
   *  - **浏览器**没有移动真实光标的 API（合成事件不改真实光标）⇒ Electron 侧靠原生模块补齐
   *    （`native/host-input`，`tickets/T-0053`）；
   *  - **headless 宿主**（`StubNative`/`HeadlessScene`）没有光标这回事 ⇒ 实现为**显式 no-op**
   *    （而不是"缺缝"：那会让闸门 A 把每次 `i10a` 都记成宿主缺口 —— 语料 1678 处，纯噪声）。
   */
  setSystemCursor?(x: number, y: number): void;

  // ---- Plan A：类型化渲染配置（严格 flag 校验） ----
  configureDrawItem?(cfg: DrawItemConfig): void;
  bindTexture?(imgid: number, slot: number): void;
  /**
   * **纹理帧屏障**：等本帧新绑定的图像载入完成（可选实现）。
   *
   * 引擎 `set-texture`(0x1F9 → `sub_422CB0`) 是**同步**读文件 + 解码 ⇒ 同一帧"绑定 + 画"必然一致；
   * renderer 侧走 IPC 异步，宿主必须在合成前补齐，否则会出现「新一屏文本已画上来、背景还没切换」
   * 的时序错位。headless 宿主无纹理 ⇒ 不实现（返回 undefined 即跳过）。
   */
  texturesIdle?(): Promise<void>;
  createMesh?(spec: MeshCreateSpec): void;
  /**
   * `0x322` set-vertex-color：op2=引擎 `entry[9]`、op3=alpha、op4=rgb。
   * ★alpha/rgb 允许**负值**（= 取当前 state0 的对应通道）且 alpha 会被夹到 255 —— 回退逻辑
   * 必须在持有 state0 的宿主侧做（`scene/ops.ts` 的 `vertexColorArg`）。
   */
  setVertexColor?(handle: number, index: number, alpha: number, rgb: number): void;
  /** `0x323` set-vertex-color-alpha：op2=delay、op3=count、op4=alpha、op5=rgb（同样允许负值）。 */
  setVertexColorAlpha?(handle: number, delay: number, count: number, alpha: number, rgb: number): void;
  /** 0x203 set-draw-color-alpha：置 from 色（ARGB）。 */
  setDrawColorAlpha?(handle: number, from: number, blend: number): void;
  /**
   * **绘制项的当前色（ARGB，`DrawItem+0x60`）** —— 引擎 `sub_4ADD60`（raw 132579-132588）的对应物。
   *
   * 引擎逐字：`sub_459EA0(Scene+1032, &v4, &handle)` 查绘制项表；**查不到 ⇒ 返回 −1**；
   * 否则 `return *(_DWORD *)(sub_4AAD40(Scene+1032, &handle) + 96)` —— 读的就是本工程的 `Item.from`
   * （`+0x60` ARGB，`0x203` 自己写的那一格）。
   *
   * 为什么必须是**宿主缝**：`0x203`（`sub_4232C0` raw 31419-31451）在 `op3(α) < 0` / `op4(color) < 0`
   * 时要把这两格**回退成"该项当前值"**（α 取 `>> 24`、颜色取整个 ARGB），而"当前值"只存在于宿主场景里
   * ——这与 `0x322`/`0x323` 的负值回退（`scene/ops.ts` 的 `vertexColorArg`）是同一条纪律。
   * 返回 −1 时 **`0x203` 的行为与引擎一致**：`(unsigned)−1 >> 24 = 255`（α）、颜色 = `0xFFFFFF`。
   *
   * ★只给 `0x203` 用（`0x33f` 的同类回退写的是 `Scene+1264`，那条通路仍未建模，见 T-0017）。
   */
  getDrawItemColor?(handle: number): number;
  /** 0x1F7 detach-texture（sub_422BC0）：删单/区间图元。op1=handle、op2=count；count≤1 删单，count>1 删 [handle,handle+count)。 */
  detachTexture?(handle: number, count: number): void;
  /** 0x202 set-draw-color：置 delay/count/to 色，置动画位。 */
  setDrawColor?(handle: number, delay: number, count: number, to: number): void;
  /**
   * **0x21D CopyScene**（`sub_423C60` → `sub_4AC0D0` raw 131146）：把源绘图项（+同 key 的网格）
   * 整块复制到另一个 handle。找不到源 ⇒ 返回 `false`（引擎打「コピー元のシーンが存在しません」串）。
   * 语料：`ROOM`/`MMODE`/`CGMODE`/`HMODE` 把预置的「全屏过渡幕布」复制成临时项做淡入淡出。
   */
  copyScene?(srcHandle: number, dstHandle: number): boolean;
  /**
   * **`0x214`**（`sub_423AE0` → `sub_4ABEF0` raw 131084-131143）：**交换两条绘图项记录**
   * （740 字节整块互换，**键不动**）。缺键的一侧引擎先建一条全 0 记录；两个键都不存在时只置脏位。
   * ★只碰绘图项表（Scene+1032）；网格表不动（与 `copyScene` 不同）。
   * @returns 是否至少有一侧原本存在（= 真的换到了内容）
   */
  swapItems?(a: number, b: number): boolean;
  /**
   * 0x217（sub_423B20, raw 31791）：**对象变换 pivot** `sub_4ACF20(_this+80708, handle, f2, f3, f4)`。
   * 引擎：`sub_4AAA50` 保证 key 存在 → `map[key]` → 写元素下标 `6/7/8` = DrawItem`+24/+28/+32`
   * = **回転/拡大縮小の中心（pivot）**；`sub_49AA30` 绘制期用 `T(-pivot) → 动画矩阵 → T(+pivot)` 夹住。
   */
  setDrawPivot?(handle: number, x: number, y: number, z: number): void;
  /**
   * `0x215`（sub_430340 → `sub_4ADC20`, raw 132507）：**绘制项 → 纹理槽号**（getter）。
   * 引擎：DrawItem map（`Scene+1032`）按 key 查；**不存在或 `flags & 1 == 0` ⇒ −1**；
   * 否则返回 `DrawItem+4`（`draw-texture` 的 op2 = 纹理槽号）。
   * ★getter：调用方把结果**写回脚本 op1**，漏实现 ⇒ 脚本拿到旧槽号（逻辑错误）。
   */
  getDrawItemTexSlot?(handle: number): number;
  /**
   * `0x218`（sub_4303C0 → `sub_4ADCF0`, raw 132549）：**绘制项的 pivot 三元组**（getter）。
   * 引擎读 `DrawItem+24/+28/+32`（= `0x217` 写的 pivot）；项不存在 ⇒ 全 0。
   * 调用方把它写回 op2/op3/op4（float 操作数）。
   */
  getDrawItemPivot?(handle: number): { x: number; y: number; z: number };
  /**
   * `0x21A`（sub_430450 → `sub_4ADC80`, raw 132519）：**绘制项的描画位置三元组**（getter）。
   * 引擎读 `DrawItem+36/+40/+44`（= `0x219` 写的位置）；项不存在 ⇒ 全 0。
   * 调用方把它写回 op2/op3/op4（float 操作数）。
   */
  getDrawItemPos?(handle: number): { x: number; y: number; z: number };
  /**
   * **`0x228`**（`sub_430650` → `sub_4AA060`，raw 39973-39988 / 130115 起）：**绘制项当前「平移」三元组**（getter）。
   *
   * 引擎：按 key 在绘制项表（`Scene+1032`）里查项；**查不到 ⇒ `sub_4AA060` 返回 0**（⇒ 调用方把 op1 写 1），
   * 查到则 `D3DXMatrixDecompose` 元素 **`+0x16C`（= 平移 work 矩阵）** 取出平移分量写进 a3/a4/a5。
   * ★与 `0x21A`（`+0x24` 描画位置）**不是同一个量**：这里读的是 `0x1FF`（立即平移）/ `0x220`（平移窗）写的那个矩阵；
   * 语料用法正是"取当前平移再在它基础上做动画"（`src/SC0500.txt:1358-1363`：`i228` 之后按返回值 +100/-y 起 `i220` 窗）。
   * ⇒ 返回值用 `undefined` 表示"项不存在"（调用方写 op1=1），与"项存在但平移为 0"区分开。
   */
  getDrawItemTranslation?(handle: number): { x: number; y: number; z: number } | undefined;
  /**
   * 0x219（sub_423BA0, raw 31807）：**描画位置** `sub_4ACEE0(_this+80708, handle, f2, f3, f4)`。
   * 引擎：与 `sub_4ACF20` 逐行同构，唯写元素下标 `9/10/11` = DrawItem`+36/+40/+44` = 描画位置 (x,y,z)；
   * 绘制期 `sub_4AEEA0` 把 `&v26[9]` 作第 5 参交 `sub_4A2D50` → `CTexture::Draw`。
   */
  setDrawPos?(handle: number, x: number, y: number, z: number): void;
  /**
   * 0x21E（sub_423CA0 → `sub_4AD170`）：**缩放动画窗（窗1）**。op2=delay、op3=dur、op4/5/6=sx/sy/sz（**÷100**）。
   * 引擎写 DrawItem`+0x3C` delay / `+0x50` dur / `+0xAC` 目标缩放矩阵，窗末 `work(+)0x6C ← target`。
   */
  setScaleAnim?(handle: number, delay: number, dur: number, sx: number, sy: number, sz: number): void;
  /** 0x21F（sub_423D40 → `sub_4AD250`）：**旋转动画窗（窗2）**。op2=delay、op3=dur、op4/5/6=轴、op7=角（度）。 */
  setRotationAnim?(handle: number, delay: number, dur: number, ax: number, ay: number, az: number, deg: number): void;
  /** 0x220（sub_423DE0 → `sub_4AD3C0`）：**平移动画窗（窗3）**。op2=delay、op3=dur、op4/5/6=位移（**不除**，像素）。 */
  setTranslationAnim?(handle: number, delay: number, dur: number, x: number, y: number, z: number): void;
  /** 0x239（sub_424900 → `sub_4AD4A0`）：**flipbook 窗（窗4）**。op2=delay、op3=dur、op4=总帧数、op5=列数、op6=标志(bit0=保持末帧)。 */
  setFlipbook?(handle: number, delay: number, dur: number, frames: number, cols: number, flags: number): void;
  /**
   * **B 层（`Item.flags` bit2）周期/循环动画层** —— `0x230`/`0x231`/`0x232`/`0x233`/`0x234`/`0x235` 六条。
   *
   * 载荷见 `DrawItemLoopRequest`；写入端 = 共享层 `scene/ops.ts` 的
   * `scResetDrawItemLoop`/`scSetFlipbookLoop`/`scSetColorLoop`/`scSetScaleLoop`/`scSetRotationLoop`/
   * `scSetTranslationLoop`（两个宿主都只转发、不各写一份语义）。
   * ★六条**都没有 `flags & 1` 门控**：项不存在时会建一个 `flags = 0`（不可见）的项并把动画配上、不报错。
   */
  setDrawItemLoop?(req: DrawItemLoopRequest): void;
  /**
   * **`0x244`**（`sub_41A370` raw 25349-25355 → `sub_4AD9F0` raw 132364-132503）：
   * 遍历绘制项，把 `flags & mask`（引擎固定 `mask = 2` = bit1）的项的 **A 层窗起点 `+52` 清 0**
   * ⇒ 下一帧求值重新锁存 now（窗从头跑）。
   * @returns 命中的绘制项数（引擎里是"命中 `a2 & flags` 的元素数"）。
   * ★两张 572B 表（`Scene+1084`/`+1100`，后者 = `Engine.l2dNodes`）的 `node+24` 清 0 **未建模**
   *   （`L2dNode` 没有"起点"字段）—— 见 `scene/ops.ts` 的 `scClearDrawItemAnimStarts` 注释。
   */
  clearDrawItemAnimStarts?(mask: number): number;
  /**
   * ★**Live2D 没有宿主缝**（`0x341`/`0x345`/`0x34E` 的装载全在 VM 层 handler 里完成）。
   *
   * 为什么不留 `l2dLoadModel?` 之类的可选方法：那三个 handler 必须**同步语义等价**（引擎在
   * `0x341` 里直接读文件+解析，紧随的 `i344` 就要看到模型），所以它们 `await` 共享层的
   * `live2d/assetLoader`（两个宿主同一份实现）。旧的宿主缝既没人实现、又会让**闸门 A** 报出
   * 假的「意图被丢弃」（2026-09 实测：控制窗显示 `l2dLoadModel`/`l2dStartMotion` 未实现，
   * 而模型其实已经装好了）⇒ 已删除。
   */
  /** 0x352（sub_4283B0）：图形子系统 `sub_4A1AC0(_this+80708, op1, op2, op3)`（按 op2 选 sub_478560/sub_478540）。 */
  gfxSubsystem?(a2: number, a3: number, a4: number): void;
  /** 0x1F6（sub_41A130）：`sub_4AB7A0(_this+80708)` —— 整批释放绘制项/网格（保留纹理槽）。 */
  clearDrawContainer?(): void;
  /**
   * **丢掉"某一帧画的"绘制项**（emulator 侧的近似，**不是引擎 opcode**）——读档装载点用，返回丢掉的项数。
   *
   * ★2026-09 订正：**降级为 fallback**。引擎真槽的 body 里带着**绘制项清单**（`sub_410160`
   * raw 19810-19832：清 `Scene+1032` → 从清单逐条插回）⇒ 那份清单读出来时装载点走
   * `restoreDrawItems`，本方法只在"body 里没有清单"（本工程槽/旧布局）或"清单解析失败"时兜底。
   *
   * 早先的依据（`sub_403EF0` 复位两个**仮想ディスプレイ**）已被推翻：那两次复位动的是
   * **点击热点/路由表 + 游标**（`Engine+0x55D8`/`0xCAC0`，raw 9958-9971），**不碰绘制项容器**
   * ⇒ 它解释不了"上一屏的项为什么该消失"。见 `tickets/T-0083` 的以体订正。
   */
  dropFrameItems?(frame: number): number;
  /**
   * **用存档里的绘制项清单整批替换绘制项**（emulator 侧的宿主缝，**不是引擎 opcode**）——引擎真槽读档用。
   *
   * 依据 = `sub_410160` raw 19810-19832：先把 `Scene+1032`（绘制项 map）delete-walk 清空 + 哨兵复位 +
   * `size = 0`，再把清单里每条 `memcpy` 进 740 B 元素并插回 ⇒ **上一屏的项一个不留，画面 = 存档当时**。
   * 记录体的解码在 VM 层（`vm/engineDrawItem.ts`，740 B 逐字段），宿主只负责"先清后装"这一下。
   * 返回装进去的项数（宿主日志用；`pixiBackend`/`headlessScene` 两个实现必须同语义）。
   *
   * ★**不动网格容器**（引擎的清场只走 `Scene+1032` 那棵树，`Scene+1064` 的网格一个结点都不动）。
   */
  restoreDrawItems?(items: readonly Item[]): number;
  /**
   * **告诉宿主"现在正在执行哪一帧"**（emulator 记账，**不是引擎 opcode**）——每条指令派发前由
   * `interpreter.ts` 调一次。用途：所有**建项路径**（`0x1FB` 之外的文本/`ensure` 建项）都要记
   * `Item.ownerFrame`，而建项发生在宿主的共享场景层、看不到 VM 的 `e.cur`（`tickets/T-0083`）。
   */
  setCurrentFrame?(frame: number): void;
  /**
   * **释放「留帧」**（emulator 侧的呈现策略，**不是引擎 opcode**）——读档装载点用。
   *
   * 依据：引擎的装载路径会复位两个**仮想ディスプレイ**（`sub_403EF0`，raw 19913-19915），
   * 即"上一帧的显示态被丢弃"，引擎**没有**"保留旧像素"的概念（渲染目标每帧 `ClearTarget` 后从模型重组）。
   * ⇒ 读档瞬间屏上应当是**当前模型**（= 保留下来的绘制项 + 重建后的槽），不能是上一屏（TITLE/菜单）的旧像素。
   * 见 `tickets/T-0083` 的 (A) 步。
   */
  releaseFrameHold?(): void;
  /** 0x20C（sub_41A1A0）：每帧 `sub_4B4040(_this+80708)`（帧刷新；emulator 渲染循环自行 present，可选）。 */
  frameTick?(): void;
  /** 0x21C u00416270：置等待旗标位（0x400）。 */
  setWaitFlag?(mask: number): void;
  /** 0x1FA release-texture：释放某 layer。 */
  releaseTexture?(layer: number): void;
  /** 0x20F play-movie：起播视频句柄。 */
  /**
   * **`0x20F` play-movie**（`sub_4237B0` raw 31604-31670；arity 槽 = 7 ⇒ argc=3）：
   * op1 = 影片资源 id（`sub_454FA0` 取名 → `sub_489230` 打开）、op2 = **影片槽**（对象表 `[4*slot+378688]`）、
   * op3 = **音量/模式选择子**（`sub_4054D0`/`sub_405460` 解析 → `sub_4885A0(对象, Engine[20032]*v/10000)`）。
   * ★emulator 没有影片子系统（video 不在重写范围）⇒ 三个操作数原样上报，播放本身仍是缺口。
   */
  playMovie?(id: number, slot: number, mode: number): void;
  /**
   * **`0x20B` FillTexture**（`sub_423690` → `sub_4A4C70`，raw 31569-31592 / 124572 起）：
   * 往**纹理槽的表面**填一个纯色矩形。`op1=槽`、`op2/op3`=左上角、`op4/op5`=**宽/高**、
   * `op6`=α（>255 夹 255）、`op7`=RGB（引擎组装成 `0xFFRRGGBB`，A 固定 FF）。
   */
  fillSlotRect?(slot: number, x: number, y: number, w: number, h: number, argb: number, alpha: number): void;
  /**
   * 每帧渲染合成（由帧驱动在帧末按"是否需要渲染"调用；见 `src/frame/loop.ts`）。
   * @param nowMs 本帧时钟（引擎 `nowMs`）—— 单一时间域，见 `tickets/T-0008` 的 D1
   * @param waitFlags 仅诊断用（`Engine.waitFlags`）
   */
  present?(nowMs?: number, waitFlags?: number): void;
  /**
   * **本帧该不该合成**（可选能力；`tickets/T-0013` 入桥）。
   *
   * 判据本身在共享层（`sceneNeedsRender` = 场景脏 || 还有动画窗在跑），宿主只回答"我这边的状态要不要刷新"。
   * ★它**不是** `0x400` 门的判据（那是 `poolPending` + `Engine.gatePending`）：两者范围不同，
   * 见 `scPoolPending` / `scAnimationsPending` 的注释。
   * 未实现 ⇒ 闸门 A 记一次；帧驱动把"宿主不报 = 不跳过合成"当作安全默认。
   */
  needsRender?(): boolean;
  /**
   * **本遍推进后"池是否挂起"**（`Scene+46516` 的等价物；可选能力；`tickets/T-0013` 入桥 / `T-0024` 定口径）。
   *
   * 口径 = 共享层 `scPoolPending`（`sub_49AA30` raw 117843-117844：mesh 窗 + draw item 5 窗，
   * **排除 `+720` bit0 的元素**）；驱动在 `advanceModel` 之后取一次并锁存进 `Engine.scenePending`，
   * 再由 `Engine.serviceWaitGate`（= `sub_407E20`：池挂起位 + `0x238` 计时器）决定门放不放行。
   * 未实现 ⇒ 驱动按"池不挂起"处理（`run.ts` 的 `StubNative` 就是这种宿主 ⇒ 它用 `gates.anim: 'clear'`）。
   */
  poolPending?(): boolean;
  /**
   * **图像预载**（可选能力；`tickets/T-0013` 入桥）：把该 imgid 读入纹理缓存（幂等）。
   *
   * 引擎 `set-texture` 是同步读文件；renderer 侧异步 ⇒ 启动期预载清单靠它，未实现则首次绘制才加载
   * （闪一帧空图）或永远取不到纹理。headless 没有纹理 ⇒ 不实现（闸门 A 记一次）。
   */
  preloadImage?(imgid: number): Promise<void>;
  /**
   * 启动渲染（等价物）。★2026-09 订正（`tickets/T-0002` 的 D3）：**它不是"启动一个每帧 ticker"** ——
   * `PixiBackend.startFrameLoop()` 只记一个墙钟起点，`present()` 仍由帧驱动调用。
   */
  startFrameLoop?(now?: number): void;
}

export { StubNative } from './stubNative.js';
