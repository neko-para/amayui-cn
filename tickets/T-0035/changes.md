# T-0035 · 过程文档（changes.md）

## 第 1 次变更（2026-09）：按引擎的两键门实现抗锯齿；关闭时把字形阈值化

### 改了什么

| 位置 | 改动 |
|---|---|
| `src/engineConfig.ts` | `applyConfigToEngine` 增加**两键门**：`set:EnableAntiFont` 非 0 才取 `message:UseAntiFont`，结果写字段 **21662**（= `Font+1352`）：`engineValues.set(21662, aaOn ? 1 : 0)`；不影响其它绑定（键不存在时写 0 = 引擎初始化值） |
| `src/text/layout.ts` | `FontSpec` 增加 `antiAlias: boolean`（带引擎语义注释）；`defaultWinStyle()` 的两套字体补 `antiAlias: false` |
| `src/vm/handlers/msgwin.ts` | `globalTextStyle()` 的 `main.antiAlias = (字段 21662 & 1) !== 0`；注音共用同一把开关（引擎只有 `Font+1352` 一个）；`0x204`/`0x205` 直绘路径把该值透传进 `DrawStringStyle` |
| `src/vm/native.ts` | `DrawStringStyle` 增加 `antiAlias: boolean` |
| `src/renderer/text/raster.ts` | 新增并导出 `thresholdAlpha(ctx, w, h, cut=128)`；`rasterFrame` 在 `!st.main.antiAlias` 时对整窗画布阈值化（颜色不动、幂等） |
| `src/renderer/pixi/textureCache.ts` | `drawString` 在 `!style.antiAlias` 时阈值化（设备像素坐标、在 `setTransform` 复位前）；日志加 `no-aa` 标记 |
| `test/text-aa.test.ts`（新增，5 条） | 两键门五种组合、死写键不影响、样式携带、阈值化语义与幂等 |
| `docs-new/03-engine/adv-text-rendering.md` | §7 的 R7b 段落**订正**：AA 不再是"只记录"，给出根因（canvas 永远 AA）与实现落点；并写明 `AntiFontLevel`/`Menu_UseAntiFont` 是死写 |
| `src/text/layout.ts` 的 `defaultWinStyle()` | ★顺带修的第二处不符：描边偏移默认 **2/2 → 1/1**（引擎 `Font+1384/+1388` 初始化值，raw 78780-78781；`0x1A4` 由脚本改写） |
| `test/adv-msgwin.test.ts` | 快照断言补 `antiAlias: false`（引擎未灌配置时的字段值） |
| `analysis/engine-capabilities.json` | 新增 `text-aa-config-gate`（两键门 + 缺失时静默的症状 + 死写键警告） |

### 判据（先红后绿）

| 场景 | 修前 | 修后 |
|---|---|---|
| `set:EnableAntiFont=0` + `message:UseAntiFont=1`（本机两处 INI 的实际形态） | `Font+1352` 字段不存在 ⇒ 宿主 canvas 全 AA | 字段 21662 = 0 ⇒ **阈值化**（无灰边） |
| `set:EnableAntiFont=1` + `message:UseAntiFont=1` | 同上（碰巧"对"） | 字段 21662 = 1 ⇒ 保留 AA（引擎的软件 AA 路径） |
| 缺 `[set]` 段（真游戏 base 的现状） | 同第一行 | 字段 21662 = 0 |
| `message:AntiFontLevel=3` / `set:Menu_UseAntiFont=1` | 不影响 | **仍不影响**（有守卫钉住，防"照抄死写键"） |
| 未显式设过描边偏移的文本 | 描边副本偏 2px（`defaultWinStyle` 2/2） | 偏 1px（引擎初值 1/1） |

```text
npx tsx --test test/text-aa.test.ts   → 5/5 绿
npx tsc --noEmit                      → 干净
npm run verify                        → 见下「收尾实测」
```

