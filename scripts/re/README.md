# scripts/re —— 逆向分析脚本

本目录是《天結いキャッスルマイスター》汉化工程的**逆向分析脚本**（针对引擎反汇编 / 脚本字节码）。

| 脚本 | 作用 |
|---|---|
| `structured_cfg.js` | 把 `src/*.txt` 反汇编脚本还原为**结构伪代码**（`if/else/while`、缩进制表、无括号风格、两步骤条件）。详见 `../../docs/re/src/12-脚本控制流结构化与伪代码.md` |
| `structured-cfg-reflow.js` | **驱动脚本**：对 `src/*.txt` 并发跑 `structured_cfg.js`，输出到 `src-reflow/`。**并行** = 默认 `os.cpus()/2`（`--jobs N` 覆盖）；**默认跳过 SC/SP 家族**（SG* 及其它保留），`--sc-sp`/`--all` 才处理 SC/SP |
| `retarget.py` / `retype.py` / `sanitize_symbols.py` | 引擎 `engine/*_utf8.c` 重定型（成员函数化、语义命名），见 `re/engine/11-重定型管线与产物.md` |
| `detect_members.py` | 识别操作 Engine 的成员函数，见 `re/engine/10-成员函数识别.md` |
| `hexrays_prep.py` | libclang 解析 Hex-Rays 输出预处理，见 `re/engine/09-clang解析与重定型基座.md` |

> 快速使用：`cd scripts && npm run struct -- "src/\$1\$AMINIT.txt"`，或批量 `npm run struct -- --dir src --out .tmp/struct`。
