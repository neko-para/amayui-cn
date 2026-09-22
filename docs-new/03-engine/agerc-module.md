---
kind: narrative
state: live
---
# AGERC.DLL 模块接口（`0x14B` / `0x14C` / `0x14D`）

> 本文回答一个曾经被误判的问题：**引擎里那个"加载动态库"的指令到底加载什么，能用它加载任意库吗？**
> 结论：**不能**。脚本层能加载的库名只能来自 `SYS4INI` 文件表，而**全语料只有一个调用点**，
> 它加载的是引擎自己的 `AGERC.DLL`；引擎本体更是用**硬编码字面量**加载同一个 DLL。
> 逐 opcode 的 handler 结论在 `opcode-table.md` 与 `analysis/functions.json`；第二层（常态能力）见
> `engine-capabilities.json` 的 `agerc-module-interface-and-version-lock`。

## 1. 两条独立的加载路径（都指向同一个 DLL）

### 1.1 引擎本体：WinMain 早期，硬编码名字

```
WinMain（raw 141969-141983）
  CreateSemaphoreA(...)                       ← 单实例锁
  sub_48E730(AGERC 接口对象)                   ← ★加载 AGERC.DLL
      LibraryA = LoadLibraryA("AGERC.DLL")    ← 字面量：tstrFilename[] (raw 4927)
      [1] = LibraryA；失败 ⇒ MessageBox「AGERC.DLLを読み込み出来ません．ERRORCODE = %d」(raw 109423)
      [2] = GetProcAddress(LibraryA, "_GetInstance@0")
      [3] = GetProcAddress(LibraryA, "_ShowDialog@12")
      [4] = GetProcAddress(LibraryA, "_OperateMenu@16")
      任一为 0 ⇒ MessageBox「AGERC.DLLのアドレス設定に失敗しました．ERRORCODE = %d」(raw 109415)
      sub_48E640(接口对象)                     ← 版本校验
  …
  v26 = GetConfig("set:RCVersion")            ← raw 5004
  if (v26 && v26 != AGERC实例[5]) MessageBox「AGERC.DLLのバージョンが異なります．」+ 退出   ← raw 142155-142162
```

⇒ 引擎把 AGERC 当成自己的**同版本配套模块**：启动时加载、解析 3 个 UI 导出、**校验版本**，
不符就弹框退出。`set:RCVersion` 是引擎配置里的键（真机 `SYS4REG.INI` 没有 `[set]` 节 ⇒ 该键为 0 ⇒ 跳过校验）。

### 1.2 脚本层：`0x14B` / `0x14C` / `0x14D`（唯一调用点 `SAVE.txt`）

`src/SAVE.txt` 开头（第 6-9 行，`SAVE.BIN` 的 `ip = 1..4`）：

```
mov (local-int 21bc) 12                              ; 12 = 名字长度上限
i14b 5250                                           ; 0x14B：加载文件 id 0x5250 = 21072 = AGERC.DLL
set-agerc-export 1 "_SetNameLenMax@20"              ; 0x14C：把该导出绑到槽 1
call-agerc-export 1 (local 12) (local 21bc) 1 (local 21bc) 0   ; 0x14D：调用（5 实参）
```

- **库名来源**：`i14b` 的 op1 是**统一文件 id**；`FileDB::idToName`（`sub_454FA0`）在 `SYS4INI` 文件表里查出名字。
  id `0x5250` = **21072** → **`AGERC.DLL`**（`.tmp/sys4ini-files.json` 第 21072 项，位于 `DATA1.ALF`，849 408 字节）。
- **全语料唯一**：941 个 `src/*.txt` 里 `i14b` 出现 **1 次**、`set-agerc-export` **1 次**、`call-agerc-export` **1 次**，
  全在 `SAVE.txt`。⇒ 不存在"脚本按需加载任意 DLL"的机制。

### 1.3 三个 opcode 的精确语义

| opcode | handler | 语义 |
|---|---|---|
| `0x14B` | `sub_4229D0`(31056) | 若 `Engine+490072` 已有句柄 ⇒ `FreeLibrary` 并清 0；op1 = 文件 id → 名字 → `LoadLibraryA` → 存回 `Engine+490072`；失败 ⇒ 抛 ShowMessage |
| `0x14C` | `sub_422AB0`(31090) | op1 = **槽号 0..99**（越界抛「%sの関数インデックスが不正です．0から99までを指定してください．」）、op2 = 导出名 → `GetProcAddress(模块, 名)`（失败抛「%sのアドレス取得に失敗しました．」）→ 存进 `Engine + 4*槽 + 490076` |
| `0x14D` | `sub_430170`(43038) | `i14D <槽> <op2 未使用> <数组地址> <数组长度> <数组地址2> <n>`：把 op3 的数组**逐元素 DEC** 到临时缓冲 → `(*槽表[op1])(Engine[96981], 缓冲, 长度, op5, n)` → 把缓冲 **ENC 回写** op3。★DEC/ENC 说明参数是**脚本侧编码的整数数组**（key 见 `Engine[97059]`） |

