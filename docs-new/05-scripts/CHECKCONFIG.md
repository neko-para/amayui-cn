---
kind: generated
state: live
home: analysis/scripts.json
generated_by: scripts/build-scripts.mjs
---

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
- ★本函数的调用时机决定用哪个 `14acda`：`SYSTEM4.txt:84` 的 `call-script 51db` 在 SYSTEM4 的**读档续跑 preamble 之内** ⇒ 读档时也会跑一遍，而那一刻 `14acda` 还是**上一场景**遗留的值（池外全局 `0x14ACDA` = 1,356,506 > int 池长 1,015,792 ⇒ 读档不还原），页面脚本要到自己的页前导才改写它 ⇒ 读档后第一页的颜色＝上一场景最后那个说话人的颜色（`T-0187` ② 的机制）
- ★adcd / 14acda 的角色（T-0187 复核 2026-09-26 订正）：adcd 是**池内数组起始下标常量**（全库 0 处赋值，只作 lookup-array 的数组操作数 = 0xADCD），14acda 才是**索引变量**（脚本反复 mov 0/1/2/3）⇒ 读法 = pool[0xADCD + pool[0x14ACDA]]；**填色被覆盖的充要条件 = (a9dd & 3) == 0 且 adcd[14acda] > 0**（&1 走 f807c、&2 走 f807b，两位都在 &3 != 0 时被跳过）⇒ 出厂 a9dd = 2 时这条把填色**钉成白**。
- ★★上一条 gotcha 的「充要条件」**方向写反了，以本条为准**（T-0187 第二轮实测 2026-09-26，见 tickets/T-0187/recheck.md §5）：本项目 `jcc v mask label` = **v == 0 才跳**，按该极性重读 :50-64 —— `a9dd&3 != 0` 时 :51 **不跳**、`:56`（`a9dd&1 == 0`）**跳**（跳过 f807c）、`:62`（`a9dd&2 != 0`）**不跳** ⇒ **:63-64 执行**。所以充要条件是 **`(a9dd & 2) != 0 且 adcd[14acda] > 0` ⇒ `f807b = adcd[14acda]`（填充随当前说话人）**；`a9dd = 2`（真机与实例实测值）**正好命中这一支**，不是「钉成白」。实测指纹（实例 t0187b、游戏内 load 78）：`f807b = 0xFFE100`（阿瓦罗黄）、`f807c = 0`、`f8079 = 3`、`f807a = 1`、`a9de = 1`、`14acda = 0`（重放后）、`adcd = 0xFFFFFF`。★由此定位 ② 的真因：`src/CALLBACK_LOAD.txt:197-227` 在读档时**重算 global 14acda（当前说话人）**，随后 CHECKCONFIG 用它取色 ⇒ 白的/黄的分歧出在 `14acda` 的取值，不在 `sub_45F1B0` 的文本记录。

## 相关

- 引擎常态能力：`save-data-tables-persistence`（见 `docs-new/03-engine/engine-capabilities.md`）
- 引擎常态能力：`text-style-scope-queue-time`（见 `docs-new/03-engine/engine-capabilities.md`）
- 引擎常态能力：`adv-text-color-state-carryover`（见 `docs-new/03-engine/engine-capabilities.md`）
- 函数结论：`0x430DF0`（见 `analysis/functions.json`）
- 函数结论：`0x423390`（见 `analysis/functions.json`）
- 主题文档：`docs-new/03-engine/save-data.md`
- 主题文档：`docs-new/03-engine/adv-text-rendering.md`
- 守卫测试：`app/amayui-emulator/test/save-data.test.ts`

## 证据与备注

- 证据：src/CHECKCONFIG.txt（全文 57 行）；E3：test/save-data.test.ts 的「真语料启动链」断言 bbc 被回退为「ＭＳ ゴシック」
- 备注：本条目聚焦"设置自检"；颜色派生的细节与 CONFIG2 的 label_00007178 同源（在 CONFIG2 条目里有登记）。
