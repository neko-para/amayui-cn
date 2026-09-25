# T-0107 · INFOEN / BTL 的 L2D 资产 id 表（脚本 token `527d8c` / `528944`）—— **写入方已定位**

> 一句话：两张表的写入方 = **`src/EBINIT.txt` + `src/$1$EBINIT.txt` … `src/$5$EBINIT.txt`**（本体 + 5 个扩展包的初始化脚本），
> 逐角色用**字面 token** 写；`527d8c` / `528944` 是**表基址**，消费者用 `lookup-array-2d … 3 0` 取第 `idx` 行第 0 列。
> **判据 1 定位成功**（第一类：引擎装载路径的**前置脚本**——即"谁填的"= 游戏脚本，不是引擎内部、不是数据文件、不是新 opcode）。

---

## §1 调查路径与逐条排除证据

### 1.1 先复核票面前提（全部成立）

| 前提 | 复核结果 | 证据 |
|---|---|---|
| 两个 token 全语料**只有消费者** | ✅ | `Select-String src/*.txt 'global-int (527d8c\|528944)'` = **13 处**，只在 `BTL.txt`（10）与 `INFOEN.txt`（3），**全部** `lookup-array-2d (…)(global-int 527d8c\|528944) <idx> 3 0` |
| 引擎侧不是常量下标写 | ✅ | `5406092`(=`0x527d8c`)、`21624368`(×4)、`5409092`、`21636368` 在 `.c` 与 `.lst` **0 命中**（票面已实测，本轮复核仍为 0） |
| 对照表 `708ab6` 由脚本写 | ✅ | `src/INIT2.txt:115 mov (global-int 708ab6) 522d` ⇒ "表要有数据必须有写点"这条判据有效 |
| headless 里两槽是 0 | ✅ | `tickets/T-0054/evidence/infoen-l2d-table-probe.txt:22-31`；本轮**给出了根因**（见 §2.3） |

### 1.2 ★为什么第一轮"全语料 0 写点"是个**假排除**（本轮方法论教训）

我最初按票面口径只 grep 了**两个基址 token 本身**：

```
grep '527d8c|528944'  →  只有 BTL/INFOEN 的 13 处消费者，0 个写点
```

**真相**：EBINIT 族写的是**每一行的具体槽**，不是基址：

```
src/EBINIT.txt:115   mov (global-int 527d8f) 4087      ← 0x527d8c + 3*1 + 0
src/EBINIT.txt:116   mov (global-int 528947) 4088      ← 0x528944 + 3*1 + 0
```

⇒ **"基址 token 无写点"与"表有写点"完全可以同时成立**：`lookup-array-2d` 的语义是
`&op2[op3*op4 + op5]`（引擎 `sub_42EFD0` raw 39144-39149：`idx = op3*op4 + op5`；
emulator `src/vm/handlers/memory.ts:42-49` 同口径），所以消费者从**基址**算行地址，
写者只需写**算出来的那一格**。这是本票最重要的一条：**别再用"基址 token 是否被写"判断表有没有数据**。

### 1.3 逐条排除证据（按票面给的三条 + 我自己加的两条）

