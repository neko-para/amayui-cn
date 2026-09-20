# 存档与「设置」的真正归处：`SAVE.DAT`（表持久化）

> **本文结论全部来自 raw 读体 + 真存档验证**：`engine/天结_unpacked.exe_utf8.c`（行号即 raw 行号）、
> 真存档 `%LOCALAPPDATA%\Eushully\<game>\SAVE\SAVE.DAT`、以及 emulator 的
> `src/vm/saveData.ts` / `src/vm/crc32.ts` / `src/vm/lzss.ts`。
> 数据层：能力台账 `save-data-tables-persistence`；函数结论 `sub_40AAE0/sub_40AEE0/sub_438320/sub_438940/
> sub_437480/sub_437980/sub_436DE0/sub_436E90/sub_436A80/sub_434F60/sub_434FE0/sub_42DF40/sub_433A70`。
> 守卫：`app/amayui-emulator/test/save-data.test.ts`（含真存档 E4）。
> **存档槽链路**（`SAVE%2.2d.DAT` + `.STH`，opcode `0x19E/0x19F/0x1A0/0x1A1/0x1AB/0x1AC/0x1AE/0x1AF`）见 §7：
> 真源 `src/vm/saveSlot.ts` + `src/vm/handlers/save-slot.ts`，守卫 `app/amayui-emulator/test/save-slot.test.ts`。

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
偏移 280    4 字节  累计**游玩秒数**（i32；写侧 raw 44812 `v24 = [1036] - [1032] + timeGetTime()/1000`
                     = "上次存档里的 +280" − "本次会话开始时刻(s)" + "现在(s)"；装载时 raw 45085 把 +280
                     存进容器 [260]、raw 45099 令 [259] = [260]、[258] = now）
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
  `v23 = *v20; v34 = v20[1]; v24 = (char *)(v20 + 2)`，`v34` 就是那个 `trailerDwords`。
  **少跳这 4 字节不会报错**：第 1 条会被读成乱码键，并且**静默丢掉最后一条记录**——
  天結真存档里最后一条恰好是字体键 `\x05…bbf`（CONFIG 第 3 行字体），于是表现为
  「五个字体项里第三个回退到默认字体」。
- ★**`trailerDwords` 的合法窗口 = `4×(v34−1)` … `4×v34`**（2026-09 订正）：写侧用的是**未补齐**的
  字符串字节数做整除（raw 45294 `v46 = SizeInBytes/4`），而读侧用 `v28 = &v20[v34 + 2]`（raw 45606）
  按 dword 对齐定位下一块 ⇒ 记录区可以比 `4×(v34−1)` 长 1..4 字节（尾巴补零）。
  实测真 `SAVE.DAT`：记录区 4481 字节 ⇒ 声明 1121（= 4481/4+1 整除）。
  旧口径只认上界 `4×(v34−1)` ⇒ 遇到"记录区不是 4 的倍数"的真存档会**误判解析失败**
  （症状：鉴赏进度整份读不出来）。emulator 侧 `src/vm/saveData.ts` 的 `parseTables(…, engineLayout)`
  用这个窗口做**结构自校验**（宁可如实报错，也不静默丢键）。
- 写盘触发：**关窗**（`WM_CLOSE`，除非 `set:NoSaveDat`；raw 141189）与**存档槽保存之后**
  （`sub_40CD10` 内 raw 17687 → `sub_40AAE0`）；装载：启动（raw 142107）。
  写的都是 `$$SAVE.DAT` → 改名，旧文件留 `SAVE.BAK`。

### 3.5 ★payload 开头的 int 块 = 「已使用文件」标志（= 回想/鉴赏进度）

> 2026-09 订正：这块**不是**"存档槽用的 int 块"，而是 `FileDB`（`Engine+680092`）的
> **「已使用文件」表** —— 回想界面四个按钮的 `回収数/回収率`、BGM 鑑賞列表里哪几首显示曲名，全由它决定。
> 完整机制见 [`gallery-and-unlock-flags.md`](./gallery-and-unlock-flags.md)。

装载侧 `sub_40AEE0` raw 15202-15238（写侧 `sub_40AAE0` raw 15034-15074 把 `sub_404B20`/`sub_404BF0`
拿到的块交给 `sub_438320`）：

```text
块 A（payload 开头，dword 数 = intCount）：
  SaveVersion1>2（或 ==2 且 SaveVersion2>=10）：[key1 ^ 0x87912345][key2][槽值 × N]
                                                槽下标 = 统一文件 id（本体 0..N-1），非 0 = 该文件被打开过
  旧版本：                                      [槽值 × N]（无头，值 = 明文哈希）
块 B（payload 尾部，仅 3.10+ 写；下标是"跨包线性下标"）：
  [256 dword：每包文件数][u32 块B dword 数][块B][u32 0 终止]
  块B = [key^0x87912345][key2][槽值 × M]，装载时用那张 256 项表把线性下标 j 换算成 (包号<<24)|包内编号
```

- **判据是"槽值非 0"**（值本身只是防改档哈希 `87912345*id − 1330597712`，低 16 位 ≡ `28569*id − 20304`；
  新格式再经 `sub_499650` 模幂混淆）⇒ emulator **不需要**实现模幂还原，只需"非 0 即已使用"。
- **布局判定**：引擎用**配置里的** `set:SaveVersion1/2` 决定有没有那 2 dword 头，而同一组版本号也决定头的
  `format ≥ 3` ⇒ 读侧用 `format ≥ 3` 判别（本机真存档正是 `format=3` + 头两块 dword，实测相符）。
- 真机实测（2026-09，本机 `SAVE\SAVE.DAT`，161,584 B）：`format=3`、`intCount=21111`（= 本体 21109 个文件 + 2 头）、
  **`已使用文件 = 11106` 个** ⇒ 回想界面 `CG 797/1269、シーン 14/23、BGM 31/36`（BGM 缺 `0x15/0x16/0x1d` 三首 +
  两张 OP/ED 影片 id）。

## 4. `RT.DAT` 是什么

同一个写入器顺带写的"续玩"文件（`sub_48EB60` / 读 `sub_48FCE0`），对象是 `Engine+320428`
（消息/ADV 文本状态区）：魔数 `S3RT`、其余容器结构与 `SAVE.DAT` 相同。
**emulator 未建模**（ADV 回看/文本状态未建模）。

> ★**`RT.DAT` 不是鉴赏/解锁进度的载体**（2026-09 核查）：那份进度是**同一个 `SAVE.DAT`** 的
> payload 开头那一块（§3.5），装载时由 `sub_40AEE0` 写进 `FileDB`。`RT.DAT` 里只有 ADV 续玩状态。

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
| **`SAVE.DAT` 的「已使用文件」块**（payload 开头的 int 块 = 回想/鉴赏进度） | ✅ 已解（`SaveDataUsage`：槽值非 0 = 已使用；`format≥3` 判新布局）；两侧并集见 `NodeFileSource.readSaveFlags`；守卫 `test/gallery-bgm-list.test.ts` 的 E4 |
| 不写坏真存档：**overlay 层**（读 overlay→base，写只写 overlay） | ✅ `src/arch/systemPaths.ts` + `src/arch/overlay.ts`，守卫 `test/overlay.test.ts`；Electron 主进程与 Node 侧共用同一份实现 |
| `SYS4REG.INI` 回写的防丢键棘轮 | ✅ 新文本键数少于**当前生效的那份**（overlay 优先，否则真游戏）时拒绝写 |
| int 块（存档槽）的模幂还原 `sub_499650` | ❌ 未实现（也不需要：鉴赏进度只要"槽值非 0"） |
| 扩展包 flag 块（§3.5 的块 B：跨包线性下标 + 256 项换算表） | ❌ 未解（基础版 BGM/CG 全是本体 id ⇒ 不影响本机实测；布局已记在 §3.5） |
| `RT.DAT`（ADV 回看状态） | ❌ 未建模 |
| 存档槽（`0x1A1` `sub_42DDE0` / `SAVE%02d.DAT`） | ✅ 已实现（`0x19E` 存 / `0x1A1` 读 / `0x1A0` 读头 / `0x19F` 短读 / `0x1AB` 删 / `0x1AC` 复制 / `0x1AE`·`0x1AF` `.STH`）；真槽（format 1..3）只读头 + 接游玩秒数，状态主体仍是缺口（§7 + `SLOT_GAPS`）；**`0x1A1` 的控制转移已实现**（§7.1，`tickets/T-0056`）；守卫 `test/save-slot.test.ts` + `test/save-slot-chain.test.ts` + `test/slot-load-transfer.test.ts` |

