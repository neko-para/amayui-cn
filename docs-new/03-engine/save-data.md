# 存档与「设置」的真正归处：`SAVE.DAT`（表持久化）

> **本文结论全部来自 raw 读体 + 真存档验证**：`engine/天结_unpacked.exe_utf8.c`（行号即 raw 行号）、
> 真存档 `%LOCALAPPDATA%\Eushully\<game>\SAVE\SAVE.DAT`、以及 emulator 的
> `src/vm/saveData.ts` / `src/vm/crc32.ts` / `src/vm/lzss.ts`。
> 数据层：能力台账 `save-data-tables-persistence`；函数结论 `sub_40AAE0/sub_40AEE0/sub_438320/sub_438940/
> sub_437480/sub_437980/sub_436DE0/sub_436E90/sub_436A80/sub_434F60/sub_434FE0/sub_42DF40/sub_433A70`。
> 守卫：`app/amayui-emulator/test/save-data.test.ts`（含真存档 E4）。

## 0. 一句话结论

**设置界面的开关不在 `SYS4REG.INI` 里，而在 `SAVE.DAT` 里** —— 具体形式是"脚本用
`0x1A2 save-int` / `0x1A9 save-string` 把**全局量**登记进引擎的两张字符串键表，
引擎再把这**两张表**（外加若干块）序列化进 `SAVE.DAT`"。

```
INITCONFIG0..5   mov (global-int a9ce) 0 / save-int (global-int a9ce) …    ← 首次启动：写默认值并登记
LOADCONFIG       load-int (global-int a9ce) …                              ← 之后每次启动：从表里恢复
CHECKCONFIG      i2de 字体名→下标（装不上 ⇒ 回退默认并重新 save-string）
```

`SYS4REG.INI` 仍然是**另一套**东西：`display:` / `sound:` / `message:` / `system:` / `set:` 段的
**引擎级**配置（`0x0C0`/`0x0C5`/`0x131`/`0x2CE`/`0x2EB` 一族读它）—— 两者互补，见
`engine-config-registry-persistence`。

---

## 1. 启动顺序（`src/SYSTEM4.txt:71-84`）

```text
71  load-int (global-int 5)          ← 「已初始化」标志（也在 SAVE.DAT 的表里）
72  jcc (global-int 5) label_...     ← 非 0 ⇒ 已初始化
73      call-script 5258 LOADCONFIG  ← 29× load-int/load-string + 3×1000 条数组 load-int
74      call-script 51c3 LOADCHARM
75      jmp label_...
77  label_...（首次启动）
78      call-script 51dc INITCONFIG  ← INITCONFIG0..5：写默认值 + save-int/save-string
79      call-script 51c8 INITCHARM
80      mov (global-int 5) 1
81      save-int (global-int 5)
84  call-script 51db CHECKCONFIG     ← 字体名自检（0x2DE），必要时回退并重新登记
```

- 因此**存档必须在脚本之前装进引擎**（引擎在 `WinMain` 里 `sub_40AEE0`，raw 142107）。
  emulator 的落点：`renderer/app/configBoot.ts` 的 `loadSaveData()`（在 `loadScriptData` 之前 await）。
- 「初始化本页」按钮（`CONFIG1.txt:875-907`）就是**重新调用 INITCONFIG0..5**：
  写默认值 + 登记 —— 所以它是"重置这一页"，不是"重画界面"。

## 2. 两张表是什么

`0x1A2`/`0x1A9` 的 handler 把值写进**引擎哈希表**，键由 `wsprintf("%c%8.8x", 哨兵, 索引)` 生成：

| opcode | 方向 | 表 | 键的哨兵 | 证据 |
|---|---|---|---|---|
| `0x1A2 save-int` | 写 | `Font+5452`（str→int） | `3` | raw 42920-42932 |
| `0x1A3 load-int` | 读 | 同上（未命中 = 0） | `3` | raw 38442-38459 |
| `0x1A9 save-string` | 写 | `Font+5472`（str→str） | `5` | raw 42938-42957 |
| `0x1AA load-string` | 读 | 同上（未命中 = 空串） | `5` | raw 42449-42490 |

「索引」= 操作数解析器给出的**池下标**（`global-int 0xa9ce` → `0000a9ce`），所以真存档里能看到
`\x03` + `0000a9ce` 这样的键（见 §5）。

## 3. `SAVE.DAT` 容器格式（`sub_437480` 写 / `sub_437980` 读）