| # | 候选项 | 结论 | 排除/确认证据 |
|---|---|---|---|
| ① | **引擎装载路径**（`sub_4A1860` 那族"读文件→分析→写表"） | ❌ 排除 | `sub_4A1860`（raw 121665+）是 L2D 资源装载器（`.MOC`/`.MTN` 进实例槽），它写的是 **L2D 实例槽**（`Scene+55812` 那 10 格）与 572B 节点，**不碰脚本全局 int 池**；池里这两行的值在语料里能逐条对出（§2.1），不需要引擎参与 |
| ② | **数据文件**（含"给出文件与偏移"） | ❌ 排除 | ① `install/SYS4INI.BIN` 解压 TOC（1,692,004 B）全域扫 `.MOC`/`.MTN` 的**统一文件 id**（238+233 个）：命中 781 处，但**没有一处**是 `BM001A.MOC`(16519)/`BM001A.MTN`(16520) 等本表的值 ⇒ 池块里没有这张表；② `raw-parts/DATA1/FELLOW.BIN`（77048 B）确有「本地 id ⇄ MOC/MTN 名」的 20 B 行表格（第一处 `.MOC` 值 @0xa8），但它写的是**资源号**（18114/18126/…，不是统一文件 id），且没有消费者；③ 因此"表由数据文件装载"不成立 |
| ③ | **还没实现的 opcode** | ❌ 排除 | 全语料 9888 处 `mov (global-int 52xxxx)` 全是**已实现**的 `mov`；两张表的写点 344+344 条逐条解析到文件名（§2.1）⇒ **不是**缺 opcode 的症状（若缺，emulator 会 `NotImplementedOp` 硬停，而实测 TITLE 后正常停住） |
| ④ | 存档还原（`memcpy` 从存档恢复全局池） | ❌ 排除（但**注记**） | 池确实会被 `sub_410160`（raw 19583/19624、19705/19747）灌/取，且 `sub_42DB10`（raw 38360-38361）**加密循环只覆盖 `i < Engine[95738]+1`**——是"当前脚本上下文"的那一段，与 EBINIT 无关；且这两个 token **有脚本写点**（§2.1），无需存档解释 |
| ⑤ | "token 是**字节偏移**而不是下标"（票面给的降级备选） | ❌ 排除 | 引擎正算处一律 `_this[95744] + 4 * *v3`（`sub_42BF60` raw 37342、`sub_418A30` raw 36798 `case 3`），**没有 ÷4**；`sub_418A30` raw 24285 的 `(ptr - _this[95744]) >> 2` 是**反算**（把指针折回下标）。写侧同样 `_this[382976] + 4 * idx`（`sub_42B4B0` raw 37043-37045）⇒ token 就是**池 dword 下标** |

---

## §2 结论（定位成功）

### 2.1 写入方（判据 1 的答案）

**`src/EBINIT.txt`（本体）+ `src/$1$EBINIT.txt` … `src/$5$EBINIT.txt`（5 个扩展包）**，逐角色**字面 token 写**：

```
角色 c  ⇒  MOC 列 = 0x527d8c + 3*c + 0      MTN 列 = 0x528944 + 3*c + 0
```

逐字锚点（`src/EBINIT.txt`）：

| 行 | 原文 | 解析（统一文件 id → 真名） |
|---|---|---|
| 115 | `mov (global-int 527d8f) 4087` | `0x4087` = **`BM001A.MOC`** |
| 116 | `mov (global-int 528947) 4088` | `0x4088` = **`BM001A.MTN`** |
| 224 / 225 | `mov (global-int 527d92) 416b` / `mov (global-int 52894a) 416c` | `BM002A.MOC` / `BM002A.MTN` |

* **写点总数**：MOC 列 **344** 条、MTN 列 **344** 条（值经 base FileDB + 5 个 APPEND 包**逐条解析**成 `.MOC` / `.MTN`）。
* **按文件**：`EBINIT.txt:235` / `$3$EBINIT.txt:48` / `$5$EBINIT.txt:19` / `$2$EBINIT.txt:18` / `$1$EBINIT.txt:14` / `$4$EBINIT.txt:10`。
* **两表角色号集合逐字相同**，且 **344/344 同基名成对**（`BM###A.MOC` ↔ `BM###A.MTN`）⇒ 这是「角色号 → 模型/动作统一文件 id」表。

### 2.2 `idx` 的口径 与 行距 `3`

* **`idx` = 1-based 角色号**：角色 1 → `0x527d8f` / `0x528947`（= 基址 + 3×1）。
  写入覆盖 **1 .. 998**（`c=998` ⇒ `$5$BM998A.MOC @$5$EBINIT.txt:1498`），与语料里角色号的上界一致
  （`src/SETFATE.txt:13 lt (local-int 7d4) (local-int 0) 3e8` 与 `src/CVINIT.txt:7 mov (global-int 14b894) 3e8` 都是 **1000**）。
