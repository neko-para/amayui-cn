# 脚本台账 · `CHECKCONFIG`

> 由 `analysis/scripts.json` 生成（`node scripts/build-scripts.mjs`）—— **勿手改本文件**。

| 项 | 值 |
|---|---|
| 脚本 | `CHECKCONFIG.BIN`（真源 `src/CHECKCONFIG.txt`） |
| 状态 | ✅ 已分析 |
| 是什么 | **设置的自检与修复**：校验 5 个字体面名是否还装得上（`0x2DE` 字体名→下标），装不上就回退默认并重新 `save-string`；末尾按 a9dd/a9de 组合出文本颜色/描边并应用（0x76/0x77/0x78/0x1A4）。 |
| 怎么进/出 | SYSTEM4 两条分支汇合后的 `call-script 51db`（SYSTEM4.txt:84）；CONFIG1/CONFIG2 装载/初始化后也调用（CONFIG1.txt:907/944、CONFIG2.txt:859）。 |

## 结构（读了哪些段）

| 行区间 | 锚点（必须出现在该区间内） | 职责 |
|---|---|---|
| `5-12` | `i2de (local-int 0) (global-string bbb)` | bbb 校验：0x2DE 字体名→下标；< 0 ⇒ 回退「ＭＳ 明朝」并 save-string |
| `13-19` | `i2de (local-int 0) (global-string bbc)` | bbc 同上（回退「ＭＳ ゴシック」） |
| `20-26` | `i2de (local-int 0) (global-string bbd)` | bbd 同上（回退「ＭＳ ゴシック」） |
| `27-33` | `i2de (local-int 0) (global-string bbf)` | bbf 同上（回退「ＭＳ 明朝」） |
| `34-39` | `i2de (local-int 0) (global-string bbe)` | bbe 同上（回退「ＭＳ ゴシック」） |
| `40-51` | `label_00000258` | 收尾：call label_0000028c（派生文本色/描边）+ mov (global 3f36) 0 + i2ee fa + exit |
| `52-82` | `lookup-array (local-ptr 0) (global-int adcd) (global-int 14acda)` | 按 a9dd 位 1/2 从角色配色表 adcd[当前项] 取描边色/填充色 → 写 f807c/f807b；按 a9de 选描边档位（3/1）与偏移（1/0）；最后 i076/i077/i078/i1a4 应用 |

## 关键槽 / 局部量

| 名字 | 含义 |
|---|---|
| `global a9dd / a9de` | 「按角色变更描边色/文字色」的开关位 + 描边档位选择 |
| `global a9dc` | 另一个开关位（真存档里 = 1） |
| `global f807b / f807c / f8079 / f807a` | → i076 填充色 / i077 描边色 / i078 描边档位 / i1a4 偏移 的中转 |

## 不变量（拿它做回归断言）

- 存档里的字体名若在本机装不上，启动后必然被改成默认串（并重新 save-string）—— 真语料断言见 test/save-data.test.ts 的 E3
- 全局文本样式（i076/i077/i078/i1a4）是**全局**的：本脚本只负责把它推到与当前设置一致（作用域见引擎台账 text-style-scope-queue-time）

## 坑（踩过一次，别再踩）

- `i2de`(0x2DE) 是**字体名→字体表下标**（不是字符串资源 id）：映射错会让所有字体判定恒为 -1 ⇒ 每次启动都回退默认面名
- **load-string 没命中的结果是空串**（引擎读侧 LOBYTE(dword_55D0FC)=0 后返回空串；emulator 同为 ?? ''）⇒ i2de('') = -1 ⇒ 本脚本把该槽改成默认面名并重新 save-string。所以「某个字体项自己变回默认」既可能是字体真没装上，也可能是**存档里那条记录根本没读到**：字符串记录区起点算错 4 字节就会静默丢掉最后一条，而真存档里最后一条恰是 bbf（CONFIG 第 3 行）——见 docs-new/03-engine/save-data.md §3

## 相关

- 引擎常态能力：`save-data-tables-persistence`（见 `docs-new/03-engine/engine-capabilities.md`）
- 引擎常态能力：`text-style-scope-queue-time`（见 `docs-new/03-engine/engine-capabilities.md`）
- 函数结论：`0x430DF0`（见 `analysis/functions.json`）
- 函数结论：`0x423390`（见 `analysis/functions.json`）
- 主题文档：`docs-new/03-engine/save-data.md`
- 主题文档：`docs-new/03-engine/adv-text-rendering.md`
- 守卫测试：`app/amayui-emulator/test/save-data.test.ts`

## 证据与备注

- 证据：src/CHECKCONFIG.txt（全文 57 行）；E3：test/save-data.test.ts 的「真语料启动链」断言 bbc 被回退为「ＭＳ ゴシック」
- 备注：本条目聚焦"设置自检"；颜色派生的细节与 CONFIG2 的 label_00007178 同源（在 CONFIG2 条目里有登记）。
