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
