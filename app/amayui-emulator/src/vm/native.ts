/** 子系统/系统调用的抽象接口 + 桩实现。
 *  VM 里所有引擎子系统调用（声音/渲染/字体/输入/睡眠/日志）都经此 bridge。
 *  桩实现只记录（无界面）；将来接 H5/canvas/WebAudio/输入。 */

export interface NativeBridge {
  log(msg: string): void;
  playSound?(id: number, volume: number): void;
  playBgm?(id: number): void;
  playVoice?(id: number): void;
  drawTexture?(args: number[]): void;
  setTexture?(args: number[]): void;
  setFont?(args: number[]): void;
  setString?(s: string): void;
  getInputType?(): number;
  sleep?(ms: number): void;
  /** 未实现/待处理的子系统 opcode 兜底：记录后返回（不阻塞 VM） */
  unhandled?(opcode: number, name: string): void;
}

/** 无界面桩实现：全部记录 + 返回默认，绝不触发真实渲染/音频/输入。 */
export class StubNative implements NativeBridge {
  constructor(private onLog: (msg: string) => void = (m) => console.log(m)) {}

  log(msg: string): void {
    this.onLog(msg);
  }
  playSound(id: number, volume: number): void {
    this.log(`[native:stub] play-sound-effect id=0x${id.toString(16)} vol=${volume}`);
  }
  playBgm(id: number): void {
    this.log(`[native:stub] play-bgm id=0x${id.toString(16)}`);
  }
  playVoice(id: number): void {
    this.log(`[native:stub] play-voice id=0x${id.toString(16)}`);
  }
  drawTexture(args: number[]): void {
    this.log(`[native:stub] draw-texture [${args.map((a) => '0x' + a.toString(16)).join(', ')}]`);
  }
  setTexture(args: number[]): void {
    this.log(`[native:stub] set-texture [${args.map((a) => '0x' + a.toString(16)).join(', ')}]`);
  }
  setFont(args: number[]): void {
    this.log(`[native:stub] set-font [${args.map((a) => '0x' + a.toString(16)).join(', ')}]`);
  }
  setString(s: string): void {
    this.log(`[native:stub] set-string "${s}"`);
  }
  getInputType(): number {
    return 0; // 无界面：默认无输入；TITLE 主循环据此选择分支
  }
  sleep(ms: number): void {
    this.log(`[native:stub] sleep ${ms}`);
  }
  unhandled(opcode: number, name: string): void {
    this.log(`[native:stub] unhandled subsystem opcode 0x${opcode.toString(16)} (${name})`);
  }
}
