# scripts/asm —— age-asm（AGE 脚本反汇编/重汇编）的 Node 移植

`tools/eushully-decompiler/.../age-asm.exe` 的跨平台 Node 重写，仅依赖工程已有的
`iconv-lite`（与 `scripts/lib/sjis-encode.js` 同源），无 Windows CRT / Wine 依赖，
macOS / Linux 可直接反汇编、重汇编、往返校验。

## 为什么数据驱动（opcodes.json 取代编译期数组）

原版 age-asm.exe 的**指令集**（opcode → 名称 / 参数个数 `argc`）以 `consteval make_defs()`
数组编译进 C++ 二进制（`Decompiler/age-shared.cpp`）。新增/修正某个 opcode 后必须
重新 cmake 编译，且 Windows 产物对含日文/中文的路径参数支持不佳（ANSI 936）。

本移植把指令集抽到 **`opcodes.json`**，运行时加载：

- **更新指令集 = 改 `opcodes.json`，无需重编译**；
- `argc` 是唯一决定指令边界的字段，**必须以文档表为准**（十进制）；
- 名称（`name`）与别名（`aliases`）同时兼容两套助记符，`-a` 汇编可解析新旧任意写法，
  `-d` 反汇编输出的 `name` 与现有 `data/` `src/` 基线 txt 一致（骨架基线不漂移）。

`opcodes.json` 由 `build-opcodes.js` 从两份来源生成：

1. `docs-new/03-engine/opcode-table.md` —— 权威 544 已映射 opcode（opcode/argc/handler/状态）；
2. `tools/eushully-decompiler/Decompiler/age-shared.cpp` 的 `make_defs()` —— 旧描述性名称。

重新生成：

```bash
node scripts/asm/build-opcodes.js            # 覆盖写入 opcodes.json
node scripts/asm/build-opcodes.js --print    # 只打印统计
```

## 用法（与 age-asm.exe 一致，`-e` 可出现在任意位置）

```bash
# 反汇编 .BIN → .txt（输出 UTF-8）
node scripts/asm/cli.js -e sjis -d SC0000.BIN SC0000.txt

# 重汇编 .txt → .BIN
node scripts/asm/cli.js -e sjis -a SC0000.txt SC0000.BIN

# 往返校验（保留原文件，disassemble→assemble 后逐字节比对）
node scripts/asm/cli.js -e sjis -x SC0000.BIN

# 目录模式：处理目录下所有 .bin→.txt（-d）/ .txt→.BIN（-a），输出到 <outDir>（默认 decompiled/、compiled/）
node scripts/asm/cli.js -e sjis -d raw out-text
```

`-e` 码页：`932`(sjis, 默认) / `936`(gbk) / `65001`(utf8)。字符串按脚本码页存取，
`-d` 解码为 UTF-8 文本、`-a` 把 UTF-8 文本编码回脚本码页字节。

## 文件对照（便于排查/更新）

| 本目录 | C++ 源 | 说明 |
|---|---|---|
| `opcodes.json` | `age-shared.cpp` `make_defs()` + `docs-new/03-engine/opcode-table.md` | 指令集数据（主）+ 权威 opcode 表。**更新指令集改这里**。 |
| `build-opcodes.js` | — | 由上述两份来源重新生成 `opcodes.json`。 |
| `age-shared.mjs` | `age-shared.h/.cpp` | 头部结构、码页转换、指令表查找、操作数类型标签。 |
| `disassembler.mjs` | `disassembler.cpp` | BIN → 反汇编文本。 |
| `reassembler.mjs` | `reassembler.cpp` | 反汇编文本 → BIN。 |
| `cli.js` | `age-asm.cpp` | 命令入口（`-d` / `-a` / `-x` / `-e`，支持目录与往返校验）。 |

## 与原版的有意差异

1. **纯 Node 标准库 + `iconv-lite`**：跨平台，无需 Wine / Windows CRT / cmake 重编译。
2. **指令集数据驱动**：`opcodes.json` 运行时加载，改指令集不用重编译。
3. **路径不再受 ANSI 936 限制**：Node 以 UTF-8 处理路径，含日文/中文绝对路径可直接用，
   不需 `E:\Games\Eushully\wk` ASCII junction。
4. **码页转换**：CP932 用 `iconv-lite`，并**手工实现游戏外字区** `0xF040–0xF9FC ↔ U+E000–U+E757`
   的线性映射（`iconv-lite` 对尾部 `0xF9FC` 等解码有误），确保含外字的原文往返无损。
   CP936 沿用 C++ 对 `0x30FB/0xFA19/0x266A/0x246E` 的直接字节映射。
5. **省略多线程**：原版用 `NUM_THREADS` 并行处理多文件；Node 版单线程逐文件，方便打印与排查。

## 验证

- 对 `raw/SC0000.BIN` 反汇编，与工程基线 `data/SC0000.txt` **逐字节一致**（772339B / 31129 行）；
- 对 `raw/SC0000.BIN` 反汇编→重汇编，产出**与原始 BIN 逐字节一致**（511688B）；
- 对 20 个真实游戏 `.BIN` 批量往返，全部逐字节一致（唯一例外 `AGE.EXE__userdata.bin` 非 AGE 脚本）；
- `-x SC0000.BIN` 输出 `equal`。
