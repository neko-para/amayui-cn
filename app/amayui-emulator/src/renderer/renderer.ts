/**
 * 渲染进程入口（`dist/renderer/renderer.js`，由 build-electron.mjs 打成 IIFE）。
 *
 * 这里只做三件事：装配 → 注册控制窗指令 → 跑主循环。真实逻辑在 `./app/`：
 *
 * | 模块 | 职责 |
 * |---|---|
 * | `app/boot.ts` | 装配对象图（Engine / Pixi 后端 / IPC 文件代理 / 日志通道 / 配置 / 首个脚本） |
 * | `app/configBoot.ts` | 读 SYS4REG.INI 灌进引擎字段 |
 * | `app/traceLog.ts` | 诊断日志的批量落盘（含关窗同步 flush） |
 * | `app/jsonlWriter.ts` | 定向 trace（scene-trace.jsonl）的唯一写入者 |
 * | `app/telemetry.ts` | 四张遥测清单（ignored / internal / skipped / gaps） |
 * | `app/session.ts` | 门控 VM 主循环 + 控制窗桥接 + 状态上报 |
 *
 * 主循环：**帧驱动在 `src/frame/loop.ts`（唯一一份）**，`app/session.ts` 目前仍是它自己的那份
 * （B4 会把 session 接到驱动上，届时 `session.ts` 只剩"装配 + 观察者 + `yield`"）。
 * ★2026-09 订正（`tickets/T-0002` 的 D3）：旧注释说"渲染帧循环（Pixi ticker）独立跑 present"——
 * **与实现不符**：`PixiBackend.startFrameLoop()` 只记一个墙钟起点，`present()` 是 `session` 在每批指令
 * 之后（按"是否需要渲染"）调用的，没有第二个 ticker 在并发跑。
 */
import { bootApp } from './app/boot.js';
import { RendererSession } from './app/session.js';

async function main(): Promise<void> {
  const app = await bootApp();
  if (!app) return; // 首个脚本装载失败：原因已进日志通道，安静收场

  /**
   * ★**把渲染进程里的"野异常"也写进日志**（2026 补）。
   *
   * 为什么需要：Pixi 的 `app.render()` 跑在它自己的 ticker 回调里、**不在我们的调用栈上** ——
   * 那里抛出的异常既不会被 `#present()` 的调用方看到，也不会进控制窗；表现就是
   * "画面整个不对/只剩背景色，但日志里什么都没有、VM 还在跑"。
   * 实测那次黑屏（帧里去画一个已销毁的纹理 ⇒ WebGL 批次损坏）就是这么隐身的。
   */
  window.addEventListener('error', (ev) => {
    app.native.log(`[renderer-error] ${ev.message} @ ${ev.filename}:${ev.lineno}:${ev.colno}`);
  });
  window.addEventListener('unhandledrejection', (ev) => {
    const r = ev.reason as Error | undefined;
    app.native.log(`[renderer-rejection] ${r?.message ?? String(ev.reason)}\n${r?.stack ?? ''}`);
  });

  const session = new RendererSession(app);
  session.registerControlHandlers();
  try {
    await session.run();
  } catch (caught) {
    const msg = `boot error: ${(caught as Error).message}`;
    app.native.log(msg);
    console.error(`[boot] ${msg}`);
    // 走上报同一条路径（字段集一致），控制窗不必区分"启动失败"与"运行中错误"两种载荷。
    session.notifyStatus(msg);
  }
}

main().catch((err) => {
  console.error(err);
  const body = document.body;
  if (body) body.textContent = `启动失败: ${(err as Error).message}`;
});