* **行距 `3`** = 表每行 **3 dword（12 字节）**，`lookup-array-2d` 的第 4 操作数就是它；
  EBINIT 只写**第 0 列**（MOC / MTN 各一列），第 1、2 列**无写点**（保留）。
* **两张表同构**：`0x528944 - 0x527d8c = 0xBB8 = 250 × 3 × 4` 字节 ⇒ MTN 表是"同一张表错开 **250 行**"的第二个实例。

### 2.3 ★为什么 headless 里读到 0（把 T-0054 的"未定位"收口）

INFOEN 那一路走到的编号是 **`0x13c7 = 5063`**（`local-int 13c7 ← local-int 13bd`，`src/INFOEN.txt:717`；
`13bd` 是从**角色枚举**里挑出来的角色号，枚举在 `src/INFOEN.txt:596-619` 由
`i12f (local-int 7fc) (global-int 5298e4) (local-int be4) 3e8` + `lookup-array (global-int 529ccc)` 过滤出来）。

**5063 > 998（写入覆盖的上界）** ⇒ 该行从未被写 ⇒ 表里是 **0** ⇒ 脚本按 `a9d0`/`equ` 门走**静态贴图回落**。

⇒ **这是数据的正确行为，不是 emulator 缺陷、也不是"表没被填"**：`tickets/T-0054` 的 `global[0x527d8c] = 0`
那条实测，现在有了**根因**（探针里读的正是"角色 0"这一格 = 基址本身，永远没人写；而该角色页用的 5063 也超界）。
⇒ 判据 2 的**"真 id 可取到"成立**：把 `idx` 换成写入覆盖内的角色（如角色 1）就能取到 `BM001A.MOC/MTN`
（见 `test/t0107-infoen-real-id.test.ts` 的 E 例：经 `NodeFileSource.readById` 实测解析出
`BM001A.MOC`（首 4 字节 `moc\n`）、`BM001A.MTN`（文本头 `# Live2D Animator Motion Data`）、
`0x4fa2` → `BM001A*的 PNG`）。

---

## §3 建模 / 台账 / 文档改动清单

| 文件 | 改动 |
|---|---|
| `app/amayui-emulator/test/t0107-l2d-asset-id-table.test.ts` | **新建**（`T2 / ratchet / l2d`，5 例）：写入方 = EBINIT 族、两表角色号集合逐字相同 + 同基名成对、覆盖 1..998、基址 token 无写点且 13 处用法全 `3 0`、基址相差 250 行 |
| `app/amayui-emulator/test/t0107-infoen-real-id.test.ts` | **新建**（`T1 / core / l2d`，2 例，**真资产依赖**）：角色 1 的两列 id → `readById` 解析出真 `.MOC`/`.MTN`/PNG；`idx=5063` 超界 ⇒ 0 ⇒ 静态回落 |
| `docs-new/02-data/character-l2d-tables.md` | **新建**数据表页：写入方、行距、idx 口径、覆盖范围、两张表的关系、与 SETL2DMOC 的下游衔接 |
| `docs-new/03-engine/live2d.md` | §1 补一段「角色 → 资产 id」表口径（指向数据页），把「两个全局槽是这套装载的参数」补全 |
| `analysis/scripts.json` | **新增 `EBINIT` 条目**（part = 本体 + `$1$`..`$5$`；角色 → MOC/MTN 统一文件 id 表的唯一写入方）；`build-scripts.mjs` 重生成 |
| `analysis/functions.json` | 两条**语义订正**：`0x42FEC0`（0x148）与 `0x4229A0`（0x149）原写「全局**时间阈值**槽 `_this[97058]`」，实为**引擎内部累加器**（不进脚本全局 int 池）；把"这是池访问"的误解挡在源头 |
| `analysis/engine-capabilities.json` | 新增能力条目 `script-global-int-pool-from-sys4ini`（脚本全局 int 池的装载方 = `sub_414AC0` 从 `SYS4INI.BIN`；含池基/容量/raw 锚点与**"容量数值与本表 token 不自洽"的诚实登记**） |

