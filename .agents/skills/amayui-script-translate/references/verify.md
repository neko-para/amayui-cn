# 翻译复核清单

翻译完成后，必须执行以下复核（写仓库需提权）：

## 1. 官方 assemble（必做）
```powershell
cd E:\Games\Eushully\天結\scripts
npm run assemble -- <SCRIPT>
```
必须输出“骨架校验通过，回读验证 N/N 处译文”并写入 install 根 + DATA1。

## 2. 宽度检查（≤25 中文字 = ≤50 显示单位）
（仅适用于 ADV 视觉行 show-text/display-furigana/concat；draw-string 为固定控件文本，不适用
本检查，但需游戏内确认控件宽度不溢出）
```python
import re
pat = re.compile(r'^(show-text 0 |display-furigana 0 |concat \([^)]*\) \([^)]*\) )')
def unit(s):
    return sum(2 if ((0x2e80<=ord(c)<=0x9fff) or (0x3000<=ord(c)<=0x303f) or (0xff00<=ord(c)<=0xffef) or (0x2000<=ord(c)<=0x206f) or (0xf900<=ord(c)<=0xfaff)) else 1 for c in s)
for i, l in enumerate(open(r'E:\Games\Eushully\天結\src\<SCRIPT>.txt', encoding='utf-8').read().splitlines(), 1):
    if '@"' in l:
        for m in re.finditer(r'@"([^"]*)"', pat.sub('', l)):
            if unit(m.group(1)) > 50:
                print('超宽', i, unit(m.group(1)), m.group(1))
```

## 3. 结构检查
- `// 输入原文：` 注释数 == 页数（wait-for-input 数），且位于 `/* 原文存档 */` 与正文之间；
- 每个页面最后一行**没有** end-text-line（reflow 生成的正文末行不带 end-text-line；
  页末 `wait-for-input 0` 保留，其后的 `end-text-line 0` 属可增删的文本行，可留可删）；
- concat：仅当原脚本有 concat 时存在镜像行；
- `// 页面结束`：每个 ADV 页正文末行后存在该结束注释（三段式页块）；
- draw-string：前 3 个绘制参数（纹理/x/y）未改动；尾参字面量已按对语法/@"译文" 翻译或保持原样；
  尾参为寄存器/全局字符串引用时未误译；
- 行尾『：show-text 行内容不得以『结尾（单字『除外，如注音前开引号）；
- display-furigana 审计：逐条对照 data——第二参数为汉字释义（如 ＨＰ/耐久力、ＳＰ/技力、ＦＳ/疲労強度、
  称号类）必须保留为 display-furigana（中文释义作注音）；纯读音（假名）只存档。批量翻译后务必复核，
  勿将释义类误当纯读音丢弃；
- `<br>` 显式换行：正文中体现为 end-text-line 分隔的独立视觉行（多段同页的系统提示页
  用此保留分段，如 SG5744 合体攻击教程）；每段仍须 ≤25 中文字。
- 存档块内容与 data 基线逐字一致（含外字 U+E000-E010）。
- 大批量流程产物：`node reflow-apply.js --check <SCRIPT>` 幂等（0 差异）；
  存档块 `/* 原文存档 */` 起始行与 `// 输入原文` 之间的原文行来自源文件逐字拷贝（非手工转录）。
- 页面边界：`wait-for-input 0` 之后出现的文本行属下一页，不得并入前一页块重排；
  含 draw-string 的页不走 reflow-apply，需原位翻译（保留 draw-string 行、翻译字面尾参）。

## 3.5 漏译残留检查（必做）
```powershell
cd E:\Games\Eushully\天結\scripts
node find-untranslated.js [文件...]
```
- 分类：含假名且无译文标记 = 真实残留（需处理）；纯汉字/数字 = 同文候选（通常无需处理）；
  纯符号 / ？占位 / 空串 = 可忽略；
- 输出按「完全未翻译文件」与「部分翻译文件」分组；翻译完成的脚本不得出现真实残留
  （如 SC5740 曾漏 bc3 战斗条件、$1$SG1822A-E 曾漏系统确认串，2026-08-08 已修复）；
- `--list` 可额外输出全部已翻译文案明细，`--json` 输出机器可读结果。

## 4. git 状态
```powershell
git -C E:\Games\Eushully\天結 status --porcelain
```
预期出现 `src/<SCRIPT>.txt`（M）、`docs/prob-<SCRIPT>.md`（??/M）、
`docs/keywords-<主题或脚本>.md`（??/M）、`PROGRESS.md`（M）、`patch/patch.config.json`（M）；
其余为先前既有/用户并发改动，不要触碰。
大批量流程后不得残留 `scripts/tmp-<SCRIPT>-map.json` 等临时映射（`??` 即不合格，须删除）。

## 5. 记录检查
- `PROGRESS.md` 已包含 `<SCRIPT>`（已翻译索引）；
- `patch/patch.config.json` 的 `files` 已包含 `install/<SCRIPT>.BIN` 同步条目。

## 6. 抽查
抽查 2-3 页：块注释 → `// 输入原文` → 译文结构完整；释义类注音保留、纯读音只存档；行宽 ≤25。
