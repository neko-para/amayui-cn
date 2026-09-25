---
kind: procedure
state: live
---
# 02-data · 角色 → L2D 资产 id 表（`.MOC` / `.MTN`）

> 两张**脚本全局 int 池**里的字面表，唯一写入方是 `src/EBINIT.txt` 族；
> 消费者是 `src/INFOEN.txt`（角色资料页）与 `src/BTL.txt`（战斗立绘）。
> 引擎侧语义见 `../03-engine/live2d.md`；写入方脚本条目见 `analysis/scripts.json` 的 `EBINIT`。

---

## 1. 两张表在哪、长什么样

| | MOC 表 | MTN 表 |
|---|---|---|
| 表基址 token | `global-int 527d8c` | `global-int 528944` |
| 语义 | 角色号 → `.MOC` **统一文件 id** | 角色号 → `.MTN` **统一文件 id** |
| 每行 | **3 dword（12 字节）**，只写第 0 列 | 同左 |
| 取法（消费者） | `lookup-array-2d (local-ptr N) (global-int 527d8c) <idx> 3 0` | `… (global-int 528944) <idx> 3 0` |
| 写入法（生产者） | `mov (global-int 527d8c + 3*c) <统一文件 id>` | `mov (global-int 528944 + 3*c) <统一文件 id>` |

* 两表**同构**：`0x528944 − 0x527d8c = 0xBB8 = 250 × 3 × 4` 字节 ⇒ MTN 表 = 同一形状错开 **250 行**。
* **`idx` = 1-based 角色号**（`c`）：角色 1 ⇒ MOC 槽 `0x527d8f`、MTN 槽 `0x528947`。
* `lookup-array-2d` 的语义 = `&op2[op3*op4 + op5]`（引擎 `sub_42EFD0` raw 39144-39149：
  `idx = op3*op4 + op5`）⇒ 第 4 操作数 `3` 就是**行距**，第 5 操作数 `0` 是**列**。

## 2. 写入方：`src/EBINIT.txt` + `src/$1$EBINIT.txt` … `$5$EBINIT.txt`

本体 + 5 个扩展包的初始化脚本，**逐角色用字面 token 写**（不是循环、不是数据文件、不是引擎装载）：

```
src/EBINIT.txt:115   mov (global-int 527d8f) 4087      # 0x527d8c + 3*1，0x4087 = BM001A.MOC
src/EBINIT.txt:116   mov (global-int 528947) 4088      # 0x528944 + 3*1，0x4088 = BM001A.MTN
src/EBINIT.txt:224   mov (global-int 527d92) 40b3      # 角色 2 → BM002A.MOC
src/EBINIT.txt:225   mov (global-int 52894a) 40b4      # 角色 2 → BM002A.MTN
```

| 事实 | 实测值 |
|---|---|
| MOC 列写点 / 不同角色 | **344 条 / 344 个** |
| MTN 列写点 / 不同角色 | **344 条 / 344 个** |
| 写入覆盖的角色号 | **1 .. 998** |
| 两表角色号集合 | **逐字相同**；**344/344 同基名成对**（`BM###A.MOC` ↔ `BM###A.MTN`） |
| 按文件的写点数 | `EBINIT.txt` 235 / `$3$EBINIT.txt` 48 / `$5$EBINIT.txt` 19 / `$2$EBINIT.txt` 18 / `$1$EBINIT.txt` 14 / `$4$EBINIT.txt` 10 |

## 3. 消费者

| 位置 | 取哪张表 | `idx` |
|---|---|---|
| `src/INFOEN.txt:1568` | MOC（→ `global f8c46`） | `local-int 13c7`（= `local-int 13bd`，从角色枚举里挑出的角色号） |
| `src/INFOEN.txt:1590` | MTN（→ `i34e`） | 同上 |
| `src/INFOEN.txt:712` | MOC（只判"有没有模型"） | `local-int 13bd` |
| `src/BTL.txt:1610/1614/1636/1721/1766/2644/2648/2670/2694/2757` | MOC / MTN | `local-int 16` |

10 处 BTL + 3 处 INFOEN **全部**是 `lookup-array-2d … 3 0`（行距 3、列 0）。

## 4. ★坑：`idx` 超界就是"没有 L2D 模型"

表的写入覆盖只有 **1..998**。超出这个范围的 `idx` 读出来**恒为 0**（该行没人写），
脚本据此走**静态贴图回落**（`a9d0` / `equ` 门）——**不是错误、不是 emulator 缺陷**。

* 实测例：INFOEN 的角色页走到 `idx = 0x13c7 = 5063` ⇒ 两列都是 0 ⇒ 静态回落。
  （`tickets/T-0054` 那条「boot 到 TITLE 后 `global[0x527d8c] = 0`」的实测，根因就在这里：
  探针读的是**表基址本身** = 角色 0 那一格，永远没人写；而角色页用的 5063 也超界。）
* 语料里角色号的上界是 **1000**（`src/SETFATE.txt:13` 与 `src/CVINIT.txt:7` 都写 `3e8`），
  与表的 1..998 一致。

## 5. 下游衔接（`SETL2DMOC`）

拿到 `.MOC` 文件 id 之后（写进 `global f8c46`），`SETL2DMOC` 把它映射到「模型 + 它的贴图」：

```
src/SETL2DMOC.txt:31   eq (local-int 0) (global-int f8c46) 4087
src/SETL2DMOC.txt:33   i341 4087 (global-int f8c47)          # 装模型 0x4087 = BM001A.MOC
src/SETL2DMOC.txt:34   i345 4fa2 (global-int f8c47) 0        # 绑纹理 0x4fa2 = BM001A 的第 0 张 PNG
```

⇒ 完整链：**EBINIT（角色号 → 文件 id）→ INFOEN/BTL（索引取 id）→ SETL2DMOC（id → 模型 + 贴图）→ `0x341`/`0x345`**。

## 6. 守卫

| 守卫 | 钉什么 |
|---|---|
| `app/amayui-emulator/test/t0107-l2d-asset-id-table.test.ts` | 写入方 = EBINIT 族；两表角色号集合逐字相同 + 同基名成对；覆盖 1..998；基址 token 无写点且 13 处用法全 `3 0`；基址相差 250 行 |
| `app/amayui-emulator/test/t0107-infoen-real-id.test.ts` | 角色 1 的两列 id → 经 `NodeFileSource.readById` 解析出真 `BM001A.MOC`/`.MTN`/PNG；`idx = 5063` 超界 ⇒ 0 |
