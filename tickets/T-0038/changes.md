# T-0038 · 过程文档（changes.md）

## 2026-09-15

## 第 1 次变更（2026-09）：行距（Font+1380 / i08b）接入换行步进

### 引擎依据

- `sub_46AF90`（raw 82668-82760）：`v7 = 字号 + Font+1380`（度量模式 0 用 `-Font+1232`，1/2 用 `Font+201684`，
  都再加 `Font+1380`），随后 `*(新行 24B 记录 - 16) += v7`。
- `Font+1380`：Initialize 初值 **6**（raw 78858）；op `0x8B`（`sub_41FBF0` raw 29021-29030）写；
  **ADV 标准样式前导写 `i08b 10` = 16**（`CONFIG.txt` / `SN0000.txt` 等同型块）⇒ 行距 30+16 = **46px**。
- 注音画在行顶上方一个注音字高（`sub_465A20`：`ruby.y = 行 y + Font+1292`，`Font+1292 = -注音字号`）
  ⇒ 只加字号（30）时注音必然压进上一行的字里（用户实测）。
- D3D 路径另有「行号 × (字号 + Font+1380)」的逐行定位（raw 71734/71943/72403/77464/77895/78686/80280/80723/81493）。

### 改了什么

| 位置 | 改动 |
|---|---|
| `src/text/layout.ts` | `MsgWinStyle` 增加 `lineSpacing`（默认 6 = 引擎初值）；换行 `lineStartY += size + st.lineSpacing`；`FontStyleSnapshot` 同步 |
| `src/vm/handlers/msgwin.ts` | `globalTextStyle()` 增加 `lineSpacing: v(21669, base.lineSpacing)`；`globalFontSnapshot` / `styleOfWin` 透传 |
| `test/text-layout.test.ts` | 新增：ADV（`i08b 10`）行距 46 / 默然 36；不变量「注音顶 ≥ 上一行底部」（带注音的第二行） |
| `test/engine-field-store.test.ts` | 新增：`0x8B` 的值必须被排版路径读到（`globalTextStyle().lineSpacing`），未写时 = 6 |

### 语义订正（同一根因的"错记"）

| 位置 | 旧 | 新 |
|---|---|---|
| `analysis/fields.json` `Font/0x15294` | `color_extra2`「第四色（初值 6）」 | `line_spacing`「行间距：换行步进 = 字号 + 本字段」（初值 6、op 0x8B、读取点） |
| `analysis/functions.json` | 无 `0x8B` / `0x46AF90` | `op_set_line_spacing_41FBF0`（0x8B）、`line_feed_46AF90`（换行步进） |
| `docs-new/03-engine/opcode-table.md` `0x8B` | 「消息窗字段：写 _this[21669]」 | 「**行间距**（Font+1380）：换行步进 = 字号 + 本字段；ADV 前导 i08b 10 ⇒ 46px」 |
| `docs-new/03-engine/adv-text-rendering.md` | `+1368/+1380/+1392` = 另三色；§3.1 未讲行距 | `+1380` 单列为行间距；§3.1 补换行步进；§3.5/§4 的"另三色"与 opcode 列表订正 |
| `analysis/engine-capabilities.json` | 无 | 新增 `text-line-pitch-font-1380`（whySilent：漏了只表现成注音压上一行，不报错） |

### 判据

```text
AMAYUI_RESOURCE_DIR=<CN 资源> npm run verify  → 见收尾实测（typecheck + 全套 + 死写检测）
```

## 2026-09-15

### E4 实测（Electron `npm run shot -- --gamestart`，产物 `.tmp/t37ruby-9-sn0000-hover-out.png`）

在 2560×1440 的截图上量（放大率先用字形步进定标：全角字步进 = 60 device px / 30 逻辑 px ⇒ **scale = 2.0**）：

| 量 | 实测 | 与引擎对照 |
|---|---|---|
| 相邻两条正文的墨迹带中心间距 | 91 device px = **45.5 逻辑 px** | 引擎 `i075 1e` + `i08b 10` ⇒ 30+16 = **46** ✓（修前 = 30 ⇒ 注音压上一行） |
| 注音墨迹带（二重回廊的終焉）位置 | device y 674-685，位于上一行墨迹底（652）之下 22px、本行墨迹顶（687）之上 2px | 不再与上一行重叠 ✓ |

★未取证（诚实记录）：**逐字中途**的截图没抓到 —— `capturePage()` 单帧耗时 ≳ 逐字间隔（脚本 `INITREGMES.txt:6 i1b5 19` = 25ms/字），采样总是落在"整页已显完"之后；
  日志能证明逐字确实是逐字推进的（`.tmp/amayui-emulator.log` 的 `[reveal] win=8 k/58` 逐字序列），
  所以 T-0037 的观感确认（注音在逐字期间是否还提前）留给用户在模拟器里看一眼。