### 收尾实测

```text
npm run verify → 527/527 全绿（typecheck + 全套 + 死写检测：无新增死写）
```

★**待用户确认的 E4**：这条缺陷的最终判据是"与真机观感一致"，本机没有可复现的真机同帧对照手段 ⇒
本票不假装做过 E4；阈值化本身有 E2 守卫（边缘 alpha 只取 {0,255}）。

## 2026-09-15

## 第 2 次变更（2026-09）：★用户实测 —— 字体没有变化（E4 未通过，假说被推翻）

用户反馈（原话）：**字体没有变化**；同一轮里存档缩略图已经出来了（见 T-0036）。

⇒ 第 1 次变更的**抗锯齿假说被实测否定**：set:EnableAntiFont 门 + 阈值化确实按引擎语义生效了（字段 21662、样式携带、
分层阈值化都有 E2 守卫），但**屏幕上看到的粗细/亮度差异不来自这条路径**。

接下来要查的方向（按可能性排序）：

1. **字体的真实字重与资产**：es/fonts 里登记的 \Amayui CN\ **Regular** 面是不是真的常规 ——
   \ontSet.ts\ 文件头提到它由「Sarasa Gothic SC **Bold** 基底 + cnjp 替换」构建（见 docs/font-build.md §8.7）。
   若 Regular 面的 OS/2 usWeightClass 实际是 700（或字形本身是粗底），则**所有**用该族渲染的文字都会比引擎粗 ——
   这与「很多地方」+「AA 开关改了没变化」两条观测都吻合。
2. **图片里的 UI 文字**：翻译后的 UI 文字是我们用 HTML 渲染进 PNG 的（docs/images/FONT.md 的样式表里有 font-weight:700），
   那部分运行时改不动，只有重渲染图片才能改。
3. 运行时文本路径是否真的走了 rasterFrame/TextureCache.drawString（有没有第三条直接用 pixi.Text 的路）。

## 2026-09-15

## 第 3 次变更（2026-09）：只做记录 —— 量化对照完成，修复方案待用户 A/B 判定

**本轮没有改产品代码**（上一轮已把临时诊断实验改回原样，工作树与 `d7c7b9c` 一致）。

### 做了哪些对照（可复现）

```text
npm run shot -- --gamestart --name boldface   # 现状：真 Bold 面
npm run shot -- --gamestart --name regface    # 临时把 weight 钉成 400（已改回）
npm run shot -- --gamestart --name aabold     # 临时强制 AA 路径（已改回）
# 再对 8/9/10-sn0000-*.png 与用户真机截图做「文本行墨迹/笔画游程」统计
```

### 结果（详见 notes.md 的表）

- 真 Bold 面：覆盖率 0.330–0.398、横游程 5 / 7.1–7.6
- 强制 Regular：0.220–0.245、横游程 3 / 4.6
- 强制 AA（等价于不阈值化）：与 Regular+阈值化**同值** ⇒ 抗锯齿改动在这条度量上不可见（与用户「没有变化」一致）
- **真机：0.257、横游程 4 / 5.87** ⇒ 介于两者之间、偏向 Regular

### 判定

「比引擎粗」的**主因是字重/字面**（我们用了真 Bold 面，而真机渲染明显更轻），**不是**抗锯齿。
第 1 次变更的抗锯齿修复保留（引擎语义正确、有守卫），但它解决不了这条观感。

### 待办（下一步开工时按这个顺序）

1. 加 `fonts.bold: 'face' | 'regular'` 选项（默认 `face`）→ 请用户 A/B 一次，判定真机属于
   「只有 Regular 面（GDI 回退）」还是「真 Bold 但渲染更细」。
2. 若属后者：改光栅化（DPR 下的笔画取整策略）。
3. 若都不像：读引擎 `sub_459F40` 重建的 HFONT 集合与 ADV 绘制用的句柄（假说 (c)）。
