# scripts/re —— 逆向分析脚本

本目录是《天結いキャッスルマイスター》汉化工程的**逆向分析脚本**（针对引擎反汇编 / 脚本字节码）。

| 脚本 | 作用 |
|---|---|
| `structured_cfg.js` | 把 `src/*.txt` 反汇编脚本还原为**结构伪代码**（`if/else/while`、缩进制表、无括号风格、两步骤条件）。详见 `../../docs/re/src/12-脚本控制流结构化与伪代码.md` |
| `structured-cfg-reflow.js` | **驱动脚本**：对 `src/*.txt` 并发跑 `structured_cfg.js`，输出到 `src-reflow/`。**并行** = 默认 `os.cpus()/2`（`--jobs N` 覆盖）；**默认跳过 SC/SP 家族**（SG* 及其它保留），`--sc-sp`/`--all` 才处理 SC/SP |
| `retarget.py` / `retype.py` / `sanitize_symbols.py` | 引擎 `engine/*_utf8.c` 重定型（成员函数化、语义命名），见 `re/engine/11-重定型管线与产物.md` |
| `detect_members.py` | 识别操作 Engine 的成员函数，见 `re/engine/10-成员函数识别.md` |
| `hexrays_prep.py` | libclang 解析 Hex-Rays 输出预处理，见 `re/engine/09-clang解析与重定型基座.md` |

### 过桩型导入 / 解壳（运行态读取，同用户免提权）

> 针对带壳 `AGE.EXE` 的「过桩型」导入调用与解壳评估。全部只用 `OpenProcess(0x0400|0x0010)+ReadProcessMemory`（**不**用 SeDebugPrivilege、不附加调试器）。详见 `../../docs/re/engine/14-过桩型桩实现与静态反解.md`。

| 脚本 | 作用 |
|---|---|
| `probe_proc.py` | 验证同用户读权限、列模块/引擎头 |
| `engread.py` | dump 引擎镜像 + 节表（`--live <pid>` 之外用于生成 `.tmp/engine_image.bin` |
| `rawread.py` | 任意 VA 读 + 十六进制/落文件 |
| `memmap.py` | `VirtualQueryEx` 内存区枚举（protect/type） |
| `rdglobals.py` | 读 dword 全局并沿指针链 |
| `scan_stub_targets.py` | 扫 `.text` `call rel32` 目标，定位共享桩 |
| `collect_call_sites.py` | 列出全部 `call→桩` 站点 |
| `map_all_stubs.py` | **核心**：无漂移对齐 + poly thunk→IAT槽→导入目录，输出每站点真实导入 |
| `emit_mapping.py` | 汇总 CSV/JSON + 与 `13`§3 missing 清单交叉核对 |
| `poly_provenance.py` | 对比 `__dumped` vs `天结_unpacked` 的 poly 节/调用形态（二者是同壳的不同拆壳产物） |
| `provenance_check.py` | 运行态 vs `__dumped` vs `天结` 同址对比 |
| `unpack_health.py` | 解壳健康评估（EP/导入/熵/节权限/overlay） |
| `tool_independence.py` | 验证 trampoline 是路由产物：两拆壳工具可达导入集合一致（260=260），差异只在路由/命名别名 |

> 注意：`map_all_stubs.py` / `provenance_check.py` 需**目标进程存活**且传入正确 `<pid>`（桩地址随启动动态分配，用 `scan_stub_targets.py --live <pid>` 先定位）。`poly_provenance.py` / `unpack_health.py` / `tool_independence.py` 只读文件，无需进程。


> 快速使用：`cd scripts && npm run struct -- "src/\$1\$AMINIT.txt"`，或批量 `npm run struct -- --dir src --out .tmp/struct`。
