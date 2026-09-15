# T-0035 · 过程文档（notes.md）

## 现象（用户实测 2026-09）

与真游戏对照：emulator 里**很多地方**的文字比引擎渲染的**更粗**，且**白色看着更亮**。

## 引擎的字体配置链（逐条核对，raw = `engine/天结_unpacked.exe_utf8.c`）

| 项 | 引擎 | 证据（raw） | emulator | 结论 |
|---|---|---|---|---|
| 面名 | `Font+1260`（主）/`+1320`（注音），来自 `message:Font` 与 `0x1A5`/`0x2FE` | 78859-78875 / 23666 | `msgwin.font.mainFace/rubyFace` + `resolveFace()` 映射到内置族 | ✅ 一致（映射政策另见 `fontSet.ts` 文件头） |
| 字号 | `Font+201684` 初值 24，`0x75` 写；`lfHeight = -size` | 78755-78872 / 24063 | `font.mainSize`（`0x75`） | ✅ 一致 |
| 字重 | `Font+1248` **初值 0**（FW_DONTCARE ⇒ 常规面），`0x2BD` 写 **700/0** | 78854 / 33394-33399 | `mainBold ? 700 : 400`（默认 400） | ✅ 等价（GDI 的 0 取常规面；400 = 常规面） |
| **抗锯齿** | `Font+1352` **初值 0**；**只有** `set:EnableAntiFont` 非 0 才读 `message:UseAntiFont` 并 `sub_4155B0` | 78755 / 23649-23656 / 22409-22422 | ❌（修复前）canvas **永远开 AA** | ★**不一致 → 已修** |
| 描边档 | `Font+1372` 初值 1（0 无 / 1 单向 / 2 同位叠 1/4 / 3 四向） | 78779 / 68091-68121 | `outlineMode` + `raster.ts` 逐档实现（不用 `strokeText`） | ✅ 一致 |
| 描边偏移 | `Font+1384/+1388` **初值 1/1** | 78780-78781 | `outlineDx/outlineDy`（默认走 `defaultWinStyle`） | ★**不一致 → 已修**（默认曾是 2/2） |
| 填充/描边色 | `Font+1360`（默认 `0xFFFFFF`）/`+1364` | 78891-78892 | `0x76`/`0x77` handler → 字段 21664/21665 | ✅ 一致 |

**判定：两处实质偏差** —— 主因是抗锯齿；另一处是**描边偏移的默认值**（引擎初始化 1/1，emulator 的
`defaultWinStyle()` 写的是 2/2 ⇒ 没有脚本显式设过偏移的文本，描边副本会偏出去 2px）。字重/字号/面名/颜色都对得上。

顺带核过、**不是**问题的一项：`Font+1236`（`lfWidth`）初值 **-12** = 高度 24 的一半 —— 对 CJK 字体来说
`tmAveCharWidth` 本来就是半角宽（= 高度/2），GDI 的字体匹配不会因此做横向压缩，与浏览器自然比例等价。

## 为什么本机的引擎是"无 AA"

```
真游戏 base 的 SYS4REG.INI：只有 [display]/[sound]/[message]/[system] 段，**没有 [set] 段**
  ⇒ GetConfig("set:EnableAntiFont") 缺键 ⇒ 引擎的缺键语义是写 0 并返回 0（sub_4957F0 raw 113008）
  ⇒ 23649 的 if 不进 ⇒ 根本不调 sub_4155B0 ⇒ Font+1352 保持初始化值 0 = 无 AA
本工程 overlay 的 SYS4REG.INI：[set] 段里写的是 EnableAntiFont=0（我们首跑生成的全量文件）
  ⇒ 同样无 AA
```

注意 `message:UseAntiFont=1` **确实存在**，但它只是"门后面的值"——门关着就不生效。这条很容易看错：
**只有先看 `set:EnableAntiFont`，才能决定 `message:UseAntiFont` 有没有意义。**

另两个"看起来相关"的键在渲染侧**没有读者**（别照抄成 AA 档位）：

- `message:AntiFontLevel` → raw 23653 写 `Engine+303796`；`grep 303796` 全库只有这一处写入、**零读取**；
- `set:Menu_UseAntiFont` → 只被配置表（`sub_434D00`）读写（raw 111703 / 112525），渲染侧无读者。

## 修复

1. **配置门**（`src/engineConfig.ts`）：`applyConfigToEngine` 里按引擎语义算两键门，写**字段 21662**
   （`Font+1352` = `Engine+85296+1352` ⇒ dword `(85296+1352)/4 = 21662`，与同族的 21664/21665/21667 一致）。
2. **样式携带**（`src/vm/handlers/msgwin.ts`）：`globalTextStyle().main.antiAlias = (字段21662 & 1) !== 0`；
   注音共用同一把开关；`FontSpec.antiAlias`（`text/layout.ts`）与 `DrawStringStyle.antiAlias`（`vm/native.ts`）
   把值带到两条渲染路径。快照语义与其它全局样式一致（入队时钉住）。
3. **锯齿字形化**（`src/renderer/text/raster.ts` 的 `thresholdAlpha`）：`antiAlias === false` 时，
   画完整窗后把画布 alpha 阈值化（`>= 128` 记满 255、否则 0，**颜色不动**）——
   canvas 没有"关文字 AA"的开关（`imageSmoothingEnabled` 只管图像缩放），所以按引擎的**结果**对齐：
   GDI 锯齿字形就是"每像素非 0 即满不透明"。消息窗（`rasterFrame`）与 `0x204/0x205` 直绘
   （`TextureCache.drawString`）两条路径同口径。
4. 阈值取 128（≈ GDI 在 50% 覆盖率处取整）。

## 判据

```text
npx tsx --test test/text-aa.test.ts        → 5/5 绿
   · 两键门五种组合（含缺 [set] 段 / 缺键）
   · AntiFontLevel 与 Menu_UseAntiFont 不影响 AA
   · 样式携带（字段 21662 → globalTextStyle().main.antiAlias）
   · 阈值化：127→0、200→255、颜色通道不动、幂等（无中间值时不回写）
npm run verify                             → 见 changes.md 的收尾实测
```

## 仍未做 / 待确认

- **E4（观感）**：本机没有"真机同帧对照"的可复现手段（截屏对照要人眼），所以这条的最终判据是
  **用户在真机/GUI 上的观感确认**；票据里不假装做过 E4。
- AA 的**灰度级**（`Font+218500`）、字形度量探针、内存字形缓存仍是"只记录、不追效果"（用户口径 R7b）。
- DrawMode==1（D3D 软件 AA 字形）那条路径的宿主实现未做：本机 `DrawMode=0`（overlay INI），
  且该路径只在 `set:DrawMode=1` 时启用。
