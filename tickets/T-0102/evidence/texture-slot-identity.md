# T-0102 · 取证：ADV 窗口纹理的**槽号身份**（`11` = 0x11 = 17，且槽 17 是绑好的）

> 2026-09-22。起因：`CONTEXT.md` §5.2 写「**槽 11 在 emulator 里从未绑定**（绑定清单 14 槽…脚本侧 `set-texture` 槽是**十六进制**，全库没有 `… b`）」，
> 并据此提出「白底 = 槽 11 解析不到纹理 ⇒ 占位块」的两步修法。
> **本报告逐条复核后判定：这句话是错的**，两条推论（槽号身份、绑定状态）都不成立。
> 方法：只读真源（`src/*.txt` + `raw-parts/DATA1/*.BIN` + 反汇编器源码 + `cache/SAVE78.DAT`），并用 emulator 自己的解析器交叉验证。
> 中间探针跑在 `app/amayui-emulator/.probe/`，**跑完已删除**；本文件是唯一落点。

---

## 0. 一句话结论

**`draw-texture 19640 11 …` 里的 `11` 是十六进制 = 槽 17，不是十进制 11。** 而槽 17 在开机就被
`set-texture 5260 11`（`src/SYSTEM4.txt:123`）绑成 `0x5260`（= `SO001.AGF`，ADV 窗口图集），
读档路径也会把它装回去。⇒ **「槽 11 从未绑定」这个前提不成立**；白底**不可能**是"槽 11 解析不到纹理"。

---

## 1. 判决一：脚本里的裸数字字面量一律是**十六进制**

### 1.1 反汇编器源码（唯一格式化点）
`scripts/asm/disassembler.mjs` 的 `disassembleInstruction`：非控制流参数走 `s += hex(arg.raw_data)`；
`scripts/asm/age-shared.mjs:335`：

```js
export function hex(v) {
  return (v >>> 0).toString(16);
}
```

⇒ 真源 `src/*.txt` 里出现的每个裸数字都是**该值的 hex、无前导零**。

### 1.2 本仓库自己的文档已经这么写
`docs-new/03-engine/rendering.md:48`：
> 语料里的坐标 = 轴对齐满屏四边形 …（`float-mov` 的字面量是**十六进制**：`500`=1280、`2d0`=720）

### 1.3 交叉验证（同一行里 hex 与十进制自洽）
| 脚本原文 | 按 hex 解释 | 语义检查 |
|---|---|---|
| `draw-texture 19640 11 0 0 43e 95 5d 22c` | 槽 0x11、源 1086×149、目标 (93, 556) | 与 `float-mov (global-float 9) 500`⇒1280 / `f 2d0`⇒720 同屏自洽；窗口落在 556..705 |
| `set-texture 5260 11` | imgid 0x5260、槽 0x11 | 见 §2 |
| `i20b 48 0 0 500 2d0 ff 808080` | 1280×720 填 `#808080` | 1.1 节 + `NOVEL.txt` 的槽 48 底板 |
| `create-texture 48 500 2d0 0` | 1280×720 | 同上 |
| `i1fd … 64 64` | 0x64 = 100 = 100% | `0x1FD` handler 要 `÷100`（`dbl_5201F0`）；写成十进制 64 会得到 64% |

### 1.4 用 emulator 自己的解析器验（不靠推断）
直接 `parseScriptBytes(raw-parts/DATA1/SYSTEM4.BIN)` 后看 `operandsFor(ctx).int(2)`：

```
#445 0x1fb draw-texture args= t0:0x19640(104000) t0:0x11(17) t0:0x0(0) …
    plan.int(1)= 104000  plan.int(2)= 17
```

⇒ 读侧拿到的是 **17**（`raw=0x11`，`BinArg.raw` 是整数、与文本无关）。两侧口径一致。

### 1.5 反证：全库没有任何 `draw-texture` 用十进制 11
对 `raw-parts/DATA1` 的 **564 个 BIN** 逐个解操作数统计：

| 行为 | 槽值直方图（节选） |
|---|---|
| `set-texture`(0x1F9/0x249) 写入的槽 | `15(0xf):1 16(0x10):1 **17(0x11):1** 42(0x2a):267 72(0x48):159 192(0xc0):16 …` |
| `draw-texture`(0x1FB) 引用的槽 | `1:34 14:30 15:32 16:34 **17:2670** 42:546 72:512 192:696 …` |

★**`draw-texture` 引用槽 11（十进制）的次数 = 0**；引用槽 17 的次数 = **2670**，横跨 **200+ 个脚本**
（`SC0000/SC0010/…/NOVEL/CONFIG/CHARMEDIT/SYSTEM4`）。
⇒ `11` 只可能是 hex；否则这 2670 处动作全部指向一个从不存在的槽。