字段（`analysis/fields.json`）：`Engine+490072`（dword 122518）= 模块句柄；`Engine+490076` 起 **100 槽**函数指针表。
实参首项 `Engine[96981]`（字节 387924）= 引擎的消息窗 HWND（资源加载 `sub_4559C0` 也把它当"窗口"参数）。

## 2. AGERC.DLL 是什么：21 个导出（`ARCGameEngine Resource`）

PE 版本资源：`FileDescription = "ARCGameEngine Resource"`、`CompanyName = "ARC Software Laboratory"`、
`FileVersion = 39.1.0.0`。导出表（`.tmp/peExports.mjs raw/AGERC.DLL`）：

| 分类 | 导出 |
|---|---|
| 引擎启动时解析（3） | `_GetInstance@0`、`_ShowDialog@12`、`_OperateMenu@16` |
| 存档命名（脚本唯一用到，1） | `_SetNameLenMax@20` |
| 地图 / 地块 / 碰撞（17） | `_FindClash@20`、`_GetEv@20`、`_GetLand@20`、`_InitRect@20`、`_SetChParams@20`、`_SetMapEvPN/PX/PY@20`、`_SetMapLandIdx/PN/PX/PY@20`、`_SetMapParams@20`、`_SetMapWallCr/PN/PX/PY@20` |

⇒ AGERC 是**引擎自己的地图/地块/碰撞 + 菜单对话框模块**（Eushully 把它从 exe 拆成 DLL，
所以才有 `set:RCVersion` 这道"必须同版本"的锁）。**地图那一族 17 个导出脚本侧一次都没用** ——
脚本层只用了一个和存档命名相关的 `_SetNameLenMax@20`。

### 2.1 汉化相关：这个 DLL 是**被替换过**的

| 文件 | 大小 | 导出 | 版本 | md5 |
|---|---|---|---|---|
| `install/AGERC.DLL`（exe 同级，**`LoadLibraryA` 真正加载的那个**） | 848 896 | 21 个同名 | 39.1.0.0 | `c25e5ca2…` = **`install-manifest.json` 里登记的哈希** |
| `install/DATA1/AGERC.DLL`（原始资源，只在 ALF 里） | 849 408 | 21 个同名 | 39.1.0.0 | `1fac5b87…` |
| `raw/AGERC.DLL`（日文原版） | 335 872 | 21 个同名 | 39.1.0.0 | `c9129d77…` = `raw-manifest.json` |

三者的**导出名集合与版本号完全一致**（导入表里能看到 `d3d9.dll`/`VERSION.dll`/`WINMM.dll` ⇒ 它自己会创 D3D 设备、
读版本资源）。`install/` 那份与 `raw/` 那份哈希不同 ⇒ **汉化替换过这个 DLL**（社区先例里"天结2 汉化 = BIN + AGERC.DLL"
也印证：`_ShowDialog`/`_OperateMenu` 画的是引擎自绘对话框/菜单，文本在里面）。
⇒ 这也解释了版本锁的意义：引擎要求"与我配套的那个 RC 模块"，替换时必须保持版本字段一致，
否则启动即 MessageBox「AGERC.DLLのバージョンが異なります．」并退出。

### 2.2 反汇编里能直接看到的汉化痕迹：宽字符串（UTF-16LE）是简体中文

反汇编里绝大多数非 ASCII 文本是 **ANSI/CP932 日文**（`正しく登録されました`、`エラー`、
`画像を保存するフォルダを選択してください`…；全角片假名按原样写作**半角片假名**：`ﾌﾙｽｸﾘｰ`、`ﾒｯｾｰｼﾞ`、`ｳｲﾝﾄﾞｳ(推奨)`）。
但**菜单项文字是 UTF-16LE 简体中文**（`MENUITEMINFO.dwTypeData`）：

| 位置（`AGERC.DLL.c` / `_utf8.lst`） | 原始字节 | 正确解 |
|---|---|---|
| L2001-2002 / L8338 + L29785 | `3E 66 3A 79 88 6D 6F 60 97 7A E3 53 28 00` | `显示消息窗口(` |
| L2007-2008 / L8357 + L29776 | `90 96 CF 85 88 6D 6F 60 97 7A E3 53 28 00` | `隐藏消息窗口(` |

