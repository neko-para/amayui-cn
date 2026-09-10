/**
 * PixiJS v8 渲染后端（Plan A：引擎式「配置对象 + 每帧 present 合成」）。
 *
 * 架构（区别于旧"按指令推渲染"）：
 *  - 指令只**配置对象**（draw-item/mesh/纹理槽/颜色），存到持久场景图 `drawItems`/`meshes`；
 *  - 渲染帧循环（Pixi ticker）每帧推进 `clockMs`（墙钟 ms，等价引擎 this[46500]），调用 `present()`，
 *    对**整个场景图**合成到 backbuffer——动画在此逐帧求值，与 VM 指令解耦；
 *  - 动画槽两套、正交：
 *      · 背景(2a) = mesh#1/mesh#2 的**vertex color**（CalcDiffuse，黑覆盖层 alpha）。
 *      · 文字(2b) = draw-item 的**diffuse alpha**（+96 from → +100 to，只插 alpha，逐像素淡入）。
 *  - **严格 flag**：配置/渲染读 flags 时，未知位立刻抛 `UnknownFlagError`（绝不静默忽略）。
 *
 * 说明：视口 1280×720；真实纹理经 `window.api.image(imgid)` 取 AGF 解码 RGBA 包成 Texture。
 */
import {
  Application,
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Texture,
  type ContainerChild,
} from 'pixi.js';
import {
  assertFlags,
  type MeshCreateSpec,
  type NativeBridge,
} from '../vm/native.js';
import type { InputManager } from '../vm/input.js';
import {
  advanceWindows,
  calcDiffuse,
  itemColor,
  itemRotationRad,
  itemScale,
  itemSrcRect,
  itemTranslation,
  type DrawItemConfig,
  type Item,
  type MeshObj,
  type Vec3,
} from './drawItem.js';
import {
  newSceneState,
  scAnimationsDone,
  scClearDrawContainer,
  scConfigureDrawItem,
  scCreateMesh,
  scDetachTexture,
  scDrawCgNumber,
  scSetDrawColor,
  scSetDrawColorAlpha,
  scSetDrawPivot,
  scSetDrawPos,
  scSetFlipbook,
  scSetRotationAnim,
  scSetScaleAnim,
  scSetTranslationAnim,
  scSetVertexColor,
  scSetVertexColorAlpha,
  type SceneState,
} from './sceneModel.js';

export type { Item, MeshObj, Vec3 };

export interface RenderStatus {
  scriptName: string;
  ip: number;
  steps: number;
  log: string[];
  /** 全量日志（不截断），供渲染器按批次落盘诊断。 */
  trace: string[];
}


const W = 1280;
const H = 720;

export class PixiBackend implements NativeBridge {
  private app: Application;
  private stage: Container<ContainerChild>;
  private drawRoot: Container<ContainerChild>; // 场景绘制（每次 present 重建）
  private status: RenderStatus;
  private unit: Texture;
  /** 共享输入状态（renderer 写 / VM 读）。由 create 注入。 */
  input?: InputManager;
  private imgCache = new Map<number, Texture>();
  private slotTex = new Map<number, Texture>(); // slot/layer -> Texture（set-texture 绑定）
  /** slot → imgid（`set-texture` 建立的绑定；`create-texture` 刷新缓存时要用它重取图像）。 */
  private slotImgid = new Map<number, number>();
  private pendingImg = new Set<number>();
  private lastScript = '';
  private drawCount = 0;

  /**
   * **场景模型**（与 `HeadlessScene` 共用 `sceneModel.ts` 的同一份语义）：
   * 建/删项、5 个窗、"缺失即建项"、bit0 门控都在那边实现，本类只负责画到 Pixi。
   * 这样"报告说对、画面不对"这类最难查的漂移就不可能发生。
   */
  private scene = newSceneState();
  private get drawItems(): Map<number, Item> {
    return this.scene.drawItems;
  }
  private get meshes(): Map<number, MeshObj> {
    return this.scene.meshes;
  }
  private waitFlags = 0; // effect_flags 中的等待位（0x400 等）——由 setWaitFlag 置
  private clockMs = 0; // 渲染帧时钟（ms，等价 this[46500]）
  private wallStart = 0; // 帧循环起点（performance.now），时钟 = now - wallStart（墙钟，保证推进）
  private frameStarted = false;
  private lastSummary = -1;
  private sceneDirty = false; // 场景"脏"= 本次有配置类 op 改动过场景（引擎：present 须由脏标记 + 0x2400/0x400 门控驱动）

  static async create(
    status: RenderStatus,
    input?: InputManager,
    width = W,
    height = H,
    displayWidth = 1280,
    displayHeight = 720,
  ): Promise<PixiBackend> {
    const b = new PixiBackend(status);
    b.input = input;
    b.app = new Application();
    await b.app.init({
      width,
      height,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
      background: 0x0a0d16,
      antialias: true,
    });
    document.body.appendChild(b.app.canvas);
    b.app.canvas.style.width = `${displayWidth}px`;
    b.app.canvas.style.height = `${displayHeight}px`;
    b.app.canvas.style.display = 'block';
    b.app.canvas.style.imageRendering = 'pixelated';
    b.stage = b.app.stage;
    b.drawRoot = new Container();
    b.drawRoot.label = 'drawRoot';
    b.stage.addChild(b.drawRoot);
    b.unit = Texture.WHITE;
    // 左上角 HUD 日志已移除：诊断信息转移到独立控制窗（ControlWindow）。
    b.#attachMouseInput(b.app.canvas, input);
    return b;
  }