---

## 2. 判决二：槽 17 是**绑好的**，`0x5260` 就是 ADV 窗口图

| # | 事实 | 落点 |
|---|---|---|
| 1 | 开机绑定：`set-texture 5260 11`（3 条一批 `525e f` / `525f 10` / `5260 11`） | `src/SYSTEM4.txt:118-123` |
| 2 | `0x5260` → `SO001.AGF`（1280×1792） | 产品日志 `image 5260 -> SO001.AGF (1280x1792)`；`install-manifest.json:494` |
| 3 | SO001 的 `(0,0)-(1086,149)` **就是** ADV 窗口框 | 见 `tickets/T-0102/evidence/e4-sc0000-white-panel.png` 的窗口形状；`raw-parts/DATA1-png/SO001.png` |
| 4 | `0x5260` 全语料**只有这一处**绑定；槽 17 也只有这一个写点 | §1.5 直方图 + `grep -rn "5260" src/*.txt` |
| 5 | 产品日志里 emulator 确实绑上了 | `.tmp/amayui-emulator.log:59-60`、`:1465-1466` → `bind slot 17 <- imgid 0x5260` |
| 6 | 读档路径也把它装回去 | 见 §3 |

### 2.1 ★订正 `CONTEXT.md` §5.2 的两句话
| CONTEXT 原文 | 判决 |
|---|---|
| 「面板是**片**拼的、全取自**纹理槽 11**」 | 槽号是 **0x11 = 17**，但"取自同一个槽"这个观察本身是对的 |
| 「槽 11 在 emulator 里**从未绑定**（绑定清单 14 槽…全库没有 `… b`）」 | **错**。脚本侧槽值就是 hex，`11`=17；槽 17 绑定清单里有（`:1466`） |
| 「`0x1970b` 那一片从没被上色」 | **措辞订正**：`0x1970b` = `19708 + 3` 的**十进制写法**，是 **handle**（层序键），不是纹理槽；槽 17 全程有纹理 |

---

## 3. 判决三：读档（`--load 78`）不会丢槽 17

`cache/SAVE78.DAT` 是真槽（`format=3`）。用 `decodeEngineSlot` 解出的 **`records` 表**（1000 条 = 引擎镜像 +1252 的**图像槽表**）：

```
非空 5 条：  12:0x5190   15:0x525e   16:0x525f   17:0x5260   43:0x6c2(flag=1)
```

复刻 `app/amayui-emulator/src/vm/handlers/save-slot.ts` ②b 的装回逻辑后：

```
texSlots = 12:0x5190 15:0x525e 16:0x525f 17:0x5260 43:0x6c2
slot17  = 21088 => 0x5260        ✔
需要重载(flag=1)的: 43:0x6c2      （窗口图不在其中）
```

⇒ 续跑落点（`SC0000.txt:1013` 的 `i0ae`）之前，槽 17 已经指向窗口图。
**续跑跳过 `set-texture` 初始化这件事对槽 17 不成立** —— 它在存档的 records 里。

---

## 4. 那白底是怎么来的（仍开放，但收窄了）

白底 = **`presenter.#placeholder`**（`presenter.ts:416` 的 `tex ? cropSprite : #placeholder`），
即 **1×1 `Texture.WHITE`** 按源矩形尺寸铺开（`appSetup.ts:47` `unit: Texture.WHITE`）。
它**不是**"1×1 的一个像素"——1×1 白纹理被拉伸到 1086×149，所以看起来是一大块白/浅灰。

⇒ 触发条件是 **`this.textures.resolve(it)` 返回 `tex === undefined`**（`presenter.ts:397`）。
按 §2/§3，槽 17 在脚本侧、VM 侧（`texSlots`）、存档侧都是对的 ⇒ **缺口只可能在宿主渲染侧的
`TextureCache`**（`slotTex` / `#imgCache` / 绑定→解码的时序），而不是"脚本没配槽"。

★注意 `#placeholder` 那一步**只吃 tint、不吃纹理内容**：
`spr.tint = color & 0xffffff; spr.alpha = alpha/255;`（`presenter.ts:469-470`）——
`0x203`（`set-draw-color-alpha`）给 `0x19640` 上的 alpha（≈0xa0）会被照用
⇒ 白占位块 × f807d ≈ **`#E3E3E3`**，与归档帧的采样值逐个吻合。这条把"白底 = 占位块"钉实了。

