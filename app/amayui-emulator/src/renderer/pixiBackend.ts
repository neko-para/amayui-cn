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
  Text,
  Texture,
  type ContainerChild,
} from 'pixi.js';
import {
  assertFlags,
  UnknownFlagError,
  type DrawItemConfig,
  type MeshCreateSpec,
  type NativeBridge,
} from '../vm/native.js';
import type { InputManager } from '../vm/input.js';

export interface RenderStatus {
  scriptName: string;
  ip: number;
  steps: number;
  log: string[];
  /** 全量日志（不截断），供渲染器按批次落盘诊断。 */
  trace: string[];
}

interface AnimWindow {
  delay: number;
  count: number;
  start: number;
  started: boolean;
}

interface Item {
  handle: number;
  layer: number;
  srcX: number;
  srcY: number;
  srcW: number;
  srcH: number;
  dstX: number;
  dstY: number;
  flags: number; // 仅 bit0 存在 | bit1 颜色动画（&2）；其余位 assertFlags 拒绝
  from: number; // +96 (ARGB)
  to: number; // +100 (ARGB)
  anim?: AnimWindow; // +52 start / +56 delay / +76 count
  colorSet?: boolean; // 是否被 set-draw-color-alpha/color 显式设过色（无动画时也尊重其 alpha）
}

interface MeshObj {
  handle: number;
  layer: number;
  flags: number; // 仅 bit0 存在 | bit1 颜色动画
  state0: number;
  state1: number;
  anim?: AnimWindow; // +10 start / +11 delay / +12 count
}

const W = 1280;
const H = 720;

export class PixiBackend implements NativeBridge {
  private app: Application;
  private stage: Container<ContainerChild>;
  private drawRoot: Container<ContainerChild>; // 场景绘制（每次 present 重建）
  private hud: Text;
  private status: RenderStatus;
  private unit: Texture;
  /** 共享输入状态（renderer 写 / VM 读）。由 create 注入。 */
  input?: InputManager;
  private imgCache = new Map<number, Texture>();
  private slotTex = new Map<number, Texture>(); // slot/layer -> Texture（set-texture 绑定）
  private pendingImg = new Set<number>();
  private lastScript = '';
  private drawCount = 0;

