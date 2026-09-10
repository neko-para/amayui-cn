# 03-engine · 加壳拆壳与反汇编管线

> 本方向只讲**引擎内部机制**。游戏业务数据（掉落/技能/物品/地图及其地址）属**业务数据域**，见 `../02-data/`；两者严格解耦。

## 1. 引擎本体与素材

AGE/System4 是 Eushully 自研引擎，**是通用解释器**，本身**不含任何单位/掉落/技能字段语义**——字段语义全在脚本字节码（业务域）。

| 素材 | 作用 |
|---|---|
| `raw/AGE.EXE` | 原版引擎（1,007,104 B，ASProtect 加壳） |
| `raw/天结.exe` | 心愿屋汉化壳（同壳 + 18.9MB 加密 overlay；方案 B 弃用） |
| `raw/天结_unpacked.exe` | **已脱壳干净版**（1,746,944 B）—— 分析主对象 |
| `engine/天结_unpacked.exe_utf8.c` | Hex-Rays 全量反编译 C（UTF-8，**主力**） |
| `engine/天结_unpacked.exe_utf8.lst` | IDA 清单（含数据区） |
| `engine/engine.hpp` | `this` 对象模型（`struct Engine` C++ 布局，未知区 char 占位） |
| ~~`engine/engine.cpp`~~ | ⚠️ **已废弃**：`scripts/re/retarget.py` 重定型管线产物（libclang/AST 文本改写已放弃；分析结论以数据层 `analysis/*.json` + 原始基准 `_utf8.c` 为准） |
| `scripts/re/` | 反汇编→重定型管线（⚠️ 重定型部分已废弃） |

> ⚠️ 原始 `engine/天结_unpacked.exe.c` 为 Shift-JIS、`.lst` 为 Shift-JIS+GBK 混编，需读 `*_utf8.*` 版本。

## 2. 反汇编 → 重定型管线

| 步骤 | 脚本 | 产物 |
|---|---|---|
| 预处理 | `scripts/re/hexrays_prep.py` | `this`→`_this` 归一化 |
| 成员函数识别 | `scripts/re/detect_members.py` | 高偏移定位基准 + 调用图双向传播；清单 `member_functions.detected.txt`（1239 个） |
| 一键重定型 | `scripts/re/retarget.py` | ⚠️ **已废弃**——签名替换 + 字段标记 + 调用点 `this->` + 语义命名（`semantic_names.json`）→ `engine/engine.cpp` |

- `engine/engine.hpp` 把已确认偏移（`this+0x5D800` 全局数组、`this+0x5EC8C` key、`this+0xA509C` dispatch 表、`this+0x5D880` frames[40]（★曾误记 0x5D894）、`this+0x5D880/4/8/8C` 调用栈字段）落成 `struct Engine`。

## 3. 已确认/待确认

- ✅ 引擎是通用解释器、无业务语义；打包壳判定（ASProtect）、干净脱壳版可用。⚠️ **重定型管线**（`scripts/re/retarget.py`→`engine/engine.cpp`）**已废弃**（libclang/AST 文本改写放弃，改用数据层 `analysis/*.json` 方案）。
- 🟡 成员函数识别边界（高偏移基准 + 双向传播，1239 个）需抽查复核（⚠️ 属已废弃的重定型管线诊断）。
- ⬜ 脱壳/重打包可行性评估（ASProtect 特征、IAT 重建、run+dump 权衡）。

## 4. 相关入口

- 引擎内部内存布局见 `./runtime-memory.md`；资源加载（统一文件 id/启动链/纹理）见 `./resource-loading.md`；渲染见 `./rendering.md`。
- 接入说明：`app/amayui-emulator`（TS 重写 VM）见 `../04-app/emulator.md`。
