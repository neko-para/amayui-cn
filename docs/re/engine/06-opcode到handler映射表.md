# opcode → handler 映射表（天結_unpacked.exe）

> 级别：**已确认**（`engine/天结_unpacked.exe_utf8.lst` 中 `sub_415640`（Command 构造器）的 dispatch 表初始化实读 + `age-shared.cpp` 的 `definitions` 定义）。
>
> 来源与口径：
> - **opcode（值）**：dispatch 表数组下标。基址 `this + 0x0A509C`，项宽 4 字节，**opcode = (offset − 0x0A509C) / 4**，上限 `0x400`（越界落默认 `sub_418E30`）。
> - **已知名称（age-shared）**：`tools/eushully-decompiler/Decompiler/age-shared.cpp` 的 `Instruction_Definition.label`。⚠️ **该名称属引擎家族另一构建**（`uXXXX` = 另一版本的函数地址/编号），**与本引擎 `sub_XXXX` 地址不对齐**，仅作语义/同族对照；带 `u00xxxxxx` 的名称本身不含语义，只是跨构建交叉引用。
> - **实现函数名称**：本条 opcode 在本引擎 dispatch 表中的 handler（`engine/天结_unpacked.exe_utf8.c` 里的 `sub_XXXXXX`，由 `.lst` 的 `mov [esi+0A50XXh], offset sub_XXXX` 反推）。
> - **参数个数（argc）**：来自 age-shared 的 `argument_count`（单位 = 一个 typed arg = 8 字节；指令长度 = `4 + 8*argc`）。

> **本文件的"指令语义"下列各标记（务必区分，避免把推测当定论）**：
> - **【已核对】**：已在 `engine/天结_unpacked.exe_utf8.c`（或 `engine.cpp`）里**读到该 opcode 的 handler 体、确证其行为**。标注出处（如 `sub_XXXX（.c 行 N）`）。
> - **【推测】**：语义**仅由 age-shared 助记符名 / 命名约定 / 用法推断**，"handler 体尚未逐条读"；**可能失真**（AGE 的助记符有误导性，如 `exit`≠程序退出、`ret`≠跨脚本返回）。**不可当作定论**。
> - **【未解】**：尚无任何语义表征（仅知其 opcode/handler 地址）。绝大多数 `uXXXX` 属此列。
>
> 说明：本文档的**映射表本身（opcode→name→handler）是已确认的**；**语义列是"核对状态"**，其中仅少数已读体确认，多数仍是推测/未解。这是"逐步核对"的工作记录，非一次性终结结论。

表内共 **544** 条 opcode（有自定义 handler）。age-shared 定义但不在此引擎实现（落到默认 `sub_418E30`）/ 其它游戏专属的 30 条见文末「回退默认」。

## 完整映射（按 opcode 升序）

