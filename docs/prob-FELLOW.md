# FELLOW 待定内容清单（prob-FELLOW.md）

> 更新日期：2026-08-08
> 来源：`src/FELLOW.txt`（同伴装备界面，5 个唯一译文）
> 用途：记录 FELLOW 翻译处理情况。

## 1. 处理说明

1. FELLOW 无 ADV 文本、无注音；可译字面量为 5 处 set-string + 2 处 concat 片段；
2. concat「～は外すことが出来ない…」按 FIELD 先例用 `@"无法卸下……"` 字面量
   （接在道具名后，参数化组装不动寄存器）；
3. assemble 骨架校验通过，BIN 80832 字节，回读验证 5/5；
4. FELLOW.BIN 为游戏根目录松散文件，直接覆盖生效（manifest 无新增）。