### 4.1 下一步的判决点（宿主侧，需要那一刻的日志或一次干净窗口）
`resolve` 之后 `tex` 为空的两种形态，日志是分开的（`presenter.ts:421-431`）：
1. `未绑定纹理槽 → 占位块`（`imgid === undefined`）⇒ `TextureCache` 里那个槽没登记 ⇒ 查 `bind` 的丢弃分支
   （`textureCache.ts` 的 `#bumpEpoch` 世代判据 / `#slotImgid` 不一致）；
2. `纹理槽 N 绑定了 imgid=0x… 但纹理未就位 → 占位块`（`imgid` 已知、图没到）⇒ 查在途/屏障/`#healSlot`。

★**这两条日志有一个已知盲区**（`CONTEXT.md` §5.2 记录的那次复现就是它）：
日志是按 `handle+imgid` **去重**的（`#missingTexLogged`，上限 64 条、满了就 `clear()`），
所以"只在一帧里发生"的占位块**可能一条都不留**。要拿那一刻的证据，需要临时把这一支改成**不去重**（跑完即撤）。

---

## 6. ★2026-09-22 复验（用户实测，13:04 日志）：**占位块已经没有了**，剩下的白是**脚本自己选的支**

用户复验："依然是错误的"。查 `.tmp/amayui-emulator.log`（13:04，4789 行）：

| 检查项 | 结果 |
|---|---|
| `0x259` 的修复是否在这份构建里 | **在**：`clearSlotRecords：保留 7/8 条 槽→imgid 记录（只复位标志位）`（第 2803/2805/2873/3875/3962 行）—— 不再是旧的"丢掉" |
| `未绑定纹理槽 → 占位块` / `未就位` | **0 条** |
| `slotTex 自愈` | **0 条**（不需要自愈 ⇒ 绑定一直在） |
| 槽 17 | 开机绑一次：第 58 行 `bindTexture imgid=0x5260 slot=17` + `image 5260 -> SO001.AGF (1280x1792)`；此后无改绑 |
| 尾部帧 | 第 4789 行 `items={… 104000:a255 … 104200:a160 104203:a255}`、`slotTex=7` |

⇒ **`1×1 Texture.WHITE` 占位块这条已经消掉了**（否则必然出现上面两类日志之一）。**白底不是缺纹理。**

### 6.1 白是脚本的哪一支：`global 0 == 6` 选**白纸窗**，`!= 6` 才是半透明黑

`src/SC0000.txt:32662-32686`（`label_0006d19c`，与 `src/SN0000.txt:3075-3099` 同型）：

```
detach-texture 19640 2
detach-texture 19834 19
jcc (global-int 1397) ffffffff label_0006d438     ← ADV 未激活 ⇒ 直接返回
call label_00072770
eq (local-int 0) (global-int 0) 6
jcc (local-int 0) ffffffff label_0006d348         ← global 0 == 6 ⇒ 跳去**贴纹理**（白纸窗）
  … create-mesh 19640 … + set-vertex-color 19640 0 (global-int f807d) 0   ← 这一支才是黑幕
label_0006d348
draw-texture 19640 11 0 0 43e 95 5d 22c           ← 槽 17 = SO001 的窗户图（框 + 白色内衬）
```

日志里这支是**真的执行了**（第 4596 行 `configureDrawItem h=0x19640 layer=104000 (0,0,1086x149)`），
而黑幕那支在同一时刻被 `detachTexture h=0x19640 count=2 RANGE-REMOVE` 拆掉（第 4595 行）。
⇒ emulator 在那一刻的 `global 0` **等于 6**。

`global 0` 的写点是可枚举的（全语料只有这些值）：`1`×1098 / `4`×39 / `2`×34 / `3`×21 / `7`×6 / `8`×3 / `6`×**1** / `5`×1 / `0`×1
—— 其中 **`6` 全语料只出现一次**：`src/SC0000.txt:1292`（序章入口 `label_000049f4`，紧接 `mov (global-int 1394) 74`）。

### 6.2 结论与待判

- **本票原来的根因（占位块）已消除**；剩下的白是**"脚本选择了白纸窗支"**，不是渲染缺纹理。
- 待判：那一刻 `global 0` **应该**是几？若是 6，则画面与脚本一致、本票的"白底"不该再按缺陷追；
  若是 1/其他，则问题在 **`global 0` 的赋值路径**（`0x8B` 族/别的写点，或它在读档续跑时被带错），与纹理无关。
- ★**诊断盲区已顺手修掉**：`presenter.#missingTexLogged` 此前是 `if (size > 64) clear()` ——
  会把已记的键一起抹掉，于是"只发生一次的占位块"（白底那一帧的形状）可能一条日志都不留。
  现改为 `#noteMissing()`：**一次性键 + 只停止新增**（满了不再记新键，但已记的永不遗忘）。