| opcode | argc | 已知名称（age-shared） | 本引擎实现函数 |
|---|---|---|---|
| 0x1 | 0 | u004149C0 | sub_418E60 |
| 0x2 | 0 | exit | sub_41A820 |
| 0x3 | 1 | call-script | sub_41C6A0 |
| 0x4 | 2 | u00417E30 | sub_41C770 |
| 0x5 | 0 | ret | sub_41A9B0 |
| 0x6 | 2 | u00417E80 | sub_41C7C0 |
| 0x7 | 1 | u00417F90 | sub_41C8D0 |
| 0x8 | 1 | u00417FC0 | sub_41C900 |
| 0x9 | 0 | exit-script | sub_428A60 |
| 0xA | 2 | u00424170 | sub_429460 |
| 0xB | 11 | u00418090 | sub_41C9E0 |
| 0xC | 0 | u004149E0 | sub_418E80 |
| 0xD | 4 | u004181A0 | sub_41CAF0 |
| 0xE | 12 | u00418200 | sub_41CB50 |
| 0xF | 1 | u00418300 | sub_41CC50 |
| 0x10 | 4 | u00414A00 | sub_418EB0 |
| 0x11 | 9 | u00418330 | sub_41CC90 |
| 0x12 | 1 | u004183F0 | sub_41CD60 |
| 0x13 | 4 | u00418420 | sub_42C570 |
| 0x14 | 0 | u00414A20 | sub_418ED0 |
| 0x15 | 5 | u00418490 | sub_41CDA0 |
| 0x16 | 2 | u00418520 | sub_41CE40 |
| 0x17 | 2 | u00418560 | sub_41CE80 |
| 0x1E | 8 | u004185B0 | sub_41CED0 |
| 0x1F | 12 | u00418690 | sub_41CFB0 |
| 0x20 | 6 | u004187C0 | sub_41D0E0 |
| 0x21 | 2 | u00418860 | sub_41D180 |
| 0x22 | 2 | u00418920 | sub_41D290 |
| 0x23 | 2 | u004189D0 | sub_41D390 |
| 0x24 | 2 | u00418A90 | sub_41D490 |
| 0x25 | 3 | u00418B40 | sub_41D590 |
| 0x26 | 4 | u00418C00 | sub_41D6A0 |
| 0x27 | 4 | u00418CC0 | sub_41D780 |
| 0x28 | 4 | u00418D90 | sub_41D860 |
| 0x2A | 4 | u00418E60 | sub_41D940 |
| 0x2B | 5 | u00418F30 | sub_41DA20 |
| 0x2C | 5 | u00419010 | sub_41DB00 |
| 0x2D | 12 | u004190A0 | sub_41DBA0 |
| 0x2E | 5 | u004194B0 | sub_41DFA0 |
| 0x2F | 4 | u004195A0 | sub_41E0A0 |
| 0x30 | 5 | u00419670 | sub_41E180 |
| 0x31 | 4 | u00419750 | sub_41E260 |
| 0x32 | 10 | u004197C0 | sub_41E2D0 |
| 0x33 | 6 | u00419900 | sub_41E420 |
| 0x34 | 12 | u004199C0 | sub_41E540 |
| 0x35 | 11 | u00419AF0 | sub_41E670 |
| 0x36 | 3 | u00419C00 | sub_41E7E0 |
| 0x37 | 11 | u00419C90 | sub_41E8C0 |
| 0x38 | 12 | u00419DA0 | sub_41EA30 |
| 0x50 | 3 | add | sub_42C5E0 |
| 0x51 | 3 | sub | sub_42C620 |
| 0x52 | 3 | mul | sub_42C660 |
| 0x53 | 3 | div | sub_42C6A0 |
| 0x54 | 3 | mod | sub_42C6E0 |
| 0x55 | 2 | mov | sub_42C720 |
| 0x56 | 3 | and | sub_42C750 |
| 0x57 | 3 | or | sub_42C790 |
| 0x58 | 3 | sar | sub_42C7D0 |
| 0x59 | 3 | shl | sub_42C820 |
| 0x5A | 3 | eq | sub_42C870 |
| 0x5B | 3 | ne | sub_42C8C0 |
| 0x5C | 3 | lt | sub_42C910 |
| 0x5D | 3 | lte | sub_42C960 |
| 0x5E | 3 | gr | sub_42C9B0 |
| 0x5F | 3 | gre | sub_42CA00 |
| 0x60 | 2 | random | sub_42CA50 |
| 0x61 | 3 | lookup-array | sub_42CB00 |
| 0x62 | 3 | u0041A360 | sub_42CB50 |
| 0x63 | 2 | lea | sub_42CBA0 |
| 0x64 | 2 | copy-local-array | sub_42CBE0 |
| 0x65 | 2 | u00414AA0 | sub_418F10 |
| 0x66 | 3 | u00414AE0 | sub_42CC90 |
| 0x67 | 3 | u00414B20 | sub_42CCE0 |
| 0x68 | 3 | u00414B60 | sub_42CD30 |
| 0x69 | 3 | u00414BA0 | sub_42CD80 |
| 0x6A | 3 | u00414BE0 | sub_42CDD0 |
| 0x6B | 3 | u00414C20 | sub_42CE20 |
| 0x6C | 2 | copy-to-global | sub_42CE70 |
| 0x6D | 0 | u00416960 | sub_41AA50 |
| 0x6E | 2 | show-text | sub_41EB20 |
| 0x6F | 1 | end-text-line | sub_41ECE0 |
| 0x70 | 5 | u0041A750 | sub_41ED20 |
| 0x71 | 1 | u0041A7B0 | sub_41ED80 |
| 0x72 | 1 | wait-for-input | sub_41EEF0 |
| 0x73 | 10 | u0041AB30 | sub_41F250 |
| 0x74 | 1 | u0041AC00 | sub_41F320 |
| 0x75 | 1 | u0041AC30 | sub_41F350 |
| 0x76 | 1 | u0041AC60 | sub_41F390 |
| 0x77 | 1 | u0041ACB0 | sub_41F3F0 |
| 0x78 | 1 | u0041AD00 | sub_41F450 |
| 0x79 | 3 | u0041AD30 | sub_41F490 |
| 0x7A | 3 | u0041AD70 | sub_41F4E0 |
| 0x7B | 2 | u0041ADB0 | sub_41F530 |
| 0x7C | 0 | u00416A90 | sub_41AB80 |
| 0x7D | 2 | u0041AE00 | sub_41F580 |
| 0x7E | 1 | u0041AEA0 | sub_41F630 |
| 0x7F | 1 | u00414C60 | sub_42D1F0 |
| 0x80 | 1 | u0041AF00 | sub_41F690 |
| 0x81 | 1 | u0041AF30 | sub_41F6C0 |
| 0x82 | 5 | u0041AF80 | sub_41F720 |
| 0x83 | 3 | u00414C90 | sub_42D220 |
| 0x84 | 1 | u0041AFE0 | sub_41F790 |
| 0x85 | 0 | u00414CF0 | sub_418F50 |
| 0x86 | 1 | u0041B210 | sub_41FA20 |
| 0x87 | 0 | u00414D10 | sub_418F80 |
| 0x88 | 1 | u0041B290 | sub_41FAB0 |
| 0x89 | 4 | u0041B2E0 | sub_41FB00 |
| 0x8A | 6 | u0041B330 | sub_41FB50 |
| 0x8B | 1 | u0041B3D0 | sub_41FBF0 |
| 0x8C | 1 | jmp | sub_4203D0 |
| 0x8D | 2 | u0041BCE0 | sub_420450 |
| 0x8E | 1 | u0041BD60 | sub_4204D0 |
| 0x8F | 1 | call | sub_420560 |
| 0x90 | 7 | u0041BEB0 | sub_420640 |
| 0x91 | 1 | u0041BFB0 | sub_420740 |
| 0x92 | 2 | u0041C030 | sub_4207D0 |
| 0x93 | 0 | u00415040 | sub_4191D0 |
| 0x94 | 0 | u00415090 | sub_419230 |
| 0x95 | 2 | u0041C0C0 | sub_420870 |
| 0x96 | 0 | u004150C0 | sub_419260 |
| 0x97 | 5 | u0041C150 | sub_420910 |
| 0xA0 | 3 | jcc | sub_4209B0 |
| 0xA1 | 0 | u00427C00 | sub_433A40 |
| 0xA2 | 2 | u00427FD0 | sub_434F10 |
| 0xA3 | 2 | u004244D0 | sub_429830 |
| 0xAA | 2 | u0041C270 | sub_42D580 |
| 0xAB | 2 | u0041C330 | sub_42D650 |
| 0xAC | 9 | u0041C3E0 | sub_42D700 |
| 0xAD | 0 | u00415110 | sub_4192C0 |
| 0xAE | 0 | u00415130 | sub_4192F0 |
| 0xAF | 0 | u00415480 | sub_419690 |
| 0xB0 | 1 | u0041C530 | sub_420A50 |
| 0xB1 | 1 | u0041C560 | sub_420A80 |
| 0xB2 | 2 | u0041C590 | sub_420AB0 |
| 0xB3 | 0 | u004154B0 | sub_4196B0 |
| 0xB4 | 2 | play-sound-effect | sub_420B00 |
| 0xB5 | 1 | u0041D050 | sub_420B40 |
| 0xB6 | 1 | u0041D080 | sub_420B80 |
| 0xB7 | 1 | u0041D0E0 | sub_420C00 |
| 0xB8 | 0 | u00415520 | sub_419720 |
| 0xB9 | 1 | u0041D140 | sub_420C60 |
| 0xBA | 1 | u0041D0B0 | sub_420BC0 |
| 0xBB | 1 | u0041D250 | sub_420D90 |
| 0xBC | 1 | u0041D280 | sub_420DC0 |
| 0xBD | 1 | u00415570 | sub_42E460 |
| 0xBE | 1 | u004155E0 | sub_42E4D0 |
| 0xBF | 1 | play-bgm | sub_420CC0 |
| 0xC0 | 1 | u00415620 | sub_42E510 |
| 0xC1 | 0 | u00415650 | sub_419770 |
| 0xC2 | 2 | u0041D2B0 | sub_420E00 |
| 0xC3 | 1 | u0041D390 | sub_420F10 |
| 0xC4 | 1 | play-voice | sub_420F70 |
| 0xC5 | 2 | u0041D4A0 | sub_42E540 |
| 0xC6 | 2 | u0041D5D0 | sub_421070 |
| 0xC7 | 2 | u0041D760 | sub_42E670 |
| 0xC8 | 1 | sleep | sub_4218D0 |
| 0xC9 | 0 | u00415770 | sub_4198A0 |
| 0xCA | 0 | u004157A0 | sub_4198E0 |
| 0xCB | 1 | u00415800 | sub_42E8E0 |
| 0xCC | 2 | mouse_callback | sub_421980 |
| 0xCD | 0 | get-input-type | sub_41ACD0 |
| 0xCE | 3 | u0041E0B0 | sub_4219E0 |
| 0xCF | 0 | u00416D40 | sub_41AE40 |
| 0xD0 | 1 | u00415830 | sub_42E910 |
| 0xD1 | 0 | u00415860 | sub_419940 |
| 0xD2 | 1 | u0041E110 | sub_421A50 |
| 0xD3 | 0 | u00425960 | sub_42AC40 |
| 0xD4 | 4 | u004266F0 | sub_42E940 |
| 0xD5 | 1 | u004262C0 | sub_42ACC0 |
| 0xD6 | 6 | u004267D0 | sub_42EB80 |
| 0xD7 | 1 | u0041E1A0 | sub_421AF0 |
| 0xD8 | 2 | u0041E150 | sub_421AA0 |
| 0xD9 | 0 | u00415880 | sub_419970 |
| 0xDA | 6 | u004158B0 | sub_42EAE0 |
| 0xFA | 0 | u00415940 | sub_4199B0 |
| 0xFB | 2 | joy_callback | sub_421B80 |
| 0xFC | 0 | u004159F0 | sub_419A70 |
| 0xFD | 2 | u0041E2D0 | sub_421C10 |
| 0xFE | 1 | u0041E360 | sub_421CA0 |
| 0xFF | 0 | u00415A10 | sub_419A90 |
| 0x100 | 0 | u00415A60 | sub_419AF0 |
| 0x101 | 0 | u00415BF0 | sub_419CC0 |
| 0x102 | 3 | u0041E3C0 | sub_421D00 |
| 0x103 | 1 | u0041E4A0 | sub_421DE0 |
| 0x104 | 0 | u00415C50 | sub_419D20 |
| 0x105 | 1 | u0041E4D0 | sub_421E20 |
| 0x106 | 1 | u00415E40 | sub_42ED90 |
| 0x107 | 2 | u0041E500 | sub_421E50 |
| 0x108 | 1 | u00415E70 | sub_42EDC0 |
| 0x109 | 2 | u00415EC0 | sub_42EE10 |
| 0x10A | 2 | u0041E540 | sub_421EA0 |
| 0x10B | 2 | u0041E5A0 | sub_422070 |
| 0x10C | 2 | u0041E5E0 | sub_4220B0 |
| 0x10D | 1 | u00415F10 | sub_42EF50 |
| 0x10E | 2 | u0041E650 | sub_42EF90 |
| 0x10F | 1 | u0041E690 | sub_422120 |
| 0x12C | 5 | lookup-array-2d | sub_42EFD0 |
| 0x12D | 7 | u0041E720 | sub_42F040 |
| 0x12E | 8 | u0041E940 | sub_42F230 |
| 0x12F | 4 | u0041ECB0 | sub_42F560 |
| 0x130 | 1 | u00415F40 | sub_42F7A0 |
| 0x131 | 1 | u00415F70 | sub_42F7D0 |
| 0x132 | 1 | u0041EF00 | sub_422150 |
| 0x133 | 2 | u0041EFF0 | sub_422240 |
| 0x134 | 3 | u0041F050 | sub_42F810 |
| 0x135 | 2 | bit-set | sub_42F8B0 |
| 0x136 | 2 | bit-reset | sub_42F920 |
| 0x137 | 1 | u0041F1C0 | sub_4222B0 |
| 0x138 | 2 | u0041F2B0 | sub_4223A0 |
| 0x139 | 3 | u0041F310 | sub_42F990 |
| 0x13A | 6 | u0041F3A0 | sub_422410 |
| 0x13B | 7 | u0041F440 | sub_4224E0 |
| 0x13C | 1 | u0041F7E0 | sub_422860 |
| 0x13D | 3 | u0041F840 | sub_42FA20 |
| 0x13E | 2 | u0041F8D0 | sub_42FAC0 |
| 0x13F | 3 | check-bit | sub_42FB40 |
| 0x140 | 4 | u0041F9C0 | sub_42FBC0 |
| 0x141 | 1 | u0041FAA0 | sub_4228C0 |
| 0x142 | 1 | u0041FB10 | sub_422930 |
| 0x143 | 0 | u00415FB0 | sub_41A000 |
| 0x144 | 2 | u004259D0 | sub_433AB0 |
| 0x145 | 1 | u00416040 | sub_42FCF0 |
| 0x146 | 1 | u0041FB40 | sub_422960 |
| 0x147 | 6 | u0041FB80 | sub_42FD60 |
| 0x148 | 1 | u004160A0 | sub_42FEC0 |
| 0x149 | 1 | u0041FCE0 | sub_4229A0 |
| 0x14A | 7 | u0041FD10 | sub_42FEF0 |
| 0x14B | 1 | u0041FF50 | sub_4229D0 |
| 0x14C | 2 | set-agerc-export | sub_422AB0 |
| 0x14D | 6 | call-agerc-export | sub_430170 |
| 0x190 | 2 | u0041C5E0 | sub_42D830 |
| 0x191 | 2 | u0041A4A0 | sub_42CEC0 |
| 0x192 | 2 | set-string | sub_433660 |
| 0x193 | 3 | concat | sub_433710 |
| 0x194 | 3 | u00425480 | sub_42CF10 |
| 0x195 | 3 | u00425580 | sub_42D010 |
| 0x196 | 3 | display-furigana | sub_41FC20 |
| 0x197 | 1 | u0041B510 | sub_41FDD0 |
| 0x198 | 3 | u0041B540 | sub_41FE10 |
| 0x199 | 0 | u00414D50 | sub_418FC0 |
| 0x19A | 1 | u00414E50 | sub_42D290 |
| 0x19B | 0 | u00414E80 | sub_4190E0 |
| 0x19C | 0 | u00414EC0 | sub_419120 |
| 0x19D | 2 | u0041C680 | sub_42D8E0 |
| 0x19E | 2 | u0041C6E0 | sub_42D980 |
| 0x19F | 2 | u0041C860 | sub_42DB10 |
| 0x1A0 | 9 | u0041C9B0 | sub_42DC70 |
| 0x1A1 | 2 | u0041CB40 | sub_42DDE0 |
| 0x1A2 | 1 | u00428010 | sub_434F60 |
| 0x1A3 | 1 | string-lookup-set | sub_42DF40 |
| 0x1A4 | 2 | u0041B580 | sub_41FE60 |
| 0x1A5 | 1 | set-font | sub_433290 |
| 0x1A6 | 2 | halve-strlen | sub_42D110 |
| 0x1A7 | 1 | comment | sub_4191B0 |
| 0x1A8 | 0 | dev_ukn | sub_419690 |
| 0x1A9 | 1 | u00428090 | sub_434FE0 |
| 0x1AA | 1 | u00425920 | sub_433A70 |
| 0x1AB | 2 | u0041CCA0 | sub_42DFC0 |
| 0x1AC | 3 | u0041CD80 | sub_42E0A0 |
| 0x1AD | 0 | u004154F0 | sub_4196F0 |
| 0x1AE | 3 | u0041CED0 | sub_42E1F0 |
| 0x1AF | 3 | u004245C0 | sub_42E320 |
| 0x1B0 | 3 | memcpy | sub_42D150 |
| 0x1B1 | 1 | u0041B5C0 | sub_41FEA0 |
| 0x1B2 | 1 | u00425790 | sub_42A9B0 |
| 0x1B3 | 0 | u004257D0 | sub_42AA00 |
| 0x1B4 | 0 | u004237C0 | sub_428DB0 |
| 0x1B5 | 1 | u0041B5F0 | sub_41FED0 |
| 0x1B6 | 1 | u00414F60 | sub_42D2C0 |
| 0x1B7 | 1 | u0041B640 | sub_41FF20 |
| 0x1B8 | 2 | u0041B670 | sub_42D2F0 |
| 0x1B9 | 2 | u0041B710 | sub_41FF60 |
| 0x1BA | 2 | u0041D850 | sub_421200 |
| 0x1BB | 1 | u0041B7B0 | sub_420000 |
| 0x1BC | 0 | u00415670 | sub_4197A0 |
| 0x1BD | 1 | u0041D910 | sub_4212C0 |
| 0x1BE | 2 | u0041D9D0 | sub_42E770 |
| 0x1BF | 0 | u004156C0 | sub_419840 |
| 0x1C0 | 1 | u0041DB70 | sub_421450 |
| 0x1C1 | 3 | u0041B820 | sub_420070 |
| 0x1C2 | 2 | u0041B860 | sub_4200C0 |
| 0x1C3 | 2 | u0041B8A0 | sub_420110 |
| 0x1C4 | 1 | u00415720 | sub_42E8A0 |
| 0x1C5 | 4 | u00425800 | sub_433930 |
| 0x1C6 | 2 | u0041DD80 | sub_421690 |
| 0x1C7 | 1 | u00414F90 | sub_42D390 |
| 0x1C8 | 2 | toString | sub_433820 |
| 0x1C9 | 3 | u0041B8E0 | sub_420160 |
| 0x1CA | 1 | u0041B9B0 | sub_420240 |
| 0x1CB | 1 | u00414FD0 | sub_42D3D0 |
| 0x1CC | 1 | u00415010 | sub_42D410 |
| 0x1CD | 2 | u0041A560 | sub_42D1A0 |
| 0x1CE | 1 | u0041B9F0 | sub_420280 |
| 0x1CF | 1 | u0041DA10 | sub_4213C0 |
| 0x1D0 | 3 | u0041BA80 | sub_42D440 |
| 0x1D1 | 5 | u0041BAE0 | sub_420310 |
| 0x1D2 | 2 | u0041BB40 | sub_420380 |
| 0x1D3 | 5 | u0041BB90 | sub_42D4A0 |
| 0x1D4 | 4 | u0041BC00 | sub_42D510 |
| 0x1D5 | 0 | u00415700 | sub_419880 |
| 0x1D6 | 2 | u0041DA40 | sub_42E7C0 |
| 0x1D7 | 2 | u0041DA80 | sub_42E800 |
| 0x1D8 | 3 | u0041DAD0 | sub_42E850 |
| 0x1D9 | 2 | u0041DB20 | sub_4213F0 |
| 0x1F4 | 0 | u004160D0 | sub_41A090 |
| 0x1F5 | 0 | u00416120 | sub_41A0E0 |
| 0x1F6 | 0 | u00416170 | sub_41A130 |
| 0x1F7 | 2 | u00420270 | sub_422BC0 |
| 0x1F8 | 4 | create-texture | sub_422C20 |
| 0x1F9 | 3 | set-texture | sub_422CB0 |
| 0x1FA | 1 | u00420480 | sub_422E00 |
| 0x1FB | 8 | draw-texture | sub_422E70 |
| 0x1FC | 1 | u004205F0 | sub_422F80 |
| 0x1FD | 4 | u00420620 | sub_422FD0 |
| 0x1FE | 5 | u004206C0 | sub_423060 |
| 0x1FF | 4 | u00420770 | sub_4230F0 |
| 0x200 | 1 | u00420800 | sub_423170 |
| 0x201 | 1 | u00416190 | sub_4302B0 |
| 0x202 | 5 | u00420880 | sub_4231F0 |
| 0x203 | 4 | u00420950 | sub_4232C0 |
| 0x204 | 4 | draw-string | sub_423390 |
| 0x205 | 6 | u00420A60 | sub_4233E0 |
| 0x206 | 7 | u004161C0 | sub_41A160 |
| 0x207 | 8 | u00420B00 | sub_423480 |
| 0x208 | 3 | u00420BF0 | sub_4302E0 |
| 0x209 | 5 | u00420C50 | sub_423580 |
| 0x20A | 1 | u00420CE0 | sub_423620 |
| 0x20B | 7 | u00420D50 | sub_423690 |
| 0x20C | 0 | u00416200 | sub_41A1A0 |
| 0x20D | 1 | u00420E10 | sub_423770 |
| 0x20E | 0 | u00416250 | sub_41A200 |
| 0x20F | 3 | u00420E40 | sub_4237B0 |
| 0x210 | 1 | u00420FF0 | sub_423980 |
| 0x211 | 1 | u00421060 | sub_4239F0 |
| 0x212 | 2 | u00421090 | sub_423A30 |
| 0x213 | 3 | u004210D0 | sub_423A80 |
| 0x214 | 2 | u00421120 | sub_423AE0 |
| 0x215 | 2 | u00421160 | sub_430340 |
| 0x216 | 2 | u004211A0 | sub_430380 |
| 0x217 | 4 | u004211E0 | sub_423B20 |
| 0x218 | 4 | u00421270 | sub_4303C0 |
| 0x219 | 4 | u004212E0 | sub_423BA0 |
| 0x21A | 4 | u00421370 | sub_430450 |
| 0x21B | 1 | u004213E0 | sub_423C20 |
| 0x21C | 0 | u00416270 | sub_41A260 |
| 0x21D | 2 | u00421410 | sub_423C60 |
| 0x21E | 6 | u00421450 | sub_423CA0 |
| 0x21F | 7 | u00421510 | sub_423D40 |
| 0x220 | 6 | u004215D0 | sub_423DE0 |
| 0x221 | 4 | u00421670 | sub_423E70 |
| 0x222 | 2 | u004216C0 | sub_423EC0 |
| 0x223 | 8 | u00421700 | sub_423F00 |
| 0x224 | 0 | u00416290 | sub_41A290 |
| 0x225 | 2 | u00421780 | sub_423F80 |
| 0x226 | 5 | u004217D0 | sub_4304E0 |
| 0x227 | 6 | u00421880 | sub_4305A0 |
| 0x228 | 5 | u00421940 | sub_430650 |
| 0x229 | 5 | u004219E0 | sub_423FE0 |
| 0x22A | 3 | u00421A90 | sub_424080 |
| 0x22B | 4 | u00421B30 | sub_424100 |
| 0x22C | 3 | u00421BD0 | sub_424180 |
| 0x22D | 5 | u00421C60 | sub_4241F0 |
| 0x22E | 6 | u00421D10 | sub_424290 |
| 0x22F | 5 | u00421DD0 | sub_424330 |
| 0x230 | 1 | u00421E70 | sub_4243B0 |
| 0x231 | 4 | u00421EA0 | sub_4243F0 |
| 0x232 | 4 | u00421EF0 | sub_424440 |
| 0x233 | 5 | u00421FB0 | sub_424510 |
| 0x234 | 5 | u00422060 | sub_4245B0 |
| 0x235 | 5 | u00422100 | sub_424630 |
| 0x236 | 4 | u004221A0 | sub_4246B0 |
| 0x237 | 2 | u00422350 | sub_424880 |
| 0x238 | 1 | u00422390 | sub_4248C0 |
| 0x239 | 6 | u004223C0 | sub_424900 |
| 0x23A | 2 | u00422420 | sub_4306F0 |
| 0x23B | 7 | u00422460 | sub_424970 |
| 0x23C | 0 | u004162B0 | sub_41A2C0 |
| 0x23D | 0 | u004162F0 | sub_41A300 |
| 0x23E | 2 | u004228C0 | sub_430750 |
| 0x23F | 2 | u00422930 | sub_4307B0 |
| 0x240 | 4 | u004229A0 | sub_424DA0 |
| 0x241 | 5 | u00422B80 | sub_424FA0 |
| 0x242 | 2 | u00422D60 | sub_4251A0 |
| 0x243 | 0 | u00417070 | sub_41B180 |
| 0x244 | 0 | u00416360 | sub_41A370 |
| 0x245 | 2 | u00422DA0 | sub_4251E0 |
| 0x246 | 2 | u00422E10 | sub_425250 |
| 0x247 | 1 | u00416390 | sub_430810 |
| 0x248 | 1 | u00422E80 | sub_4252E0 |
| 0x249 | 3 | u00422EB0 | sub_425310 |
| 0x24A | 3 | u004163C0 | sub_430840 |
| 0x24B |  | （age-shared 未收录） | sub_425460 |
| 0x24C |  | （age-shared 未收录） | sub_425530 |
| 0x24D | 12 | u00422E90 | sub_4255E0 |
| 0x24E | 1 | u00422EA0 | sub_4258C0 |
| 0x24F | 10 | u00422ED0 | sub_4258F0 |
| 0x250 | 10 | u00422F60 | sub_425980 |
| 0x251 | 12 | u00422FF0 | sub_425A10 |
| 0x252 | 1 | u00423000 | sub_425AB0 |
| 0x253 | 2 | u00423019 | sub_425AE0 |
| 0x254 | 5 | u00423049 | sub_425B20 |
| 0x255 |  | （age-shared 未收录） | sub_425BC0 |
| 0x256 | 5 | u00423050 | sub_425C30 |
| 0x257 | 5 | 257 | sub_425CA0 |
| 0x258 | 2 | u00422FE0 | sub_425D20 |
| 0x259 | 0 | u00416410 | sub_41A3A0 |
| 0x25A | 1 | u00423120 | sub_425DB0 |
| 0x25B | 1 | 25B | sub_425E20 |
| 0x25C | 8 | u00423122 | sub_425E70 |
| 0x25D | 3 | u00423123 | sub_425EF0 |
| 0x25E | 5 | u00423124 | sub_425F50 |
| 0x25F | 4 | u00423125 | sub_425FF0 |
| 0x260 | 4 | u00423126 | sub_426080 |
| 0x261 | 1 | u00423127 | sub_4260F0 |
| 0x2BC | 11 | u00423020 | sub_426120 |
| 0x2BD | 1 | u00423100 | sub_426200 |
| 0x2BE | 1 | u00423140 | sub_426260 |
| 0x2BF | 3 | u00423180 | sub_4262C0 |
| 0x2C0 | 3 | u004231C0 | sub_426310 |
| 0x2C1 | 1 | u00425BC0 | sub_433CE0 |
| 0x2C2 | 6 | u00425CD0 | sub_433DE0 |
| 0x2C3 | 2 | u00423200 | sub_430890 |
| 0x2C4 | 0 | u00416450 | sub_41A3F0 |
| 0x2C5 | 2 | strlen | sub_430900 |
| 0x2C6 | 2 | u0042B5E0 | sub_430940 |
| 0x2C7 | 4 | u0042B5F0 | sub_433FD0 |
| 0x2C8 | 4 | u0042B610 | sub_434260 |
| 0x2C9 | 3 | 2C9 | sub_4344A0 |
| 0x2CA |  | （age-shared 未收录） | sub_430990 |
| 0x2CB |  | （age-shared 未收录） | sub_426360 |
| 0x2CC | 1 | 2CC | sub_4309E0 |
| 0x2CD | 1 | 2CD | sub_426390 |
| 0x2CE | 1 | u0042B616 | sub_430A20 |
| 0x2CF | 1 | u0042B617 | sub_4263D0 |
| 0x2D0 | 3 | u0042B940 | sub_430A50 |
| 0x2D1 | 3 | u0042B950 | sub_430AB0 |
| 0x2D2 | 3 | u0042B960 | sub_430B10 |
| 0x2D3 | 3 | u0042B970 | sub_430B70 |
| 0x2D4 |  | （age-shared 未收录） | sub_430BD0 |
| 0x2D5 | 2 | u0042B990 | sub_430C30 |
| 0x2D6 |  | （age-shared 未收录） | sub_430C70 |
| 0x2D7 | 2 | u0042B9B0 | sub_430CB0 |
| 0x2D8 | 3 | set-array-to | sub_430CF0 |
| 0x2D9 | 2 | u0042BA30 | sub_430D60 |
| 0x2DA | 8 | u004234E0 | sub_426420 |
| 0x2DB | 1 | u004235C0 | sub_426500 |
| 0x2DC | 1 | u0042BA80 | sub_430DB0 |
| 0x2DD | 2 | u0042D880 | sub_434720 |
| 0x2DE | 2 | u0042BAC0 | sub_430DF0 |
| 0x2DF | 3 | u0042BAC1 | sub_430E30 |
| 0x2E0 | 3 | u0042CE0F | sub_430EA0 |
| 0x2E1 | 3 | u0042CE10 | sub_430F10 |
| 0x2E2 | 3 | u0042CE11 | sub_430F80 |
| 0x2E3 | 3 | u0042CE30 | sub_430FF0 |
| 0x2E4 | 3 | u0042CE31 | sub_431060 |
| 0x2E5 | 1 | u0042CE50 | sub_4310D0 |
| 0x2E6 | 2 | u0042CE60 | sub_431110 |
| 0x2E7 | 2 | u0042CE70 | sub_426540 |
| 0x2E8 | 1 | u0042CE80 | sub_4265E0 |
| 0x2E9 | 1 | u0042CE90 | sub_426620 |
| 0x2EA | 1 | u0042CEA0 | sub_4311B0 |
| 0x2EB | 1 | u0042CEB0 | sub_434830 |
| 0x2EC | 2 | u0042CEC0 | sub_4311F0 |
| 0x2ED |  | （age-shared 未收录） | sub_431230 |
| 0x2EE | 1 | u0042CEC2 | sub_426650 |
| 0x2EF | 11 | u0042CEC3 | sub_431270 |
| 0x2F0 | 9 | u0042CEC4 | sub_431460 |
| 0x2F1 | 7 | u0042CEC5 | sub_4316E0 |
| 0x2F2 | 6 | u0042CEC6 | sub_4318A0 |
| 0x2F3 | 6 | 2F3 | sub_431A10 |
| 0x2F4 | 3 | 2F4 | sub_4266A0 |
| 0x2F5 | 4 | 2F5 | sub_4267D0 |
| 0x2F6 | 1 | 2F6 | sub_426820 |
| 0x2F7 | 1 | 2F7 | sub_426890 |
| 0x2F8 | 2 | 2F8 | sub_4268D0 |
| 0x2F9 | 7 | 2F9 | sub_431AA0 |
| 0x2FA | 1 | 2FA | sub_426910 |
| 0x2FB | 1 | 2FB | sub_431B60 |
| 0x2FC | 5 | 2FC | sub_431BA0 |
| 0x2FD | 6 | 2FD | sub_431CF0 |
| 0x2FE | 1 | 2FE | sub_4332D0 |
| 0x2FF | 2 | 2FF | sub_426940 |
| 0x300 | 3 | 300 | sub_426990 |
| 0x301 | 1 | 301 | sub_4269F0 |
| 0x302 | 2 | 302 | sub_426A30 |
| 0x303 | 3 | 303 | sub_426A90 |
| 0x304 | 0 | 304 | sub_41A420 |
| 0x305 | 0 | 305 | sub_41B1C0 |
| 0x306 | 1 | 306 | sub_431FC0 |
| 0x307 | 1 | 307 | sub_426AE0 |
| 0x308 | 1 | 308 | sub_426B20 |
| 0x309 |  | （age-shared 未收录） | sub_432000 |
| 0x30A | 2 | 30A | sub_426B60 |
| 0x320 | 10 | u0043AA20 | sub_432150 |
| 0x321 | 3 | u0043AA30 | sub_426BD0 |
| 0x322 | 4 | u0043AA40 | sub_426C20 |
| 0x323 | 5 | u0043AA50 | sub_426CF0 |
| 0x324 | 0 | u0043AA60 | sub_41A470 |
| 0x325 | 2 | u0043AA70 | sub_426DC0 |
| 0x326 | 4 | u0043AA80 | sub_426E10 |
| 0x327 | 1 | u0043AA90 | sub_426E70 |
| 0x328 | 3 | u0043AAA0 | sub_432300 |
| 0x329 | 2 | u0043AAB0 | sub_426EB0 |
| 0x32A | 1 | 32A | sub_426F80 |
| 0x32B | 0 | u0043AAD0 | sub_41A4A0 |
| 0x32C | 6 | u0043AAE0 | sub_426FC0 |
| 0x32D | 2 | u0043AAF0 | sub_427040 |
| 0x32E | 11 | u0043AB10 | sub_427110 |
| 0x32F | 1 | u0043AB11 | sub_4272B0 |
| 0x330 | 2 | u0043AB12 | sub_4272F0 |
| 0x331 |  | （age-shared 未收录） | sub_427330 |
| 0x332 | 4 | u0043AB14 | sub_427380 |
| 0x333 |  | （age-shared 未收录） | sub_427450 |
| 0x334 | 1 | u0043AB16 | sub_427520 |
| 0x335 | 4 | u0043AB17 | sub_427560 |
| 0x336 |  | （age-shared 未收录） | sub_4275F0 |
| 0x337 | 4 | u0043AB19 | sub_427680 |
| 0x338 |  | （age-shared 未收录） | sub_427700 |
| 0x339 |  | （age-shared 未收录） | sub_4277A0 |
| 0x33A |  | （age-shared 未收录） | sub_427840 |
| 0x33B | 4 | u0043AB1D | sub_4278D0 |
| 0x33C |  | （age-shared 未收录） | sub_427950 |
| 0x33D | 3 | u0043AB1E | sub_4279B0 |
| 0x33E | 5 | u0043AB1F | sub_427A00 |
| 0x33F | 3 | u0043AB20 | sub_427A90 |
| 0x340 | 1 | 340 | sub_427B60 |
| 0x341 | 2 | 341 | sub_427BA0 |
| 0x342 | 1 | 342 | sub_427C70 |
| 0x343 |  | （age-shared 未收录） | sub_41A4E0 |
| 0x344 | 2 | 344 | sub_427CB0 |
| 0x345 | 3 | 345 | sub_427CF0 |
| 0x346 |  | （age-shared 未收录） | sub_427DD0 |
| 0x347 |  | （age-shared 未收录） | sub_427E10 |
| 0x348 |  | （age-shared 未收录） | sub_427EA0 |
| 0x349 | 4 | 349 | sub_427F30 |
| 0x34A |  | （age-shared 未收录） | sub_427FB0 |
| 0x34B |  | （age-shared 未收录） | sub_428030 |
| 0x34C |  | （age-shared 未收录） | sub_4280D0 |
| 0x34D | 6 | 34D | sub_428170 |
| 0x34E | 4 | 34E | sub_428200 |
| 0x34F |  | （age-shared 未收录） | sub_428400 |
| 0x350 |  | （age-shared 未收录） | sub_4282E0 |
| 0x351 |  | （age-shared 未收录） | sub_428320 |
| 0x352 | 3 | 352 | sub_4283B0 |

