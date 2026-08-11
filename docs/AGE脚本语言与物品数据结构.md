# AGE 脚本语言与物品数据结构（调研记录）

> 调研日期：2026-08-11（网络资料 + 本地 `data/` 反汇编文本交叉验证）
> 范围：天結いキャッスルマイスター 的脚本语言（AGE 字节码）、ITINIT 物品记录结构、
> 以及“合成配方是否可从脚本中提取”的联合匹配调查
> 相关文档：[README.md](README.md) §7（游戏数据格式研究结论）

## 1. 结论摘要

- 天結的脚本是 Eushully 自家 **AGE 引擎**（ARC Game Engine / System4，SYS4 系）的**字节码**，
  不是传统汇编；但社区已有完整的反汇编/重汇编工具链，语言可理解、可修改。
- `.BIN` 脚本头部魔数 `SYS4450 `（新作另见 `SYS5501`）；字符串位于数据表尾部，
  **0xFF 按位取反 + SJIS**（v4）或 UTF-16（v5）存储。
- `ITINIT.BIN` 是物品数据库：记录 = 物品名（`set-string`）+ 一串对**并行数组槽位**的 `mov`；
  第一个数组值 = 物品 ID × 10（已与 foxofice 修改器的 ID 表交叉验证）。
- 用“3× 水色の木の実(0x7da=201) → 治癒の水・小(0x7f8=204)”做联合匹配：
  **当前语料中没有配方表**，两值同现点均为价格/计划 ID/事件发道具等其它语义；
  配方表最可能位于被 `data/` 基线过滤掉的纯逻辑脚本（EQUIP/USEITEM/FIELD 等松散逻辑 BIN，
  或 ALF 内 315 个无台词脚本）中。

## 2. 脚本语言：AGE 字节码（SYS4）

格式要点（详见 README §7.2）：

- 指令流：`opcode + 参数`，参数为 (type, u32)；反汇编文本如
  `show-text 0 "…"`、`set-string (...) "…"`、`mov (global-int 558811) 7f8`、`jmp label_…`
- Kelebek1 源码中的已命名指令（部分）：
  `exit / call-script / ret / exit-script`、
  `add / sub / mul / div / mod / mov / and / or / sar / shl`、
  `eq / ne / lt / lte / gr / gre`、
  `lookup-array / copy-local-array / copy-to-global / lookup-array-2d`、
  `show-text / end-text-line / wait-for-input / set-string / concat / display-furigana / draw-string`、
  `jmp / call / jcc / sleep / comment / toString`、
  `play-sound-effect / play-bgm / play-voice`、
  `set-font / halve-strlen / create-texture / set-texture / draw-texture`、
  `mouse_callback / joy_callback / get-input-type`、`bit-set / bit-reset / check-bit` 等；
  未命名指令以 AGE.EXE 内函数地址命名（如 `u0041BB40`）。
- 字符串编码：v4 = XOR 0xFF + SJIS(CP932)，0xFF 结尾；v5（SYS5501）= UTF-16。

## 3. 外部资料清单