---

## §4 别人该接

1. **`tickets/T-0054` 的"轮 14 剩余项"可以关**：那张探针的 0 有根因了（§2.3）；`test/live2d-chain.test.ts:235-241`
   的「★仍然开着的那一格」注释应改写为「已定位：写入方 = EBINIT 族，5063 超界 ⇒ 0」，并把 E3 例的
   硬编码 id（`0x4c8e` 等）换成**从表里推出来的** id（本票 `t0107-infoen-real-id.test.ts` 已经给出可复制的写法）。
2. **`BTL.txt` 的战斗立绘**用的是同一对表（10 处读点，idx = `local-int 16`）：现在可用同一套口径复现，
   建议给战斗立绘补一条与 INFOEN 同形的 end-to-end 守卫。
3. **`analysis/engine-capabilities.json` 的那条诚实登记**（池容量 `Engine[699180]` 读出来是 3,335,068 dword
   = 13.3 MB，而 EBINIT 写的 token 最大到 `0x557c31` ≈ 5.6 M dword > 容量）：**这是个开放问题** ——
   要么池容量字段不止一个（`_this[382952]` 与 `_this[95738]` 是两套口径），要么 token 不是简单的 dword 下标。
   我按"token = 池 dword 下标"落地（因为正算/反算两处都没有 ÷4，且 emulator 的 Map 口径实测行为一致），
   但**没有证明容量自洽** —— 谁要碰脚本全局池的内存模型，请先解这一格。
4. `$n$EBINIT.txt` 的**包内覆盖**语义（扩展包重新写 1..998 的哪些角色、与本体冲突时谁生效）未查；
   本票只证明"这 6 份合起来把 1..998 填满"。

---

## §5 改动文件清单

```
新增  tickets/T-0107/changes-c107.md（本文件）
新增  app/amayui-emulator/test/t0107-l2d-asset-id-table.test.ts       （T1 / ratchet / l2d，5 例）
新增  app/amayui-emulator/test/t0107-infoen-real-id.test.ts          （T1 / core / l2d，2 例，真资产）
新增  docs-new/02-data/character-l2d-tables.md
改动  docs-new/03-engine/live2d.md
改动  analysis/scripts.json          （+ EBINIT 条目；counts 经 --recount：37 条 / partial 25）
改动  analysis/functions.json        （0x42FEC0 / 0x4229A0 语义订正 + journal）
改动  analysis/engine-capabilities.json（+ script-global-int-pool-from-sys4ini；counts 经 --recount：144 条）
改动  tickets/T-0107/ticket.json     （tests[2] / doneWhy / status=done / history）
生成物 05-scripts/、engine-capabilities.md、00-overview/index.md、00-overview/status.md、tickets/README.md 重生成
```

### 收尾实测（本轮）

| 项 | 结果 |
|---|---|
| `npm run verify` / `test:all` | **tests 1604 / pass 1597 / fail 3 / skipped 2** —— 3 条红 = `T-0146` 基线（`engine-slot` 真槽、`save-slot` 真槽 `format`、`scene-report` 可绘制项 24 ≤ 缺纹理项 26）⇒ **不新增红** |
| `tsc -p tsconfig{,.test,.control,.electron}.json --noEmit` | 四个 **exit 0** |
| 新守卫 | `t0107-l2d-asset-id-table` **5/5**、`t0107-infoen-real-id` **2/2** |
| 四份台账 `--validate` | tickets 176 ✅（15 条既存行号漂移警告）/ capabilities **144** ✅ / scripts **37** ✅ / opcode-gaps ✅ |
| 生成物 `--check` | `doc-index` / `status` / `tickets` / `opcode-table` / `opcode-gaps` 全 ✓；`capabilities`/`scripts` 无 `--check`，已重生成 |