  // Plan A：持久场景图
  private drawItems = new Map<number, Item>();
  private meshes = new Map<number, MeshObj>();
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
    b.hud = new Text({ text: '', style: { fontFamily: 'monospace', fontSize: 13, fill: 0x7cfc00 } });
    b.hud.position.set(8, 8);
    b.stage.addChild(b.hud);
    b.#attachMouseInput(b.app.canvas, input);
    return b;
  }

  /** 把鼠标事件映射到 InputManager（虚拟 1280×720 坐标；左=bit0、右=bit1）。
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
    // 右键需阻止默认菜单，否则点击无法作为游戏输入
    window.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private constructor(status: RenderStatus) {
    this.status = status;
    this.app = null as unknown as Application;
    this.stage = null as unknown as Container<ContainerChild>;
    this.drawRoot = null as unknown as Container<ContainerChild>;
    this.unit = null as unknown as Texture;
    this.hud = null as unknown as Text;
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
    const it = this.drawItems.get(cfg.handle) ?? {
      handle: cfg.handle,
      layer: cfg.layer,
      srcX: cfg.srcX,
      srcY: cfg.srcY,
      srcW: cfg.srcW,
      srcH: cfg.srcH,
      dstX: cfg.dstX,
      dstY: cfg.dstY,
      flags: 0,
      from: 0xffffffff,
      to: 0xffffffff,
    };
    it.layer = cfg.layer;
    it.srcX = cfg.srcX;
    it.srcY = cfg.srcY;
    it.srcW = cfg.srcW;
    it.srcH = cfg.srcH;
    it.dstX = cfg.dstX;
    it.dstY = cfg.dstY;
    it.flags |= 1; // bit0 = 存在
    assertFlags('drawitem', it.handle, it.flags);
    this.drawItems.set(cfg.handle, it);
    this.#pushLog(`configureDrawItem h=0x${cfg.handle.toString(16)} layer=${cfg.layer} (${cfg.srcX},${cfg.srcY},${cfg.srcW}x${cfg.srcH})`);
  }

  bindTexture(imgid: number, slot: number): void {
    this.#markDirty();
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
    const m = this.meshes.get(spec.handle) ?? {
      handle: spec.handle,
      layer: spec.layer,
      flags: 0,
      state0: 0xffffffff,
      state1: 0,
      anim: undefined,
    };
    m.flags |= 1; // bit0 = 存在
    assertFlags('mesh', m.handle, m.flags);
    this.meshes.set(spec.handle, m);
    this.#pushLog(`createMesh h=0x${spec.handle.toString(16)} v=${spec.vcount}`);
  }

  setVertexColor(handle: number, state0: number): void {
    this.#markDirty();
    const m = this.meshes.get(handle);
    if (!m) {
      this.#pushLog(
        `setVertexColor: mesh 0x${handle.toString(16)} 不存在（现有 mesh: ${[...this.meshes.keys()].map((h) => '0x' + h.toString(16)).join(',') || '无'}）`,
      );
      return;
    }
    assertFlags('mesh', m.handle, m.flags);
    m.state0 = state0;
    this.#pushLog(`setVertexColor h=0x${handle.toString(16)} state0=0x${state0.toString(16)}`);
  }

  setVertexColorAlpha(handle: number, delay: number, count: number, state1: number): void {
    this.#markDirty();
    const m = this.meshes.get(handle);
    if (!m) {
      this.#pushLog(
        `setVertexColorAlpha: mesh 0x${handle.toString(16)} 不存在（现有 mesh: ${[...this.meshes.keys()].map((h) => '0x' + h.toString(16)).join(',') || '无'}）`,
      );
      return;
    }
    m.flags |= 2; // bit1 = 颜色动画
    assertFlags('mesh', m.handle, m.flags);
    m.state1 = state1;
    m.anim = { delay, count, start: 0, started: false };
    this.#pushLog(`setVertexColorAlpha h=0x${handle.toString(16)} d=${delay} c=${count} to=0x${state1.toString(16)}`);
  }

  setDrawColorAlpha(handle: number, from: number): void {
    this.#markDirty();
    const it = this.drawItems.get(handle);
    if (!it) {
      this.#pushLog(
        `setDrawColorAlpha: item 0x${handle.toString(16)} 不存在（现有 item: ${[...this.drawItems.keys()].map((h) => '0x' + h.toString(16)).join(',') || '无'}）`,
      );
      return;
    }
    assertFlags('drawitem', it.handle, it.flags);
    it.from = from;
    it.colorSet = true; // 显式设色：无动画时也按此色的 alpha 渲染（hover 高亮可回退）
    // 清掉/重置动画窗：引擎 set-draw-color-alpha 是"设当前色"，若沿用旧 set-draw-color 的 to=opaque 动画窗，
    // #itemAlpha 会一直在窗末返回 to（不透明），导致 hover 高亮无法回退。清除后即时按 from 的 alpha 渲染。
    it.anim = undefined;
    this.#pushLog(`setDrawColorAlpha h=0x${handle.toString(16)} from=0x${from.toString(16)}`);
  }

  /** 0x1F7 texture-op：对图元应用纹理/颜色操作。emulator 标记图元重渲染（颜色态在 present 生效）。 */
  textureOp(handle: number, mode: number): void {
    this.#markDirty();
    this.#pushLog(`textureOp h=0x${handle.toString(16)} mode=${mode}`);
  }

  setDrawColor(handle: number, delay: number, count: number, to: number): void {
    this.#markDirty();
    const it = this.drawItems.get(handle);
    if (!it) {
      this.#pushLog(
        `setDrawColor: item 0x${handle.toString(16)} 不存在（现有 item: ${[...this.drawItems.keys()].map((h) => '0x' + h.toString(16)).join(',') || '无'}）`,
      );
      return;
    }
    it.flags |= 2; // bit1 = 颜色动画
    assertFlags('drawitem', it.handle, it.flags);
    it.to = to;
    it.anim = { delay, count, start: 0, started: false };
    this.#pushLog(`setDrawColor h=0x${handle.toString(16)} d=${delay} c=${count} to=0x${to.toString(16)}`);
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

  // ---- 动画求值（每帧 present 调用） ---- //

  /** mesh+draw-item 全部是否已完成动画（供 0x400 门控放行判断）。 */
  sceneAnimationsDone(): boolean {
    for (const it of this.drawItems.values()) {
      if (it.flags & 2 && it.anim && !this.#windowDone(it.anim, this.clockMs)) return false;
    }
    for (const m of this.meshes.values()) {
      if (m.flags & 2 && m.anim && !this.#windowDone(m.anim, this.clockMs)) return false;
    }
    return true;
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

  #markDirty(): void {
    this.sceneDirty = true;
  }

  #windowDone(w: AnimWindow, clock: number): boolean {
    if (!w.started) return false; // 尚未开播，视为未完成
    return clock >= w.start + w.delay + w.count;
  }

  /** mesh 顶点色 CalcDiffuse：state0↔state1 逐字节 lerp（黑覆盖层的 alpha）。 */
  #calcDiffuse(m: MeshObj, clock: number): number {
    assertFlags('mesh', m.handle, m.flags);
    if (!(m.flags & 2) || !m.anim || m.anim.count <= 0) return m.state1;
    const w = m.anim;
    if (!w.started) {
      w.start = clock;
      w.started = true;
    }
    if (clock >= w.start + w.delay + w.count) return m.state1;
    if (clock <= w.start + w.delay) return m.state0;
    const a = (clock - w.start - w.delay) / w.count;
    return this.#lerpArgb(m.state0, m.state1, a);
  }

  /** draw-item diffuse alpha：from→to 只插 alpha 字节（RGB 恒白，逐像素淡入）。返回 0..255。
   *  无动画窗时，若图元被 set-draw-color-alpha 显式设过色（colorSet），按其 from 色的 alpha 渲染
   *  （避免 hover 高亮叠层永远停在默认不透明、无法回退）。 */
  #itemAlpha(it: Item, clock: number): number {
    assertFlags('drawitem', it.handle, it.flags);
    if (it.flags & 2 && it.anim) {
      const w = it.anim;
      if (!w.started) {
        w.start = clock;
        w.started = true;
      }
      if (clock >= w.start + w.delay + w.count) return (it.to >> 24) & 0xff;
      if (clock <= w.start + w.delay) return (it.from >> 24) & 0xff;
      const a = (clock - w.start - w.delay) / w.count;
      const fa = (it.from >> 24) & 0xff;
      const ta = (it.to >> 24) & 0xff;
      return Math.round(fa + (ta - fa) * a);
    }
    // 无动画窗：尊重显式设色的 alpha；默认不透明。
    if (it.colorSet) return (it.from >> 24) & 0xff;
    return 255;
  }

  #lerpArgb(a: number, b: number, t: number): number {
    const ch = (shift: number) => {
      const av = (a >> shift) & 0xff;
      const bv = (b >> shift) & 0xff;
      return Math.round(av + (bv - av) * t);
    };
    return (ch(24) << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0);
  }

  // ---- 每帧渲染 ---- //

  /** 启动渲染：仅记录起点（墙钟）并保留一个 ticker 画 HUD。
   *  注意：present() 不再由 ticker 并发调用——引擎是"跑完一批指令 → present"，
   *  所以 present() 由 renderer 循环在每批指令之后（帧末）调用，避免中间态场景图闪一帧。 */
  startFrameLoop(now = 0): void {
    if (this.frameStarted) return;
    this.frameStarted = true;
    this.wallStart = performance.now();
    this.app.ticker.add(() => this.drawHud());
  }

  present(): void {
    this.clockMs = performance.now() - this.wallStart; // 墙钟毫秒（单调推进）
    const clock = this.clockMs;
    this.drawRoot.removeChildren();

    // 节流诊断：每 ~500ms 记一次 scene 合成状态（看动画推进 + 是否有 item/mesh/纹理）。
    if (clock - this.lastSummary >= 500) {
      this.lastSummary = clock;
      const itemInfo = [...this.drawItems.values()]
        .map((it) => `${it.layer}:a${this.#itemAlpha(it, clock)}`)
        .join(' ');
      const meshInfo = [...this.meshes.values()]
        .map((m) => `${(m.handle & 0xf).toString(16)}:a${(this.#calcDiffuse(m, clock) >> 24) & 0xff}`)
        .join(' ');
      this.#pushLog(
        `[present ${Math.round(clock)}ms] items={${itemInfo || '无'}} meshes={${meshInfo || '无'}} slotTex=${this.slotTex.size} wait=0x${this.waitFlags.toString(16)}`,
      );
    }

    // 1) draw-items（图像）：按 layer 升序、再 handle 升序。
    const items = [...this.drawItems.values()].sort((a, b) => a.layer - b.layer || a.handle - b.handle);
    for (const it of items) {
      const alpha = this.#itemAlpha(it, clock);
      if (alpha <= 0) continue; // 全透明跳过
      const tex = this.slotTex.get(it.layer);
      const spr = tex ? this.#cropSprite(tex, it) : this.#placeholder(it);
      spr.position.set(it.dstX, it.dstY);
      spr.alpha = alpha / 255; // 逐像素 alpha 淡入
      this.drawRoot.addChild(spr);
    }

    // 2) meshes（顶点色黑覆盖层）：按 handle 升序，叠在图之上。
    const meshes = [...this.meshes.values()].sort((a, b) => a.handle - b.handle);
    for (const m of meshes) {
      const diffuse = this.#calcDiffuse(m, clock);
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

  #cropSprite(tex: Texture, it: Item): Sprite {
    const frame = new Rectangle(it.srcX, it.srcY, it.srcW, it.srcH);
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

  drawHud(): void {
    const im = this.input;
    const mouse = im
      ? `mouse=(${im.hasCursor ? `${im.x},${im.y}` : 'off'}) btn=${im.buttons & 1 ? 'L' : ''}${im.buttons & 2 ? 'R' : ''}`
      : 'mouse=—';
    this.hud.text =
      `script=${this.status.scriptName}  ip=${this.status.ip}  step=${this.status.steps}  draws=${this.drawCount}\n` +
      `clock=${Math.round(this.clockMs)}ms  items=${this.drawItems.size}  meshes=${this.meshes.size}  wait=0x${this.waitFlags.toString(16)}\n` +
      `${mouse}` +
      (this.status.log.length ? `\n${this.status.log.map((s) => `  ${s}`).join('\n')}` : '');
  }

  #onSceneChange(_handle: number): void {
    if (this.status.scriptName !== this.lastScript) {
      this.lastScript = this.status.scriptName;
      this.drawItems.clear();
      this.meshes.clear();
      this.waitFlags = 0;
      this.#markDirty(); // 场景切换需触发一次 present（引擎：新场景要渲染）
      this.drawCount = 0;
    }
  }
}