| 项目 | 说明 | 链接 |
|---|---|---|
| Kelebek1/Eushully-Decompiler | AGE 脚本反汇编/重汇编（`-d`/`-a`/`-x` 往返校验，支持目录批量、多线程）；指令表在 `Decompiler/age-shared.cpp`；Kellindil 原作、Maide 重写；仓库无 README，源码即文档；提交 21da1e8（2024-08-30） | https://github.com/Kelebek1/Eushully-Decompiler |
| foxofice/alf | Eushully 封包 `.ALF`/`SYS4INI.BIN` 解包（源自 asmodean exs4alf、Xuan1986/ZeroLove）；支持 SYS5INI；2025-09 后 GitHub 停更，作者主页 acgdev.com | https://github.com/foxofice/alf |
| asmodean exs4alf | 最早的 ALF 解包工具（原始页面） | http://asmodean.reverse.net/pages/exs4alf.html |
| satan53x/SExtractor | 从反汇编文本提取/导回文本；Eushully 正则（julixian 提供）：跳过 `wait-for-input 0`，提取 `show-text 0 "…"` / `display-furigana 0 "…" "…"` / `set-string (...) "…"` | https://github.com/satan53x/SExtractor |
| ichisadashioko/pyage | Python：SYS4INI/AII 元数据解析与 ALF 解包 | https://github.com/ichisadashioko/pyage |
| andreili/Eushully-Editor | 查看/编辑 Eushully 资源；已识别 200+ opcode，作者可提供 IDA dump | https://github.com/andreili/Eushully-Editor |
| marcussacana/EushullyEditor | C# 脚本编辑器库（字符串改写），Kamidori/神の狂想曲 实测 | https://github.com/marcussacana/EushullyEditor |
| foxofice/eushully_editor | **E社修改器合集，含「天结1 修改器」(EU18)/「天结2 修改器」(EU21)**。注意：内存修改器（按 AGE.EXE 进程 + 版本 SHA1 定位），不是脚本解析器；`Files/EU18/DB/Item_*.txt` = item_id→名称表（中文），可作 ID 字典 | https://github.com/foxofice/eushully_editor |
| ZAP Interface Translations | 天結英化（Interface Patch），安装 = 备份并覆盖 BIN/AGF | http://www.zapinterlations.com/2018/05/amayui-castle-meister-translation.html |
| Depravity Complete English Patch | 天結完整英化（对话），致谢 asmodean/SaintLouisX/FlamePaladin 的工具 | https://maximumdepravity.blogspot.com/2021/05/amayui-castle-meister-complete-english.html |
| 封緘のグラセスタ 英化 | 同代引擎（2018）覆盖 BIN 的英化先例 | https://www.anime-sharing.com/threads/fuukan-no-grasesta-full-english-machine-translation.764920/ |
| 永焔の戦姫 AI 汉化补丁 | 同一工具链完整流程（alf→Decompiler→SExtractor→UIF），页面附 SExtractor 正则 | https://www.moyu.moe/resource/1977（2dfmax/ai2.moe 亦有） |
| Dir-A cnblogs「AGE 引擎逆向」 | ASProtect/PlayDRM 脱壳、注册检查（改数据文件不必须，深入了解用） | https://www.cnblogs.com/Dir-A/category/2387636.html |
| 知乎 GAL 解包入门 | ALF 解包入门教程 | https://zhuanlan.zhihu.com/p/57378947 |
| fuwanovel 帖子 | Kamidori（同引擎前作）BIN 反编译器来源（Kellindil） | https://forums.fuwanovel.net/topic/18117-someone-have-saintlouisxs-kamidori-bin-script-decompiler/ |

调研备注：以上 GitHub 元数据（默认分支、提交、无 README 等）于 2026-08-11 通过本机
`GITHUB_TOKEN`（`~/.zshrc` 导出，需登录 shell 加载）读取 GitHub API 确认。

## 4. ITINIT 物品数据结构（本地验证）

### 4.1 记录形态

`data/ITINIT.txt`（8623 行）中每个物品 = `set-string (global-string 18exx) "名称"` +
连续若干条 `mov (global-int <地址>) <值>`（实测共 732 条“名称+mov”记录）。

### 4.2 并行数组结构（重要更正）

地址**按物品下标 +1**：青銅の導鍵=558746、白銀=558747、黄金=558748、…（跳 558749 = 空缺 ID 4）。
因此正确模型是：

> 若干**并行数组、按物品 ID 索引**；每条记录向相关数组各写一个槽位。
> “同一地址 = 同一字段”的说法不成立。

物品种类 ≈ “写了哪几个数组”（地址区间组合）：

| 种类 | 地址区间组合（示例） | 说明 |
|---|---|---|
| 消耗品 | 5588 5597 55a7 55b6 5ba4 5bf2×2 | 7 个数组（ID/分类/种类/标志/效果/买价/卖价） |
| 重要道具 | 5587 5596 55a6 55b6 55c5 | 4~5 个数组 |
| 素材 | 5588/5589 5598/5599 55a8/55a9 55b7/55b8 5bf4~5bf8 | 6 个数组 |
| 装备类 | 5591/5593 55a1/55a2 55b0/55b2 5ac1/5ac3 … | 另组数组 |

### 4.3 已交叉验证的字段

**第一个数组 = 物品 ID × 10**（与 foxofice `Files/EU18/DB/Item_*.txt` 逐一比对，20+ 条全部吻合，
含两侧共同空缺的 ID 4）：

