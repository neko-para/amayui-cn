# T-0102 判据 4/5 取证：角色名颜色的**完整派生链**已核定，遗留问题收窄到"通道约定"一处

> 本轮（2026-09-22，轮 17）用**真语料 + 游戏的自己的角色数据脚本**把这条链走通，并新增持久取样口
> `AdvReturnProbe.derivation`（`src/tools/config1Chain.ts`）与守卫 `test/adv-name-color-chain.test.ts`（3 → 2 例）。

## 1. 链条（全部在脚本侧；emulator 只提供操作数与字段语义）

```text
3f37（当前消息号；旁白 = -1）
 ├─ CONFIG.txt:226-241（各 SC 脚本同一段）：
 │    旁白     ⇒ 14acda = 0
 │    有发言人 ⇒ via = 14acdc[3f37]；idx = 14b0c4[via]
 │               idx != 0 ? 14acda = idx : 14acda = (52a49c[3f37]==1 ? 1 : ==2 ? 2 : 3)
 ├─ CONFIG.txt:372-407（label_00001ae8）：f807b = adcd[14acda]（`a9dd&2` 门控）、f807c 同法
 └─ i076(f807b) ⇒ Font+1360 = engineValues[21664]（通道转换），i077 同法写描边
```

## 2. 实测（`advReturnProbe: { g0: 1, g1397: 1, msg }`，真 `install/` 语料）

| `3f37` | `52a49c[msg]`(sex) | `14acdc[msg]`(via) | `14b0c4[via]`(idx) | 实得 `14acda` | `f807b`（adcd 原值） | `fill`（应用后） | 消息表 `f612[msg]` |
|---|---|---|---|---|---|---|---|
| −1 | 0 | 0 | 0 | 0 | `0xffffff` | `#ffffff` | （空 = 旁白） |
| 1 | 1 | 1 | **4** | **4** | `0xffe100` | **`#00E1FF`（青）** | **阿瓦羅・魯庫雷爾** |
| 2 | 2 | 2 | 5 | 5 | `0x84b1ff` | `#FFB184`（浅橘） | 菲丞（菲亚） |
| 3 | 2 | 3 | 6 | 6 | `0xdcdcc6` | `#C6DCDC` | 伊欧露 |
| 5 | 2 | 5 | 8 | 8 | `0x00d3c3` | `#C3D300` | 鷭斯尼爾・裃古里 |
| 64 / 69 | 0 | 0 | 0 | 3（回退分支） | `0xffffff` | `#ffffff` | （空） |

★**这次终于有了"谁在说话"的判据**：`f612[3f37]`（消息表）在真语料里**是有内容的**，
`f612[1] = 「阿瓦羅・魯庫雷爾」` —— 判据 5 缺的"有角色名的那一行"，用**强制 `msg`** 就能铺出来（不必走到 SC0000）。

## 3. 独立 oracle：`14b0c4` 的值来自角色数据脚本 `src/CVINIT.txt`

`CVINIT.txt` 用**逐元素名**写数据（`14b0c5` = 基址 `14b0c4` + 偏移 1），阿瓦罗那一块（:37-43）：

```text
mov (global-int 14a8f5) ffe100      ← 他的默认色
mov (global-int 14b898) a
set-string (global-string 11176) "アヴァロ|阿瓦罗"
...
mov (global-int 14b0c5) 4           ← 他的调色板下标（= 14b0c4[1]）
```

菲亚那块是 `14a8f6 = 84b1ff` + `14b0c6 = 5`。⇒ 探针实测 `14acdc[1] = 1 → 14b0c4[1] = 4` **与脚本数据逐值一致**，
守卫 `test/adv-name-color-chain.test.ts` 就是把这条"运行态 vs 脚本正文"的比对钉住（含**突变证明**：
把 `src/CVINIT.txt` 的 `14b0c5` 改成 `7` ⇒ 该用例 1 fail；还原后绿）。

## 4. `adcd`（调色板）的来源：不是存档，是 `INITCONFIG4` 从 `CVINIT` 默认值推出来的

- `INITCONFIG4.txt`（唯一写 `adcd` 的脚本）：`fill-zero 3b4e` / `set-array-to a9e5` →
  循环 `i = 0..0x3e7`：`adcd[i] = 14a8f1[i] != 0 ? 14a8f1[i] : adcd[i] - 1`，然后 `save-int adcd[i]`。
