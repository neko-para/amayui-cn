# T-0013 · 变更记录（changes.md）

> **一句话**：把"宿主能力面"从"宿主私有方法"变成**桥声明 + 闸门 A 白名单 + 守卫钉住**，
> 使"两个宿主悄悄不一致"这件事从"没人发现"变成"编译期/测试期就红"。

## 第 1 批（2026-09-14）—— D6 落地

### ① 三个能力入桥（`src/vm/native.ts`）

| 方法 | 语义 | 缺了会怎样（写进 `nativeTap.WHY`） |
|---|---|---|
| `needsRender?(): boolean` | 本帧该不该合成（判据在共享层 `sceneNeedsRender`） | 帧驱动只能每帧无脑合成（浪费）或从不合成（画面卡住） |
| `animationsDone?(nowMs): boolean` | `0x400` 等待门的放行判据（口径 = `scGateAnimationsDone`） | 门的 `wait` 档永远等不到放行（脚本卡在等待门） |
| `preloadImage?(imgid): Promise<void>` | 图像预载（幂等） | 首次绘制才加载（闪一帧空图）或永远取不到纹理 |

三个都写成**可选方法**（桥的风格），并在注释里写明"谁是它唯一的实现/谁缺它"。
★`animationsDone` 明确写"必须带本帧时钟"（`T-0008`/`T-0009` 修的就是这一处）。

### ② 闸门 A 白名单（`src/vm/nativeTap.ts`）

- `BRIDGE_METHODS` 加三名；`_exhaustive` 编译期穷尽性检查继续保证"桥新增方法必进白名单"（这次正是它提醒的）。
- **导出 `BRIDGE_METHODS`**：守卫要拿它逐名对照宿主原型。
- `WHY` 表补 `needsRender` / `animationsDone` 两条（`preloadImage` 早就有，说明它是被 `boot.ts` 直接调用的）。

### ③ 宿主改名与调用面收口

- `PixiBackend.sceneAnimationsDone` → **`animationsDone`**（与桥同名）：帧驱动/会话只经接口调用，不再有"宿主私有名字"。
  实现仍是 `scGateAnimationsDone`（门口径）。
- `RendererSession.#native` 的类型由 `PixiBackend` 改成 **`NativeBridge`**：会话只能用桥声明过的能力，
  "会话偷偷用了宿主私有方法"现在**编译期**就报错（同时给 B4 铺路）。
  调用改成可选式，默认值朝"安全侧"取：
  - `native.needsRender?.() ?? true`（宿主不报 ⇒ 照常合成，不吞帧）；
  - `this.#native.animationsDone?.(nowMs) ?? false`（宿主不报 ⇒ 门继续等，不提前放行）；
  - `this.#native.present?.(nowMs, waitFlags)`（没有合成能力 ⇒ 什么也不做）。

### ④ ★守卫：宿主能力面（`test/native-tap.test.ts`）

**不实例化**（pixi 需要 WebGL/DOM）——用 `Object.getOwnPropertyNames(X.prototype)` 取方法名集合。

| 守卫 | 内容 | 当前值 |
|---|---|---|
| 桥方法差异 | `pixi ∩ 桥` 与 `headless ∩ 桥` 的对称差必须**等于** `DECLARED_HOST_DIVERGENCE` | 16 项（见下） |
| 方向 | `headOnly` 必须为空 | 空（差异只允许 pixi 独占） |
| 三个能力在桥里 | `needsRender`/`animationsDone`/`preloadImage` ∈ `BRIDGE_METHODS` | ✔ |
| 门判据两宿主都有 | `animationsDone` 必须**不在**差异表里 | ✔ |
| 非桥方法 | 宿主原型上"不在桥里"的方法必须登记在 `NON_BRIDGE` | pixi 3 项 / headless 7 项 |

`DECLARED_HOST_DIVERGENCE`（= 已声明的可选能力差异，按理由分类）：

- 纹理/像素（headless 没有渲染目标）：`preloadImage` `texturesIdle` `present` `needsRender`
- 音频（`T-0006` 待补）：`audio` `playSound` `playBgm` `playVoice`
- 影片/输入/收尾：`playMovie` `getInputType` `sleep` `startFrameLoop` `unhandled`
- GDI 文本/字符串资源：`setFont` `setString` `stringResourceId`

`NON_BRIDGE`（宿主私有、刻意不入桥）：

- `pixiBackend.ts`：`debugAudio` `debugItemState` `resolveItemTexture`（诊断/取图缝）
- `headlessScene.ts`：`advance` `advanceModel` `note` `outcome` `slotTable` `snapshot` `snapshotText`（模型推进/报告缝）

### ⑤ 负向实测（守卫真的会红）

`.tmp/neg-t13-surface.mjs`：把 `present(): void {}` 注入 `HeadlessScene` ⇒
守卫报 `宿主能力差异变了：新增能力要么补进 headless，要么更新 DECLARED_HOST_DIVERGENCE 并说明理由`；
注入后按 **sha256** 校验还原（`还原后字节相同 = true`）。

### ⑥ 判据

- `npm run verify` **441/441**（3×tsc + 测试 + 死写棘轮；比上一轮 +2 = 这两条守卫）。
- E4 冒烟（`npm run shot -- --gamestart --name postT13`）：`[present]` 67 / `[frame-hold]` 82 /
  `gate 0x400 cleared` 11 / `[reveal]` 312 行（末 27/58）/ `[audio]` 24 行 —— 与上一轮（66–68 / 11 / 316–323）同量级，
  且 10 张截图不再出现"几乎全黑"告警 ⇒ 会话改类型 + 可选调用没有行为变化。
