/**
 * PixiJS v8 渲染后端（实现 NativeBridge，最终替换 Canvas 占位）。
 * 用 WebGL/WebGPU（Pixi v8 后端）把 AGE 的 draw 调用画成批量 Sprite 矩形。
 *
 * 说明：
 *  - 本实现先复用 NativeBridge 的 **原始 raw 参数**（见 ops.ts stubSubsystem -> drawTexture/setTexture），
 *    把标题的 draw-texture 命令画成**按纹理编号着色的矩形**（占位），布局/坐标即游戏原布局。
 *  - 真实 CG 需要：① 操作数解码（readIntOperand）② AGF→PNG 解码（脚本已实现，见 scripts/agf）③
 *    纹理号→图像资源→文件 的映射。此三块在「真实标题图」阶段接上。
 */
import {
  Application,
  Container,
  Graphics,
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
  private unit: Texture; // 1x1 白纹理，按 texture 编号 tint 成色、scale 到目标矩形
  private hud: Text;
  private status: RenderStatus;
  private layerRoot: Container<ContainerChild>;
  private drawCount = 0;

  static async create(
    status: RenderStatus,
    width = 1920,
    height = 1080,
    displayWidth = 1280,
    displayHeight = 720,
  ): Promise<PixiBackend> {
    const b = new PixiBackend(status);
    b.app = new Application();
    await b.app.init({ width, height, background: 0x0a0d16, antialias: true });
    document.body.appendChild(b.app.canvas);
    b.app.canvas.style.width = `${displayWidth}px`;
    b.app.canvas.style.height = `${displayHeight}px`;
    b.stage = b.app.stage;
    b.layerRoot = b.app.stage;
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
    this.unit = null as unknown as Texture;
    this.hud = null as unknown as Text;
    this.layerRoot = null as unknown as Container<ContainerChild>;
  }

  #pushLog(msg: string): void {
    this.status.log.push(msg);
    if (this.status.log.length > 8) this.status.log.shift();
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
    // 原始 args（暂不解码指针）：[tex, layer, x, y, w, h, p, q]
    const [tex = 0, layer = 0, x = 0, y = 0, w = 0, h = 0] = args;
    this.#pushLog(`drawTexture tex=${tex} layer=${layer} (${x},${y},${w}x${h})`);
    if (w <= 0 || h <= 0) return;
    const spr = new Sprite(this.unit);
    spr.width = w;
    spr.height = h;
    spr.position.set(x, y);
    // 按纹理号取色相（占位）；layer 加到不同子容器保持次序
    spr.tint = hsl((tex * 47) % 360, 65, 48);
    // 半透明边框提示
    const border = new Graphics();
    border.rect(x, y, w, h).stroke({ color: 0xffffff, width: 1, alpha: 0.7 });
    const holder = this.layerFor(layer);
    holder.addChild(spr, border);
    this.drawCount++;
  }

  setTexture(args: number[]): void {
    const [slot = 0, img = 0, color = 0xffffff] = args;
    this.#pushLog(`setTexture slot=${slot} img=${img} color=0x${color.toString(16)}`);
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

  private layerFor(layer: number): Container<ContainerChild> {
    let l = this.layerRoot.getChildByLabel(`layer${layer}`) as Container<ContainerChild> | null;
    if (!l) {
      l = new Container();
      l.label = `layer${layer}`;
      this.layerRoot.addChild(l);
    }
    return l;
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
