# T-0029 · 过程文档（notes.md）

## 2026-09-14

## 现状（已核实）

`src/renderer/app/boot.ts`

```ts
21: const PRELOAD_IMAGES = [0x5245, 0x5246, 0x5272, 0x5273];   // 注释：「引擎启动流程里会立刻用到的那几张」
78: for (const imgid of PRELOAD_IMAGES) { await native.preloadImage(imgid); }
```

实测这 4 个 id 的映射（Electron 启动日志 `.tmp/amayui-emulator.log` 第 8/10/11/12 行）：

| imgid | 文件 | 尺寸 |
|---|---|---|
| `0x5245` | `SO006.AGF` | 1280×720 |
| `0x5246` | `SO005.AGF` | 1280×720 |
| `0x5272` | `SO004.AGF` | **1664×1536** |
| `0x5273` | `SO004A.AGF` | 740×700 |

## 正统路径（已存在，不需要新造）

```
0x1F9 set-texture → PixiBackend.bindTexture → TextureCache.bind
    命中缓存 → 立刻可画；未命中 → void this.preloadImage(imgid).then(...)   // textureCache.ts:174/183
帧末 → PixiBackend.texturesIdle()  // 纹理帧屏障：等本帧新绑定到位再合成（pixiBackend.ts:285）
```

⇒ 删掉预载后，这 4 张图与其它图走**同一条**按需路径；唯一要盯的是"绑定后同帧读尺寸（`0x208`）"那条已知缺口
（能力 `texture-bind-synchronous-then-query`）是否被屏障覆盖住 —— 这也正是本条改动顺带验证的事。

## 为什么不能靠"多预载一点"解决

预载是无依据的第二入口：headless 侧（`bootHeadless`/两份 chain/scenario）**没有**它 ⇒ 改动前两宿主的图文就绪时机天然不同；
而且预载会在启动期无条件解码 `SO004.AGF`（1664×1536），与"用哪张载哪张"的正统语义相反。
若真有"绑定前就要用"的图，正确落点是能力台账（`analysis/engine-capabilities.json`）而不是 boot 的硬编码清单。
