# scripts/alf —— unpack_alf 的 Node 移植

`tools/alf/unpack_alf/unpack_alf.cpp`（源自 asmodean exs4alf，Xuan/FPE 修改）的跨平台 Node 重写，
仅依赖 Node 标准库，无第三方包。可用于 macOS/Linux 直接解包，无需 Wine / Windows CRT。

## 用法

```bash
# 显式指定索引文件（在含 SYS?INI.BIN 与 *.ALF 的目录下运行）
node scripts/alf/unpack_alf.mjs   SYS4INI.BIN
node scripts/alf/unpack_alf.mjs   SYS5INI.BIN
node scripts/alf/unpack_alf.mjs   APPEND01.AAI

# 无参数：自动检测 SYS3INI.BIN / sys4ini.bin / SYS5INI.bin / APPEND01..20.AAI
node scripts/alf/unpack_alf.mjs

# 输出到指定根目录（归档 *.ALF 按“索引所在目录”解析，可从任意位置调用）
node scripts/alf/unpack_alf.mjs   --out raw-parts  raw/SYS4INI.BIN
node scripts/alf/unpack_alf.mjs   --out raw-parts  raw/APPEND01.AAI
```

解包结果写到 `--out 目录/<归档名前缀>/`（`get_file_prefix` 去扩展名所得目录名），
每个目录内是原始拷贝的文件内容，与原版行为一致。

## 文件对照（便于排查/更新）

| 本目录 | C 源 | 说明 |
|---|---|---|
| `lzss.mjs` | `tools/alf/lzss/lzss.cpp` | 只移植了解压方向 `unlzss`/`lzss_read`。压缩方向（`lzss`/`lzss_write` 等）本工具未用到，未移植。 |
| `unpack_alf.mjs` | `tools/alf/unpack_alf/unpack_alf.cpp` | 主流程，结构逐段对齐 C 源码。 |

`unpack_alf.mjs` 保留了 C 的：

- 结构体名与字段布局（`S4HDR`/`S5HDR`/`S4SECTHDR`/`S4TOCARCHDR`/`S4TOCARCENTRY`/`S4TOCFILENTRY` 等），
  以**尺寸常量** + 偏移读取的形式呈现，并保留 `archdr + 1` 等指针算术的注释。
- 函数名与职责：`get_file_prefix` / `read_header` / `read_sect` / `main`。
- 双分支结构：`unicode_alf ? (S5 系) : (S4 系)`。
- addon 偏移魔数：S4AC→`268`，S5AC→`532`。
- `Unpacking: [i/N] name` 的 `\r` + 空格清行进度，以及结尾 `Unpacking done!`。
- `lzssdata.bin` / `lzssdata2.bin` 调试写档逻辑（见下方差异 6）。

## 与原版的有意差异

1. **磁盘字段用定宽类型**：整型一律按 `uint32`(4B)、宽字符按 UTF-16LE(2B) 读取，
   不再依赖平台原生 `unsigned long`(Linux=8B) / `wchar_t`(Linux=4B)，因此 64 位 Linux/macOS
   与 Windows 的磁盘布局完全一致。
2. **头类型检测**用字节字面量 `Buffer.from('S5IC','utf16le')` 替代 `L"S5IC"` 的 `memcmp`，
   规避跨平台 `wchar_t` 宽度差异。
3. **文件 I/O** 用 `node:fs`（`readSync`(按位置)/`writeSync`/`mkdirSync`/`accessSync`）替代
   Windows CRT（`_read/_open/_lseek/_wopen/_mkdir/PathFileExistsA/...`），无需 `_O_BINARY`/`_S_IREAD`。
4. **S5 宽文件名**：解码 UTF-16LE → JS 字符串；**S4 单字节名**：按 `latin1` 逐字节解码。
   路径统一经 Node 编码为 UTF-8 打开。
   ⚠ 注意：S4 若含非 ASCII（如 SJIS）或 S5 文件名与磁盘上的实际编码不一致时，需另行转换，
   本移植默认按 UTF-8 处理。
5. **修复原版 bug**：原版在写出文件后误写 `if (fd == -1)`（应为 `out_fd`），本移植未复现该错误。
6. **`DEBUG_DUMP`（默认 `false`）**：原版会在每次解包时于 CWD 写 `lzssdata.bin`/`lzssdata2.bin`
   调试文件；设 `true` 可复现该行为。
7. **进度输出**：`\r`+空格清行逻辑照搬；非 TTY 管道下会呈现为字面字符（与原版相同）。
8. **截断/非法索引文件**：Node 会在 `Buffer` 越界时抛 `RangeError`，而 C 是未定义行为（读垃圾）。
   本工具面向合法游戏文件，未做结构性校验。

## 验证

开发期用合成 S4/S4AC/S5/S5AC 目录 fixture 验证了：

- `unlzss` 字面量 + 匹配分支往返一致；
- S4(S4IC)、S4AC(addon@268)、S5(S5IC)、S5AC(addon@532) 全流程；
- 无参自动检测（`SYS4INI.BIN` / `APPEND??.AAI`）；
- 含日文的 UTF-16LE 文件名。

用**真实游戏文件**验证：把 `SYS4INI.BIN`（及相关 `*.ALF`）放到一个目录，`cd` 进去运行
`node /path/to/scripts/alf/unpack_alf.mjs SYS4INI.BIN`，与 Windows 版 `unpack_alf.exe` 产出逐字节比对。
