# T-0036 · 过程文档（notes.md）

## 现象（用户实测 2026-09）

存档界面（Load Data 列表）右侧应该有一张缩略图，现在**出不来**。

## 链路真源：`src/SAVE.txt:2086-2095`

```text
2086  create-texture (local-int 21c6) 140 b4 0            ← 造 320×180 离屏纹理（0x140=320, 0xb4=180）
2088  i1af (local-int 12) (local-int 219) (local-int 21c6) ← 0x1AF：op1=状态 out、op2=槽号、op3=纹理槽
2089  eq (local-int 21c6) (local-int 12) 0                ← 判 op1 == 0
2090  jcc (local-int 21c6) ffffffff label_00009cd8        ← 失败 ⇒ 跳过整段
2091-2095  add … / draw-texture (local-int 21c7) (local-int 21c8) 0 0 140 b4 452 (local-int 21ca)
                                                          ← 把这张纹理按 320×180 画到界面右侧
```

写侧同构（`src/$1$SC0330.txt:17590-17595`）：`create-texture e 140 b4 2` → 存完槽 →
`i1ae (global-int 1396) (global-int f8019) e` —— **op3 就是那个纹理槽 `e`**。

⇒ **`op3` 不是"块选择子"，是要装图的纹理槽**；`0x1AE`/`0x1AF` 干的事是"把这个槽的位图写进/读出 `.STH`"。

## 引擎侧：`.STH` 就是 BMP

| 步骤 | 函数 | 依据 |
|---|---|---|
| 写 `0x1AE` | `sub_42E1F0`（raw 38515-38550）→ DrawMode==1 ? `sub_4A5260(Engine+322832, FileName, op3)` : `sub_43BF20(Engine+7912, op3, hFile)` | raw 38537-38546 |
| 写位图 | `sub_43BF20`（raw 47838，ddWriteBmp）：`"BM"`（`19778`）+ 40 字节 DIB + 24bpp，行按 32 bit 对齐 | raw 47892-47907 |
| 读 `0x1AF` | `sub_42E320`（raw 38553-38594）→ `sub_40BF20(Engine+7912, op3, -1, hFile, GetFileSize)` | raw 38580-38582 |
| 解位图 | `sub_40BF20`（raw 16072-16087）→ `sub_43E9F0`（raw 49926）先校验 `19778` 再 ddReadBmp 进该槽表面 | raw 16076 / 49987 |

## E4：本机真槽的实测

```text
47 个 SAVE??.STH：全部 172,854 字节 = 54（BMP 头）+ 320×180×3（像素）
头：42 4d | bfSize=0x0002A328(172,840) | offBits=0x36(54) | DIB=40 | 320 | 180 | 1 | 24bpp | BI_RGB
★bfSize 比真实文件**小 14 字节**（引擎 raw 47894 写"像素 + 40"，漏了自己的 14 字节文件头）
  ⇒ 解码**不许信 bfSize**（也不信 biSizeImage，引擎写 0）：按 DIB 头的宽高 + 行对齐算。
```

## 修复前的实现错在哪

`op_slot_thumb_read` 只做了一件事：读**本工程自己写的 4 字节长度前缀**、校验长度、返回 `op1 = 0/2`。
于是脚本 `eq … 0` 判定"成功"、继续 `draw-texture`，但**那张纹理槽从来没被填过** ⇒ 右侧一片空白
（不是脚本走错、也不是门没过，纯粹是宿主把图丢了）。

## 修复

1. **新增 `src/vm/bmp.ts`**：`decodeBmp`（24bpp BI_RGB、自底向上/负高度自顶向下、行 4 字节对齐、BGR→RGBA、
   截断/压缩/非 BMP 如实返回 null）与 `encodeBmp`（写正确 `bfSize`；引擎读侧不看该字段）。
2. **`0x1AF`**：读 `.STH` → `decodeBmp` → `native.setSlotPixels(op3, w, h, rgba)`；`op1`：0 成功 / 1 打不开 /
   2 解不出。旧格式（本工程 T-0018 的自描述空块）仍认得出来（返回 0，不写像素），避免自己的旧槽变砖。
3. **`0x1AE`**：`native.getSlotPixels(op3)` → `encodeBmp` → 写 `.STH`；宿主无画布（headless）时退回自描述空块。
4. **宿主缝**（`vm/native.ts`）：`getSlotPixels` / `setSlotPixels`；Pixi 侧 = `TextureCache` 的 canvas 表面
   （`getImageData`/`putImageData`，DPR 逐点取样回逻辑尺寸）；headless 侧 = `getSlotPixels` 返回 null、
   `setSlotPixels` 只记尺寸（供 E3 断言）。`nativeTap.ts` 的桥方法清单同步（编译期穷尽性检查会拦）。
5. 台账/文档：新增能力条目 `save-slot-thumbnail-bmp`；`0x1AE`/`0x1AF` 的 opcode-table 行订正
   （op3 = 纹理槽、产物 = BMP）；`saveSlot.ts` 的 `SLOT_GAPS` ④ 与 `save-data.md` §7 同步。

## 判据

```text
npx tsx --test test/save-thumb.test.ts     → 6/6 绿
   · 编解码往返逐点一致（含 3×2 的行对齐、1×1）
   · 自顶向下（负高度）解得出；非 BMP / BI_RLE8 / 截断 ⇒ null
   · E4 真 SAVE00.STH：320×180、像素非常量、bfSize+14 = 文件长度
   · 0x1AF：把像素交给 **op3** 槽（旧实现的缺陷点）、缺文件=1、解不出=2、旧格式仍认
   · 0x1AE：把 op3 槽的像素写成 BMP，0x1AE→0x1AF 往返逐点一致
npx tsx --test test/save-slot-chain.test.ts → 2/2 绿（新增 E3：真语料进列表后确实有 320×180 缩略图装进纹理槽）
npm run verify                              → 见 changes.md 的收尾实测
```

## 仍未做

- DrawMode==1（D3D）那条 `sub_4A5260` / `sub_49E9D0` 分支未建模：本机 `DrawMode=0`，且两条分支的产物都是
  BMP ⇒ 宿主行为一致；真机确认由用户观感给出。
- `.STH` 的**截屏时机/内容**（哪一帧的画面）由脚本决定，emulator 不做额外截屏：脚本给的槽里是什么，
  写出去就是什么（与引擎同口径）。
