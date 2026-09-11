/**
 * PixiJS `Application` / 舞台的装配。
 *
 * 与 `pixiBackend.ts` 的分工：本模块只管"把 Application、stage、drawRoot 建出来并挂到 body"，
 * 不涉及任何 NativeBridge 语义。这样渲染后端的类不再兼职做 DOM/Pixi 引导。
 */
import { Application, Container, Texture, type ContainerChild } from 'pixi.js';
import { VIEW_H, VIEW_W } from '../viewport.js';

export interface PixiStage {
  app: Application;
  stage: Container<ContainerChild>;
  /** 每帧重建的绘制根（present 时 `removeChildren()` 后重新合成）。 */
  drawRoot: Container<ContainerChild>;
  /** 1×1 白纹理：占位块与 mesh 覆盖层共用。 */
  unit: Texture;
}

/** 建 Application + 画布 + 舞台；画布按 `displayWidth/Height` 铺满窗口内容区。 */
export async function setupPixiStage(
  width = VIEW_W,
  height = VIEW_H,
  displayWidth = VIEW_W,
  displayHeight = VIEW_H,
): Promise<PixiStage> {
  const app = new Application();
  await app.init({
    width,
    height,
    autoDensity: true,
    resolution: window.devicePixelRatio || 1,
    background: 0x0a0d16,
    antialias: true,
  });
  document.body.appendChild(app.canvas);
  app.canvas.style.width = `${displayWidth}px`;
  app.canvas.style.height = `${displayHeight}px`;
  app.canvas.style.display = 'block';
  app.canvas.style.imageRendering = 'pixelated';

  const stage = app.stage;
  const drawRoot = new Container();
  drawRoot.label = 'drawRoot';
  stage.addChild(drawRoot);

  // 左上角 HUD 日志已移除：诊断信息转移到独立控制窗（ControlWindow）。
  return { app, stage, drawRoot, unit: Texture.WHITE };
}
