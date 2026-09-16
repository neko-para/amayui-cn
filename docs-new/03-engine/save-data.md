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
  `v23 = *v20; v34 = v20[1]; v24 = (char *)(v20 + 2)`，`v34` 就是那个 `trailerDwords`，
  记录区按 dword 对齐（`4×(v34-1)` 字节，尾部补零）。
  **少跳这 4 字节不会报错**：第 1 条会被读成乱码键，并且**静默丢掉最后一条记录**——
  天結真存档里最后一条恰好是字体键 `\x05…bbf`（CONFIG 第 3 行字体），于是表现为
  「五个字体项里第三个回退到默认字体」。emulator 侧 `src/vm/saveData.ts` 的 `parseTables(…, engineLayout)`
  按引擎布局读，并用 `记录区字节数 ∈ [声明区-3, 声明区]` 做**结构自校验**（宁可如实报错，也不静默丢键）。
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
| 存档槽（`0x1A1` `sub_42DDE0` / `SAVE%02d.DAT`） | ✅ 已实现（`0x19E` 存 / `0x1A1` 读 / `0x1A0` 读头 / `0x19F` 短读 / `0x1AB` 删 / `0x1AC` 复制 / `0x1AE`·`0x1AF` `.STH`）；真槽（format 1..3）只读头 + 接游玩秒数，状态主体仍是缺口（§7 + `SLOT_GAPS`）；守卫 `test/save-slot.test.ts` |

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
- `SLOT_GAPS`（诚实边界，别当保证）：① 真槽（format 1..3）的状态主体没解析（只接游玩秒数 + 空表）；
  ② 只还原"当前帧 + 调用栈上的帧"；③ `0x19E` 的覆盖确认框没建模（宿主无对话框 ⇒ 恒等于"点了是"）；
  ④ `.STH` 已解（320×180 24bpp BMP；`tickets/T-0036`），仍未做的是 DrawMode==1 的截图分支；
  ⑤ 按名读档族（`0x190`/`0x0AA`/`0x0AB`/`0x0AC`）未实现（语料 0 次）。

## 8. 相关

- 引擎级配置（另一套）：`engine-config-registry-persistence` + `docs-new/03-engine/opcode-table.md` 的
  `0x0C5/0x0C7/0x131/0x141/0x1B5/0x1B8/0x1B9/0x2CC/0x2CD/0x2E6/0x2E7/0x2EA/0x2EB`。
- 脚本站点：`docs-new/05-scripts/INITCONFIG*.md`、`LOADCONFIG.md`、`CHECKCONFIG.md`、`SYSTEM4.md`。
- 文本颜色/描边的生效范围（CHECKCONFIG 派生 `f807b/f807c` 之后）：`message-config-gates.md`、
  `adv-text-rendering.md` §3.5 与台账 `text-style-scope-queue-time`。
