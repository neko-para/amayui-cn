# STAGECLEAR 待定内容清单（prob-STAGECLEAR.md）

> 更新日期：2026-08-08
> 来源：`src/STAGECLEAR.txt`（关卡通关结算界面，1 处字面量译出）
> 用途：记录 STAGECLEAR 翻译中的处理情况。

## 1. 工程说明

1. STAGECLEAR 无 ADV 文本、无 concat、无注音；可译字面量仅 1 处 `set-string`（お金→金钱），
   女神力 保持原样（与 AIM/SELSTAGE 口径一致）；
2. assemble 骨架校验通过，BIN 11980 字节，回读验证 1/1；
3. 道具名/单位名为全局字符串引用（ITINIT/EBINIT 已译），不在本脚本翻译；
4. `STAGECLEAR.BIN` 原为 ALF 内文件，assemble 已在 install 根生成松散副本
   （manifest 文件数 +1）。
