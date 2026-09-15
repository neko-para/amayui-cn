# T-0037 · 过程文档（changes.md）

## 2026-09-15

## 第 1 次变更（2026-09）：注音按「本文词末字」门控

### 引擎依据

- 排版收尾（`sub_46BE30` raw 83988-83997）：本文词的字逐个 push 成 24B 记录后，把**最后一个**那条标
  `[+0] = 1`，再把注音自己的记录 push 在它后面（`sub_465A20`）。
- 显现（`sub_45BE20` raw 72427-72435，dd 路径）：
  ```c
  do { 贴 24B 记录(行号); ++行号; } while (上一记录[+0]);
  ```
  ⇒ **一步 = 本文末字 + 它的注音**（同一帧），且注音不占独立节拍。

### 改了什么

| 位置 | 改动 |
|---|---|
| `src/text/layout.ts` | `RubyGlyph` 增加 `from`（本文词**末字**在本行里的序号）；`pairRuby` 写 `from = last.i`；新增导出 `visibleRubyInLine(line, revealedInLine)`；注音 y 顺带按引擎补非 D3D 路径的 `+1`（`sub_465A20`：`ruby.y = 行 y + Font+1292` 再 `if (DrawMode != 1 && !Font+218600) ++y`） |
| `src/renderer/text/raster.ts` | 旧的 `if (n > 0) for (const rg of line.ruby)` ⇒ `for (const rg of visibleRubyInLine(line, n))`（逐字期间只有末字已显现的注音才画） |
| `test/text-layout.test.ts` | 新增「注音随本文词的末字显现」：`from` = [2,2,2]、「天」显现时 0 个注音、「結」显现时 3 个；并把注音 y 期望从 −10 改成 **−9**（引擎 +1） |

### 判据

```text
AMAYUI_RESOURCE_DIR=<CN 资源> node --env-file=test/options.test.env --import tsx --test test/text-layout.test.ts  → 18/18 绿
```

行为变化：逐字期间注音不再整行提前亮 —— 与真机一致（整段显完后结果不变）。

## 2026-09-15

### E4 状态（诚实记录）

逐字中途的截图**没抓到**：Electron 的 `capturePage()` 单帧耗时 ≳ 逐字间隔
（`INITREGMES.txt:6 i1b5 19` = 25ms/字；把测试资源里的该值改成 99ms/字、并把 overlay INI 的
`message:MessageSpeed` 调到 400 之后仍然抓不到 —— SN0000 首屏在这一路径上是**整页**出现，
逐字序列只出现在后续页，而抓帧间隔仍大于逐字窗口）。

可观测的旁证：`.tmp/amayui-emulator.log` 里有 `[reveal] win=8 k/58` 的**逐字**序列 ⇒ 逐字确实是逐字推进的，
本票改的是"这一帧画不画注音"，模型层已由 `test/text-layout.test.ts` 钉住。

⇒ **请用户在模拟器里看一眼**：ADV 逐字期间带注音的词，其注音应当在该词**末字**出现的那一帧一起出现
（不再整行提前亮）。若观感仍不对，把当时那页的脚本行号发我即可复现。