## 具名（可读助记符）opcode 一览 + 语义核对状态

> 只列 age-shared 里带真实助记符（非 `u00xxxxxx`、非纯数字编号）的指令。
> **语义列严格区分核对状态**：`【已核对】`=读了 handler 体确证；`【推测】`=仅凭助记符名推断、**handler 未读体、可能失真**；`【未解】`=无表征。
> ⚠️ 反复强调：AGE 助记符名**不可靠**（例：`exit`≠程序退出，是"跨脚本返回"；`ret`≠跨脚本返回，是"同脚本子程序返回"）。凡未读体的 `【推测】` 一律不可当定论。

| opcode | argc | 已知名称（age-shared） | 本引擎实现函数 | 语义（含核对状态） |
|---|---|---|---|---|
| 0x2 | 0 | exit | sub_41A820 | 【已核对】跨脚本**返回调用层**（`cur=frame.caller`；顶层 caller<0 才程序退出）。handler=sub_41A820（raw .c 25629） |
| 0x3 | 1 | call-script | sub_41C6A0 | 【已核对】读 operand1=目标脚本索引 → 压帧（cur++）+ 装载新脚本帧。handler=sub_41C6A0（raw .c 26762） |
| 0x5 | 0 | ret | sub_41A9B0 | 【已核对】**同脚本**子程序返回（弹每帧返回栈 `256*cur+97193`；栈空 no-op）。handler=sub_41A9B0（raw .c 25704） |
| 0x9 | 0 | exit-script | sub_428A60 | 【已核对】**全量 teardown**：清 40 帧 + 重置全局数组 → 回根态。handler=sub_428A60（raw .c 35171） |
| 0x50 | 3 | add | sub_42C5E0 | 【已核对】`op1 = op2 + op3`（read op2/op3 → write op1） |
| 0x51 | 3 | sub | sub_42C620 | 【已核对】`op1 = op2 - op3` |
| 0x52 | 3 | mul | sub_42C660 | 【已核对】`op1 = op2 * op3` |
| 0x53 | 3 | div | sub_42C6A0 | 【已核对】`op1 = op2 / op3` |
| 0x54 | 3 | mod | sub_42C6E0 | 【已核对】`op1 = op2 % op3` |
| 0x55 | 2 | mov | sub_42C720 | 【已核对】`op1 = op2` |
| 0x56 | 3 | and | sub_42C750 | 【已核对】`op1 = op2 & op3` |
| 0x57 | 3 | or | sub_42C790 | 【已核对】`op1 = op2 \| op3` |
| 0x58 | 3 | sar | sub_42C7D0 | 【已核对】`op1 = op2 >> op3` |
| 0x59 | 3 | shl | sub_42C820 | 【已核对】`op1 = op2 << op3` |
| 0x5A | 3 | eq | sub_42C870 | 【已核对】`op1 = (op2 == op3)` |
| 0x5B | 3 | ne | sub_42C8C0 | 【已核对】`op1 = (op2 != op3)` |
| 0x5C | 3 | lt | sub_42C910 | 【已核对】`op1 = (op2 < op3)` |
| 0x5D | 3 | lte | sub_42C960 | 【已核对】`op1 = (op2 <= op3)` |
| 0x5E | 3 | gr | sub_42C9B0 | 【已核对】`op1 = (op2 > op3)` |
| 0x5F | 3 | gre | sub_42CA00 | 【已核对】`op1 = (op2 >= op3)` |
| 0x60 | 2 | random | sub_42CA50 | 【已核对】`op1 = rand() % op2` |
| 0x61 | 3 | lookup-array | sub_42CB00 | 【已核对】`op1 = &op2[op3]`（取数组元素**地址**写入 op1 指针槽：sub_42AEA0 取 op2 基址 → sub_418CC0 写 `基址+4*op3`；与 lea 同底座）。handler=sub_42CB00（raw .c 37742）。⚠️ 修正旧「取值」——实际存的是元素**地址**（AGE 指针操作数后续读取时自动解引用即成值） |
| 0x63 | 2 | lea | sub_42CBA0 | 【已核对】`op1 = &op2`（取 op2 的**内存地址**写入 op1 指针槽：`sub_42AEA0(this,2)` 取址 → `sub_418B90(this,1,addr)` 写指针/地址型操作数）。handler=sub_42CBA0（raw .c 37766） |
| 0x64 | 2 | copy-local-array | sub_42CBE0 | 【已核对】把 op2 索引的字面数组（count=池`[4*op2]`；源=池`+4*op2+4`；每项经 `key ^ ROR` 解码后写入）拷入 op1 指向的数组 —— **数组/地板填充的底座**（MPINIT 地板用）。handler=sub_42CBE0（raw .c 37776） |
| 0x6C | 2 | copy-to-global | sub_42CE70 | 【已核对】`op1 起的 count 个槽置 0`（**非 mov 值拷贝**）：`v2=&op1; n=op2(count); while(n--) *v2++ = _this[97060]`；`_this[97060]`=**ENC(0)**（`ROL(x,11)==key` 反篡改校验在 3 处独立成立唯一确定）。handler=sub_42CE70（raw .c 37876）。⚠️ 修正旧「局部→全局循环拷贝」——实为 bulk 零初始化 |
| 0x6E | 2 | show-text | sub_41EB20 | 【推测(子系统)】显示文本。未读体 |
| 0x6F | 1 | end-text-line | sub_41ECE0 | 【推测(子系统)】结束当前文本行。未读体 |
| 0x72 | 1 | wait-for-input | sub_41EEF0 | 【推测(子系统)】等待输入。未读体 |
| 0x8C | 1 | jmp | sub_4203D0 | 【已核对】跳到 operand1 的 label（无条件，不入栈） |
| 0x8F | 1 | call | sub_420560 | 【已核对】同脚本子程序调用：push 下一指令到每帧返回栈，跳 label；operand==-1 则弹回不跳。handler=sub_420560（raw .c 29452） |
| 0xA0 | 3 | jcc | sub_4209B0 | 【已核对】`cond=op2`；cond!=0→跳 op3 的 label；cond==0→跳 op4 的 label；对应 label==0xFFFFFFFF 则不跳（falls through）。注：条件读 op2（非 op1）；两目标在 args[1]/args[2] |
| 0xB4 | 2 | play-sound-effect | sub_420B00 | 【推测(子系统)】播放音效。未读体 |
| 0xBF | 1 | play-bgm | sub_420CC0 | 【推测(子系统)】播放 BGM。未读体 |
| 0xC4 | 1 | play-voice | sub_420F70 | 【推测(子系统)】播放语音。未读体 |
| 0xC8 | 1 | sleep | sub_4218D0 | 【推测(子系统)】睡眠/延时。未读体 |
| 0xCC | 2 | mouse_callback | sub_421980 | 【推测(子系统)】注册鼠标/键盘回调。未读体 |
| 0xCD | 0 | get-input-type | sub_41ACD0 | 【推测(子系统)】取输入类型。未读体 |
| 0xFB | 2 | joy_callback | sub_421B80 | 【推测(子系统)】注册手柄回调。未读体 |
| 0x12C | 5 | lookup-array-2d | sub_42EFD0 | 【推测】二维数组查找。未读体 |
| 0x135 | 2 | bit-set | sub_42F8B0 | 【已核对】`op1 \|= (1<<op2)`（置位；op2=bit 位，>0x1F 报错 `setbit`）。handler=sub_42F8B0（raw .c 39402） |
| 0x136 | 2 | bit-reset | sub_42F920 | 【已核对】`op1 &= ~(1<<op2)`（复位；op2=bit 位，>0x1F 报错 `rembit`）。handler=sub_42F920（raw .c 39424） |
| 0x13F | 3 | check-bit | sub_42FB40 | 【已核对】`op1 = ((1<<op3) & op2) != 0`（op3=bit 位，op2=待测值，>0x1F 报错 `getbit`）。handler=sub_42FB40（raw .c 39549） |
| 0x14C | 2 | set-agerc-export | sub_422AB0 | 【推测】绑定 agerc 导出。未读体 |
| 0x14D | 6 | call-agerc-export | sub_430170 | 【推测】调用 agerc 导出。未读体 |
| 0x192 | 2 | set-string | sub_433660 | 【已核对】`op1 = op2`（**汉化核心指令**：把字符串 op2 赋给 op1 串槽。`sub_42A420(this,&buf,2)` 读 op2 字符串对象 → `sub_433310(this,1,buf)` 写入 op1）。handler=sub_433660（raw .c 41936） |
| 0x193 | 3 | concat | sub_433710 | 【已核对】`op1 = op2 + op3`（字符串拼接：`sub_42A420` 读 op3/op2 → `sub_42AA90` 拼接（**op2 在前**）→ `sub_433310` 写入 op1）。handler=sub_433710（raw .c 41952） |
| 0x196 | 3 | display-furigana | sub_41FC20 | 【推测】显示注音。未读体 |
| 0x1A3 | 1 | string-lookup-set | sub_42DF40 | 【已核对-部分】读 op1 → 在 `_this+5452` str 查找表按键取值 → 写回 op1。handler=sub_42DF40（raw .c 38443）。字符串表语义 M1 细化 |
| 0x1A5 | 1 | set-font | sub_433290 | 【推测(子系统)】设置字体。未读体 |
| 0x1A6 | 2 | halve-strlen | sub_42D110 | 【推测】字符串半长。未读体 |
| 0x1A7 | 1 | comment | sub_4191B0 | 【已核对】nop（dev 注释，无副作用） |
| 0x1A8 | 0 | dev_ukn | sub_419690 | 【已核对】nop（dev 未知指令，通常空实现） |
| 0x1B0 | 3 | memcpy | sub_42D150 | 【推测】`op1 = dest; op2 = src; size = 4*op3`。未读体（备注来自 age-shared 注释） |
| 0x1C8 | 2 | toString | sub_433820 | 【推测】转字符串。未读体 |
| 0x1F8 | 4 | create-texture | sub_422C20 | 【推测(子系统)】创建贴图。未读体 |
| 0x1F9 | 3 | set-texture | sub_422CB0 | 【推测(子系统)】设置贴图。未读体 |
| 0x1FB | 8 | draw-texture | sub_422E70 | 【推测(子系统)】绘制贴图。未读体 |
| 0x204 | 4 | draw-string | sub_423390 | 【推测(子系统)】绘制字符串。未读体 |
| 0x2C5 | 2 | strlen | sub_430900 | 【推测】字符串长度。未读体 |
| 0x2D8 | 3 | set-array-to | sub_430CF0 | 【已核对】`op1 起 count 个槽填 op2 值`（**脚本值 bulk 填充**；对比 copy-to-global 固定 0）：`v2=&op1; v5=ENC(op2); n=op3; memset32(v2,v5,n)`。handler=sub_430CF0（raw .c 40206） |

