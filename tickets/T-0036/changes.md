# T-0036 · 过程文档（changes.md）

## 第 1 次变更（2026-09）：`.STH` 缩略图按 BMP 真解/真写，`op3` = 纹理槽

### 改了什么

| 位置 | 改动 |
|---|---|
| `src/vm/bmp.ts`（新增） | `decodeBmp` / `encodeBmp` / `isBmp`：24bpp BI_RGB、自底向上（负高度 = 自顶向下）、行 4 字节对齐、BGR↔RGBA；**不信 `bfSize`/`biSizeImage`**（E4 实测引擎的 bfSize 少 14）；截断/压缩/非 BMP 返回 null |
| `src/vm/handlers/save-slot.ts` | `0x1AF`：读 `.STH` → `decodeBmp` → `native.setSlotPixels(op3, w, h, rgba)`，`op1 = 0/1/2`（旧格式的自描述空块仍认）；`0x1AE`：`native.getSlotPixels(op3)` → `encodeBmp` → 写 `.STH`（宿主无画布 ⇒ 退回自描述空块） |
| `src/vm/native.ts` | 新增两条宿主缝 `getSlotPixels(slot)` / `setSlotPixels(slot, w, h, rgba)`（带引擎 raw 依据的注释） |
| `src/vm/nativeTap.ts` | 桥方法清单补两个名字（编译期穷尽性检查拦下了遗漏） |
| `src/renderer/pixi/textureCache.ts` | 实现 `getSlotPixels` / `setSlotPixels`：读/写 `create-texture` 出来的 canvas 表面（DPR 逐点取样回逻辑尺寸；`imageSmoothingEnabled=false`） |
| `src/renderer/pixiBackend.ts` | 转接两条缝（`#markDirty` + TextureCache） |
| `src/renderer/headlessScene.ts` | `getSlotPixels` 返回 null（无画布）、`setSlotPixels` 记尺寸（供 E3 断言） |
| `src/vm/saveSlot.ts` | `SLOT_GAPS` ④ 更新：`.STH` 已解（320×180 BMP），剩余缺口改为"DrawMode==1 的截图分支" |
| `test/save-thumb.test.ts`（新增，6 条） | BMP 编解码往返/边界；E4 真槽；`0x1AF` 写进 op3 槽 + 三个结果码；`0x1AE`→`0x1AF` 往返 |
| `test/save-slot.test.ts` | `.STH` 往返那条的注释按新语义改写（旧格式仍算读到） |
| `test/save-slot-chain.test.ts` | 新增 E3：真语料 TITLE → Load Data → 列表后，确有 320×180 缩略图被装进纹理槽 |
| `docs-new/03-engine/opcode-table.md` | `0x1AE`/`0x1AF` 两行订正：`op3` = **纹理槽**、产物 = BMP、给出 `src/SAVE.txt:2086-2095` 与 `$1$SC0330.txt:17590-17595` 的真实调用面 |
| `docs-new/03-engine/save-data.md` | §7 的 `.STH` 行 + `SLOT_GAPS` 同步 |
| `analysis/functions.json` | 新增 `sub_43E9F0`（ddReadBmp）/ `sub_43BF20`（ddWriteBmp）/ `sub_40BF20`（把文件读进槽表面） |
| `analysis/engine-capabilities.json` | 新增 `save-slot-thumbnail-bmp`；`save-slot-chain` 的 note 去掉"`.STH` 不透明往返" |

### 判据（先红后绿）

| 场景 | 修前 | 修后 |
|---|---|---|
| `0x1AF` 读真槽 `.STH`（本机 47 个真槽） | 只校验 4 字节长度前缀 ⇒ **该前缀恰好是 `"BM"`+size 的低位**，长度校验也可能碰巧过 ⇒ `op1=0` 但纹理槽空 ⇒ 界面右侧空白 | `decodeBmp` 解出 320×180 ⇒ `setSlotPixels(op3)` ⇒ 脚本 `draw-texture` 画出真图 |
| `0x1AF` 读坏文件 | 长度前缀不成立 ⇒ 2 | 非 BMP 且无长度前缀 ⇒ 2（不变） |
| `0x1AE` 写 `.STH` | 写"自描述空块"（真机读不出） | 写标准 24bpp BMP（真机 `ddReadBmp` 可读；E4 尺寸/格式与真槽一致） |
| 真槽 `.STH` 的头 | 无人解析 | E4 断言：320×180、像素非常量、`bfSize + 14 = 文件长度`（引擎的少算是事实，解码不依赖它） |

```text
npx tsx --test test/save-thumb.test.ts       → 6/6 绿
npx tsx --test test/save-slot-chain.test.ts  → 2/2 绿（含新 E3 缩略图）
npx tsc --noEmit                             → 干净
npm run verify                               → 见下「收尾实测」
```

### 收尾实测

```text
npm run verify → 527/527 全绿（typecheck + 全套 + 死写检测：无新增死写）
E3（真语料）：存档列表跑完后 setSlotPixels 收到 320×180 / 320*180*4 字节的 RGBA（真 .STH 解出的像素）
```

★**待用户确认的 E4（观感）**：界面右侧那张图现在是脚本给的纹理槽里真实存在的内容；
宿主画布 → 屏幕的最终观感由用户在 GUI 上确认（本机无可复现的真机同帧对照）。

## 2026-09-15

## 第 2 次变更（2026-09）：★用户 E4 确认 —— 缩略图成功加载

用户反馈（原话）：**存档界面成功加载缩略图了**。

⇒ 这条缺陷按引擎语义修好了，并且**有用户侧的 E4 观感确认**（第 1 次变更里