- 字节对 `663E 793A 6D88 606F 7A97 53E3 0028` = `显示消息窗口(`（UTF-16LE）。按 CP932 解**失败**、
  按 GBK 解是乱码（`>f:y坢o\`梲鉙(`）⇒ 只有按 UTF-16LE 解才是原文。
- 用点是 `sub_10039F10`（系统菜单状态刷新）里的 `SetMenuItemInfoW(hMenu, 0x9C64, …)`（L2001-2009），
  即**顶部菜单里"显示/隐藏消息窗口"两项**；同族代码 `mii.cch = j__strlen("显示消息窗口(")` 是引擎自己
  （对宽字符串取字节长度）的写法。
- ⇒ 与 §2.1 的哈希结论互为印证：`install/AGERC.DLL` 确为**汉化改动过的构建**，且改动方式是
  **只替换宽字符串**（菜单项文字），ANSI 字符串仍是日文原型。

## 3. emulator 现状（2026-09 **已实现**，A6 批次）

| | 现状 |
|---|---|
| `0x14B` | ✅ `OPS` 的 `op_agerc_load`（`handlers/agerc.ts`）：重载语义（已有句柄 ⇒ 清槽）+ **只接受 `AGERC.DLL`**（id `0x5250`），其余 id 按引擎同文报错；状态 = `Engine.agerc.loaded` |
| `0x14C` | ✅ `op_agerc_bind_export`：导出名按 PE 实读的 **21 个**校验（查不到 ⇒ 引擎同文「アドレス取得に失敗しました」）、槽 0..99 越界 ⇒「0から99まで」 |
| `0x14D` | ✅ `op_agerc_call_export`：op3 数组按 DEC 读出 → 调槽 → ENC 回写 → `op2 ← 返回值`；内置导出表里只有 `_SetNameLenMax@20` 有行为（写 `Engine.agerc.nameLenMax`，初值 18），其余**调用即抛**明确错误（本作不可达） |

**实测后果**（探针 `.tmp/loadDataProbe.mts`，可直接复跑）——**A6 之前 vs 之后**：

```
（A6 之前）★ 首次未实现指令：0x14c set-agerc-export @SAVE.BIN:ip=2      ⇒ 一进 Load Data 就硬报错
（A6 之后）★ 首次未实现指令：0x1a0 i1a0 @SAVE.BIN:ip=628                ⇒ 存档/读档界面已能跑 628 条指令
```

即 **TITLE →「Load Data（ロード）」不再卡在 AGERC 链上**：`SAVE.BIN` 的第 1-4 条
（`i14b 5250` / `set-agerc-export` / `call-agerc-export`）现在按引擎语义执行。
**下一个缺口**是同一条路上的 `0x1A0`（`sub_42DC70` raw 38366-38404，argc 9）＝
**存档文件读取**（`"%s\\SAVE%2.2d.DAT"` + `CreateFileA` + `sub_438120` 反序列化；语料 339 处 / 335 个脚本）——
它**不在**复评台账的 57 条 stub 里（属"压根没有 handler"的 286 条），需要另立批次。

**实现方式（不需要任何原生依赖）** —— 与本节此前的建议一致：
1. `0x14B`：把"AGERC 模块已加载"记为状态，并**校验库名**（只接受 `AGERC.DLL`）⇒ 把"只能加载这一个库"编码进实现；
2. `0x14C`：在内置的 **AGERC 导出表**（§2 的 21 个名字）里查名，查不到/越界 ⇒ 抛与引擎同文的 ShowMessage；
3. `0x14D`：调用该槽；唯一会被调到的 `_SetNameLenMax@20` 建模为"记录存档名长度上限"
   （可见效果只在 AGERC 的注释输入 UI，emulator 未建模该 UI ⇒ 先记录 + 台账登记）。


### 3.1 范围界定：17 个地图/地块/碰撞导出**本作不可达**，不必实现

AGERC 另外导出 17 个地图/地块/碰撞函数（见 §2 表），但专项核查证明它们在《天結》里**没有任何调用者**：

| 检查 | 结果 |
|---|---|
| exe 反编译源码里 `FindClash`/`GetLand`/`GetEv`/`InitRect`/`SetChParams`/`SetMap*` | **0 命中** |
| exe 清单 `.lst`（含导入表/全部引用）里同上一组名字 + `_SetNameLenMax@20` | **0 命中** |
| exe 里对 AGERC 的 `GetProcAddress` 字符串 | 只有 `_GetInstance@0` / `_ShowDialog@12` / `_OperateMenu@16` |
| `_SetNameLenMax@20` 的唯一调用者 | **脚本**（`SAVE.txt:7-9`），不是 exe |

