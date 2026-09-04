/**
 * PixiJS v8 渲染后端（实现 NativeBridge，最终替换 Canvas 占位）。
 * 用 WebGL/WebGPU（Pixi v8 后端）把 AGE 的 draw 调用画成 Sprite（批量），HUD 显示状态。
 *
 * 真实图像接入（本次）：
 *  - set-texture 的 imgid（op1）经 `window.api.image(imgid)` 取到 AGF 解码后的 RGBA，包成 Pixi Texture 缓存；
 *  - set-texture 绑定「slot(op2) -> 该 imgid 的纹理」；
 *  - draw-texture 语义（实证，docs/10 §4）：`[tex, layer, srcX, srcY, srcW, srcH, dstX, dstY]`
 *    - op3-6 = **源裁剪矩形**（图集内位置）；op7/op8 = **目标屏幕位置**；目标尺寸 = 源尺寸（1:1）。
 *    - 用 layer 查 slot 绑定纹理，按源矩形裁剪、贴到屏幕位置 (dstX,dstY)。
 *  - 场景切换（脚本名变化）时清空绘制层，避免上一场景残留。
 *
 * 说明：视口为 1280×720（背景源(0,0,1280,720)+按钮最大(1263,710)均在内），Pixi 画布即 1280×720。
 * 标题菜单的按钮两态（normal/hover）由 draw-texture 的源矩形从 SO004 图集选列 + 目标位置(dstX,dstY)决定。
 *
 * 说明：
 *  - 仍保留「未绑定纹理」时的占位色块回退，保证非标题场景也能画出布局。
 *  - draw-texture 的 tex(0x30d40/0xa/0x64…) 是图形子系统句柄（见 docs/10），本实现按「layer==slot」整页贴图，
 *    对标题第1/2步(整页背景/版权)正确；对主菜单图集的子图切块是近似（整张 SO004 贴到各 dest rect）。
 *    → 后续要精确，可改为「tex 句柄 -> 图集子 UV」映射。
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
import type { NativeBridge } from '../vm/native.js';
export interface RenderStatus {
  scriptName: string;
  ip: number;
  steps: number;
  log: string[];
}

export class PixiBackend implements NativeBridge {
  private app: Application;
  private stage: Container<ContainerChild>;
  private drawRoot: Container<ContainerChild>; // 场景绘制（可整批清空）
  private hud: Text;
  private status: RenderStatus;
  private unit: Texture; // 1x1 白纹理，占位用
  private imgCache = new Map<number, Texture>(); // imgid -> Texture（AGF 解码后）
  private slotTex = new Map<number, Texture>(); // slot/layer -> Texture（set-texture 绑定）
  private pendingImg = new Set<number>();
  private lastScript = '';
  private drawCount = 0;

  static async create(
    status: RenderStatus,
    width = 1280,
    height = 720,
    displayWidth = 1280,
    displayHeight = 720,
  ): Promise<PixiBackend> {
    const b = new PixiBackend(status);
    b.app = new Application();
    // 固定渲染到 1280×720（游戏设计分辨率），autoDensity + devicePixelRatio：canvas CSS 保持 1280×720，
    // 底层按 DPR 渲染（高 DPI 清晰）。窗口内容区由 main.ts 用 setContentSize(1280,720) 强制 16:9，
    // 因此画布正好填满内容区，无黑边；DPI 只放大物理尺寸，不改变比例。
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
    // 绘制层在下、HUD 在上
    b.drawRoot = new Container();
    b.drawRoot.label = 'drawRoot';
    b.stage.addChild(b.drawRoot);
    b.unit = Texture.WHITE; // 内置 1x1 白纹理
    b.hud = new Text({ text: '', style: { fontFamily: 'monospace', fontSize: 13, fill: 0x7cfc00 } });
    b.hud.position.set(8, 8);
    b.stage.addChild(b.hud);
    return b;
  }

  private constructor(status: RenderStatus) {
    this.status = status;
    // 占位（app 在 create 里初始化）
    this.app = null as unknown as Application;
    this.stage = null as unknown as Container<ContainerChild>;
    this.drawRoot = null as unknown as Container<ContainerChild>;
    this.unit = null as unknown as Texture;
    this.hud = null as unknown as Text;
  }

  #pushLog(msg: string): void {
    this.status.log.push(msg);
    if (this.status.log.length > 8) this.status.log.shift();
  }

  /** 预载某资源 id 对应的图像纹理（先于 VM 执行，避免 draw 时纹理未到）。 */
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

  /** 把 top-down RGBA 包成 Pixi Texture。 */
  async #rgbaToTexture(w: number, h: number, data: Uint8Array): Promise<Texture> {
    const clamped = new Uint8ClampedArray(data); // 拷贝出独立 ArrayBuffer
    const imageData = new ImageData(clamped, w, h);
    const bmp = await createImageBitmap(imageData);
    return Texture.from(bmp);
  }

  // ---- NativeBridge ----
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

  drawTexture(args: number[]): void {
    // 原始 args：[tex, layer, srcX, srcY, srcW, srcH, dstX, dstY]
    //  op3-6 = 源裁剪矩形（图集内），op7/op8 = 目标屏幕位置，目标尺寸 = 源尺寸（1:1）。
    const [tex = 0, layer = 0, x = 0, y = 0, w = 0, h = 0, p = 0, q = 0] = args;
    // 场景切换：脚本名变化时清空绘制层（避免 LOGO 背景残留到菜单）。
    if (this.status.scriptName !== this.lastScript) {
      this.lastScript = this.status.scriptName;
      this.drawRoot.removeChildren();
      this.drawCount = 0;
    }
    if (w <= 0 || h <= 0) return;
    // 优先：layer 已绑定真实纹理 -> 按源矩形 (x,y,w,h) 裁剪，贴到屏幕位置 (p,q)，1:1。
    const real = this.slotTex.get(layer);
    if (real) {
      const frame = new Rectangle(x, y, w, h);
      const cropped = new Texture({ source: real.source, frame });
      const spr = new Sprite(cropped);
      spr.position.set(p, q);
      this.drawRoot.addChild(spr);
      this.#pushLog(`drawTexture tex=${tex} layer=${layer} src(${x},${y},${w}x${h}) dst(${p},${q}) real`);
      this.drawCount++;
      return;
    }
    // 回退：占位色块（保持布局）
    this.#pushLog(`drawTexture tex=${tex} layer=${layer} src(${x},${y},${w}x${h}) dst(${p},${q}) placeholder`);
    const spr = new Sprite(this.unit);
    spr.width = w;
    spr.height = h;
    spr.position.set(p, q);
    spr.tint = hsl((tex * 47) % 360, 65, 48);
    const border = new Graphics();
    border.rect(p, q, w, h).stroke({ color: 0xffffff, width: 1, alpha: 0.7 });
    this.drawRoot.addChild(spr, border);
    this.drawCount++;
  }

  setTexture(args: number[]): void {
    // 原始 args：[imgid, slot, color]（set-texture 的 op1=imgid, op2=slot）
    const [imgid = 0, slot = 0] = args;
    this.#pushLog(`setTexture imgid=0x${imgid.toString(16)} slot=0x${slot.toString(16)}`);
    if (imgid !== 0) {
      const tex = this.imgCache.get(imgid);
      if (tex) {
        this.slotTex.set(slot, tex);
        this.#pushLog(`  bind slot 0x${slot.toString(16)} <- imgid 0x${imgid.toString(16)}`);
      } else {
        // 纹理可能尚未预载：异步补载后绑定
        void this.preloadImage(imgid).then(() => {
          const t2 = this.imgCache.get(imgid);
          if (t2) this.slotTex.set(slot, t2);
        });
      }
    }
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
    /* renderer 内 no-op */
  }

  unhandled(opcode: number, name: string): void {
    this.#pushLog(`unhandled 0x${opcode.toString(16)} ${name}`);
  }

  drawHud(): void {
    this.hud.text = `script=${this.status.scriptName}  ip=${this.status.ip}  step=${this.status.steps}  draws=${this.drawCount}\n` +
      this.status.log.map((s) => `  ${s}`).join('\n');
  }
}

/** hsl(色相, 饱和度%, 亮度%) -> 0xRRGGBB */
function hsl(h: number, s: number, l: number): number {
  const s2 = s / 100;
  const l2 = l / 100;
  const c = (1 - Math.abs(2 * l2 - 1)) * s2;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l2 - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; } else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
  return ((r + m) * 255 << 16) | ((g + m) * 255 << 8) | ((b + m) * 255 | 0);
}
