# 脚本台账 · `SYSTEM4`

> 由 `analysis/scripts.json` 生成（`node scripts/build-scripts.mjs`）—— **勿手改本文件**。

| 项 | 值 |
|---|---|
| 脚本 | `SYSTEM4.BIN`（真源 `src/SYSTEM4.txt`） |
| 状态 | 🟠 部分 |
| 是什么 | 引擎最先执行的脚本（统一文件 id 0）：初始化引擎字段/消息窗，再逐级 call-script 数据表 INIT 脚本，最后进 LOGO/TITLE。 |
| 怎么进/出 | 启动时由引擎直接装载 index 0（`loadScriptData`）；本脚本自己再 call-script 其它脚本。 |

## 结构（读了哪些段）

| 行区间 | 锚点（必须出现在该区间内） | 职责 |
|---|---|---|
| `28-42` | `i071 8` | 启动即逐个 i071 1..8（清/开 8 个消息窗） |
| `40-44` | `i073 1 37a 6e c 0 0 23 23 a 64` | 窗 1 的字格设置（0x73 的 10 个操作数：格尺寸/格数/节拍 0x64=100ms）——引擎『逐字显现』的入口 |
| `120-130` | `i075 1e` | 全局主字号 30（0x75） |

## 关键槽 / 局部量

| 名字 | 含义 |
|---|---|
| `win 1..8` | 启动阶段批量清场的消息窗 |

## 坑（踩过一次，别再踩）

- 全库只有 27 处 `i073`（SYSTEM4.txt:41、NOVEL.txt:11/265、SN0000 各页）⇒ 只有序章/NOVEL/SYSTEM4 走引擎的『字格逐字』路径

## 相关

- 引擎常态能力：`msgwin-char-reveal-grid`（见 `docs-new/03-engine/engine-capabilities.md`）
- 引擎常态能力：`adv-perframe-dispatch`（见 `docs-new/03-engine/engine-capabilities.md`）
- 函数结论：`0x41F250`（见 `analysis/functions.json`）
- 函数结论：`0x45A940`（见 `analysis/functions.json`）
- 主题文档：`docs-new/03-engine/adv-text-rendering.md`

## 证据与备注

- 证据：src/SYSTEM4.txt:28-44 / 120-130；0x73 语义见台账 msgwin-char-reveal-grid
- 备注：只登记了启动段与字格入口；初始化字段/INIT 调用链未逐段读。