| 物品 | mov 值 | ÷10 | foxofice ID |
|---|---|---|---|
| 青銅の導鍵 | 0x0a | 1 | 1 青铜的导匙 |
| ドンパフ楽器 | 0x32 | 5 | 5 ドンパフ乐器 |
| 治癒の水・小 | 0x7f8 | 204 | 204 治愈之水·小 |
| 若葉の宝石 | 0xbc2 | 301 | 301 若叶宝石 |

### 4.4 字段语义验证状态

- **ID×10**：已交叉验证（§4.3）。
- 消耗品 `5ba4xx` 效果值：0xa/0x1e/0x64/0x1f4 与描述“回復 10/30/100/500”吻合 —— **强相关，未游戏内验证**。
- 消耗品 `5bf2xx`：买价/卖价（0x12c/0x1e、0x258/0x3c、0x3e8/0x64，约 10:1）—— **未验证**。
- 其余字段（分类/种类/标志等）：**未定义**，需差分验证（改值 → 游戏内观察）。

### 4.5 跨表引用用“裸 ID”

部分表直接引用 ÷10 后的裸 ID：PLINIT「水実の木」设施产出字段 `70710a = c9`（= 201 =
水色の木の実）。**搜跨表引用时需同时尝试两种编码（7da 与 c9）。**

## 5. 合成配方联合匹配调查（场景：3× 水色の木の実 → 治癒の水・小）

- 水色の木の実 = 0x7da（÷10 = 201）；治癒の水・小 = 0x7f8（÷10 = 204）。
- 全库（`data/` 全部 txt）中 `mov ... 7da` / `mov ... 7f8` 的所有同现点及语义：

| 位置 | 内容 | 语义 |
|---|---|---|
| ITINIT.txt:324/354 | `55880e 7da`、`558811 7f8` | 两物品自身记录（ID 字段），消耗品记录无材料字段 |
| ITINIT.txt:6424 | `5c0c21 7f8` | 「女傑の靴」卖价 2040（旁 `27d8`=买价 10200） |
| $5$ITINIT.txt:121 | `5c0cc6 7f8` | 「闇の靴」卖价 2040 |
| $3$PLINIT.txt:28/98 | `703eb0 7da`、`703eb3 7f8` | 追加 3 设施的计划 ID（步长 0xa，与物品 ID 数值空间同但表不同） |
| SC0190.txt:32925/37135 | `f8007 7da`/`7f8` | 事件发道具（临时全局变量 → 引擎调用 u0041BB40） |
| $1$AMINIT2.txt:10 | `14cb94 7f8` | 迷宫数据 |
| CONFIG1/2、INFOFA | `local-int 7da/7f8` | 局部变量槽编号（巧合） |
| PLINIT.txt:1874、CDINIT2.txt | 物品名 | 设施产出说明文本、卡片消息（非表） |

### 5.1 结论

- 当前语料（有文本的脚本）中**不存在配方表**；消耗品记录只有 7 个字段，无材料列表。
- 配方表（产物 ID + 材料 ID + 数量）最可能在**纯逻辑脚本**中：
  松散逻辑 BIN（EQUIP/USEITEM/FIELD/BTL 等，无台词，被 `data/` 基线过滤）
  或 ALF 内 315 个无台词脚本。已知跨表引用可能用裸 ID，定位时 `7da/7f8` 与 `c9/cc` 都要搜。

### 5.2 后续定位方案

1. **解包搜**（Windows）：`tools/alf/unpack_alf.exe` 解 `SYS4INI.BIN` 拿完整文件索引，
   反汇编名字含 CRAFT/MAKE/RECIPE/SYNTH/KOU 等候选脚本，搜 `7da`+`7f8` 或 `c9`+`cc` 同现。
2. **运行时断点**：游戏内工房制作一次该配方，CE 断引擎读取，直接定位它读的脚本/表。

## 6. 待验证 / 待办

- [ ] 消耗品其余字段语义差分验证（改值 → 游戏内观察）
- [ ] 定位配方表所在脚本（解包 DATA1 / 运行时断点），确认记录格式（裸 ID or ×10）
- [ ] 配方表可导出后，沉淀为数据文档（如 `keywords-装备与物品.md` 扩展或独立配方表）
