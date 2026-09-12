# 脚本台账 · `SETMEMOIR`

> 由 `analysis/scripts.json` 生成（`node scripts/build-scripts.mjs`）—— **勿手改本文件**。

| 项 | 值 |
|---|---|
| 脚本 | `SETMEMOIR.BIN`（真源 `src/SETMEMOIR.txt`） |
| 状态 | ✅ 已分析 |
| 是什么 | **回想界面的收集度计算表**（无画面）：用 `0x19D` 逐条查询 CG 表 / 场景表 / BGM 表的"是否已收集"，写出收集数、收集率与已收集下标表。ROOM 每次进入都 `call-script 524c` 调它。 |
| 怎么进/出 | ROOM.txt:68（进界面）与 `:412`（从 HMODE 返回）`call-script 524c`；本体 `exit` 返回。 |

## 结构（读了哪些段）

| 行区间 | 锚点（必须出现在该区间内） | 职责 |
|---|---|---|
| `6-15` | `fill-zero (global-int 10e3af)` | 清三张收集表：`10e3af`（BGM 版是 122731）、`121c2f`、`121f4f` 与三个计数器 |
| `21-68` | `i19d (local-int 1) (local-ptr 0)` | ★CG 循环（i=1..0xbb8=3000）：查 `107a0c[i][0]` 的收集状态 → `10e3af[页][槽] = i`（已收集）或 `-1`；`10e3ad` 收集数、`10e3ac` 收集率、`10e3ae` 总数 |
| `82-115` | `lt (local-int 6) (local-int 3) 28` | ★场景（シーン）循环：28 组 × 8 槽的 `122271` 表，逐条 `i19d` → `12251c[组][槽] = 1`、`12251a` 收集数、`122519` 收集率、`12251b` 总数 |
| `122-155` | `lt (local-int 6) (local-int 0) 64` | ★BGM 循环：`12265c[i]`（统一文件 id，MUINIT 填 1..64）→ `i19d` ⇒ 已收集的**下标 i** 依次写 `122731[122730]`，`12272f` 收集数、`122730` 总条目数、`12272e` 收集率（= `12272f*64/122730`） |

## 关键槽 / 局部量

| 名字 | 含义 |
|---|---|
| `global 12265c` | BGM 统一文件 id 表（1-based；MUINIT 写 12265d..） |
| `global 122731` | ★已收集的 BGM 下标表（**1-based**：[1] = 第一个已收集曲目在曲号表里的下标；[0] 恒 0 未用） |
| `global 12272f / 122730 / 12272e` | BGM 收集数 / 总条目数 / 收集率 |
| `global 10e3af / 10e3ad / 10e3ac` | CG 收集表（[页][槽] = 下标或 −1）/ 收集数 / 收集率 |
| `global 122271 / 12251c / 122519` | 场景收集源表 / 收集结果表 / 收集率 |

## 不变量（拿它做回归断言）

- `122731[0]` 恒 0（写从下标 1 起）⇒ 读收集列表要 `122731[1..12272f]`
- `i19d != 0`（已收集）才写表（脚本形如 `jcc (local-int 1) ffffffff label_…` ⇒ 假分支跳走 = 条件为 0 时跳过写入）

## 坑（踩过一次，别再踩）

- ★它是「回想」四个按钮上数字的**唯一来源**：`0x19D` 没实现 ⇒ 全部 0（2026-09 用户实测：BGM 鉴赏列表空白）
- 收集状态来自引擎的「已使用文件」表（按统一文件 id）——**不是**脚本自己记的 flag；所以"听过一次 BGM"就够（引擎在曲号解析时打开了文件）

## 缺口

- `10b4a4`/`109d34`/`10a8ec` 三张 CG 分页辅助表由哪个脚本填未查（本脚本只读）。

## 相关

- 引擎常态能力：`gallery-unlock-file-used-flags`（见 `docs-new/03-engine/engine-capabilities.md`）
- 函数结论：`0x42D8E0`（见 `analysis/functions.json`）
- 函数结论：`0x4181F0`（见 `analysis/functions.json`）
- 函数结论：`0x454960`（见 `analysis/functions.json`）
- 主题文档：`docs-new/03-engine/gallery-and-unlock-flags.md`
- 主题文档：`docs-new/03-engine/opcode-table.md`
- 守卫测试：`app/amayui-emulator/test/gallery-bgm-list.test.ts`

## 证据与备注

- 证据：src/SETMEMOIR.txt 全文 157 行实读；运行期断言见 test/gallery-bgm-list.test.ts 的 E3（122730=36 / 12272f≥1 / 122731[1]=2 / 12272e=2）
- 备注：BGM 段的三张表（id/曲号/曲名）由 MUINIT 填，见条目 MUINIT。