> 上表「已核对」的算术/比较/random 依据 `docs/re/engine/03`；控制流（exit/ret/exit-script/call/call-script/jmp）依据本轮读 `raw .c` handler + `docs/re/engine/08`；`jcc` 依据 `docs/re/engine/02`；`lea(0x63)`/`set-string(0x192)`/`concat(0x193)` 依据本轮直接读 `raw .c` handler 体（各见同行行号）。

---

## 补充项：已核对语义（读 handler 体）的引擎内部/子系统 opcode

> 这些无具名助记符（`uXXXX`/数字名），但**本轮已读 handler 体确认**其行为：皆属**引擎内部状态 / AGE 消息窗口系统 / 配置 setter**，只写引擎内部字段（`_this[offset]`）或调用子系统对象方法（`_this+21324` / `_this+174405`），**不读/写 VM 可见状态**（全局数组、脚本帧、IP、cur），不影响控制流 → 对"到 TITLE"路径良性，模拟器可"插桩跳过"（见 `app/amayui-emulator/docs/06 §2.2`）。**这些是 `【已核对】`**（非推测）。

| opcode | name | handler（raw .c 行） | 已核对语义 |
|---|---|---|---|
| 0x2F6 | 2F6 | sub_426820（.c 33219） | 读 op1 → 引擎内部按索引初始化槽（`_this[v2+21315/21318/122505/122508]`清零 + `sub_404CB0`） |
| 0x2F8 | 2F8 | sub_4268D0（.c 33245） | 读 op1/op2 → `sub_4B6940(v2+12,v4)`（子系统对象方法） |
| 0x149 | u0041FCE0 | sub_4229A0（.c 30687） | `_this[97058]=op1`（config setter） |
| 0x88 | u0041B290 | sub_41FAB0（.c 28686） | `_this[1415]/[97050]=op1` + flag |
| 0x21B | u004213E0 | sub_423C20（.c 31433） | `_this[166965]=(op1!=0)` |
| 0x1CA | u0041B9B0 | sub_420240（.c 29019） | config `set-message-read-texture`（调 `config->vtable+12`） |
| 0x252 | u00423000 | sub_425AB0（.c 32631） | `_this[92323]=op1` |
| 0x324 | u0043AA60 | sub_41A470（.c 25205） | `sub_453530(_this[93384])`（arity 1，子系统） |
| 0x32F | u0043AB11 | sub_4272B0（.c 33637） | `sub_49A150(_this+80708,op1)` |
| 0x70 | u0041A750 | sub_41ED20（.c 28141） | 消息系统 `sub_45D660(_this+21324,…)` |
| 0x71 | u0041A7B0 | sub_41ED80（.c 28158） | 消息系统 + 缓冲拷贝 |
| 0x73 | u0041AB30 | sub_41F250（.c 28338） | 消息系统 |
| 0x78 | u0041AD00 | sub_41F450（.c 28417） | `_this[21667]=op1`; `sub_459F40()` |
| 0x79 | u0041AD30 | sub_41F490（.c 28427） | 消息系统 `sub_4563A0(_this+21324,…)` |
| 0x1C1 | u0041B820 | sub_420070（.c 28953） | 消息系统 `sub_4563D0(_this+21324,…)` |
| 0x212 | u00421090 | sub_423A30（.c 31357） | 消息部件 `_this[result+21585]+100=op2` |
| 0x213 | u004210D0 | sub_423A80（.c 31372） | 消息部件 `_this[result+21585]+104/108=op3/op2` |
| 0x25D | u00423123 | sub_425EF0（.c 32811） | 消息部件 `_this[result+21585]+276/280` |
| 0x2DB | u004235C0 | sub_426500（.c 33073） | `_this[71744]=op1`; `sub_459F40()` |
| 0x303 | 303 | sub_426A90（.c 33314） | 消息系统 `sub_456600(_this+21324,…)` |
| 0x1A2 | u00428010 | sub_434F60（.c 42215） | 写内部字符串查找表 `_this+5452` |
| 0x1A9 | u00428090 | sub_434FE0（.c 42229） | 写内部字符串查找表 `_this+5472` |