⇒ 那 17 个导出是「ARCGameEngine Resource」这个共享模块给**同期别的作品/工具**复用的部分
（一套自足的多边形碰撞微引擎：墙/地/事件三层 + `FindClash` 扫掠圆判定 + `GetLand`/`GetEv` 点在多边形），
本作的碰撞在引擎自己里。**emulator 只需实现 `0x14B/0x14C/0x14D` + 内置导出表里的 `_SetNameLenMax@20`。**

> 模块**内部**到底有哪些功能面（顶部菜单 38 个命令、设置对话框族、配置键全集、
> 截图/注册码/硬件信息、以及那套碰撞微引擎的细节）见
> **[`agerc-internals.md`](./agerc-internals.md)　AGERC.DLL 内部能力地图**。

## 4. 反汇编 UTF-8 转写（`engine/AGERC.DLL_utf8.{c,lst}`）

与引擎本体那两份一样，`engine/AGERC.DLL.c`（Hex-Rays）与 `engine/AGERC.DLL.lst`（IDA 清单）
是 **CP932 + UTF-16LE 混编**，需读 `*_utf8.*` 版本。转写脚本 `.tmp/convert_agerc_utf8.py`
（沿用 `.tmp/convert_to_utf8.py` 的逐行字节解码方法，另加两类规则），**原始文件不动、行号完全保留**，
输出为 **UTF-8 + LF**（源文件是 CRLF，CR 按需丢弃）。

字节实测（脚本报告 `.tmp/agercConvertReport.txt` 逐行给出 in/out 对照）：

| 文件 | 大小 | 行数 | 非 ASCII 行 | 其中 |
|---|---|---|---|---|
| `AGERC.DLL.c` → `_utf8.c` | 176,953 B | 5,102 | 28 | CP932 24 + UTF-16LE 宽串 4 |
| `AGERC.DLL.lst` → `_utf8.lst` | 27,924,926 B | 1,074,510 | 565 | CP932 560 + GBK 文件名行 1 + UTF-16LE 4 |

规则：
1. 纯 ASCII 行原样；
2. 含 `; File Name   :` 的行整体按 **GBK**（`CC EC BD 59` = `天結`）；
3. 引号内字节串若「按 UTF-16LE 解出来是 ASCII+汉字」且处在宽字符串上下文（`(LPWSTR)` / `dwTypeData` /
   `text "UTF-16LE"` / IDA 的 `aXxx db` 串标号）⇒ 按 **UTF-16LE**（即 §2.2 那两串；同一串在 `j__strlen("…")`
   里没有 cast，靠"同字节串已识别"一致解出）；
4. 其余按 **CP932** 逐字节解；CP932 解不出的单字节保留原码位（IDA 的 `; \x80` 字节字面量 ⇒ U+0080，
   与既有 `天结_unpacked.exe_utf8.*` 约定一致）。
   本对文件**没有** GBK xref 箭头（引擎本体那份有 `A1 F4..FE`）；
   仅 `AGERC.DLL.lst:39674`（`.rdata` 一处二进制结构体 `db '\x80\x80\x86\x80\x81\x80',0`）两边都解不出，按规则 4 处理。

### 4.1 顺带修正了解码器的一个半角片假名 bug（影响既有引擎转写）

逐字节回退必须按 CP932 的**字节结构**判定：`A1..DF` 是**单字节**半角假名，**永远不是前导字节**，
不能"盲试两字节"。旧脚本盲试时，若半角假名后面跟着一个真正的前导字节（如 `B1 8F`）会配对失败并回退成
Latin-1（`ﾊｰﾄﾞｳｪｱ` 里的 `ｱ` 变成 `±`）。修正后：

- AGERC 两份产物 **0 处** Latin-1 残留；
- 既有 `engine/天结_unpacked.exe_utf8.c` 有 **1 行**受影响（L4269 `ｷｬﾝｾÙ` → `ｷｬﾝｾﾙ`），
  `engine/天结_unpacked.exe_utf8.lst` 有 **2 行**（L426830 同上、L471957 `Ì第１引数…` → `ﾌ第１引数…`）。
  **这 3 行尚未重跑**（只改字符不改行数，行号引用不受影响）——如需修正，用同一脚本同样规则重跑引擎本体两份即可。