  /** 把鼠标事件映射到 InputManager（虚拟 1280×720 坐标；左=bit0、右=bit1；滚轮 → wheelDelta）。
   *  监听 window（而非仅 canvas），用 canvas 的 getBoundingClientRect 求局部坐标——更稳健，
   *  避免 canvas 层事件不触发/坐标偏移的常见坑。 */
  #attachMouseInput(canvas: HTMLCanvasElement, input?: InputManager): void {
    if (!input) return;
    const toVirtual = (clientX: number, clientY: number): [number, number] => {
      const r = canvas.getBoundingClientRect();
      const cw = r.width || W;
      const ch = r.height || H;
      return [Math.round(((clientX - r.left) / cw) * W), Math.round(((clientY - r.top) / ch) * H)];
    };
    // 诊断：是否收到 DOM 鼠标事件（节流，避免刷屏）
    let lastMouseLog = 0;
    const logMove = (label: string, x: number, y: number): void => {
      const now = performance.now();
      if (now - lastMouseLog > 300) {
        lastMouseLog = now;
        this.status.trace.push(`[input] ${label} (${x},${y}) hasCursor=${input!.hasCursor ? 1 : 0}`);
      }
    };
    window.addEventListener('mousemove', (e) => {
      const [x, y] = toVirtual(e.clientX, e.clientY);
      input.setCursor(x, y, true);
      logMove('move', x, y);
    });
    window.addEventListener('mouseleave', () => {
      input.setCursor(-100000, -100000, false);
      this.status.trace.push('[input] leave');
    });
    window.addEventListener('mousedown', (e) => {
      const [x, y] = toVirtual(e.clientX, e.clientY);
      input.setCursor(x, y, true);
      if (e.button === 0) input.pressMouse(0); // 左
      else if (e.button === 2) input.pressMouse(1); // 右
      this.status.trace.push(`[input] down btn=${e.button} (${x},${y})`);
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) input.releaseMouse(0);
      else if (e.button === 2) input.releaseMouse(1);
    });
    // 滚轮：喂给 InputManager.wheelDelta（0x10D 读并清零）。
    // 方向/单位对齐引擎 WM_MOUSEWHEEL 的 `+= (short)HIWORD(wParam)`：**每格 ±120、上滚正**；
    // 而 DOM WheelEvent.deltaY 在"下滚"时为正 → 取负。
    let lastWheelLog = 0;
    window.addEventListener(
      'wheel',
      (e) => {
        const [x, y] = toVirtual(e.clientX, e.clientY);
        input.setCursor(x, y, true);
        const d = -e.deltaY;
        input.addWheel(d);
        const now = performance.now();
        if (now - lastWheelLog > 200) {
          lastWheelLog = now;
          this.status.trace.push(
            `[input] wheel raw=${e.deltaY} -> ${d} sum=${input.wheelDelta} (${x},${y})`,
          );
        }
      },
      { passive: true },
    );
    // 右键需阻止默认菜单，否则点击无法作为游戏输入
    window.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private constructor(status: RenderStatus) {
    this.status = status;
    this.app = null as unknown as Application;
    this.stage = null as unknown as Container<ContainerChild>;
    this.drawRoot = null as unknown as Container<ContainerChild>;
    this.unit = null as unknown as Texture;
  }

  #pushLog(msg: string): void {
    this.status.log.push(msg);
    if (this.status.log.length > 8) this.status.log.shift();
    this.status.trace.push(msg);
  }

  // ---- 纹理 ---- //

  async preloadImage(imgid: number): Promise<void> {
    if (this.imgCache.has(imgid) || this.pendingImg.has(imgid)) return;
    this.pendingImg.add(imgid);
    try {
      const r = await window.api.image(imgid);
      if (r) {
        const tex = await this.#rgbaToTexture(r.width, r.height, r.data);
        this.imgCache.set(imgid, tex);
        this.#pushLog(`image ${imgid.toString(16)} -> ${r.name} (${r.width}x${r.height})`);
      }
    } catch (err) {
      this.#pushLog(`image ${imgid.toString(16)} fail: ${(err as Error).message}`);
    } finally {
      this.pendingImg.delete(imgid);
    }
  }

  async #rgbaToTexture(w: number, h: number, data: Uint8Array): Promise<Texture> {
    const clamped = new Uint8ClampedArray(data);
    const imageData = new ImageData(clamped, w, h);
    const bmp = await createImageBitmap(imageData);
    return Texture.from(bmp);
  }

  // ---- NativeBridge：日志/音频（供 VM 用） ---- //

  log(msg: string): void {
    this.#pushLog(msg);
  }
  playSound(id: number, volume: number): void {
    this.#pushLog(`sound#${id} vol=${volume}`);
  }
  playBgm(id: number): void {
    this.#pushLog(`bgm#${id}`);
  }
  playVoice(id: number): void {
    this.#pushLog(`voice#${id}`);
  }
  setFont(args: number[]): void {
    this.#pushLog(`setFont [${args.map((a) => '0x' + a.toString(16)).join(', ')}]`);
  }
  setString(s: string): void {
    this.#pushLog(`setString "${s}"`);
  }
  stringResourceId(s: string): number {
    this.#pushLog(`stringResourceId "${s}"`);
    return -1;
  }
  getInputType(): number {
    return 0;
  }
  sleep(_ms: number): void {
    /* renderer 内 no-op，帧循环自走 */
  }
  unhandled(opcode: number, name: string): void {
    this.#pushLog(`unhandled 0x${opcode.toString(16)} ${name}`);
  }

  // ---- 配置（指令 -> 场景图，Plan A） ---- //

  drawTexture(args: number[]): void {
    // raw：[tex, layer, srcX, srcY, srcW, srcH, dstX, dstY]
    const [tex = 0, layer = 0, x = 0, y = 0, w = 0, h = 0, p = 0, q = 0] = args;
    this.configureDrawItem({ handle: tex, layer, srcX: x, srcY: y, srcW: w, srcH: h, dstX: p, dstY: q, tex });
  }

  setTexture(args: number[]): void {
    // raw：[imgid, slot, color]
    const [imgid = 0, slot = 0] = args;
    this.bindTexture(imgid, slot);
  }

  configureDrawItem(cfg: DrawItemConfig): void {
    this.#onSceneChange(cfg.handle);
    this.#markDirty();
    // 语义（建/覆盖 + 置 bit0 + 覆盖描画位置）在共享模型层；两侧（此处与 HeadlessScene）只有一份。
    const it = scConfigureDrawItem(this.scene, cfg);
    assertFlags('drawitem', it.handle, it.flags);
    this.#pushLog(`configureDrawItem h=0x${cfg.handle.toString(16)} layer=${cfg.layer} (${cfg.srcX},${cfg.srcY},${cfg.srcW}x${cfg.srcH})`);
  }

  bindTexture(imgid: number, slot: number): void {
    this.#markDirty();
    this.slotImgid.set(slot, imgid); // 记录绑定，供 create-texture 刷新缓存时重取
    this.#pushLog(`bindTexture imgid=0x${imgid.toString(16)} slot=${slot}`);
    const tex = this.imgCache.get(imgid);
    if (tex) {
      this.slotTex.set(slot, tex);
      this.#pushLog(`  bind slot ${slot} <- imgid 0x${imgid.toString(16)}`);
    } else {
      void this.preloadImage(imgid).then(() => {
        const t2 = this.imgCache.get(imgid);
        if (t2) this.slotTex.set(slot, t2);
      });
    }
  }

  createMesh(spec: MeshCreateSpec): void {
    this.#onSceneChange(spec.handle);
    this.#markDirty();
    const m = scCreateMesh(this.scene, spec.handle, spec.layer);
    assertFlags('mesh', m.handle, m.flags);
    this.#pushLog(`createMesh h=0x${spec.handle.toString(16)} v=${spec.vcount}`);
  }

  /**
   * `0x1F8` create-texture（sub_422C20 → `sub_4A2C10(_this+80708, slot, w, h, mode)`）：
   * 引擎先释放该槽旧纹理对象、再**新建**一张（脚本给尺寸/模式 ⇒ 程序化/空白纹理，非文件图像）。
   * emulator 建模：**该槽的图像缓存失效后重取**——若该槽此前由 `set-texture` 绑定过文件图像，
   * 保持绑定语义并刷新缓存；若是全新程序化纹理，则只记录（程序化纹理生成未建模）。
   */
  createTexture(slot: number, w: number, h: number, mode: number): void {
    this.#markDirty();
    const bound = this.slotImgid.get(slot);
    if (bound !== undefined) {
      const tex = this.imgCache.get(bound);
      if (tex) this.slotTex.set(slot, tex);
    }
    this.#pushLog(
      `createTexture slot=${slot} ${w}x${h} mode=${mode}` +
        (bound !== undefined ? ` (沿用已绑定 imgid=0x${bound.toString(16)})` : ' (程序化纹理未建模)'),
    );
  }

  /** `0x1FD`（sub_422FD0 → `sub_4AC5F0`）：3D 缩放变换（D3DXMatrixScaling，输入按 256 格除）。emulator 记录。 */
  setScale(handle: number, sx: number, sy: number, sz: number): void {
    this.#markDirty();
    this.#pushLog(`setScale h=0x${handle.toString(16)} (${sx},${sy},${sz})`);
  }

  /**
   * `0x1FF`（sub_4230F0 → `sub_4AC750`）：**DrawItem 的像素平移**（立即生效、无动画窗）。
   * 引擎写 `+0x68 = 1`（用世界矩阵）与 `+0x16C`（平移 **work** 矩阵）⇒ emulator 直接把 work/target 都设为该值
   * （`itemTranslation` 在无窗时返回 target，故写入即生效，`present()` 会把它叠加到描画位置）。
   */
  setDrawTranslation(handle: number, x: number, y: number, z: number): void {
    this.#markDirty();
    const it = this.drawItems.get(handle);
    if (!it) {
      this.#pushLog(`setDrawTranslation: item 0x${handle.toString(16)} 不存在（引擎 sub_4AAA50 会补建，此处忽略）`);
      return;
    }
    assertFlags('drawitem', it.handle, it.flags);
    it.useWorld = true;
    it.transWork = { x, y, z };
    it.transTarget = { x, y, z };
    this.#pushLog(`setDrawTranslation h=0x${handle.toString(16)} (${x},${y},${z})`);
  }

  /**
   * `0x208`（sub_4302E0 → `sub_49ED60`）：**纹理尺寸查询**（getter）。
   * 引擎读该槽 `CTexture` 的 `+1040`（宽）/`+1044`（高）；槽越界或未创建 → 0/0。
   * emulator：槽 → imgid → 已载入纹理的原始尺寸；未载入时返回 0/0（与引擎"槽为空"同口径），
   * 并把待定尺寸**记入 `pendingTexSize`**，使图像异步载入后下一次查询能拿到真实值。
   */
  getTextureSize(slot: number): { w: number; h: number } {
    const tex = this.slotTex.get(slot);
    if (tex) return { w: tex.source.width, h: tex.source.height };
    const imgid = this.slotImgid.get(slot);
    if (imgid !== undefined) void this.preloadImage(imgid); // 首次查询触发载入
    this.#pushLog(`getTextureSize slot=${slot} → 0x0（纹理尚未载入${imgid === undefined ? '；该槽未绑定' : `，imgid=0x${imgid.toString(16)}`}）`);
    return { w: 0, h: 0 };
  }

  /**
   * `0x23B`（sub_424970）：**按 CG 数字条画数值**。
   * 忠实复刻引擎几何（raw 32381-32503）：先按 `[id, id+digits)` 删 DrawItem/Mesh，再逐位建 DrawItem。
   * 记录 `rec`：`[0]` 纹理槽、`[1]` x0、`[2]` y0、`[3]` 单字宽、`[4]` 字高、`[5]` 字内空隙、`[6]` 字距。
   * 三种对齐（`flags`）：bit1 居中 `x = k·adv − adv·(last−数位+1)/2 + op4`；
   * bit2 左对齐 `x = (数位−1)·adv + op4`（逐位递减）；否则右对齐 `x = k·adv + op4`。
   * `k` 从 `last = digits−1` 递减到 0，同时 `value %= 10` 取位 ⇒ **id = 个位、id+1 = 十位…（自右向左）**；
   * 前导零跳过，除非 `flags & 1`（补零）或是个位那一轮。
   */
  drawCgNumber(id: number, rec: readonly number[], value: number, x: number, y: number, digits: number, flags: number): void {
    // 删区间 + 逐位建项都由共享模型层做（`sceneModel.ts` 的 scDrawCgNumber）
    const created = scDrawCgNumber(this.scene, id, rec, value, x, y, digits, flags);
    this.#pushLog(`drawCgNumber id=0x${id.toString(16)} value=${value} digits=${digits} flags=${flags} → 建 ${created} 项（槽 ${rec[0] ?? 0}）`);
  }

  /**
   * `0x219`（sub_423BA0 → `sub_4ACEE0`）：写绘制项的**描画位置**（DrawItem`+36/+40/+44`，三个 float）。
   * 引擎绘制期读它（`&v26[9]`）交给 `CTexture::Draw`；emulator 写进 item 的 `posX/posY/posZ`，`present()` 优先采用。
   * 若 item 尚不存在（脚本先变换后画），记进 `posOverride` 待 `configureDrawItem` 消费。
   */
  setDrawPos(handle: number, x: number, y: number, z: number): void {
    this.#markDirty();
    const o = scSetDrawPos(this.scene, handle, x, y, z);
    this.#pushLog(`setDrawPos h=0x${handle.toString(16)} (${x},${y},${z})${o === 'applied' ? '' : ' [建空项]'}`);
  }

  /**
   * `0x217`（sub_423B20 → `sub_4ACF20`）：写绘制项的**旋转/缩放中心 pivot**（DrawItem`+24/+28/+32`）。
   * 与 0x219 逐行同构、只是写入下标不同（6/7/8 vs 9/10/11）。绘制期 `sub_49AA30` 用
   * `T(-pivot) → 动画矩阵 → T(+pivot)` 夹住动画矩阵，故它**只改基准点、不改位置**。
   */
  setDrawPivot(handle: number, x: number, y: number, z: number): void {
    this.#markDirty();
    const o = scSetDrawPivot(this.scene, handle, x, y, z);
    this.#pushLog(`setDrawPivot h=0x${handle.toString(16)} (${x},${y},${z})${o === 'applied' ? '' : ' [建空项]'}`);
  }

  /**
   * `0x21E`（sub_423CA0 → `sub_4AD170`）：**缩放动画窗（窗1）**。
   * 引擎：`op1`=handle、`op2`=delay→`+0x3C`、`op3`=dur→`+0x50`、`op4/5/6`=sx/sy/sz（**÷256**，
   * `sub_41C300(...) / dbl_5201F0`）→ 置 `flags |= 2`、写 `+0x34 = 0`、`+0x68(+104) = 1`、
   * `D3DXMatrixScaling(元素+0xAC, sx, sy, sz)`（**目标矩阵**；工作矩阵在 `+0x6C`，窗末 `work ← target`）。
   */
  setScaleAnim(handle: number, delay: number, dur: number, sx: number, sy: number, sz: number): void {
    this.#markDirty();
    const o = scSetScaleAnim(this.scene, handle, delay, dur, sx, sy, sz);
    const it = this.drawItems.get(handle);
    if (it) assertFlags('drawitem', it.handle, it.flags);
    this.#pushLog(`setScaleAnim h=0x${handle.toString(16)} d=${delay} dur=${dur} s=(${sx},${sy},${sz})${o === 'applied' ? '' : ` [${o}]`}`);
  }

  /**
   * `0x21F`（sub_423D40 → `sub_4AD250`）：**旋转动画窗（窗2）**。
   * 引擎：`op1`=handle、`op2`=delay→`+0x40`、`op3`=dur→`+0x54`、`op4/5/6`=轴 (x,y,z)、`op7`=角（**度**，
   * 内部 `* dbl_526C98 / dbl_5263F0` 换算为弧度）→ `D3DXMatrixRotationAxis(元素+0x12C, axis, θ)`，
   * 并把轴/角同时存 `+0x1F8..0x208`（目标）。
   */
  setRotationAnim(handle: number, delay: number, dur: number, ax: number, ay: number, az: number, deg: number): void {
    this.#markDirty();
    const o = scSetRotationAnim(this.scene, handle, delay, dur, ax, ay, az, deg);
    const it = this.drawItems.get(handle);
    if (it) assertFlags('drawitem', it.handle, it.flags);
    this.#pushLog(`setRotationAnim h=0x${handle.toString(16)} d=${delay} dur=${dur} axis=(${ax},${ay},${az}) θ=${deg}${o === 'applied' ? '' : ` [${o}]`}`);
  }

  /**
   * `0x220`（sub_423DE0 → `sub_4AD3C0`）：**平移动画窗（窗3）**。
   * 引擎：`op1`=handle、`op2`=delay→`+0x44`、`op3`=dur→`+0x58`、`op4/5/6`=位移 (x,y,z)（**不除 256**）
   * → `D3DXMatrixTranslation(元素+0x1AC, x, y, z)`。
   */
  setTranslationAnim(handle: number, delay: number, dur: number, x: number, y: number, z: number): void {
    this.#markDirty();
    const o = scSetTranslationAnim(this.scene, handle, delay, dur, x, y, z);
    const it = this.drawItems.get(handle);
    if (it) assertFlags('drawitem', it.handle, it.flags);
    this.#pushLog(`setTranslationAnim h=0x${handle.toString(16)} d=${delay} dur=${dur} t=(${x},${y},${z})${o === 'applied' ? '' : ` [${o}]`}`);
  }

  /**
   * `0x239`（sub_424900 → `sub_4AD4A0`）：**flipbook 窗（窗4）**。
   * 引擎：`op1`=handle、`op2`=delay→`+0x48`、`op3`=dur→`+0x5C`、`op4`=总帧数→`+0x238`、
   * `op5`=每行列数→`+0x23C`、`op6`=标志→`+0x234`（bit0 = **窗末保持末帧**）。
   * 逐帧把帧序号换算成**源矩形**偏移（不是 UV）——见 `#itemSrcRect`。
   */
  setFlipbook(handle: number, delay: number, dur: number, frames: number, cols: number, flags: number): void {
    this.#markDirty();
    const o = scSetFlipbook(this.scene, handle, delay, dur, frames, cols, flags);
    const it = this.drawItems.get(handle);
    if (it) assertFlags('drawitem', it.handle, it.flags);
    this.#pushLog(`setFlipbook h=0x${handle.toString(16)} d=${delay} dur=${dur} frames=${frames} cols=${cols} flags=${flags}${o === 'applied' ? '' : ` [${o}]`}`);
  }

  /** `0x322`（`sub_4AE2C0`）：mesh 顶点色 state0。★引擎 `sub_4AAB80` 缺失即建项、无门控。 */
  setVertexColor(handle: number, state0: number): void {
    this.#markDirty();
    const o = scSetVertexColor(this.scene, handle, state0);
    const m = this.meshes.get(handle);
    if (m) assertFlags('mesh', m.handle, m.flags);
    this.#pushLog(`setVertexColor h=0x${handle.toString(16)} state0=0x${state0.toString(16)}${o === 'applied' ? '' : ' [建空项]'}`);
  }

  /** `0x323`（`sub_4AE330`）：mesh 顶点色动画窗。★缺失即建项、无门控。 */
  setVertexColorAlpha(handle: number, delay: number, count: number, state1: number): void {
    this.#markDirty();
    const o = scSetVertexColorAlpha(this.scene, handle, delay, count, state1);
    const m = this.meshes.get(handle);
    if (m) assertFlags('mesh', m.handle, m.flags);
    this.#pushLog(`setVertexColorAlpha h=0x${handle.toString(16)} d=${delay} c=${count} to=0x${state1.toString(16)}${o === 'applied' ? '' : ' [建空项]'}`);
  }

  setDrawColorAlpha(handle: number, from: number): void {
    this.#markDirty();
    const o = scSetDrawColorAlpha(this.scene, handle, from);
    const it = this.drawItems.get(handle);
    if (it) assertFlags('drawitem', it.handle, it.flags);
    this.#pushLog(`setDrawColorAlpha h=0x${handle.toString(16)} from=0x${from.toString(16)}${o === 'applied' ? '' : ' [建空项]'}`);
  }

  /** 0x1F7 detach-texture (sub_422BC0)：删单/区间图元。读 op1=handle、op2=count；按 count 分派：
   *  - count ≤ 1 → sub_4AB950(_this+80708, handle)：**移除该 handle 单图元**（`sub_459EA0` 找 + `sub_4A8AF0`/`4A9020`/`4A9270` std::map erase，置脏 `[46508]=1`）。
   *    TITLE 的 hover 回退（label_00003340 part1）就用 `detach-texture <old_normal> 1` 移除上一步 hover 画出的 normal 图元，
   *    让该按钮回退到 highlight（配合 part1 的 set-draw-color-alpha highlight→opaque）。emulator 先前是 no-op，故 normal 残留 → "始终 hover"。
   *  - count > 1 → sub_4ABB60(_this+80708, handle, count)：**按 handle 区间批量移除** —— 在 4 个有序容器上 lower_bound `handle` 与 `handle+count`，
   *    对 `[begin,end)` 每个结点调用 `sub_4A8AF0`（std::map erase，经 sub_4AA1D0/4AA330/4AA3D0 逐结点删），并销毁 +266/+267 容器的每项 record
   *    （vtable 调用 delete `[1]` + `operator delete` `[2]/[3]/[4]`），置脏 `[11627]=1`。→ **删除 handle∈[handle, handle+count) 的全部绘制项/网格**。
   *    SYSTEM4/LOGO/TITLE 开机大量用（count 2/3/4/6/0x19/0x64/0x12c/0x1f4），用于批量清掉一段特效/网格（非崩溃路径，需实现 range-remove）。 */
  detachTexture(handle: number, count: number): void {
    this.#markDirty();
    const r = scDetachTexture(this.scene, handle, count);
    if (count <= 1) {
      this.#pushLog(`detachTexture h=0x${handle.toString(16)} count=${count} REMOVE (drawItems=${r.drawItems}, meshes=${r.meshes})`);
    } else {
      this.#pushLog(`detachTexture h=0x${handle.toString(16)} count=${count} RANGE-REMOVE [0x${handle.toString(16)},0x${(handle + count).toString(16)}) (drawItems=${r.drawItems}, meshes=${r.meshes})`);
    }
  }

  /**
   * `0x202` set-draw-color（`sub_4AD0C0`）：`sub_4AAA50` 建项 → **门控 `flags & 1`** →
   * `|=2`/`+0x34=0`/`+0x38`/`+0x4C`/`+0x64`。★项不存在时只建空项，本 op 不生效（引擎构造器 flags=0）。
   */
  setDrawColor(handle: number, delay: number, count: number, to: number): void {
    this.#markDirty();
    const o = scSetDrawColor(this.scene, handle, delay, count, to);
    const it = this.drawItems.get(handle);
    if (it) assertFlags('drawitem', it.handle, it.flags);
    this.#pushLog(`setDrawColor h=0x${handle.toString(16)} d=${delay} c=${count} to=0x${to.toString(16)}${o === 'applied' ? '' : ` [${o}]`}`);
  }

  setWaitFlag(mask: number): void {
    this.waitFlags |= mask;
    this.#markDirty();
    this.#pushLog(`setWaitFlag 0x${mask.toString(16)} (~0x${(this.waitFlags & mask).toString(16)})`);
  }

  releaseTexture(layer: number): void {
    this.#markDirty();
    this.slotTex.delete(layer);
    this.#pushLog(`releaseTexture layer=${layer}`);
  }

  playMovie(id: number): void {
    this.#markDirty();
    this.#pushLog(`playMovie id=0x${id.toString(16)}`);
  }

  /**
   * `0x1F6`（sub_41A130 → `sub_4AB7A0(_this+80708)`）：**整批释放绘制项/网格**。
   * 引擎里它扫描绘制容器逐项 delete；emulator 的等价语义 = 清空 `drawItems` + `meshes`，
   * **保留纹理槽绑定**（`slotTex` 不动 —— 引擎这里只释放图元/网格对象，不动纹理资源）。
   */
  /** `0x1F6`（sub_41A130）：整批释放绘制项/网格（保留纹理槽）→ 共享模型层 `scClearDrawContainer`。 */
  clearDrawContainer(): void {
    const r = scClearDrawContainer(this.scene);
    this.drawCount = 0;
    this.#markDirty();
    this.#pushLog(`clearDrawContainer: 释放 drawItems=${r.drawItems} meshes=${r.meshes}（保留纹理槽）`);
  }

  /** `0x20C`（sub_41A1A0 → `sub_4B4040(_this+80708)`）：帧刷新。emulator 的渲染帧循环自行 present，这里只标脏。 */
  frameTick(): void {
    this.#markDirty();
  }

  // ---- 动画求值（每帧 present 调用） ---- //

  /** 场景是否还有动画在跑（供 0x400 门控放行判断）。 */
  sceneAnimationsDone(): boolean {
    return scAnimationsDone(this.scene, this.clockMs);
  }

  /** 场景"脏"：有配置类 op 改动过场景（present 的触发条件之一）。 */
  sceneDirtyFlag(): boolean {
    return this.sceneDirty;
  }

  /** 引擎式 present 条件："场景脏 || 仍有动画在播 || 命中 0x400 等待门"。 */
  needsRender(): boolean {
    return this.sceneDirty || !this.sceneAnimationsDone() || (this.waitFlags & 0x400) !== 0;
  }

  /** 诊断：导出 draw-item 实况（handle/layer/dst/alpha），用于排查 hover 高亮叠层是否渲染/回退。 */
  debugDrawItems(): string {
    const clock = this.clockMs;
    const a = [...this.drawItems.values()]
      .sort((x, y) => x.layer - y.layer || x.handle - y.handle)
      .map((it) => `0x${it.handle.toString(16)}:L${it.layer}@(${it.dstX},${it.dstY})a${this.#itemAlpha(it, clock)}`)
      .join(' ');
    return `items={${a || '无'}}`;
  }

  /**
   * 诊断：导出某绘制项**求值后**的渲染状态（先推进动画窗，再取各窗结果）。
   * 控制窗与回归测试用它观察引擎的 5 窗语义（颜色/缩放/旋转/平移/flipbook + 源矩形）。
   */
  debugItemState(handle: number): {
    color: number;
    scale: Vec3;
    rotRad: number;
    trans: Vec3;
    src: { x: number; y: number; w: number; h: number };
    /** 动画位仍在（`flags & 2`）——即"还有窗没走完"。 */
    pending: boolean;
  } | null {
    const it = this.drawItems.get(handle);
    if (!it) return null;
    const clock = this.clockMs;
    advanceWindows(it, clock); // 先推进窗（窗末 work ← target），再取各窗结果
    return {
      color: itemColor(it, clock),
      scale: itemScale(it, clock),
      rotRad: itemRotationRad(it, clock),
      trans: itemTranslation(it, clock),
      src: itemSrcRect(it, clock),
      pending: (it.flags & 2) !== 0,
    };
  }

  #markDirty(): void {
    this.sceneDirty = true;
  }

  /** draw-item diffuse alpha（0..255）：取 `itemColor` 的 alpha 字节。 */
  #itemAlpha(it: Item, clock: number): number {
    return (itemColor(it, clock) >>> 24) & 0xff;
  }

  // ---- 每帧渲染 ---- //

  /** 启动渲染：仅记录起点（墙钟）并保留一个 ticker 画 HUD。
   *  注意：present() 不再由 ticker 并发调用——引擎是"跑完一批指令 → present"，
   *  所以 present() 由 renderer 循环在每批指令之后（帧末）调用，避免中间态场景图闪一帧。 */
  startFrameLoop(now = 0): void {
    if (this.frameStarted) return;
    this.frameStarted = true;
    this.wallStart = performance.now();
    // HUD 已移除（诊断信息移至控制窗）；不再用 ticker 每帧 drawHud。
  }

  present(): void {
    this.clockMs = performance.now() - this.wallStart; // 墙钟毫秒（单调推进）
    const clock = this.clockMs;
    this.drawRoot.removeChildren();

    // 0) 逐帧驱动：推进所有 draw-item 的 5 个动画窗（窗末 work ← target；全窗结束清动画位）。
    for (const it of this.drawItems.values()) advanceWindows(it, clock);

    // 节流诊断：每 ~500ms 记一次 scene 合成状态（看动画推进 + 是否有 item/mesh/纹理）。
    if (clock - this.lastSummary >= 500) {
      this.lastSummary = clock;
      const itemInfo = [...this.drawItems.values()]
        .map((it) => `${it.layer}:a${this.#itemAlpha(it, clock)}`)
        .join(' ');
      const meshInfo = [...this.meshes.values()]
        .map((m) => `${(m.handle & 0xf).toString(16)}:a${(calcDiffuse(m, clock) >> 24) & 0xff}`)
        .join(' ');
      this.#pushLog(
        `[present ${Math.round(clock)}ms] items={${itemInfo || '无'}} meshes={${meshInfo || '无'}} slotTex=${this.slotTex.size} wait=0x${this.waitFlags.toString(16)}`,
      );
    }

    // 1) draw-items（图像）：按 layer 升序、再 handle 升序。
    const items = [...this.drawItems.values()].sort((a, b) => a.layer - b.layer || a.handle - b.handle);
    for (const it of items) {
      // ★bit0 门：引擎渲染器 `sub_4AEEA0` 以 `(*elem & 1) != 0` 为绘制门（raw 133361）。
      //   任何"缺失即建项"的 setter（sub_4AAA50）建出的空项 flags=0 ⇒ **不画**。
      //   早前漏了这个门，空项会被当成正常项画出来（用 alpha 0 的色掩盖了症状）。
      if ((it.flags & 1) === 0) continue;
      const color = itemColor(it, clock);
      const alpha = (color >> 24) & 0xff;
      if (alpha <= 0) continue; // 全透明跳过
      // ★纹理解析：**槽号 = DrawItem`+4`**（`draw-texture` 的 op2；见 op_draw_texture）。
      //   `it.layer`/`it.handle` 是绘制层序（op1 = Scene map key），**不是槽号** —— 早前这里误用
      //   `slotTex.get(it.layer)`，于是除"层号恰好等于某个已绑定槽"的极少数项外，全部取不到纹理
      //   → 退化成 #placeholder 色块（表现为"背景消失、只剩零星几个方块"）。槽→imgid 由 set-texture 建立。
      const { tex, imgid } = this.resolveItemTexture(it);
      const rect = itemSrcRect(it, clock); // flipbook 窗（窗4）会改源矩形
      const spr = tex ? this.#cropSprite(tex, rect) : this.#placeholder(it);
      if (!tex && imgid === undefined) {
        this.#pushLog(`[present] item h=0x${it.handle.toString(16)} layer=${it.layer} 未绑定纹理槽 → 占位块`);
      }
      // 位置：DrawItem`+36/+40/+44`（由 `0x219` 写；未写时 = draw-texture 的 op7/8），
      // 再叠加平移动画窗（窗3）的偏移（引擎把平移矩阵乘进世界矩阵）。
      const tr = itemTranslation(it, clock);
      spr.position.set(it.posX + tr.x, it.posY + tr.y);
      // pivot（`0x217` 写 DrawItem`+24/+28/+32`）：引擎 `sub_49AA30` 以 `T(-pivot) → 动画矩阵 → T(+pivot)`
      // 夹住动画矩阵 ⇒ pivot 是旋转/缩放的基准点。Pixi 的 pivot 以纹理左上角为原点，故直接换算。
      if (it.pivotX !== 0 || it.pivotY !== 0) spr.pivot.set(it.pivotX, it.pivotY);
      const sc = itemScale(it, clock);
      if (sc.x !== 1 || sc.y !== 1) spr.scale.set(sc.x, sc.y);
      const rot = itemRotationRad(it, clock);
      if (rot !== 0) spr.rotation = rot;
      spr.tint = color & 0xffffff; // diffuse RGB 调制纹理（逐像素 RGB×α）
      spr.alpha = alpha / 255; // diffuse alpha 淡入
      this.drawRoot.addChild(spr);
    }

    // 2) meshes（顶点色黑覆盖层）：按 handle 升序，叠在图之上。
    const meshes = [...this.meshes.values()].sort((a, b) => a.handle - b.handle);
    for (const m of meshes) {
      const diffuse = calcDiffuse(m, clock);
      const a = (diffuse >> 24) & 0xff;
      if (a <= 0) continue;
      const ov = new Sprite(this.unit);
      ov.width = W;
      ov.height = H;
      ov.tint = 0x000000;
      ov.alpha = a / 255;
      this.drawRoot.addChild(ov);
    }
    this.drawCount++;
    this.sceneDirty = false; // present 已消费本次"脏"标记
  }

  /**
   * **绘制项 → 纹理**：`draw-texture` 的 **op2** 是纹理槽（存进 `Item.tex`），
   * 而 `handle` 是 Scene map 的 key（= 层序）、`layer` 与之同值。
   * 槽→imgid 由 `set-texture` 建立（`slotImgid`），槽→Texture 由 `bindTexture` 载入（`slotTex`）。
   * 返回 `{ tex }` 命中；未绑定/未载入时 `{ imgid }`（imgid=undefined 表示该槽从未绑定）。
   * **抽成方法便于回归测试**（历史 bug：曾误用 `it.layer` 当槽号）。
   */
  resolveItemTexture(it: Item): { tex?: Texture; imgid?: number } {
    const slot = it.tex ?? 0;
    const imgid = this.slotImgid.get(slot);
    const tex = this.slotTex.get(slot);
    return { tex, imgid };
  }

  #cropSprite(tex: Texture, rect: { x: number; y: number; w: number; h: number }): Sprite {
    const frame = new Rectangle(rect.x, rect.y, rect.w, rect.h);
    const cropped = new Texture({ source: tex.source, frame });
    return new Sprite(cropped);
  }

  #placeholder(it: Item): Sprite {
    const spr = new Sprite(this.unit);
    spr.width = it.srcW;
    spr.height = it.srcH;
    spr.tint = (((it.layer * 47) % 360) << 8) | 0x6a;
    return spr;
  }

  // ---- HUD ---- //
  // 左上角画布 HUD 日志已移除：诊断信息（脚本名/已忽略指令/日志开关）移到独立控制窗（ControlWindow）。

  drawHud(): void {
    // no-op：保留方法签名以兼容 renderer.ts 的 `native.drawHud()`（只留 no-op，不再在画布上渲染日志）。
  }

  /**
   * 场景切换钩子（`draw-texture` 0x1FB / `create-mesh` 0x320 每次配置绘制项时被调用）。
   *
   * ★**曾经的实现问题（2025 修正）**：原先在这里做
   *     `if (status.scriptName !== lastScript) { drawItems.clear(); meshes.clear(); … }`
   *   —— 但脚本名在**每次 `call-script` / 帧切换**时都会变（CONFIG.BIN → CONFIG2.BIN → CONFIG1.BIN、
   *   以及 `call-frame` 预装帧），于是**每次进出子脚本都会把整批绘制项抹掉**。表现为：
   *   进入设置界面（CONFIG2/CONFIG1）后，先前渲染好的**背景整批消失**，只剩当前脚本重画的零星几项。
   *
   * 引擎实际语义（raw）：绘制项存在 `_this+80708` 的容器里，**脚本装载/切换不清空该容器**；
   *   清空只由显式指令完成——`detach-texture`(0x1F7 `sub_422BC0`：删单/删 `[handle,handle+count)`)、
   *   `release-texture`(0x1FA) 等。因此这里**不再做任何跨脚本清空**：`lastScript` 仅保留作诊断，
   *   场景内容完全由脚本的 detach/draw 指令驱动（emulator 缺的正是这些指令的实现，而不是"切换时清场"）。
   */
  #onSceneChange(_handle: number): void {
    this.lastScript = this.status.scriptName;
    // 仅「需要重绘」：不 clear、不动 waitFlags（避免误清引擎仍在用的图元/门控）。
    this.#markDirty();
  }
}