```text
偏移 0      4 字节  魔数 "S4SD"（另一分支 "S3SD"）
偏移 4      4 字节  引擎版本串（本作 "460B"，来自 Engine+382688）
偏移 8    0xE8 字节 标题串（游戏名，装载时 strcmp 校验）
偏移 240    4 字节  载荷的**逻辑字节数**（未压缩口径）
偏移 264   16 字节  SYSTEMTIME(local)（存档时间）
偏移 280    4 字节  stamp（timeGetTime()/1000 派生的单调时刻）
偏移 284    4 字节  format：1 = 加密未压缩 / 2 = 加密+压缩 / ≥3 = 再带额外块 + int 块模幂
偏移 288    4 字节  aux（引擎传的 a8）
偏移 292   20 字节  [载荷 dword 数 N][CRC1][CRC2][Crypt key1][Crypt key2]
偏移 312  4N 字节  载荷密文（Crypt 加密；format≥2 时是 LZSS 压缩后的）
```

- **两个 CRC**（对密文算）：`CRC1 = sub_436D50`、`CRC2 = sub_436D00`。两者用的是引擎自己建的两张
  256 项表（`sub_436BD0` 的非反射表 + `sub_436C60` 的反射表）—— 见 `src/vm/crc32.ts`（两种都已逐字实现）。
- **Crypt**（`sub_436DE0` 加密 / `sub_436E90` 解密）：把每个 dword 用 `key1` 异或后按 `key2` 拆成 8 字节
  （`out[2i]=key2*(v>>>16)`、`out[2i+1]=key2*(v&0xffff)`），每轮 `key1 += 0x0B0B0B0B`、`key2 += 0x0B02`。
  `key1/key2` **就写在文件里** ⇒ 这是混淆而不是加密。
- **压缩**（format ≥ 2）：AGE LZSS（Okumura LZSS，N=4096 / F=18 / THRESHOLD=2，`sub_436A80`），
  解压后是 `[inLen][outLen][cSize][压缩数据]` 的容器 —— 与 ALF 归档用的是同一算法
  （`scripts/alf/lzss.mjs`，emulator 侧移植在 `src/vm/lzss.ts`）。
- **载荷主体**（`sub_438320` 写 / `sub_438940` 读）：

```text
u32 intCount ; intCount × u32                 ← 存档槽用的 int 块（format≥2.10 逐元素模幂混淆，见 sub_499650）
u32 recCount ; recCount × { key[12] ; u32 }   ← ★str→int 表（save-int 的值都在这里）
u32 strCount                                  ← str→str 表的记录条数
u32 trailerDwords                             ← ★= 字符串记录区字节数/4 + 1（`v16[1] = v46 + 1`，raw 45293-45295）
strCount × { key\0 value\0 }                  ← str→str 表（save-string 的值）
trailerDwords × u32                           ← 尾部块（3.10+ 放 a9/a10/a11；低版本仅首个 dword = 0 终止）
```

- ⚠**字符串记录区从 `strCount` 之后 8 字节起**，不是 4 字节：读侧 `sub_438940` raw 45564-45566 是
  `v23 = *v20; v34 = v20[1]; v24 = (char *)(v20 + 2)`，`v34` 就是那个 `trailerDwords`，
  记录区按 dword 对齐（`4×(v34-1)` 字节，尾部补零）。
  **少跳这 4 字节不会报错**：第 1 条会被读成乱码键，并且**静默丢掉最后一条记录**——
  天結真存档里最后一条恰好是字体键 `\x05…bbf`（CONFIG 第 3 行字体），于是表现为
  「五个字体项里第三个回退到默认字体」。emulator 侧 `src/vm/saveData.ts` 的 `parseTables(…, engineLayout)`
  按引擎布局读，并用 `记录区字节数 ∈ [声明区-3, 声明区]` 做**结构自校验**（宁可如实报错，也不静默丢键）。
- 写盘触发：**关窗**（`WM_CLOSE`，除非 `set:NoSaveDat`；raw 141189）与**存档槽保存之后**
  （`sub_40CD10` 内 raw 17687 → `sub_40AAE0`）；装载：启动（raw 142107）。
  写的都是 `$$SAVE.DAT` → 改名，旧文件留 `SAVE.BAK`。

## 4. `RT.DAT` 是什么

同一个写入器顺带写的"续玩"文件（`sub_48EB60` / 读 `sub_48FCE0`），对象是 `Engine+320428`
（消息/ADV 文本状态区）：魔数 `S3RT`、其余容器结构与 `SAVE.DAT` 相同。
**emulator 未建模**（ADV 回看/文本状态未建模）。

## 5. 真存档验证（E4）

`test/save-data.test.ts` 直接读本机真存档（若存在）：

