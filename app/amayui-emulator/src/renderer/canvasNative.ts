/**
 * Canvas 2D 渲染后端（NativeBridge 实现）。
 * 把 VM 的子系统/渲染调用映射到 canvas 2D 上下文，并叠加一个"运行状态 HUD"。
 *
 * 阶段说明（技术评估见 docs/08-render-backend.md）：
 *  - 本实现是**起始后端**：先用 canvas 2D 打通"VM draw 调用 -> 屏幕上像素"的因果链。
 *  - 当前 opcode→native 调用仍是**原始操作数（raw）**直传（见 ops.ts stubSubsystem），
 *    坐标/颜色/序号尚未按 ADR-011 指针模型逐操作数解码，故渲染为"占位四边形"，不是真实 CG。
 *  - 下一步（M5）：把 draw-texture/set-texture/draw-string/color 等改为按 readIntOperand/readFloatOperand
 *    解码后再调用 **类型化** 的 native 接口（render API），并接入真实 CG 图片解码 + 字体。
 */
import type { NativeBridge } from '../vm/native.js';

export interface RenderStatus {
  scriptName: string;
  ip: number;
  steps: number;
  log: string[];
}

const W = 640;
const H = 480;

export class CanvasNative implements NativeBridge {
  private ctx: CanvasRenderingContext2D;
  private status: RenderStatus;

  constructor(ctx: CanvasRenderingContext2D, status: RenderStatus) {
    this.ctx = ctx;
    this.status = status;
    this.#drawBackdrop();
  }

  #pushLog(msg: string): void {
    this.status.log.push(msg);
    if (this.status.log.length > 8) this.status.log.shift();
  }

  /** 初始暗色渐变背景，避免全黑难以判断窗口是否工作。 */
  #drawBackdrop(): void {
    const g = this.ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#1a2030');
    g.addColorStop(1, '#0a0d16');
    this.ctx.fillStyle = g;
    this.ctx.fillRect(0, 0, W, H);
    this.ctx.fillStyle = 'rgba(255,255,255,0.06)';
    this.ctx.font = '11px monospace';
    this.ctx.fillText('amayui-emulator · canvas 2D backend', 12, H - 16);
  }

  // ---- NativeBridge 实现 ----

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
    // 原始 args（暂不解码指针）：[tex, layer, x, y, w, h, ...]
    const [tex = 0, layer = 0, x = 0, y = 0, w = 0, h = 0] = args;
    this.#pushLog(`drawTexture tex=${tex} layer=${layer} (${x},${y},${w}x${h})`);
    // 占位四边形：按纹理号取色相，描边框 + 标签
    if (w > 0 && h > 0) {
      this.ctx.fillStyle = `hsla(${(tex * 47) % 360}, 65%, 48%, 0.9)`;
      this.ctx.fillRect(x, y, w, h);
      this.ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      this.ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      this.ctx.fillStyle = '#ffffff';
      this.ctx.font = '10px monospace';
      this.ctx.fillText(`tex${tex}/${layer}`, x + 3, y + 12);
    }
  }

  setTexture(args: number[]): void {
    const [slot = 0, img = 0, color = 0xffffff] = args;
    this.#pushLog(`setTexture slot=${slot} img=${img} color=${color.toString(16)}`);
    // 占位：在画布中央画一个小色块表示"该槽已绑定图像"
    this.ctx.fillStyle = `hsl(${(img * 31) % 360}, 55%, 55%)`;
    this.ctx.fillRect(12, 12, 24, 24);
    this.ctx.fillStyle = '#fff';
    this.ctx.font = '10px monospace';
    this.ctx.fillText(`img${img}`, 12, 44);
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
    return 0; // 无输入：TITLE 主循环按此停在菜单轮询
  }

  sleep(_ms: number): void {
    /* renderer 内 no-op，避免死等；boot 的消息轮询 sleep 直接返回。 */
  }

  unhandled(opcode: number, name: string): void {
    this.#pushLog(`unhandled 0x${opcode.toString(16)} ${name}`);
  }

  // ---- HUD（每步节流刷新，覆盖左上角小块，不清屏）----
  drawHud(): void {
    const c = this.ctx;
    c.fillStyle = 'rgba(0,0,0,0.75)';
    c.fillRect(0, 0, 300, 14 + this.status.log.length * 12 + 22);
    c.font = '11px monospace';
    c.fillStyle = '#7CFC00';
    c.fillText(`script=${this.status.scriptName} ip=${this.status.ip} step=${this.status.steps}`, 8, 12);
    let yy = 26;
    for (const l of this.status.log) {
      c.fillStyle = '#9ab';
      c.fillText(l, 8, yy);
      yy += 12;
    }
  }
}