> ⚠️ 诚实边界：上表**handler 行为已读体核对**，但"归类为引擎内部/子系统、对 VM 可见状态无影响"这一**判断本身是工作假设**——因为 `_this[offset]` 的长偏移字段语义尚未逐一定义到语义名。若后续发现某 offset 实为全局/脚本字段，需**升级为 VM 核心**改精确实现。这是 ADR-010 的高危信号提醒。

---

## 回退默认 `sub_418E30` 的 opcode（age-shared 已定义，但本引擎未实现）

> 这些条目在 dispatch 表数组里**没有被覆盖**（`rep stosd` 填充后保持默认 `sub_418E30`）。从 age-shared 注释看，它们多是**引擎家族其它作品**（Amayui 2 / Alchemy / Fuukan / Tenmei / Sankai / La Dea / Kami no Rhapsody / Hyakusen / Tenmei no Conquista 等）的专属 opcode，本引擎（天結)未实现。

| opcode | argc | 已知名称（age-shared） | 归属作品（age-shared 注释） |
|---|---|---|---|
| 0x262 | 1 | 262 | Amayui 2 |
| 0x263 | 1 | 263 | Amayui 2 |
| 0x264 | 5 | 264 | Hyakusen |
| 0x30C | 1 | 30C | Tenmei no Conquista |
| 0x353 | 2 | 353 | Fuukan no Gransesta |
| 0x354 | 2 | 354 | Fuukan no Gransesta |
| 0x358 | 5 | 358 | Amayui 2 |
| 0x35A | 5 | 35A | Amayui 2 |
| 0x35B | 2 | 35B | Fuukan no Gransesta |
| 0x35C | 2 | 35C | Fuukan no Gransesta |
| 0x35D | 3 | 35D | Fuukan no Gransesta |
| 0x35F | 3 | 35F | Fuukan no Gransesta |
| 0x360 | 3 | 360 | Fuukan no Gransesta |
| 0x361 | 2 | 361 | Fuukan no Gransesta |
| 0x363 | 3 | 363 | Amayui 2 |
| 0x364 | 3 | 364 | Amayui 2 |
| 0x384 | 3 | 384 | Tenmei no Conquista |
| 0x386 | 11 | 386 | Tenmei no Conquista |
| 0x387 | 8 | 387 | Tenmei no Conquista |
| 0x388 | 3 | 388 | Tenmei no Conquista |
| 0x389 | 6 | 389 | Tenmei no Conquista |
| 0x38F | 6 | 38F | Tenmei no Conquista |
| 0x390 | 7 | 390 | Tenmei no Conquista |
| 0x391 | 2 | 391 | Amayui 2 |
| 0x392 | 1 | 392 | Tenmei no Conquista |
| 0x393 | 6 | 393 | Amayui 2 |
| 0x396 | 5 | 396 | Tenmei no Conquista |
| 0x398 | 3 | 398 | Amayui 2 |
| 0x399 | 7 | 399 | Tenmei no Conquista |
| 0x39B | 5 | 39B | Amayui 2 |