- `CVINIT.txt` 的 `14a8f1..` = 每个角色的**默认色**（旁白/一般男性/一般女性/… = `ffffff`，第 5 格起
  `ffe100`/`84b1ff`/`dcdcc6`/`71d8ff`/…）。
- 真机 `SAVE.DAT`（**overlay 与 base 两侧**）的 `adcd[0..13]` = `ffffff ffffff ffffff ffffff ffe100 84b1ff dcdcc6 71d8ff 00d3c3 4dbf67 2c9bdd d15e4b ff90b6 c6c83f`
  —— **与 CVINIT 默认值逐值相同、两侧也相同**（⇒ 本机没有在角色设定页改过色，不存在"用户配色被忽略"的问题）。
- `14b0c4` / `14acdc` / `52a49c` **不在 `SAVE.DAT` 的 int 表里**（`\x03`+hex8(Base+i) 全部查不到），
  它们是**脚本数据**（`CVINIT` 的 `14b0c*`、`52a4*` 等逐元素名 + 各 SC 脚本）⇒ 与"存档装载"无关。

## 5. 遗留问题（判据 4 **重新打开**）：唯一的判决点是 `i076` 的**通道约定**

阿瓦罗自己的数据值是 **`0xffe100`**：

| 读法 | 结果 | 与用户口径 |
|---|---|---|
| `0xRRGGBB`（RGB 直读） | `#FFE100` = **橘黄** | ✅ 与用户"预期橘色"一致 |
| COLORREF `0x00BBGGRR` → `bgrToRgb`（emulator 现状 / 引擎 raw 79666 的**字面**读法） | `#00E1FF` = **青** | ✅ 与用户"变成青色"（**症状**）一致 |

同法看 `adcd[12] = 0xff90b6`：直读 = `#FF90B6`（粉），交换 = `#B690FF`（**紫**）—— 用户报的"紫"匹配**交换**读法。

⇒ **两条症状合起来只有一个自洽解释**：这条链上「数据是 RGB、而 emulator（按引擎 raw 79666 的字面读法）
又交换了一次」。要么
**(a)** 引擎在 `i076` 的操作数**读取端**已经做过一次 RGB→COLORREF 的转换（于是 79666 的交换是"回到 RGB"、
净效果 = 直读），emulator 少了那一端；要么
**(b)** `CVINIT`/`adcd` 的数据本身就是 COLORREF，而用户对"橘"的记忆来自别处（例如真机截图/角色卡）。

**怎么判**（下轮，任选其一，都要留证据）：
1. **真机像素**：`.tmp/t0042-shots/opt-engine.png`（真机 OPTION 屏，1602×958）里若出现有名有色的角色名，
   取像素与 `#FFE100`/`#00E1FF` 比 —— 一次采样即可定性（这是**唯一**不依赖推断的路）。
2. **读 `0x76` 的 handler 全文**（`sub_466000` 的调用点与其操作数取法）：确认 `a5` 是脚本原值还是
   已转换值 ⇒ 直接判 (a) 还是 (b)；若 (a) 成立，emulator 的修复点是**操作数读取端**而不是 `bgrToRgb`。

## 6. 本轮新增的持久能力

- `AdvReturnProbe.derivation`（`src/tools/config1Chain.ts`）：`{ msg, sex, via, idx, viaPrev, idxPrev,
  viaNext, idxNext, palette[3], text }` —— 前几轮"缺 oracle"就是因为只有 `14acda` 一个数；
  现在连同**相邻消息号**的取值一起给（"差一"假设的判决量）与消息文本。
- `test/adv-name-color-chain.test.ts`：① `14b0c4` 逐值 == `CVINIT` 正文（独立 oracle，突变已证明）；
  ② `14acda == 14b0c4[14acdc[msg]]` 且 `f807b == adcd[14acda]`（两条不同角色）。
  ★诚实边界：②里 `fill == bgrToRgb(f807b)` 是**自洽检查**（两侧用同一个函数），
  "交换方向对不对"的 oracle 在 `test/text-style-snapshot.test.ts` 的判据 4（照抄引擎位表达式），不在这里。
