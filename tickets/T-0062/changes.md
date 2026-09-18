# T-0062 · 过程文档（changes.md）

## 2026-09-17

## 第 1 次变更（2026-09）——渲染目标帧捕获

- \src/renderer/pixiBackend.ts\ 的 \rameTick()\（0x20C）：从『只标脏』改为『标脏 + 若 \ender4.renderTargetSlot >= 0\ 就
  当场 \present()\ 一次并经 \	extures.captureCanvasIntoSlot\ 把整帧拷进该槽』，失败只记日志。
- \src/renderer/pixi/textureCache.ts\ 新增 \captureCanvasIntoSlot(slot, src, srcW, srcH)\：把合成帧按槽的逻辑尺寸
  铺进该槽的 canvas（LINEAR 采样，与 \litSlotToSlot\ 同口径），随后 \	ex.source.update()\。
- 文档：\docs-new/03-engine/save-data.md\ §7.3 记下截图链与『为什么必须在 0x20C 当场捕获』；能力条目
  \save-slot-thumbnail-bmp\ 的 emulator 段同步（含待目视确认）。

### 判据
- typecheck ×3 绿。
- 像素级内容仍待 GUI 目视（headless 无画布、\getSlotPixels\ 返回 null ⇒ 只能验证写盘与解码那一段）。

## 2026-09-17

## 第 2 次变更（2026-09）——★缩略图"素材拼贴 + 缩放不一致"：捕获取错了矩形

用户实测（第 1 次变更之后）：缩略图不再全黑，但**内容混乱** ——「能看到原始的若干素材，但是存在不一致的
缩放/拉伸」。新增 `src/tools/slotThumbPng.ts`（`.STH` = BMP → PNG）把那份缩略图导出后**看图**确认：
场景确实进去了，但整幅画是按**一个比屏幕更大的矩形**取样后再压进 320×180 ⇒ 屏外内容也被拉进来、
各处比例不一致（附件 `evidence/thumb-before-fix-user-save70.png`；对照真机
`evidence/thumb-reference-engine-save00.png` 是干净的 16:9 场景）。

### 根因
`app.renderer.extract.canvas(this.stage)` **默认按 target 的 local bounds 出图**，而 `stage`/`drawRoot`
的子节点可能落在视口之外（宽背景、屏外精灵、被移出画面的绘制项…）⇒ 画布尺寸 ≠ 屏幕尺寸、内容整体错位。

### 修法
给 `extract` 显式传**屏幕矩形**与 `resolution: 1`（逻辑尺寸整帧）：

```ts
const frame = new Rectangle(0, 0, this.app.screen.width, this.app.screen.height);
const canvas = this.app.renderer.extract.canvas({ target: this.stage, frame, resolution: 1 });
this.textures.captureCanvasIntoSlot(slot, canvas, frame.width, frame.height);
```

⇒ 捕获的正是「玩家当时看到的那一帧」—— 引擎的渲染目标语义本来就是这样（`i20e` 清屏 → `i20c` 把这一帧画进去）。

### 判据
- 工具：`node src/tools/slotThumbPng.ts <SAVE70.DAT> out.png` ⇒ 看图应与当时画面一致（不再是拼贴）。
- 待用户在 GUI 里存档一次目视确认（本机 headless 无画布，只能验到写盘/解码那一段）。

## 2026-09-18

## 证据锚点复位（2026-09-19）

本票的 evidence 曾被改写成 T-0063 的锚点（\enderer/scene/ops.ts\ 的 0x259「口径纠错」、\pixiBackend.ts\ 的
\snapshotPresent(): unknown\）—— 两者都与缩略图无关（是读档画面快照那条线的证据）。核对后确认
**原始四条锚点至今都还在**（\pixiBackend.ts\ 的 \captureCanvasIntoSlot\ = frameTick 当场合成 + 屏幕矩形捕获、
\	extureCache.ts\ 的 \captureCanvasIntoSlot(slot: number\、\slotThumbPng.ts\ 的 \ncodePng\、
\src/\\.txt:17591\ 的 \i032 2 e 0 0 500 2d0 0 0 140 b4\）⇒ 已复位，并把 note 写清各自对应的那一环。

状态仍为 \doing\：判据 3 的 GUI 目视已由用户确认通过，但本票还没有**自动化守卫**（\	ests[]\ 为空 ⇒ 不能置 done）。
