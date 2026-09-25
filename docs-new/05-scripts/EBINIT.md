---
kind: generated
state: live
home: analysis/scripts.json
generated_by: scripts/build-scripts.mjs
---

# 脚本台账 · `EBINIT`

> 由 `analysis/scripts.json` 生成（`node scripts/build-scripts.mjs`）—— **勿手改本文件**。

| 项 | 值 |
|---|---|
| 脚本 | `EBINIT.BIN`（真源 `src/EBINIT.txt`） |
| 状态 | 🟠 部分 |
| 是什么 | **两张「角色号 → L2D 资产」统一文件 id 表的唯一写入方**：`global-int 527d8c + 3c` = 角色 c 的 `.MOC` 文件 id、`global-int 528944 + 3c` = 同一个角色的 `.MTN` 文件 id（c = 1-based 角色号）。逐角色用**字面 token** 写，不是循环、不是表装载。 |
| 怎么进/出 | boot 链里的**本体数据表总初始化**之一（`src/INIT2.txt` 那 40 张 INIT 表族的一员，与 `CVINIT`/`SETFATE` 同级）；本体 `EBINIT.BIN` 之外还有 `$1$`..`$5$EBINIT.BIN` 五个扩展包变体，六份合起来把角色号 1..998 写满。 |

## 结构（读了哪些段）

| 行区间 | 锚点（必须出现在该区间内） | 职责 |
|---|---|---|
| `115-117` | `mov (global-int 527d8f) 4087` | ★**角色 1 的 MOC 列**：`0x527d8c + 3*1 = 0x527d8f` ← 统一文件 id `0x4087` = `BM001A.MOC`；下一行的 `0x527d90` 再写一次同一个值（同角色的其它形态位） |
| `115-118` | `mov (global-int 528947) 4088` | ★**角色 1 的 MTN 列**：`0x528944 + 3*1 = 0x528947` ← `0x4088` = `BM001A.MTN`（与 MOC 同行成对；两张表基址相差 `0xBB8 = 250*3*4` 字节） |
| `224-227` | `mov (global-int 527d92) 40b3` | 角色 2：`0x527d8c + 3*2 = 0x527d92` ← `0x40b3` = `BM002A.MOC`，紧邻的 `52894a` ← `0x40b4` = `BM002A.MTN` ⇒ **行距 3 dword 的口径在第二行即成立** |

## 关键槽 / 局部量

| 名字 | 含义 |
|---|---|
| `527d8c + 3c` | **输出**：角色 c 的 `.MOC` 统一文件 id（1-based；c ∈ 1..998） |
| `528944 + 3c` | **输出**：角色 c 的 `.MTN` 统一文件 id（同 c、同行、同列） |

## 不变量（拿它做回归断言）

- 每一行的第 0 列是 MOC、第 1 列是 MTN，第 2 列无写点（保留）——两张表各只写一列，行距恒为 3 dword
- MOC 列与 MTN 列**同角色同基名成对**（344/344：`BM###A.MOC` ↔ `BM###A.MTN`）⇒ 表的语义是「角色 → 一对模型/动作」

## 坑（踩过一次，别再踩）

- ★**表基址 token 本身没有任何写点**（`grep '(global-int 527d8c)'` 全语料 0 处）—— 写者只写「基址 + 3c」那一格。⇒ 用「基址 token 有没有被写」判断表有没有数据会得到**假否**，本票踩过这个坑
- 写入覆盖只有角色号 **1..998**；超出这个范围的 idx（例如 INFOEN 角色页实际走到的 `0x13c7 = 5063`）读出来恒为 0 ⇒ 调用方走静态贴图回落，这是数据事实、不是缺陷
- 六份脚本按包覆盖同一区间：`$n$EBINIT` 会重写本体已写的角色（`$n$` 优先），后跑的包生效；`EBINIT` 侧写点最多（235/344）

## 缺口

- `$n$EBINIT.txt` 的**包内覆盖顺序**（本体与五个包的先后、冲突时谁生效）未逐条核对；本票只证明六份合起来把 1..998 写满
- 第 1/2 列（每行的另两格）在本体侧无写点，是否有包或引擎会填未查

## 相关

- 主题文档：`docs-new/02-data/character-l2d-tables.md`
- 主题文档：`docs-new/03-engine/live2d.md`
- 守卫测试：`app/amayui-emulator/test/t0107-l2d-asset-id-table.test.ts`
- 守卫测试：`app/amayui-emulator/test/t0107-infoen-real-id.test.ts`

## 证据与备注

- 证据：src/EBINIT.txt:115-116（角色 1 的 MOC/MTN 两列逐字）；段锚点 src/EBINIT.txt:224-225（角色 2）；全表扫（6 份脚本）得 344 角色 / 1..998；消费端 src/INFOEN.txt:1568/1590、src/BTL.txt:1610-2757（10 处、全部 `3 0`）
- 备注：只登记「它是这两张表的写入方 + 行距/口径 + 覆盖范围」；其余 1.9 万行里别的全局表（`52xxxx` 段另有 9888 处写点，多为 `AGF`/`OGG`/`BIN` 资源表）未读。
