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

/** 已知 draw-item flag 位（引擎实测）：bit0 存在 | bit1 颜色动画。bit2(&4, sub_49BCC0 分支) 未逐字解码 ⇒ 拒绝。 */
export const KNOWN_DRAW_ITEM_FLAGS = 0b011;
/** 已知 mesh flag 位：bit0 存在 | bit1 颜色动画。 */
export const KNOWN_MESH_FLAGS = 0b011;

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
  /** 0x342（sub_427C70 → `sub_4A1A60`）：**销毁 Live2D 模型实例槽**（Scene+55812 的 10 槽，析构 + delete + 置 0）。 */
  destroyL2DSlot?(slot: number): void;
  /** 0x352（sub_4283B0 → `sub_4A1AC0`）：Live2D 槽参数——按 `sel` 置**待纹理 ID**(+24/+28) 或**待动作 ID**(+25/+32)。 */
  l2dSlotSet?(slot: number, sel: number, value: number): void;
  /** 0x23D（sub_41A300）：**销毁 movie/纹理槽 42..999**（CMovieToTexture 族析构 + Scene 卸槽）。 */
  releaseMovieSlots?(): void;
  /** 0x32B（sub_41A4A0）：**清 D3DX 网格层级槽表**（Scene+50708 区 1000 槽，逐项 delete）。 */
  clearMeshSlots?(): void;
  /** 0x259（sub_41A3A0）：清两张 1000×2 组 5-DWORD 记录表（只清记录、不 delete 对象）。 */
  clearSlotRecords?(): void;
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
  /** 清空一个消息窗（引擎 `0x85` / `0x301` / `0x71` 开始新一段）。 */
  msgWinClear?(win: number): void;
  /** 全部清空（`op_exit_script` 的 `msgwin.reset()`）。 */
  msgWinClearAll?(): void;

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
  /** 0x344（sub_427CB0）：纹理槽变换 `sub_4AFBF0(_this+80708, handle, value)`（置 map 项 `|=1`、`[+4]=value`）。 */
  setTextureTransform?(handle: number, value: number): void;
  /** 0x352（sub_4283B0）：图形子系统 `sub_4A1AC0(_this+80708, op1, op2, op3)`（按 op2 选 sub_478560/sub_478540）。 */
  gfxSubsystem?(a2: number, a3: number, a4: number): void;
  /** 0x1F6（sub_41A130）：`sub_4AB7A0(_this+80708)` —— 整批释放绘制项/网格（保留纹理槽）。 */
  clearDrawContainer?(): void;
  /** 0x20C（sub_41A1A0）：每帧 `sub_4B4040(_this+80708)`（帧刷新；emulator 渲染循环自行 present，可选）。 */
  frameTick?(): void;
  /** 0x21C u00416270：置等待旗标位（0x400）。 */
  setWaitFlag?(mask: number): void;
  /** 0x1FA release-texture：释放某 layer。 */
  releaseTexture?(layer: number): void;
  /** 0x20F play-movie：起播视频句柄。 */
  playMovie?(id: number): void;
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