**玩家数据怎么落地（overlay）**——引擎的"系统存档目录"里既有存档也有配置，emulator 对它的**一切访问**走同一层：

```text
base    = %LOCALAPPDATA%\Eushully\天結いキャッスルマイスター\          ← 真游戏（只读）：SYS4REG.INI、SAVE\SAVE.DAT、存档槽…
overlay = %LOCALAPPDATA%\Eushully\天結いキャッスルマイスター.overlay\  ← 本工程（同级目录，结构镜像）
读：overlay\<rel> 有就用它，否则 base\<rel>      写：只写 overlay\<rel>（先写 .$$tmp 再改名）
```

- 于是**不需要"另存成别的文件名"这种 hack**（旧实现写 `<SAVE.DAT>.amayui`、读时优先它）：继承玩家设置与
  "绝不写坏真存档/存档槽"由目录布局本身保证；把 `.overlay\` 整个删掉即彻底复原。
  覆盖用环境变量：`AMAYUI_SYSTEM_DIR`（base）、`AMAYUI_OVERLAY_DIR`（overlay）。
- ⚠若换过解码器/版本后发现设置不对，删掉 `.overlay\` 再启动，让它重新从真游戏继承一次。
- **看存档内容**：`npm run save:dump`（取系统存档目录的 `SAVE\SAVE.DAT`，按 overlay → base 命中并打印是哪一侧；
  可 `npm run save:dump -- <文件>` 指定某个存档槽）。

## 7. 存档槽链路（`0x19E` 存 / `0x1A1` 读 / `0x1A0` 读头…）

存档槽与 `SAVE.DAT` **共用同一个容器**（写 `sub_437480`、读头 `sub_438120`、载荷 `sub_438320`/`sub_438940`），
但载荷内容不同：`SAVE.DAT` 的载荷是「已使用文件块 + 两张表」，槽的载荷是**引擎自己的整份状态**
（`sub_410160` 序列化：帧栈 / 全局池 / 场景 / 字体 / 额外块），所以**不能**拿 `SAVE.DAT` 的表布局去解槽。

| opcode | 引擎（raw .c） | 语义 | emulator |
|---|---|---|---|
| `0x19E` | sub_42D980 38287-38331 | 存档到槽（已存在且头**读不出**时才弹确认框，选否则 `op1 = 1`） | ✅ `handlers/save-slot.ts` |
| `0x19F` | sub_42DB10 38334-38363 | 读档（短：`sub_410160(…,0,0)`），**写 op1** | ✅（`a6/a7` 两层未单独建模） |
| `0x1A0` | sub_42DC70 38365-38404 | 读槽头 292 B（**只读**）：`op1` = 0 可读 / 1 打不开（= 空槽）/ 2 头坏、`op3..op8` = 年/月/日/时/分/秒（跳过 `+268` 星期、不取 `wMilliseconds`）、`op9` = 游玩秒数 | ✅ |
| `0x1A1` | sub_42DDE0 38407-38440 | 读档（全量）；★**不写任何操作数** | ✅ |
| `0x1AB` | sub_42DFC0 38463-38483 | 删槽（`op1`：`.DAT` 失败 1 / `.STH` 失败 2） | ✅ |
| `0x1AC` | sub_42E0A0 38486-38513 | 复制槽（同上两个结果码） | ✅ |
| `0x1AE`·`0x1AF` | sub_42E1F0 / sub_42E320 38515-38594 | 写 / 读 `.STH` **缩略图**（op3 = 纹理槽；产物是 320×180 24bpp BMP：写经 `sub_43BF20`、读经 `sub_40BF20`→`sub_43E9F0` ddReadBmp） | ✅ 按 `src/vm/bmp.ts` 真解/真写（`tickets/T-0036`） |

- 路径：`%s\SAVE%2.2d.DAT`（`sub_408A40` 取系统存档目录；`%2.2d` = 精度 2 ⇒ **补 0**，真槽就是 `SAVE00.DAT`）。
  本工程落到 overlay：`SAVE/SAVE00.DAT` + `SAVE/SAVE00.STH`（`src/vm/saveSlot.ts` 的 `slotRelPath`/`slotThumbRelPath`）。
- **`0x1A0` 的契约细节**（`sub_42DC70` 逐行；`tickets`/台账见 `analysis/functions.json` 的 0x42DC70）：
  ① 写序是 `op3..op9` **先**、`op1` **最后** ⇒ 观察者若只看第一条写会看到"过期"的 op1；② 失败（1/2）时
  `op3..op9` **原样不动** ⇒ 脚本必须先读 `op1` 再信日期；③ `op1 = 2` 把**四种**失败原因（魔数不符 / 游戏名不符 /
  `ReadFile` 错误 / 长度 ≠ 292）合并，具体原因只出现在引擎日志文本里；④ 它是**唯一不碰状态**的槽指令
  ⇒ **没有** `pool_int` re-ENC（对照 `0x1A1`/`0x19F`）；⑤ 输出经通用写端 `sub_42B4B0` ⇒ 传**引用**操作数
  （`(local-ptr N)`/`(global-ptr N)`）时是**写进数组元素**（语料 `src/SAVE.txt:73-80` 正是这样按槽填七张表）。
- **`0x1A0` 的两类语料形态**（脚本层，详见台账 `SAVE` / `SC0330`）：
  ① **列表行填充**（`src/SAVE.txt:67-80`，5 处）：`232[0x3d4+行]` 取该行的**槽号** → 七张字段数组的元素**引用**
  （`61d`=状态 / `a05`=年 / `ded`=月 / `11d5`=日 / `15bd`=时 / `19a5`=分 / `1d8d`=游玩秒）→ `i1a0` 直接写进数组
  （`op8`（秒）丢进 `local-int 2175`）。② **存在性探针**（334 处，各 ADV/剧情脚本的公共块，如 `$1$SC0330.txt:532-545`）：
  `i1a0 (global-int f7ffd) (global-int f8019) (global-int f7ffe)×7` —— 状态读 `f7ffd`、槽号来自 `f8019`、
  其余 7 个输出全丢进**丢弃槽** `f7ffe`，随后 `eq (global-int f7ffd) 0` 判"这个槽有没有存档"。
- ★**缩略图的"缩屏"这一步 = `0x32`（`i032`，引擎名 StretchTexture）**：`.STH` 的 320×180 BMP
  不是引擎自己缩的，而是**脚本**先建两张纹理槽再转送 —— 337 个 ADV 脚本里的同一段（`src/SN0000.txt:3171-3184`、
  `src/SC5450.txt:3009-3021`）：
  ```
  create-texture 2 500 2d0 2      // 槽 2 = 1280×720（500/2d0 = 十六进制）
  i20d 2                          // 以槽 2 为渲染目标
  i20e                            // （把画面/场景提交进该表面）
  i20c                            // 帧刷新
  sub 0 = -1 ; i20d (local 0)     // 还原渲染目标（-1 = 后台缓冲）
  create-texture e 140 b4 2       // 槽 0xe = 320×180
  i032 2 e 0 0 500 2d0 0 0 140 b4 // ★把槽 2 的 (0,0,1280,720) 缩放转送到槽 0xe 的 (0,0,320,180)
  release-texture 2               // 释放全屏槽
  i1ae (global 1396) (global f8019) e   // 把槽 0xe 写成 <槽>.STH
  release-texture e
  ```
  ⇒ 引擎侧：`0x20D`（渲染目标）+ `0x20E`（提交）+ `0x32`（缩放转送）+ `0x1AE`（写 BMP）。
  `0x32` 的语义与夹取见 `opcode-table.md`；emulator 侧像素由宿主做（Pixi 在两张画布间 `drawImage`），
  模型侧记在 `scene.render4.blits`（守卫 `test/op-032-stretch-texture.test.ts`，`tickets/T-0050`）。
- **`0x1A1` 不写操作数**（与 `0x1A0`/`0x19E`/`0x19F` 不同）：`sub_42DDE0` 函数体里没有 `sub_42B4B0`，
  且调度器 `(*(void (__thiscall **)(int))(_this + 4 * opcode + 675996))(_this)`（raw 21217）**丢弃 C 返回值**
  ⇒ 脚本给的 `(global-int f7ffd)` 只是占位；"读档成没成"要靠先 `0x1A0` 验头。
  ★旧注"`0x1A1` = 存档到槽位"是**误**（存档是 `0x19E`）。
- 装载后引擎还会把 `pool_int`（`_this[95744]`，`_this[95738]+1` 个 dword）**整体 ENC 一遍**
  （raw 38433-38438 / 38360-38361，`ENC(a) = ROL4(key ^ ROR4(a,7), 21)`、key = `_this[97059]`）
  ⇒ **运行时池必须是 ENC 态**。emulator 的对应物是 `Engine.globals.int`（存 ENC 值）+ `Engine.key`
  （`src/vm/operand.ts` 的 `enc`/`dec`）。★"文件里那份池是明文还是已被 ENC 过"按 `set:SaveVersion1` 分支不同
  （`sub_410160` raw 19488-19490 的 a4==1 分支读时即 ENC、raw 19624/19747 的 a4==2/3 分支直接 memcpy），
  这一层属于槽载荷的未解部分（`SLOT_GAPS`）；本工程只对齐上面那条不变量。
- **游玩秒数**（头 `+280`）在装载时被接回：引擎把 `+280` 存进容器 `[260]`、令 `[259] = [260]`、`[258] = now`
  （raw 45085 / 45099），下次存档写 `[1036] - [1032] + timeGetTime()/1000`（raw 44812）。
  emulator：`Engine.playSeconds`（`src/frame/loop.ts` 按帧累加；读引擎格式槽时用头的 `+280` 接上）。
- 语料用量（`src/*.txt`，941 个脚本）：`i19e` 337 / `i1a0` 339 / `i1a1` 335 / `i1ae` 337 / `i1ab` 1 /
  `i1ac` 2 / `i1af` 1；`i19f`·`i190`·`i0aa`·`i0ab`·`i0ac` **0 次**（`0x190` = "任意路径读档"，本作用不到）。
  ★列表界面的**横向翻页**另用 `0x2E5`（水平滚轮；`src/SAVE.txt:205/304` 各一次）——它与 `0x10D` 是
  引擎里**两个独立累加器**，见 [`input-system.md`](./input-system.md) §15。
- **E3（菜单链路）**：真语料 `SYSTEM4 → LOGO → TITLE →（右上角菜单第 1 项 Load Data）→ SAVE.BIN` 跑通，
  路径上**零未实现 opcode**，且列表真的经 `FileSource.readSaveSlot` 读了真玩家槽
  （实测 120 次、槽号去重后覆盖 **0..999** ⇒ 引擎没有"只接受两位槽号"的限制，`%2.2d` 只补位不截断）；
  该死链路只读不写。守卫 `app/amayui-emulator/test/save-slot-chain.test.ts`（`tickets/T-0018`）。
- **本工程的槽 = 同一容器 + `format = 0` 明文 payload + 尾块状态**（`src/vm/saveSlot.ts` 的 `SlotStateBlock`：
  魔数 `AMYS1\n` + JSON，装 `Engine.key` / `cur` / 每帧 `scriptId`+`ip`+返回栈 / 全局池 / 游玩秒数）。
  这是**私有扩展**：引擎不会读它（真槽没有这一段）⇒ "引擎能读我们的槽"不成立，反过来我们只读引擎槽的头。
  尾块的定位依赖 §3 那个 `u32`（引擎的 `trailerDwords`，本工程写 0 当"空尾部块"）——读侧必须先吃掉它，
  否则状态块前面会多 4 个 `00` 字节（`T-0018` 实测踩过）。
- `SLOT_GAPS`（诚实边界，别当保证）：① 真槽 `format = 3` 的状态主体**已解析并可续跑**（见 §7.2），
  `format = 1/2` 的旧布局仍只读头；② 只还原"当前帧 + 调用栈上的帧"；③ `0x19E` 的覆盖确认框没建模（宿主无对话框 ⇒ 恒等于"点了是"）；
  ④ `.STH` 已解（320×180 24bpp BMP；`tickets/T-0036`），且 §7.3 的渲染目标帧捕获已接（仍需 GUI 目视确认）；
  ⑤ 按名读档族（`0x190`/`0x0AA`/`0x0AB`/`0x0AC`）未实现（语料 0 次）；
  ⑥ 续跑跳过了引擎的 `CALLBACK_LOAD.BIN` 那一跳、且存档里的解码图槽/图像重载清单**已解码未应用**（见 §7.2 末）——
  该跳里**对本工程有观测意义的那一步（BGM 重播 `i0b7 0`）已补**（§7.7），其余（10 个 SE 通道重装/`LOADCHARM`/消息跳过复位）仍未做。

### 7.1 ★读档不是"恢复两张表"，而是**控制转移**（`tickets/T-0056`）

`0x1A1`（全量档 `a6=1`）的装载内核 `sub_410160` 在搬完各块之后**还会换掉当前脚本**（raw 19464-19476）：

```c
qmemcpy(Engine+84088, Engine+497416, 0x28);          // 字体/消息窗状态拷回
sub_4B5090(Engine+82876);                            // 文本/窗口子系统复位
sub_403EF0(Engine+51904); sub_403EF0(Engine+21976);  // 两张面板复位（路由表清空）
v20 = sub_455000(FileDB, String2);                   // ★解析**存档里记录的脚本名**
Engine[383120] = 1;                                  // 「正在读档」门（0xAE 读它）
Engine[383104] = 0;                                  // ★cur = 0（回根帧）
if (v20 < 0) { sub_40F750(Engine, 1, 10); return 0; } // 解析不出 ⇒ 另走装载
... LABEL_136：把 v20 装进帧 0
```

⇒ **调用方脚本被放弃**：SAVE.BIN 那类界面脚本不会在 `0x1A1` 之后继续被派发。
`0x19F`（`a6=0` 短读）**不**走这一段（语料 0 处）。

**脚本侧的两条口径正好印证**（这也是"漏了会崩"的原因）：

| 路径 | 收尾 | 为什么 |
|---|---|---|
| **存档**（`src/SAVE.txt:1148-1154`） | `… mov (local-int e) 4` + `ret` | `e = 4` ⇒ 主循环跳回 `label_00000e60` **重新登记**全部回调（含 `mouse-callback`） |
| **读档**（`label_000039cc`，`src/SAVE.txt:921-936`） | `i1a1 …` + `ret` | 不需要重登记 —— 脚本系统已被上面的控制转移复位 |

`mouse-callback`(0xCC) 的 **owner 是全局一格、每次登记都改写**（`sub_421980` raw 30323：`Engine[107674] = frames[cur][95796]`），
而 `get-input-type`(0xCD) 派发前要用它比对（raw 25861）⇒ 若"读档后调用方接着跑"，
它就会带着**上一个子脚本**（确认框 `SBUNKI.BIN`，id 54，`SBUNKI.txt:118`）留下的身份去比对，
撞上 `Depth が不正です 51 != 54`。emulator 修前正是这样（把读档当普通还原）⇒ 用户实测的崩溃。

**emulator 实现**（`src/vm/handlers/save-slot.ts`）：面板/文本复位 + 置 `Engine+383120` 门 + `cur = 0` +
**把存档记录的脚本装进帧 0** —— `format = 3` 的真槽能解出记录 0 的脚本 id（见 §7.2），
`format = 1/2` 等解不出的情形退回**重载根脚本 0**（`transferToRootAfterLoad`，启动链重新接管）。
`0x19F`（`a6=0`）不转移。守卫 `app/amayui-emulator/test/slot-load-transfer.test.ts`（E3：真槽 + 真资源根，
读档后启动链重新跑到 TITLE 且不抛错）与 `test/slot-load-resume.test.ts`（§7.2 的续跑）。

★**顺带修的数据破坏**：真槽的两张表与「已使用文件」标志**不在槽里**（`parseSlotFile` 对 format 1..3 返回
`engineFormat: true` + 空表；那两张表在 `SAVE.DAT` 里，槽里对应的是**池**）⇒ 修前
`applySaveDataTables(空表)` + `setUsedFileIds(空集)` 会把当前 `SAVE.DAT` 的表（含 §1 的 `global 5`「已初始化」标志）
与解锁标志**洗掉且无报错**；现在只在真读出来时才写。

### 7.2 ★真槽（`format = 3`）的状态主体与**续跑**（`tickets/T-0059`）

槽的 payload 是引擎自己的整份状态，**被 `sub_436E90` 置乱 + LZSS 压过**，与 `SAVE.DAT` 的表布局无关。
解码链（`src/vm/engineSlot.ts` 逐条实现，本机 47 个真槽全过）：

```text
292 B 头（+240 = payload 逻辑字节数、+284 = format=3、+288 = aux=SaveVersion2=20）
 20 B 块：{storedDwords, ?, ?, seed1, seed2}
  置乱流：storedDwords 个 dword（= 2×逻辑 dword）—— sub_436E90：out = a2 ^ (lo/a3 + (hi/a3)<<16)，
          a2 += 0x0B0B0B0B、a3 = (a3 + 2818) & 0xFFFF（★a3 是 u16 会绕回；两个存储 dword 必须能被 a3 整除）
  前 3 个逻辑 dword：{解压后字节数, 同上, 压缩流字节数}；其后是 LZSS 流（sub_436A80 = util/lzss.ts）
  解压结果前 2 个 dword：两个内层 CRC（msb-first 与普通，**都覆盖其后全部 body**）
```

body（`a4 == 3` 布局，`sub_410160` raw 19703-19927 读 / `sub_40CD10` raw 17465-17632 写）：

| 段 | 长度 | 内容 |
|---|---|---|
| 帧镜像 | `1044*savedCur + 22296` | +0 savedCur（走栈目标）/ +4 savedRet / +8 `Engine[174713]` / +12..51 `Engine+84088`（40 B 消息窗态）/ +52..1251 100 个**解码图槽**（每槽 12 B：id/flag/param）/ +1252..21251 1000 条 20 B 记录 / +21252+1044k **第 k 帧记录**（261 dword） |
| 帧记录 | 每条 1044 B | `[0]` 返回帧（`frames[k][95795]`）/ `[1]` **脚本统一 id** / `[2]` 返回栈深度 / `[3..]` 返回栈 = **表 C 下标** / `[259]` = **`0x71` 消息表下标** / `[260]` = **`0x3` call-script 表下标**（**末帧恒 −1**） |
| 池块 | 24 B + 数据 | `{intsCount, floatsCount, stringsCount, 表A len, 表B len, 表C len}` + int 池（**定长稀疏数组**，本机 1,015,792 项 = 4 MB，`(global-int f8019)` 这类大下标就是它的下标）+ float 池 + 字符串区长度 + NUL 结尾串 + 三张**全局** ip 表 |
| 图像清单 | 可变 | `{740, count, (1 dword + 740 B)×count, 2 dword + 740 B}` —— 读档时按 id 重新解码图像（`sub_4559C0`） |

**三个池在文件里是明文**（引擎的 `ENC`/`DEC` 只发生在内存侧：`ENC(x) = ROL(key ^ ROR(x,7),21)`、
`DEC(x) = ROR(key ^ ROL(x,11),25)`，`key` = 每次启动 `rand()` 派生的 `_this[97059]`）⇒ 装载时直接读、
不需要密钥（`sub_40CD10` 写进文件的就是 `DEC(内存值)` = 明文）。★**但写回内存时 `int` 池必须再 `ENC` 一遍**
（`0x1A1` 的 raw 38433-38438 就是干这个的），因为读侧一律 `DEC` 还原 ⇒ 少这一步**不报错**、只是续跑后
**所有全局量都读成垃圾**（实测：漏了它，续跑链会提前停在 `SETADVFLAG.BIN`；补上后能继续走到 `SETGARDEN.BIN`）。
`float`/`string` 池没有这层（引擎直接读 `*(float*)(pool+4*i)` 与字符串指针）。

**续跑链路**（引擎口径 → emulator 落点）：

```text
sub_410160 收尾：cur = 0、Engine[95780] = 1（读档门）、帧 0 ← CALLBACK_LOAD.BIN
CALLBACK_LOAD exit 时 frames[0][95795] == -11 ⇒ sub_41A820 走「按存档版本重装」→ sub_40F750(3, sv2)
sub_40F750(3)：帧[cur] ← 记录[cur] 的脚本（sub_40ED40）、返回栈 ← 表C[下标]+3、ip 指向脚本入口（95782 = 95781）
脚本入口的 i0ae（0xAE，语料 **339 处**）：ip ← 表B[记录[260]]（命中则 95805 = 3 ⇒ 落到**调用点的下一条**）
                                    否则 ip ← 表A[记录[259]]（95805 = 0 ⇒ **重放这条消息**）
                                    cur == savedCur ⇒ 95777 ← savedRet、95780 = 0（收尾）
                                    否则 95776 = cur+1 + sub_40F750(3)（装下一帧）
```

⇒ **落点语义**：末帧停在一条 `0x71`（显示消息）⇒ 续跑重放存档当时那句话；更早的帧停在一条 `0x3`
（call-script）⇒ 续跑从**它的下一条**开始（调用点不重放，返回栈已由装载恢复）。

emulator 侧：`src/vm/engineSlot.ts`（解析）+ `handlers/save-slot.ts`（`restoreEngineSlot`：还原池/帧记录、
装帧 0）+ `handlers/frame.ts` 的 `op_save_version_branch`（`0xAE` 真实现）+ `Engine.saveResume`。
**已知偏离**（`SLOT_GAPS ⑥`）：① 跳过 `CALLBACK_LOAD.BIN` 那一跳（emulator 能直接装帧脚本；引擎因为装载
发生在帧派发里才要绕回调）⇒ 回调的副产物里**只有 BGM 重播（`i0b7 0`，§7.7）被显式补上**（`replaySavedBgm`），
charm/LOADCHARM 绘制管线、savemesskip 复位、10 个 SE 通道重装仍不复现；
② 存档里的解码图槽与图像重载清单**已解码未应用**（emulator 的纹理由脚本 `set-texture` + 宿主按 id 惰性解码重建）；
③ 镜像里那 40 B 消息窗态未还原（emulator 的 msgwin 有自己的状态）。

**E4/E3 证据**：47 个真槽的两个内层 CRC 全过，且**每帧记录的落点 opcode 与语义自洽**
（末帧 = `0x71`、调用方帧 = `0x3`，共 11 帧实测）—— 守卫 `test/engine-slot.test.ts`；
真 `SAVE00.DAT` 装载后帧 0 = `SYSTEM4.BIN`、第一步走栈真的把存档帧脚本装进帧 1 —— 守卫
`test/slot-load-resume.test.ts`。

### 7.3 本工程槽（`format = 0`）的**存档退栈 / 读档转移**契约（`tickets/T-0061`）

本工程写的槽是**私有格式**（容器 + `format = 0` + 尾块 `SlotStateBlock`）：引擎读不了它（真槽没有那一段），
我们读引擎槽也只读 §7.2 那套。私有格式里有两处**必须照引擎口径做**，否则玩家看到的就是
「存了档，读档却停在存档界面上」（2026-09 用户实测）：

| 环节 | 引擎依据 | 契约 |
|---|---|---|
| **存档退到哪一帧** | `sub_40CD10` case 3：`v10 = _this[166963]; if (v10 < 0) v10 = _this[95776];` —— `_this[166963]` = **`0x1AD`（`i1ad`，`sub_4196F0` raw 24806：`storedCur = cur`）**，语料 **1100 处 / 337 个脚本**；每个 ADV 脚本都在进主循环前 `i1ad`（`src/$1$SC0330.txt:44-46`） | 存档写的是 **`i1ad` 记的那一帧**（帧记录只铺 `0..storedCur`、连空帧一起写），**不是**按下"保存"时的 `cur`（那时 `cur` 是存档菜单帧）⇒ 这就是玩家说的"自动退栈" |
| **读档怎么续** | `sub_40F750(3)` → `sub_40ED40`：帧 ip = **脚本入口**；随后入口那条 `i0ae` 落 ip（见 §7.4） | 读档把每个帧**装到入口**、把落点放进 `Engine.saveResume`，由 `0xAE` 逐帧走栈到 `savedCur` 收尾（两条读档路同一套，只差落点是"表下标"还是"指令下标"） |
| **放弃调用方** | `sub_410160` 的 a6=1 段（raw 19464-19476）：`cur = 0` + 装载存档记录的脚本 | 读档**一定**放弃调用方脚本（SAVE.BIN 不再继续跑）；`0x19F`（a6=0）不转移 |
| 帧记录带**帧号**与**返回帧链** | 帧镜像按帧号铺（`+21252+1044*k`）、记录 `[0]` = `frames[k][95795]` | 状态块每条帧记录带 `index`（帧号）与 `caller`（返回帧）—— 不然中间有空帧会整体错位、`exit` 会退回错帧 |

**存档缩略图链**（脚本侧，`src/$1$SC0330.txt:17584-17596` 的 `label_0003e24c`）：

```text
create-texture 2 500 2d0 2      // 1280×720 离屏槽（op4 = 2 = 渲染目标用法）
i20d 2                          // ★设渲染目标 = 槽 2
i20e                            // 清该 surface（sub_498B60 的 Clear）
i20c                            // ★帧刷新：引擎在这里把**这一帧的场景**画进槽 2
i20d -1                         // 切回后台缓冲
create-texture e 140 b4 2       // 320×180
i032 2 e 0 0 500 2d0 0 0 140 b4 // 缩放转送 槽2 → 槽e（StretchTexture）
i1ae (global 1396) (global f8019) e   // 把槽 e 的位图写成 <槽>.STH（= 320×180 24bpp BMP）
```

emulator 侧：`0x20D` 只把目标槽记进 `render4.renderTargetSlot`（它还兼作混合门控输入），而 `0x20C`
（`PixiBackend.frameTick`）**在设了渲染目标时同步合成一次并把整帧拷进该槽的画布**
（`TextureCache.captureCanvasIntoSlot`）—— 必须在这一刻做：外层渲染循环的 present 落在**整批指令之后**，
那时脚本早已 `i20d -1` 切回去了（否则 `i032` 转送的是空画布 ⇒ 全黑缩略图）。
★捕获必须给**屏幕矩形**（`extract({target: stage, frame: [0,0,1280,720], resolution: 1})`）：`extract` 默认按
target 的 local bounds 出图，而舞台子节点可能落在视口之外（宽背景/屏外精灵）⇒ 画布比屏幕大、内容错位，
压进 320×180 就是"素材拼贴 + 各处缩放不一致"（2026-09 用户实测，`tickets/T-0062`）。

### 7.4 读档为什么必须"**让脚本从入口重跑**"（`tickets/T-0063`）

引擎 `sub_40F750(3)` 装载 rec[cur] 的脚本时，`sub_40ED40` 把帧 ip 设成**脚本入口**（raw 18847：`95782 = 95781`），
随后由入口那条 `i0ae`（`0xAE`）把 ip 落到存档位置 ⇒ **读档 = 场景脚本从 dword 0 重跑一遍**。
emulator 侧因此把**本工程槽（`format = 0`）也接到引擎那条路上**（`tickets/T-0061` 的"直接摆 `cur`/`ip`"已作废）：
装载时把每个存档帧按 scriptId **装到入口**、把落点（本工程槽存的是**指令下标** ⇒ `saveResume.frames[k].instr`）
与返回栈放进 `Engine.saveResume`，`cur = 0` + 置读档门，然后由脚本入口的 `i0ae` 逐帧走栈到 `savedCur` 收尾。

### 7.5 ★读档还必须把**画面**装回去（`tickets/T-0063`）

"从入口重跑"只能重建**流程**，重建不了**画面**：ADV 的背景/立绘是**一次性**画出来的，而每帧的落点都
在那些绘制**之后**。实测 `NOVEL.BIN`（0x5268，ADV 场景的外层）：

```text
指令 21   i0ae                    ← 落点入口
指令 39   set-texture …           ← 场景贴图
指令 43   draw-texture 186a0 …    ← ★背景
指令 123  call-script <场景>       ← 把控制交给场景脚本（SN0000）
指令 124  i0f4 …                  ← ★帧 1 的存档落点（113 行之前那些绘制全被跳过）
```

`SN0000.BIN` 从入口到主循环（`label_000037f0` 的 `i0ae`）之间**一处 `draw-texture` 都没有** ⇒
只还原帧栈/池的话，读档后**画面上什么都没有**；而宿主 GUI 有"留帧"机制（`HOLD_MAX_FRAMES`）
⇒ 屏上继续显示上一屏 —— 玩家看到的就是**"读档后回到标题界面"**（点击还能推进 ADV，因为流程已经续上了）。

引擎为此在存档里带了**绘制/槽记录**（`_this[81174]`/`[86174]` 两张 1000×2 组 5 dword 表，20000 字节：
每条 = 统一文件 id + 参数；读档时 raw 19843-19910 按它逐条 `sub_4559C0` + `sub_4A3800` 把图像装回槽）。

> ★★**2026-09 轮 5 以体订正**（`tickets/T-0083`）：
> 1. 上面那张 `_this[81174]`/`[86174]` 表（20000 字节 / 1000 条 20 B）**不是绘制项**，是**纹理槽记录表**（`Session[5*slot+466]`：id/param/flag），raw 19843-19910 的循环只做「按 flag==1 把图像重新解码进槽」（`sub_4559C0`+`sub_4A3800`）；
> 2. **绘制项在 body 末段**：`{u32 740、u32 count、(u32 handle + 2960 B 记录区) × count}`（条目步长 = `1 + 740` dword = 2964 B，引擎 raw 19828 `&v67[4*hFile]`；记录区只有前 740 B 被 `memcpy` 进内存里的 DrawItem）。装载段 raw 19810-19820 **先整批清 `Scene+1032` 容器**、raw 19822-19832 再逐条插回 ⇒ 引擎读档后画面 = **存档那一屏**（真槽 79 的 69 条：背景 0x18A88/slot 4/BG050ABL + 侧栏 tex 17 + 消息窗字格 tex 28）；
> 3. `NOVEL` 的 `draw-texture 186a0`（line 55）那条在 `(global-int 3f90) != 0` 门后，而 `3f90` **全语料只被写成 0** ⇒ 正式脚本里**从不执行**（`i0ae` 在 line 29、背景块在它之后，天然被续跑跳过）；
> 4. emulator 侧已按 2 实现（宿主缝 `native.restoreDrawItems`），`SlotStateBlock` 那两段只是**本工程自造槽**的等价物。

emulator 的等价物是 `SlotStateBlock` 里的两段：

| 段 | 内容 | 读档时 |
|---|---|---|
| `texSlots` | `[槽号, 统一文件 id][]`（= VM 的 `Engine.texSlots`） | 还原 `e.texSlots` + 逐条 `native.bindTexture(imgid, slot)`（宿主按 id 取图） |
| `present` | 场景**呈现态快照**：`drawItems` / `meshes` / `msgWins`（消息窗文本）/ `msgRanges` / `slotText` / `slotModes`（见 `renderer/scene/present.ts`） | `native.restorePresent(snapshot)` ⇒ 模型先清后装、每个窗 `msgRev` 递增以触发重新光栅化 |
| `adv` | **VM 侧状态**（见 `src/vm/advState.ts`）：`engineValues`（除读档流程自用的 `cur`/`callRet`/读档门/收尾标志）、热点区 `routes.entries`、消息窗标量态、文本项账本 `textItems.records`、阶梯动画表 `StageLoop` | `restoreAdvState`（在清空之后、续跑脚本继续之前） |
| `adv.fields` 里的 BGM 两格 | 运行态「当前曲 id」`_this[174713]` / 循环位 `[174715]`（真槽对应帧镜像 `[2]`；见 §7.7） | `restoreAdvState` 装回后由 `replaySavedBgm` **重播该曲**（= 引擎 `CALLBACK_LOAD.BIN:20` 的 `i0b7 0`） |
| `loadHold`（不在槽里） | 装载点装好的那份画面快照本身（`present` + `texSlots`） | `0xAE` **每个走栈步**重新 `applySlotPresentation`，收尾才松手 —— 见 §7.8 |
| `frames[].lastMsgIp` | 本帧最后一次 `0x71`（开始消息）的指令下标 | **末帧**的落点优先用它 ⇒ 重放存档当时那句话（引擎帧记录里那一格就是 `0x71` 表下标） |

顺序很重要：**先还原快照/VM 态，再让续跑脚本继续跑** —— 模型以 handle 为键，脚本重画同一个 handle 是覆盖而不是叠加。
读档还会 `routes.reset()` + `msgwin.reset()`（清掉旧 UI 的窗口/热点），所以那批状态**必须**由存档带回来 ——
否则实测症状是：侧边栏 hover 不展开（热点区没了）、ADV 窗遮罩不对（窗口标量态没了）、
背景不再移动（阶梯动画表没了）、面板/淡入开关位被复位（`engineValues` 被清）。
（`0x259` 那条"清记录"也因此必须只清**槽记录**、不能清绘制项 —— 见 §7.6。）

### 7.6 `0x259`（`i259`）到底清什么（口径纠错）
`sub_41A3A0`（raw 25357-25376）的完整体是一趟 `v2 = 1000` 的循环：

```c
result = _this + 86176;                       // 影表；主表 = result - 5000（= 81176）
do { *(result - 5000) = 0;  *result = 0;      // 两表的 [0]
     *(result - 4999) = 0;  result[1] = 0;    // 两表的 [1]
     result += 5; --v2; } while (v2);          // 步长 5 dword × 1000 条
```

⇒ 它清的是**槽记录**（"槽 → 统一文件 id"那一格 + 邻居），**不碰绘制项、也不 delete 纹理对象**
（引擎绘制走 CTexture 对象表 `_this[op2+94672]`，与这份记录无关）。语料 517 处，每个 ADV 场景开头
都调一次（`src/SN0000.txt:7`）—— 所以它**不是**"清屏"，把它实现成清 `drawItems` 会**在每个场景开头
把刚画好的画面清掉**（本仓一度如此，症状正是"读档后什么都不剩"）。

### 7.7 ★读档还要把 **BGM** 放回去（`tickets/T-0064`）

画面之外还有一样东西会"跟着存档走"：**音乐运行态**。

```text
存档（sub_40CD10 a4==3）: 帧镜像[2] = Music 模块的 [259]（当前曲 id；raw 17469-17471）
读档（sub_410160 a4==3）: Engine[698852] = 镜像[2]（raw 19911 ⇒ 把当前曲 id 装回模块[259]）
                          帧 0 ← CALLBACK_LOAD.BIN
CALLBACK_LOAD.BIN:20     : `i0b7 0` ⇒ sub_489F80(Music, 0, 1) ⇒ 曲 id 非 0 ⇒ **重新起播该曲**（循环）
```

★为什么"不补这一跳 ⇒ 读档后整场没 BGM"（2026-09 用户实测）：

1. `src/SAVE.txt:934` 在 `i1a1`（读档）**前一条**就是 `i0b8`：`sub_489B50` 停播**并清 `Music[259]`**
   （运行态当前曲 id 归零）；
2. 读档落点是"存档当时那句话"（`0xAE` 用 `0x71` 表下标），而场景的 `play-bgm` 在**消息循环之前** ——
   实测 `SN0000.BIN`：`i0ae` = 指令 737、`play-bgm d`（曲号 13 = `BGM013.OGG`，318 s）= 752、落点 = 794
   ⇒ 续跑那一遍**必然跳过**它；
3. 于是只有 `CALLBACK_LOAD` 用**存档里的 id** 重播才能把音乐放回来。

emulator 的对应物：`engineValues[174713]`（当前曲 id）/ `[174715]`（循环位）是唯一真源
（`0xB7/0xB9/0xBF/0xC3` 写、`0xB8`/`0xC2`(目标 0) 清；**不再**由配置 `sound:Music` 灌值 ——
配置落字节 `0xAAB10` 而不是 `0xAA9E4`）；本工程槽把它随 `adv.fields` 存走，读档末尾由
`handlers/save-slot.ts` 的 `replaySavedBgm` 发一条 `bgm-play{id, loop:true}`（真槽走 `pre8` 那一格）。
细节与 opcode 语义见 `sound-system.md` §5/§5.1。

★**旧档注意**：修前存的槽里那一格是配置值（本机 `sound:Music=2`）⇒ 读档会尝试播曲号 2（= `OP.BIN`）
并静默失败（日志 `[slot-load] BGM 还原：重播存档里的当前曲 #2`）—— 用新版本重存一次即可。


### 7.8 ★走栈期间要"按住"读档画面（`tickets/T-0070`）

读档的画面快照装好之后，**续跑本身会再演一遍场景入口**：续跑是"帧 0 从入口重跑 → 入口 `i0ae` 落 ip"，
而场景入口的初始化在这条路上会重跑（`create-mesh` 重建遮罩、`set-vertex-color-alpha` 重播淡入）——
快照里的遮罩 mesh 与新建的是**同一个 handle** ⇒ 被覆盖成 alpha=0 再动画回来。

玩家实测症状：**先出现带遮罩的背景（快照，正确）→ 又像刚进游戏一样从无遮罩渐变到有遮罩**（画面被播两遍）。

引擎没有这个问题：它的后备缓冲**从不清**（`ClearTarget` 被恒 0 的 `Scene+46460 & 1` 守卫），
旧像素一直压着那些一次性绘制。emulator 的等价物 = `Engine.loadHold`：

```text
读档（本工程槽）  : applySlotPresentation(present + texSlots) 并挂 e.loadHold = 同一份
每个走栈步（0xAE）: if (e.loadHold) applySlotPresentation(e, e.loadHold)   // 把重跑产生的中间画面盖回快照
收尾（cur==savedCur）: 上面已盖回一次 ⇒ 清 e.loadHold（此后脚本自己的绘制如实可见）
```

真槽（没有快照）不挂 `loadHold` ⇒ 行为不变（它的画面缺口见 `T-0066`）。

### 7.9 ★`SAVE.DAT` 的两张表要**按 key 并表**读（`tickets/T-0069`）

`SAVE.DAT` 里除了配置值，还有一批**按槽**的记录（`save-string`/`save-int` 以槽号为键：槽标题
`\x05000004xx`、状态、年月日时分、游玩秒数…，见 `src/SAVE.txt:1102-1139`）。
本工程 overlay 目录里那份可能由**旧版本**写过，而旧版本只把自己改过的键写回去 ——
实测本机 overlay 那份只剩 **int 3049 / str 8**，而真游戏 base 那份是 **int 5439 / str 248**
（槽标题「序章」「１章」… 全在 base 里）。读侧是"overlay 优先"⇒ 列表**整列没有标题**、
点槽也进不了读档（脚本按空槽处理）。

引擎的表是**单调增长**的（从不删键）⇒ 两侧并集与引擎语义一致（与既有的 `usedFileIds` 并集同口径）：

```text
启动装 SAVE.DAT: 解 overlay 那份 → mergeSaveDataFallbacks(表, 其余几份) → applySaveDataTables
                 （同名键 overlay 优先，base 只补缺键；实测补回 2638 个键 ⇒ int 5444 / str 251）
文件源          : readSaveDataBoth()（Node 直读两侧 / Electron 新 IPC `read-save-data-both`）
```

并表是单调的 ⇒ 下一次保存写回的 overlay 副本就带上全部键，问题自愈；真游戏 base 那份始终不动。


### 7.10 ★真槽载荷的**逐字段全表**（引擎口径；`tickets/T-0071`）

把 `sub_40CD10`（写，case 3）、`sub_410160`（读，a4==3）、`sub_40F750`/`sub_40ED40`（帧装载）、
`sub_4192F0`（`0xAE` 走栈）四处**逐行对齐**之后的完整结构。行号为本仓 `engine/天结_unpacked.exe_utf8.c` 的**行号**。

**① 容器（292 B 头 + 20 B 块 + 置乱流）** —— 与 `SAVE.DAT` 同一套（`sub_438120` 读头 / `sub_437980` 读载荷）：

| 偏移 | 类型 | 含义 | 所属系统 |
|---|---|---|---|
| +0 | char[4] | 魔数「S4SD」（旧引擎「S3SD」；`sub_438120` 45121 比对） | 容器 |
| +8 | char[] | **游戏标题串**（与本进程的标题 `Engine+698912` 比对；不符 ⇒ 读头失败） | 容器 |
| ~+64 | char[] | 引擎版本串（本机 `460B`） | 容器 |
| +240 | u32 | **payload 逻辑字节数**（解压后长度；读侧 `v8 = v99[60]/4 + 1` 用它开缓冲，19313） | 容器 |
| +264/266/268 | u16×3 | 年 / 月 / **星期**（`0x1A0` 不取它） | 存档槽 UI |
| +270/272/274/276 | u16×4 | 日 / 时 / 分 / 秒（`0x1A0` 的 `op3..op8`，38390-38395） | 存档槽 UI |
| +280 | i32 | **游玩秒数**（`0x1A0` 的 `op9`；装载时接回 `Engine` 的计时器） | 存档槽 UI |
| +284 | u32 | **`set:SaveVersion1`**（格式：1/2/3；本机真槽 = 3） | 引擎版本 |
| +288 | u32 | **`set:SaveVersion2`**（子版本：10/20；本机真槽 = 20） | 引擎版本 |
| +292 | u32 | `storedDwords`（= 2×逻辑 dword；以下置乱流长度） | 容器 |
| +304 / +308 | u32×2 | `seed1` / `seed2`（`sub_436E90` 的两个种子） | 容器 |
| +312 | u32×n | 置乱流 → LZSS（`sub_436A80`）→ `[crc32MsbFirst, crc32, body]` | 容器 |

**② body（`a4 == 3`：21252 B 前导 + (savedCur+1)×1044 B 帧记录 + 池块 + 图像清单）**

| 段 | 偏移/步长 | 字段 | 含义 | 所属系统 |
|---|---|---|---|---|
| 帧镜像前导 | +0 | `savedCur` | 存档时的帧号（`0xAE` 走栈的目标；写侧取 `i1ad` 记的那一帧） | 帧栈 |
| | +4 | `frames[savedCur].returnFrame` | 收尾写回 `Engine[95777]`（写侧 17468 读的正是**末帧记录**的 `[0]`） | 帧栈 |
| | +8 | `Music[259]` | **当前曲 id**（装载时写回 `Engine[698852]`，19911） | 声音 |
| | +12..51 | 40 B | ← `Engine+84088`：**消息窗/字体状态**（装载时 `qmemcpy` 回，19912） | 消息窗 |
| | +52..1251 | 100×12 B | **纹理槽**：`{id@+0, flag@+4, param@+8}`（= `Engine+16220` 的镜像副本，`sub_41ED80` 28429/17472 拷） | 纹理 |
| | +1252..21251 | 1000×20 B | **图像槽**：`{id@+0, param@+4, flag@+8, flag2@+12, ?@+16}`（= `Engine+324696` 的镜像副本，`sub_41ED80` 28430/17474 拷） | 图像/绘制 |
| 帧记录 | +21252+1044k | `[0]` | `frames[k][95795]` = 返回帧（−1 = 根帧）；写侧 `v71[-1]`（17485） | 帧栈 |
| | | `[1]` | `frames[k][95796]` = **脚本统一文件 id**（`sub_40ED40` 按它装载） | 脚本 |
| | | `[2]` | 返回栈深度（`_this[97153+k]`，17488） | 脚本 |
| | | `[3..2+depth]` | 返回栈元素 = **表 2（`0x8F` call 表）下标**（写侧搜 `table2[i]+3 == 栈值`，17501-17517；读侧 `sub_40F750` 18944 再 `+3` 还原） | 脚本 |
| | | `[259]`（字节 1036） | **表 0（`0x71` 消息表）下标** —— 装载后 ip 落在该消息上、`95805 = 0`（**重放这句话**） | 脚本 |
| | | `[260]`（字节 1040） | **表 1（`0x3` call-script 表）下标** —— 装载后 ip 落在**它的下一条**、`95805 = 3`（17560-17561 里"末帧恒 −1"即此） | 脚本 |
| 池块 | 镜像之后 | u32×6 | `{intCount, floatCount, stringCount, ipTableA_len, ipTableB_len, ipTableC_len}` | VM |
| | | ints | **明文**（`ENC` 只在内存侧）；intCount = 本机 81 个真槽**全为 1,015,792** | VM |
| | | floats | 明文（`a5 >= 20` 才拷，19750-19752） | VM |
| | | u32 + strings | 字符串区 dword 长 + `stringCount` 个 NUL 结尾串 | VM |
| | | 表 A/B/C | 三张 **全局** ip 表（A = `0x71` 消息、B = `0x3` call-script、C = `0x8F` call） | 脚本 |
| 图像清单 | 池块之后 | `{740, count, (1 dword + 740 B)×count, …}` | 读档时按 id 重解码图像（`sub_4559C0`） | 图像 |

**③ 装载（`sub_410160` 的 a4==3 段）逐条做了什么（每一条都对应一个系统）**

| 顺序 | 引擎 | 行号 | 系统 |
|---|---|---|---|
| 1 | （可选）清 1000 个对象槽 / 10 个 SE 通道 | 19380-19389 | 图像 / 声音 |
| 2 | `memcpy(Engine+604840, body, 1044*n + 22296)`（镜像整块落进 Engine） | 19744 | 全部 |
| 3 | 池块 → `Engine[95744/95746/95748/95750/95752/95754]`；`int` 池**先 memset(count+1) 再 memcpy(count)** ⇒ ★**只覆盖 0..count，池外下标保留旧值** | 19705/19747 | VM |
| 4 | 100 个**纹理槽**：`flag==1 && id>=0` ⇒ `sub_40BF20(Engine+7912, 槽, id, 数据, 名)` 重新解码 | 19849-19872 | 纹理 |
| 5 | 1000 个**图像槽**：`flag==1 && id>=0` ⇒ `sub_4559C0`+`sub_455560`+`sub_4A3800(Engine+322832, id, 数据, 槽, param, 0)`（顺带写回槽表 `[5*槽+466/467]`） | 19875-19910 | 图像 |
| 6 | `Engine[698852] = 镜像[+8]`（BGM）；`Engine+84088 ← 镜像[+12]`（消息窗 40 B） | 19911-19912 | 声音 / 消息窗 |
| 7 | `sub_4B5090`（SE 重装）+ `sub_403EF0`×2（两张面板复位） | 19913-19915 | 声音 / 面板 |
| 8 | `cur = 0`、`Engine[383120] = 1`（读档门）、帧 0 ← **`CALLBACK_LOAD.BIN`**（按名解析 `sub_455000(FileDB, String2)`，返回帧 = **-11** 哨兵） | 19916-19918 | 帧栈 |
| 9 | `CALLBACK_LOAD` 的 `exit`：`frames[0][95795] == -11` ⇒ `sub_40F750(sv1, sv2)` 装**记录 0 的脚本**（入口 ip=0）。★第 8 步那一跳干的是**上一个画面的收尾**（`src/CALLBACK_LOAD.txt`：`i19b` ADV 退出 / `i20d -1` 渲染目标 / `detach-texture 110000 2000` 释放 2000 个句柄 / `i324` / `i2fa 0` / `i2f6 0..2` / `i0b6 0..9` / `global 3f36 = 0` / `i0b7 0` BGM 重播）—— 少了它，续跑会带着上一场的 ADV/消息窗状态（实测：第一条消息落进 1 号窗而不是 8 号窗） | 19919-19927 / 25649-25658 | 帧栈/脚本 |
| 10 | 脚本入口的 `i0ae`（`0xAE`）逐帧走栈：按 `rec[260]`→表1（进 3 dword）/ `rec[259]`→表0（停在该条）落 ip，`cur < savedCur` 则装下一帧，`cur == savedCur` 收尾（`95777 = 镜像[+4]`、门清零） | 24706-24736 | 帧栈/脚本 |

★**实测分布**（本机 81 个真槽，E4）：第 4 步的 100 条纹理槽表**全是零**（`flag` 从不置 1）⇒ 那一段在本作里等价空操作；
第 5 步每个槽有 **0–3 条**有效条目，**全部是场景大图**（`BG*`/`CS*`/`EV*`/`AE*` 的 AGF，如 `BG050ABL.AGF`），
而 `SO0xx`（窗口 UI）那些条目的 `flag == 0`（不重载 —— 它们由脚本自己在续跑路上再 `set-texture` 一次）。
⇒ **第 5 步就是"读档后画面里的背景/立绘从哪来"的答案**；漏掉它 ⇒ ADV 文字在、背景全空（2026-09 用户实测）。

★**`flag` 与 `flag2` 是谁写的**：`0x258`（`i258`，`sub_425D20` raw 33156-33185）——
`i258 <槽> <位掩码>`：`op2 & 1` ⇒ 该槽的 `+8` 与镜像的 `+8` 都写 1（否则都写 0）；`op2 & 2` ⇒ 同理写 `+12`。
也就是说**"读档要重载"是脚本显式打的标记**（两个位分别对应两类图像），而 `0x259`（`sub_41A3A0`）
在每个场景开头把 1000 条**两表的 `+8/+12` 全部清 0**（= 丢掉上一场的标记）。
⇒ 存档里 `+8 == 1 且 id >= 0` 的那些槽 = **该场景自己声明"读档后要重建"的图**（本机实测：`BG*`/`CS*`/`EV*`/`AE*` 这类场景大图）。

**④ 本工程的两条偏离（都已修，见 `tickets/T-0071` / `T-0066`）**

| # | 引擎 | 修前 emulator | 现状 |
|---|---|---|---|
| 1 | 第 5 步按 1000 条图像槽表重解码（槽 79 = 槽 4 ← `BG050ABL.AGF`） | 只 `markFileUsed`（图像一个不装） | ✅ 已按表装回 `Engine.texSlots` + 对 `flag==1` 的条目 `bindTexture` |
| 2 | 第 3 步**只覆盖池内下标**（`0..count`），池外（如 `global 708ada` = 7,375,578、`global f8c48` = 1,018,952）保留旧值 | `globals.int.clear()` 整份清空 ⇒ 池外全局读成 0 | ✅ 只覆盖 `0..池长` |
| 3 | 第 8/9 步的 `CALLBACK_LOAD.BIN` 那一跳（ADV 退出 / 渲染目标 / 释放 2000 个句柄 / SE·语音复位 / `savemesskip`） | 直接装记录 0 的脚本（只补了 BGM 重播） | ✅ 已按引擎接上（`T-0072`）：按名装回调进帧 0（返回帧 -11），`exit` 走 -11 分支装记录 0；该脚本自身用到的 `0x137`/`0x244` 已登记（评价：`0x2FA` = 只写字段 `Engine[1951]`，全反编译里只有那一次写 ⇒ 等价 no-op 成立；`0x137` = 整型栈复位（`sub_4222B0`，同族 `0x138` push/`0x13B..0x13D`，emulator 未建模该栈）、`0x244` = 窗复位（`sub_41A370 → sub_4AD9F0(Scene,2)` 遍历绘制项复位 `flags&2` 者的窗）⇒ **两条是"未建模缺口"，不是等价 no-op**；语料各 1 处） |
| 4 | ★★**装载路径会清绘制容器 —— 但是 `sub_410160` 行内做的**（2026-09 轮 5 订正）：raw **19810-19820** 先整批销毁 `Scene+1032` 容器的树（`sub_40BB60` 释放 + `operator delete`）并复位哨兵/计数（`Scene+0x40C` 树根 `next/prev = self`、`Scene+0x410 = 0`），raw **19822-19832** 再把存档 body 末段 `{u32 740、u32 count、(u32 handle + 2960 B 记录区) × count}` 逐条 `sub_49A300`（740 B 记录默认初始化，raw 116879）+ `memcpy` + `sub_40C910`/`sub_40C310`（按键查/建节点后赋值）插回容器。★**旧结论「27 个被调函数里没有清容器」是对的但结论下错了** —— 清容器不是被调函数、而是 `sub_410160` 自己的行内语句；raw **19378-19389** 那两段**配置门**（`CreateObject&2` / `AutoFreeTexture&2`，默认 1/0 ⇒ 假）确实不执行，但它们管的是**1000 个槽对象**与**两个网格容器**（`+1064`/`+1096`），与绘制项容器（`+1032`）无关。raw **19913-19915** 的两个 **仮想ディスプレイ**复位（`sub_403EF0`，体 raw 9958-9971）复位的是**两套点击热点表 + 鼠标游标**（`virtual_display_a/b` = `Engine+0x55D8`/`0xCAC0`），也不是绘制项。⇒ **引擎读档后画面上是「存档那一屏的绘制项」**（如真槽 79 的 69 条：背景 handle 0x18A88/slot 4/BG050ABL 全屏 + ADV 侧栏 tex 17 + 消息窗字格 tex 28） | 单模型：装载点经宿主缝 `native.restoreDrawItems(items)` 一步做完「清上一屏 + 装存档清单」（= 上面 raw 19810-19832 的等价物） | ✅ **2026-09 轮 5 已按引擎口径实现**（`tickets/T-0083`）：`src/vm/engineDrawItem.ts`（740 B → `Item`，矩阵按 D3DX 写入位置取分量）＋ `engineSlot.ts` 的清单解析（**步长修正** `1 + size` = 2964 B）＋ `restoreDrawItems`（两宿主对称）；`Item.ownerFrame`/`dropFrameItems` **降级为「body 无清单」时的回退**。E4：`--load 79` 日志 `清掉上一屏 172 项、按存档装回 69 项`，阶梯/灰块消失（截图 `tickets/T-0083/evidence/after-itemrestore-*.png`）；守卫 `test/engine-slot.test.ts` / `test/slot-load-screen.test.ts` |



## 8. 相关

- 引擎级配置（另一套）：`engine-config-registry-persistence` + `docs-new/03-engine/opcode-table.md` 的
  `0x0C5/0x0C7/0x131/0x141/0x1B5/0x1B8/0x1B9/0x2CC/0x2CD/0x2E6/0x2E7/0x2EA/0x2EB`。
- 脚本站点：`docs-new/05-scripts/INITCONFIG*.md`、`LOADCONFIG.md`、`CHECKCONFIG.md`、`SYSTEM4.md`。
- 文本颜色/描边的生效范围（CHECKCONFIG 派生 `f807b/f807c` 之后）：`message-config-gates.md`、
  `adv-text-rendering.md` §3.5 与台账 `text-style-scope-queue-time`。


