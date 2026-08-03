# tools 工具集

天結いキャッスルマイスター 方案 B（改数据文件重制补丁）工具链。

| 工具 | 来源 | 版本 | 状态 | 用途 |
|------|------|------|------|------|
| `alf\unpack_alf.exe` | foxofice/alf（源自 asmodean exs4alf） | 8a70066 (2025-09-26) | 已编译可用（已移除 getchar 阻塞） | 解包 `SYS4INI.BIN`+`DATA*.ALF`、`APPEND*.AAI` |
| `alf\packdata`（源码） | 同上（战Z中文项目） | 同上 | 源码，需按天結い适配 | 修改文件重打包进 ALF 并重建索引 |
| `eushully-decompiler\Decompiler\Decompiler.exe` | Kelebek1/Eushully-Decompiler | 21da1e8 (2024-08-30) | 已编译可用 | AGE 脚本反汇编(`-d`)/重汇编(`-a`)/往返校验(`-x`) |
| `SExtractor\` | satan53x/SExtractor | 克隆时 HEAD | Python 3.9+ GUI 工具，依赖已按 requirements 安装 | 按正则从脚本提取/导入文本；可导出 UIF 的 JIS 替换配置与 `sjis_ext.bin`（tunnel 编码） |
| `UniversalInjectorFramework\` | AtomCrafty/UniversalInjectorFramework | 克隆时 HEAD | 源码（无 release，VS v143 工程，需编译） | 运行时注入：字体/编码/转区（中文显示方案） |

## 准备步骤

```bash
# SExtractor 依赖（Python 3.11，已装好则跳过）
python -m pip install -r tools/SExtractor/requirements.txt

# UIF 编译（VS2022 v143 工具集；本机是 VS18/v180，需要先重定向工程或用 vcvars64 手动编译）
```

## 常用命令

```bash
# 解包（在含 SYS4INI.BIN 的目录运行）
tools/alf/unpack_alf.exe SYS4INI.BIN

# 反汇编/重汇编/往返校验
tools/eushully-decompiler/Decompiler/Decompiler.exe -d SC0000.BIN SC0000.txt
tools/eushully-decompiler/Decompiler/Decompiler.exe -a SC0000.txt SC0000.BIN
tools/eushully-decompiler/Decompiler/Decompiler.exe -x SC0000.BIN
```

## 编译方式（如需要重新构建）

```bash
# Decompiler（MSVC，v143 工具集；本机如无 v143 可用 vcvars64 手动编译 4 个 cpp）
cd tools/eushully-decompiler && msbuild Decompiler.sln -p:Configuration=Release -p:Platform=x64

# unpack_alf（vcvars64 环境）
cd tools/alf && cl /O2 /EHsc unpack_alf/unpack_alf.cpp lzss/lzss.cpp /Fe:unpack_alf.exe /link Shlwapi.lib
```

## 注意

- `unpack_alf.exe` 解包时会在当前目录写入 `lzssdata.bin`/`lzssdata2.bin` 调试文件（可删除）。
- `unpack_alf.exe` 已移除源码中全部 `getchar()` 阻塞（原版为双击运行保留的暂停），可直接作为流水线工具使用。
- install 已是全量独立真拷贝（无硬链接），对 ALF 重打包直接在 install 内的 ALF 副本上进行即可，不会波及游戏本体。
- 若需改 AGF 内嵌文字图片：Eushully AGF 分 `ACGF` 头与无头两种格式，社区已有现成工具
  （ai2.moe「Eushully AGF图片处理工具」，作者以珊海王/天結い测试），不必自行逆向格式。
