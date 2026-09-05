# 00-overview · 工程定位与现状

## 1. 这是什么

一套围绕《天結いキャッスルマイスター》（Eushully，2017-05-26，AGE/System4 引擎，v1.07 + AP01-05）
的**自研工具链仓库**，分四大方向：

| 方向 | 目标 | 主体 |
|---|---|---|
| ① 游戏汉化 | 重制简体中文补丁（方案 B：改数据文件） | `data/`（基线）、`src/`（真值）、`res/`、`scripts/`、`tools/`、`patch/` |
| ② 游戏数据分析 | 反向业务数据/静态表结构 | `30`（业务数据文档）、`app/amayui-inspector`、`app/amayui-toolkit`、`scripts/` 提取、`output/` |
| ③ 游戏引擎分析 | 反向 AGE 引擎 VM/字节码/机制 | `engine/`（反编译 C）、`docs-new/03-engine/` |
| ④ app 工具 | 三个可运行子工程 | `app/amayui-emulator`、`app/amayui-inspector`、`app/amayui-toolkit` |

## 2. 现状（已达成）

- **汉化已收官**：需翻译文件 465 中已译 453；剩余 12 为系统/杂项+追加包。译文以 `src/*.txt` 为真值，后续仅持续校对。
- **引擎重写**：`app/amayui-emulator` 解释器已从 `SYSTEM4(0)` 跑到 `TITLE.BIN`；`npm test` 12/12；Electron+PixiJS 渲染壳已接通、标题真实图像已接入。
- **数据**：业务数据结构（掉落/技能/物品/地图/单位）已摸清；`app/amayui-toolkit` 产出统一 `metadata.json`（items=923、buildings=113、recipes=458、units=373、skills=450 等）。
- **进程查看器**：`app/amayui-inspector` 可定位 `this`、DEC 校验、快照全局/脚本帧。

## 3. 关键边界

- **引擎机制（`docs-new/03-engine`）**：VM/opcode 分发/`this` 布局/资源加载/渲染。引擎是**通用解释器**，不含单位/掉落/技能等业务语义。
- **业务数据（`docs-new/02-data`）**：脚本字节码/静态表里的业务字段。其地址是**业务域常量**，**与引擎内部无必然联系**；除非有确切证据（进程内实测读取 + 与脚本语义互证），**不把两者混同**。

## 4. 术语约定

见 `docs-new/README.md` §3 术语速览。全库统一使用「方案 B」「src 真值」「Amayui CN（Sarasa 基底）」「业务数据/引擎机制」等固定措辞。