```text
SAVE.DAT (160,640 B) format=3
  头：magic=S4SD engineVersion=460B title=(SJIS 游戏名) format=3 aux=20
  块：N=40082 dwords  key1=0x49730ECC  key2=0x48A9
  Crypt 解密 → LZSS 解压 → [intCount=21111][int 块][recCount=5409][16B 记录]
                             [strCount=245][trailerDwords=1104][245 条字符串记录][尾部块]
  ★配置键（对照 src/INITCONFIG0..5 的默认值）：
    global 000005 = 1        ← 「已初始化」标志
    global 00a9ce = 0  a9cd = 1  a9d5 = 0  a9d0 = 0  a9cb = 3  a9cc = 31
    global 00a9de = 1  a9dd = 2  a9db = 0  a9df = 192  a9e0 = 160  a9e1 = 128  a9e2 = 0
    global 00a9dc = 1  a9d4 = 0  a9d9 = 0  a9da = 0  a9e3 = 0  a9d2 = 0
    …以及玩家改过的项：b1b6 = 2（默认 0）、a9d6 = 1、a9e4 = 0、139b = 0
  ★字体键：字符串表最后五条就是 CONFIG 的五个字体槽
    \x0500000bbb / bbc / bbd / bbe / bbf 全是「Amayui CN」（bbf 是**最后一条** ⇒ 上面那个 4 字节陷阱的现场）
```

- 字符串表里能看到脚本 `save-string` 过的文本（字体名、技能/角色文本缓存等）。
  **字符集随发行版**：本机这份（心愿屋中文版）是 **GBK**（`b3c7edce…` → 「城砦与结缘之力共存」），
  日文原版则是 SJIS。emulator 自己写的是 **UTF-8**（自洽即可；配置值走 int 表，与字符集无关）。
- 一个实例里 `b1b6 = 2` 而 `INITCONFIG1` 的默认是 0 ⇒ **这确实是"玩家设置"而不是"默认值快照"**。

## 6. emulator 现状与边界

| 能力 | 状态 |
|---|---|
| 本工程格式（`format = 0`）读写 `SAVE.DAT`（头 + 块 + 表结构 + 双 CRC） | ✅ `saveData.ts`，守卫 `test/save-data.test.ts` |
| `save-int`/`save-string` → 表 → 落盘（`Engine.onSaveDataChanged` → `FileSource.writeSaveData`） | ✅ |
| 启动装载 → `load-int`/`load-string`（⇒ 走 LOADCONFIG 分支，设置跨会话保留） | ✅ E3 真语料断言 |
| 读**引擎格式**（format 1..3：Crypt + LZSS + 表） | ✅ 真存档 E4 通过 |
| 引擎载荷的 `trailerDwords`（字符串记录区起点 = `strCount` + 8） | ✅ 已实现 + 结构自校验（`parseTables(…, engineLayout)`），回归见 `test/save-data.test.ts` |
| 覆盖真存档的保护 | ✅ 目标是引擎存档时改写 `<SAVE.DAT>.amayui`，读取优先 `.amayui` |
| `SYS4REG.INI` 回写的防丢键棘轮 | ✅ 新文本键数少于磁盘时拒绝写 |
| int 块（存档槽）的模幂还原 `sub_499650` | ❌ 未实现（配置值不在该块） |
| `RT.DAT`（ADV 回看状态） | ❌ 未建模 |
| 存档槽（`0x1A1` `sub_42DDE0` / `SAVE%02d.DAT`） | ❌ 未实现（菜单未接） |

**怎么用它继承玩家设置**：把 `AMAYUI_SAVE_DIR` 指向真游戏存档目录
（`%LOCALAPPDATA%\Eushully\<game>\SAVE`）—— emulator 会读那份 `SAVE.DAT`（引擎格式）并走
LOADCONFIG 分支；之后它自己的改动写到同目录的 `SAVE.DAT.amayui`，**不碰**原文件。
（默认目录是随工程的 `app/amayui-emulator/SAVE/`，不污染真游戏。）

⚠**`.amayui` 会盖住引擎存档**（读取优先它）。所以解码器修好后，**上一次用错解码器跑出来的
`.amayui` 仍会把错的设置喂回来**（`bbf = ＭＳ 明朝` 就是这么留下来的）：换解码器/换版本后若怀疑设置
不对，把 `<SAVE.DAT>.amayui` 改名或删掉，让它重新从引擎存档继承一次。

**看存档内容**：`npm run save:dump`（仓库内那份）· `npm run save:dump -- <文件>`（指定文件）·
`AMAYUI_SAVE_DIR=<真游戏 SAVE 目录> npm run save:dump`（真存档：会列出 §5 的那批配置键）。

## 7. 相关

- 引擎级配置（另一套）：`engine-config-registry-persistence` + `docs-new/03-engine/opcode-table.md` 的
  `0x0C5/0x0C7/0x131/0x141/0x1B5/0x1B8/0x1B9/0x2CC/0x2CD/0x2E6/0x2E7/0x2EA/0x2EB`。
- 脚本站点：`docs-new/05-scripts/INITCONFIG*.md`、`LOADCONFIG.md`、`CHECKCONFIG.md`、`SYSTEM4.md`。
- 文本颜色/描边的生效范围（CHECKCONFIG 派生 `f807b/f807c` 之后）：`message-config-gates.md`、
  `adv-text-rendering.md` §3.5 与台账 `text-style-scope-queue-time`。
