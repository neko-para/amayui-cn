# AGERC.DLL 内部能力地图（模块功能归类）

> **本文回答「AGERC 里到底有什么」**——模块接口（谁加载它、脚本怎么用、版本锁）见 [`agerc-module.md`](./agerc-module.md)。
> 真源：`engine/AGERC.DLL_utf8.c`（Hex-Rays 全量反编译，UTF-8；**本文行号即该文件行号**）
> + `engine/AGERC.DLL_utf8.lst`（IDA 清单，用于 thunk/地址/导入表取证）。
> 原始 cp932 文件 `engine/AGERC.DLL.c` / `.lst` 的转写规则见 [`agerc-module.md`](./agerc-module.md) §4。
>
> **结论先行**：AGERC 远不止「对话框资源」。它是 AGE 引擎的**游戏外壳/系统 UI 模块**，自带的代码分成四块：
> ① **顶部系统菜单**（资源 MENU `124`，38 个命令 ID，可被配置裁剪）+ ② **设置对话框族**
> （启动 6 页 / 游戏内 5 页两套 tab 外壳 + 显示/文字/自动消息/音效/其它/動作環境 六个子页）
> + ③ **一整套运行时服务**（配置读写、显示模式套用、截图目录与剪贴板、注册码/版本信息、
> CPU·内存·DirectX·磁盘信息采集、热重载 `CALLBACK_*.BIN`）+ ④ **一个多边形碰撞微引擎**
> （17 个地图/地块/碰撞导出）。其中 ④ **在《天結》里不可达**（§6），①②③ 才是本作真正用到的部分。

## 0. 先确认「这份 C 看得到多少代码」——100%

`.c` 尾行 `// nfuncs=1699 queued=122 decompiled=122`。三组数字核对下来，**AGERC 自己的代码 100% 在这份 `.c` 里**：

| 事实 | 数据 | 取证 |
|---|---|---|
| `.c` 里的函数体 | **122 个**（`DllMain` @10034CA0 … `sub_10088550`） | 每个带 `//----- (地址) ---` 注释 |
| `.lst` 里的函数（`proc near`） | **221 个** | `.text` 段共 221 个 `proc near`、0 个 `proc far` |
| 差额 99 个是谁 | **全部**在 `0x10032000–0x10034C9F`（`DllMain` 之前的跳转桩区） | 该区 1973 行里 574 条 `jmp`、97 个 `proc`，形如 `sub_10032096 proc near / jmp sub_10060910 / endp` |
| `.c` 的函数有没有漏 | **0 个漏**：122 个地址在 `.lst` 里全部有 `proc`；`0x10034CA0` 以上的 `.lst` `proc` 无一在 `.c` 里缺体 | 见 §附录 B 脚本 |
| 212 条声明中 62 条「只有声明没有体」 | **52 个是 jump thunk**（目标**全部**有函数体）+ 10 个是 CRT/STL 库函数（`std::exception`/`_LocaleUpdate`/`type_info`/`operator delete`/`_RTC_CheckStackVars` 等，Hex-Rays 对库函数本来就不出体） | thunk 例：`DialogFunc → jmp sub_10036DE0`、`sub_10032B3B → jmp sub_10038330`、`sub_10032924 → jmp sub_10039A00`、`sub_10032CBC → jmp sub_10039F10`、`sub_10032A64 → jmp sub_10036820` |

> ⚠ **方法教训（与 `sub_453530` 同一类）**：`.c` 里「只有声明、没有函数体」**不等于**二进制里没有这段代码。
> 判断前必须查 `.lst` 的 `proc near` 后面是不是一条 `jmp`。本文档中所有对话框过程的用途判定，
> 正是靠把 thunk 目标解析回 `.c` 的函数体才拿到实证的（而不是靠猜契约）。

## 1. 双向接口：exe ⇄ AGERC（一个 COM 味道的服务定位器）

```
exe (天结_unpacked.exe)                                   AGERC.DLL
  WinMain: LoadLibraryA("AGERC.DLL")                        DllMain (L618-629)
    GetProcAddress "_GetInstance@0" / "_ShowDialog@12"        hInstance = hinstDLL
                    / "_OperateMenu@16"          ─────────►   GetClassObject = GetProcAddress(GetModuleHandleA(0),
    set:RCVersion 版本校验（不符即 MessageBox 退出）                        "_GetClassObject@4")   ← 取宿主 exe 的导出
                                                              OperateMenu (L645-672)
脚本 (SAVE.txt:7-9)  i14b/set-agerc-export/call-agerc-export     dword_10150E60 = GetClassObject("AGE:reg")        ← 配置对象
  0x14B/0x14C/0x14D → _SetNameLenMax@20 (L1145-1149)             dword_10150E64 = GetClassObject("AGE:IAGEService") ← 引擎服务
```

- 宿主 exe 的 `_GetClassObject@4` 是**它唯一的导出**（`.edata:005AF028`，实现 `0x4B52F0`），
  按 ProgID 字符串分发：`"AGE:reg"` / `"AGE:IAGEService"`（exe 侧字面量 L5198-5199）。
- **`AGE:reg`** = 配置注册表对象，四个槽被 AGERC 用到：`+4 Get(int)`、`+8 GetString`、
  `+12 Set(int)`、`+16 SetString`（证据：L1886 / L1785-1791 / L3327 / L1862）。
- **`AGE:IAGEService`** = 引擎服务对象，vtable 在 exe 的 `0x526AF4..0x526BE0`（≈59 槽，`sub_476920…`）。
  AGERC 按槽号调用它完成真正的动作（套用显示模式、开关音乐/SE、存读档、消息窗显示状态……），
  本文用 `svc+N` 记槽偏移，证据行号见各节。
- **模态状态字 `dword_10150E70`**：AGERC 用位标记「当前有 UI 占用」（已见位 `2/4/8/0x10/0x20/0x100/0x200/0x400`），
  `ShowDialog(-1)` 直接返回它供引擎查询（L1597-1599）。
- 脚本侧只用到一个导出：`_SetNameLenMax@20`（§5.1）。

## 2. 配置域：AGERC 是这些键的「主人」

引擎配置命名空间 `set:` `display:` `message:` `sound:` `system:` `debug:` 里，**几乎全部由 AGERC 读写**
（引擎侧 `GetConfig` 读同一批键）。按用途归类（键 → 语义 → 证据行）：

| 命名空间 | 键 | 语义 | 证据 |
|---|---|---|---|
| `display:` | `ScreenMode` | 全屏/窗口（单选） | L2966, L3892 |
| | `ForceScreen` | 强制窗口模式（勾选时禁用全屏项） | L2988, L3058 |
| | `AspectMode` | 宽高比固定方式 | L3009, L3906 |
| | `VirtualFullScreenType` | 虚拟全屏放大方式（**UI 索引 ×2 写回**） | L3016, L3911 |
| | `VirtualFullScreen` | 虚拟全屏开关（**IDOK 恒写 1**） | L3899 |
| | `FullScreenWidth` / `FullScreenHeight` | 全屏分辨率（由预设表 `dword_101515A0[]`/`dword_10151410[]` 索引） | L3916-3925 |
| | `DeviceType` | D3D 设备类型（HAL/REF…） | L3023, L3930 |
| | `VertexProcessing` | 顶点处理（硬件/软件） | L3031, L3935 |
| | `PresentInterval` | 垂直同步 | L3037, L3940 |
| | `MultiSample` | 多重采样（**UI 索引 ×2 写回**） | L3044, L3941 |
| `message:` | `MessageSpeed` | 文字速度（**反相刻度**：0=不等待，100=最慢；菜单分 4 档） | L3114, L3644, L2057-2082 |
| | `ReadTextSkip` | 已读文本跳过 | L1981 |
| | `UseAntiFont` | 抗锯齿字体（受 `set:EnableAntiFont` 门控） | L2950, L2043 |
| | `MesWinAlpha` | 消息窗不透明度（0/4/8/12 四档） | L2087-2096 |
| | `RMouseEvent` | 右键行为（0/1/2 三选一） | L2021-2042 |
| | `AdvanceMesOnWheel` | 滚轮推进（**位域**：bit0/bit1） | L3126-3131, L3651 |
| | `AutoMessagePitch0/1`、`AutoMessageTime0/1` | 自动消息节奏/等待（**×10 / ×100 刻度**） | L3220-3233, L3661-3676 |
| | `AutoMessageOption` | 自动消息选项（**bit0 反相**） | L3244, L3681 |
| `sound:` | `Music` / `SE` / `Voice` | 音乐（三态 `-1/0/>0`）/ 音效 / 语音 开关 | L3333-3354, L2097-2116 |
| | `Volume0..3` | 四路音量，**1/10000 单位且滑块反相**（`10000-100*pos`） | L3713-3728, L3426-3441 |
| | `MusicFadeOnVoicePlaying`(+`Volume`) | 语音播放时音乐闪避 | L3325, L3703-3733 |
| `system:` | `SaveBMPPath` | 截图输出目录（空 ⇒ 桌面） | L1785, L1862 |
| | `UseAppDataFolder` | 截图默认目录走 AppData 判定 | L1798 |
| | `UseMMX` / `OutErrorLog` / `LimitTouch` / `LimitJoy` / `EffectSkipOnClick`(位域) | 「動作環境/その他」页开关 | L2942/2962/3003/3001, L3469-3740 |
| `set:` | `EnableAntiFont`、`ScreenWarning` | 抗锯齿字体总开关、屏幕警告文案 | L2946, L2976 |
| | `GameName` / `Copyright` / `GameVersion` / `IsReggist` | 关于框与注册状态 | L1315/1319/1323, L1348 |
| | `NoSetMusic` | 决定音效页用 `0x66`（有音乐）还是 `0x65`（无音乐）模板 | L3826, L4035 |
| | `Menu_Save` / `Menu_RClick` / `Menu_UseAntiFont` / `Menu_MesSpeed` / `Menu_MesWinA` / `Menu_SoundONOFF` / `Menu_Message` | **决定顶部菜单里哪些项存在**（§3） | L1886-1936 |
| `debug:` | `DebugFlag` / `DebugOutLabel` / `DebugOutVar` / `DebugOutFlag%d` / `DebugRemote` / `FunclstPath` / `DebugComputerName` | 调试菜单与调试输出配置 | L2811-2883 |
| — | `AGE:reg` / `AGE:IAGEService` | 服务对象 ProgID（非配置键） | L648/650 |

**三个易踩的换算/语义陷阱**（emulator 若要读同一批键必须照抄）：
①`MultiSample` 与 `VirtualFullScreenType` 的存储值是 **UI 索引的 2 倍**；
②`sound:Volume*` 是 1/10000 且**滑块位置与值反相**（`10000 - 100*pos`）；
③`message:MessageSpeed` 同样是反相刻度（`100 - pos`），且 `AdvanceMesOnWheel`/`AutoMessageOption`/`EffectSkipOnClick` 是**位域**不是布尔。

## 3. 顶部系统菜单（资源 MENU `124` + 38 个命令 ID）

三个入口都在导出 `_OperateMenu@16`（L645-672）：

| `OperateMenu` 的 a1 | 目标（thunk 实证） | 作用 |
|---|---|---|
| `0` | `sub_10032CBC → jmp sub_10039F10`（L1950-2131，182 行） | **刷新勾选/灰化状态**（按配置与 svc 状态逐个 `CheckMenuItem`/`EnableMenuItem`） |
| `1` | `sub_10032924 → jmp sub_10039A00`（L1873-1946，74 行） | **按 `set:Menu_*` 裁剪菜单**，并向主菜单第 4 位插入右对齐子菜单（`LoadMenuA(hInstance,124)`） |
| `2` | `sub_10032B04 → jmp sub_1003AD60`（L2136-2547，**411 行**） | **命令分发**：`switch(a3)` 38 个命令 ID |

- **命令 ID = Windows 菜单 ID 40003–40048**（`0x9C43`–`0x9C70`，成段）。实际存在 **38 个 case**：
  `40003-40007 / 40009-40011 / 40013-40016 / 40018-40021 / 40022-40027 / 40029-40037 / 40040 / 40042 / 40044-40048`
  （缺号 `40008/40012/40017/40028/40038/40039/40041/40043`——`40043` 是主窗口过程的退出路径，见 §5.6）。
- **三类分支**：(a) 拉起对话框（`sub_10032B3B`=ShowDialog，如 `40003/40004 → ShowDialog(5,{1|0})`）；
  (b) **写配置键 + 刷新勾选**（`40009-40011 → message:RMouseEvent`、`40013-40016 → message:MessageSpeed`、
  `40018-40021 → message:MesWinAlpha`）；(c) **纯服务调用**（音乐 `svc+36`、SE `svc+40`、窗口模式 `svc+28`、
  截图/剪贴板 `svc+172`、`svc+176`、`svc+168` 等）。
- ⚠ **`ShowDialog(5,…)` 是空路径（已确证）**：`sub_10038330` 的 switch 只处理 `-1/2/3/4/8/9/10`；
  `.lst` 的跳转表注释直接写明 **`jumptable 100383C4 default case, cases 0,1,5-7`**（`AGERC.DLL_utf8.lst:6105`）
  ⇒ 菜单里"存档/读档"两项（`40003`/`40004`）请求的对话框**在本 DLL 里不存在，调用即返回 `-1`**。
  这两项真正留下的效果只有 `sub_10032442()`（隐藏主窗口）+ `svc+20`/`svc+24` + 模态位 `0x20` 的置/清；
  而游戏真正的存读档界面是**引擎/脚本侧的 `SAVE.BIN` UI**（正是 `SAVE.txt` 里 `0x14B/0x14C/0x14D` 那条链）。
  ⇒ 对 emulator：`ShowDialog(5)` 照抄"返回 -1、无对话框"即可，不必实现任何 Win32 存档对话框。
- **三个运行时热重载的资源**（重要：这些 `.BIN` 是**按配置即时重载**的，不是启动时装一次）：
  `CALLBACK_SETTING.BIN`（设置快照，L2429/2444/2523/4090）、`CALLBACK_MESWINA.BIN`（消息窗 alpha，L2307-2343）、
  `CALLBACK_USEANTIFONT.BIN`（抗锯齿字体，L2388/2397）。
- **汉化痕迹就在菜单里**：`sub_10039F10` 用 `SetMenuItemInfoW` 把 `0x9C64`（=命令 `40022`）的文字设成
  **UTF-16LE 简体中文** `显示消息窗口(` / `隐藏消息窗口(`（L2001-2009）——这是 `install/AGERC.DLL` 被汉化改动过的直接证据
  （详见 [`agerc-module.md`](./agerc-module.md) §2.2）。

## 4. 对话框族：资源 ID → 实现（全部有函数体，靠 thunk 解析）

`.text` 里 14 处 `DialogBoxParamA` + 13 处 `CreateDialogParamA`，资源 ID 与实现的对应关系（行号为调用点）：

| 资源 | 实现（`sub_` → 体行区间） | 用途 |
|---|---|---|
| `2` | `sub_100331A3 → sub_10037000`（L1292-1363） | **版本信息/关于框**（读 `set:GameName/Copyright/GameVersion`、AP 列表 `APnn`、`IDI_ICON1`；**按住 Ctrl 点 OK** 且未注册 ⇒ 弹 `0x86`） |
| `3` | `sub_1003269F → sub_10037580`（L1368-1403） | 设置确认框（勾选状态决定返回值 1/2/0） |
| `4` | `sub_100329FB → sub_1003C2F0`（L2555-2670） | **主窗口**（非模态/常驻；`WM_INIT` 里设满屏、装图标、刷新菜单；`WM_COMMAND` 把其余命令转发给 `sub_1003AD60`） |
| `6` | `sub_100335CC → sub_1003E440`（L2787-2909） | **debug 设置对话框**（`debug:*` 七个键 + 11 个 `DebugOutFlag%d`） |
| `8` | `sub_10033162 → sub_10037B30`（L1466-1578） | **存档/读档 名称选择**（`LABEL` 模式判别 `stricmp(String1,"LABEL")`、`?` 通配过滤、`svc+92/+96/+100/+144/+148/+152` 六个服务方法） |
| `9` | `sub_1003281B → sub_100427F0`（L3747-3945）<br>`sub_10032F55 → sub_100434D0`（L3952-4119） | **设置 tab 外壳**：启动时 6 页（含显示页，IDOK **写配置键** + `svc+116` 立即套用）/ 游戏内 5 页（不含显示页，IDOK 走 `svc+32("CALLBACK_SETTING.BIN")` **存快照**，取消时**回滚运行时值**） |
| `0xA` | `sub_10032FC8 → sub_100377B0`（L1406-1461） | **名字/注释输入**（提示 `コメントを入力してください。(最大全角%d文字)`，长度上限 = `SetNameLenMax`，见 §5.1） |
| `0x86` | `DialogFunc → sub_10036DE0`（L1258-1288） | **注册码输入**（成功 `MessageBoxA("正しく登録されました","エラー")` + `svc+212`，失败 `"コードが正しくありません"`） |
| `0x64` | `sub_1003231B → sub_1003F7B0`（L3092-3186） | 消息页（文字速度/滚轮/不透明度滑块） |
| `0x65`/`0x66` | `sub_10032D61 → sub_10040680`（L3291-3448） | 音效页（**`set:NoSetMusic` 决定用哪个模板**） |
| `0x67` | `sub_10033400 → sub_1003EBC0`（L2913-3087） | 显示页（`display:*` 全部 + `system:UseMMX/LimitTouch/OutErrorLog`） |
| `0x68` | `sub_10033469 → sub_10041370`（L3460-3476） | 「その他」页（`system:EffectSkipOnClick` 位域） |
| `0x69` | `sub_100325BE → sub_10041900`（L3533-3618） | **動作環境**页（CPU 名/频率、内存、路径、磁盘；`SetTimer` 延迟 1 秒后填值） |
| `0x88` | `sub_10032483 → sub_1003FDF0`（L3190-3287） | 自动消息页（4 个 `message:AutoMessage*` 滑块） |
| MENU `124` | `sub_10039A00` 内 `LoadMenuA(hInstance,124)`（L1943） | 插入主菜单第 4 位的右对齐子菜单 |
| `IDI_ICON1` | L1292/L2623 | 图标资源 |

对话框统一约定：`dword_10150E70` 记模态位（`8/0x10/0x100/0x200/0x400`），
`sub_10038330`（=`ShowDialog` 实现）是总调度：`case 2/3/4/8/9/10` + `case -1` 查询状态（L1595-1683），
**`0/1/5-7` 落 default ⇒ 返回 -1**（`.lst:6105`）。
`.rsrc` 段 326 KB（虚拟大小 `0x4FB4A`）装的就是这些对话模板 + 图标 + 版本信息。

## 5. 其余功能面（按用途）

### 5.1 存档命名/注释输入 —— 脚本唯一触及的那条链
`_SetNameLenMax@20`（L1145-1149）只做一件事：`dword_100A9000 = *a2`（初值 18，L397）。
消费者是**注释/名字输入对话框** `sub_100377B0`：提示串用 `dword_100A9000` 填「最大全角 N 文字」，
OK 时按**显示宽度**截断（双字节字符计 18、单字节计 9，超过 `18 * dword_100A9000` 即断，L1440-1456），
结果写全局 `String1`。⇒ `src/SAVE.txt` 传 12，就是「存档名/注释最多 12 个全角字」。

### 5.2 截图、目录与剪贴板
`system:SaveBMPPath` 读（L1785）/写（L1862）；目录选择用 `SHBrowseForFolderA`（`画像を保存するフォルダを選択してください`，L1852）
+ `BFFM_SETSELECTIONA` 回调预选（L1790）；**默认目录是桌面**（`CSIDL_DESKTOPDIRECTORY`，L1800-1826）。
文本复制到剪贴板 `sub_10041780`（`GlobalAlloc`→`OpenClipboard`→`SetClipboardData(CF_TEXT)`），
磁盘容量格式化 `sub_10041490`（`" %c: "` + `" %dMByte /"`/`" %d.%2.2dGByte /"`），
硬件页的「复制」按钮把 6 行文本用 `\r\n` 拼起来交出（L3571-3592）。
⚠ 截图文件本身（BMP 落盘）由**引擎**做，DLL 只负责目录与文案。

### 5.3 注册码 / 版本信息
读宿主 exe 的版本资源 `\StringFileInfo\041103a4\FileVersion`（语言页 **0411 = 日文**，L1217-1242）；
关于框（资源 2）显示 `Version %s` + `set:GameName/Copyright/GameVersion` + `APnn` 列表（`svc+232` 逐 AP 判定，L1328-1338）；
`Ctrl+OK` 且 `set:IsReggist` 为 0 ⇒ 打开隐藏注册码框（L1347-1351）；注册码校验走 `svc+208`，成功再 `svc+212`（L1269-1273）。

### 5.4 DirectX / OS / 硬件信息采集
注册表 `HKLM\Software\Microsoft\DirectX` 的 `Version`/`InstalledVersion` → `" DirectX %d.%d (%s)"`（L2696-2713）；
`GetVersionExA`（OS 版本分支）、`GetCurrentDirectoryA`/`GetWindowsDirectoryA`、`GlobalMemoryStatusEx`（物理内存 L4153-4159）、
CPUID 特性位与 **48 字节 CPU 品牌串**（L4240-4349）、rdtsc/`timeGetTime` 标定 CPU 主频（L4163-4235）。

### 5.5 文件与窗口基础设施
`File` 类（vftable L231）：`Close`（L1713-1725）/`Write`（L1728-1739）；
自身目录 `sub_100392C0`（`GetModuleFileNameA`+`_splitpath_s`，L1742-1756）；
窗口居中 `sub_100368E0`（受 `display:ScreenMode` 门控，L1160-1213）；
常驻非模态窗口的隐藏 `sub_10039440`（L1759-1768）。

### 5.6 主窗口过程
`sub_1003C2F0`（资源 4）：`WM_INIT` 满屏 + `IDI_ICON1` + `SetWindowLongA(-16, 0x91C40000)` + 刷新菜单（L2618-2636）；
`WM_SYSCOMMAND` 的窗口/全屏切换（`svc+28`，L2587-2612）；`WM_COMMAND`：`40001`/`2` ⇒ 向父窗口 `PostMessage(WM_CLOSE)` 退出，
**`40043` ⇒ `WM_CLOSE(1)`**，其余转 `sub_1003AD60`（L2652-2669）。

### 5.7 CRT / 本地化样板（尾部 ~900 行，无业务）
`_LocaleUpdate`+`_strgtold12_l` 的字符串→浮点、`printf` 家族 helper、`_initterm` 初始化表、
安全 cookie（`0xBB40E64E`）、RTTI 异常类收发/析构、`_CrtSetReport*` 配置簇、
以及 W/A 两版 `_crtMessageBox`（`sub_100639A0` L4682-4771 / `sub_1007DE50` L4954-5043）——
后者的唯一看点是：查 `GetProcessWindowStation` 的 `USEROBJECTFLAGS.dwFlags & WSF_VISIBLE`，
窗口站不可见时给消息框加 `MB_SERVICE_NOTIFICATION`（0x200000）送去交互桌面（L4736-4744）——**CRT 断言弹窗，不是游戏 UI**。

## 6. 多边形碰撞微引擎（17 个导出）——**《天結》里不可达**

AGERC 另外导出 17 个地图/地块/碰撞函数，是一套**自足的多边形查询引擎**（静态数组 + bbox 预处理）：

| 层 | 数据（写入导出） | 容量 | bbox / 顶点 | 查询 |
|---|---|---|---|---|
| 墙 `Wall` | `SetMapWallPX/PY`（L679-701）、`SetMapWallPN`（L705）、`SetMapWallCr`（L718，墙类型） | 10000 点 / 100 多边形 | `dword_100EEEB8…` / `dword_100DB630` | `FindClash`（L949-1061）**扫掠圆 vs 多边形**：按 `WallCr==1` 过滤 + 包围盒预筛 + 线段相交/最近点，把命中写回 `a2[0..6]` |
| 地 `Land` | `SetMapLandPX/PY`（L731-753）、`SetMapLandPN`（L757）、`SetMapLandIdx`（L770） | 10000 点 / 100 多边形 | `dword_100EFB40…` / `dword_100BDFE0` | `GetLand`（L1082-1102）**点在多边形** ⇒ 返回该多边形的 `LandIdx`（0=无） |
| 事件 `Ev` | `SetMapEvPX/PY`（L783-805）、`SetMapEvPN`（L809） | 10000 点 / 100 多边形 | `dword_100EF500…` / `dword_100AA760` | `GetEv`（L1114-1134）**点在多边形** ⇒ 返回多边形序号 |
| 参数 | `SetMapParams`（L822，三层多边形数）、`SetChParams`（L931，角色 前后位置+半径，`r²` 预算）、`InitRect`（L834-898，一次性算 bbox + 交错 x/y 顶点表） | | | 几何原语：`sub_1003DEC0`=点在多边形（射线交叉）、`sub_1003E030`=线段相交、`sub_1003E150`=叉积符号（只回 ±1，**共线归一侧**） |

**可达性实证（为什么本作不建模它）**：

| 检查 | 结果 |
|---|---|
| exe 反编译源码 `engine/天结_unpacked.exe_utf8.c` 里 `FindClash/GetLand/GetEv/InitRect/SetChParams/SetMap*` | **0 命中** |
| exe 清单 `.lst`（含导入/导出/全部引用）里同上一组名字 + `_SetNameLenMax@20` | **0 命中** |
| exe 清单里对 AGERC 的 `GetProcAddress` 字符串 | 只有 `_GetInstance@0`、`_ShowDialog@12`、`_OperateMenu@16`（L237594-237608） |
| `_SetNameLenMax@20` 的唯一调用者 | **脚本**（`SAVE.txt:7-9` 的 `0x14B/0x14C/0x14D`，非 exe） |

⇒ 这 17 个导出在《天結》里**没有任何调用者**（AGERC 自己也不调它们）。
它们是「ARCGameEngine Resource」这一共享模块给**同期别的 Eushully 作品/工具链**复用的部分，
本作把碰撞逻辑放在引擎自己里。**结论：emulator 不需要实现这 17 个导出**（这也直接缩小了
[`stub-reaudit-2026-09.md`](./stub-reaudit-2026-09.md) 里 A6 批次的范围）。

## 7. 对 emulator 的意义（建模 / 忽略清单）

| 面 | 结论 | 理由 |
|---|---|---|
| `0x14B/0x14C/0x14D` + `_SetNameLenMax@20` | **必须建模**（已列入 A6） | 脚本唯一触及；`SAVE.txt` 一进 Load Data 就断在这（见 [`agerc-module.md`](./agerc-module.md) §3） |
| `_ShowDialog@12` 的请求码契约 + `dword_10150E70` 模态位 | **要建模（★现状 = 未建模 —— 别把这一列读成"已完成"）**：只认 `-1/2/3/4/8/9/10`，**其余（含 5）一律返回 `-1` 且无对话框**；无 GUI 时按请求码返回「取消/0」，并保证 `AGE:reg` 可读写 | 引擎会查询模态位；返回值影响调用方分支。★2026-09 补实证：`dword_55E1B4` **就是 `AGERC.DLL!_ShowDialog@12`**（经 `LoadLibraryA("AGERC.DLL")` + `GetProcAddress` 装入，raw 109386-109427；取值点 `sub_453870` raw 65952-65956），**首参 = 请求码**，静态可枚举的调用方 = cmd `−1/2/3/4/8/9/10`。其中 **cmd 8 = 引擎指令 `0x140`**（handler `sub_42FBC0` raw 39570-39638）：`op2 == "LABEL"` ⇒ 对话框列**当前脚本帧的标签表**（`Engine[4*cur_frame+495964]`）并返回选中标签的整数值；否则列**引擎文件表**（`Engine+0xA609C`）按扩展名（如 `"BIN"`）过滤。⇒ **不实现它是"返回值只能由真人点选"（+ 两张运行时表未建模 + 无对话框宿主缝），不是静态信息不足**；无 GUI 时的返回策略属产品决策（见 `tickets/T-0088`）。★另：`0x140` 的 181 处语料**全在 DEBUG 路径**（`global 708ad6 == 1` 才进，该全局唯一写点 = `TITLE.txt:462` 的 DEBUG 菜单）⇒ 正常剧情零影响 |
| 配置键**全集与取值约定** | **建模**：键名、范围、位域、反相/倍率陷阱（§2） | 引擎侧同键读取；缺键不报错只表现不对 |
| 存读档名称选择的服务契约（`svc+92/+96/+100/+144/+148/+152`）与 `LABEL` 模式 | **建模（若做存档 UI）** | `SAVE.BIN` 界面走这条路；纯脚本模拟可先 stub |
| 显示设置语义（`display:*` + `svc+116` 立即套用） | **建模（键层面）** | 影响引擎渲染分支；具体 D3D 调用换成 H5/Canvas 即可 |
| 顶部菜单 38 个命令 ID / `set:Menu_*` / 3 个 `CALLBACK_*.BIN` 热重载 | **可忽略（GUI 层）**，但键清单要能读 | 无 Win32 菜单时整段不需要；`CALLBACK_*.BIN` 是**引擎侧**资源，可在渲染层另行处理 |
| 注册码 / 关于框 / DirectX / CPUID / 磁盘 / 剪贴板 / CRT 样板 | **可忽略** | 与游戏状态无关；要复刻界面时用常量即可 |
| 17 个地图/地块/碰撞导出 | **不建模** | 本作不可达（§6） |

## 8. 待确认 / 缺口

- `svc+N` 槽号语义只有部分有一手证据（+36/+40/+44/+60…/+116/+144/+148/+152/+208/+212/+232 等）；
  其余（如 `svc+156/+164/+168/+172/+176/+196/+220`）属**推测**，要精确建模需读宿主 exe 的 `IAGEService` vtable 实现。
- `CALLBACK_SETTING.BIN` / `CALLBACK_MESWINA.BIN` / `CALLBACK_USEANTIFONT.BIN` 的**格式与引擎侧消费方式**未读（在 exe 侧）。
- `0x64/0x65/0x66/0x67/0x68/0x69/0x88` 各对话模板的**控件布局**在 `.rsrc` 二进制里（未解析），
  子页与 tab 的映射已由调用点确定（§4），但控件 ID→控件类型的对应只能从消息码推断。
- `sub_10039A00` 里 `set:Menu_SoundONOFF` 出现两次（L1920-1934），疑似汉化/反编译把两个不同键写成同一个，未追。
- L3899-3902 的 `display:VirtualFullScreen` 被无条件写 `1`（而不是读控件）是引擎预期行为还是缺陷，未判。

## 附录 A. 函数清单（122 体，按功能簇）

> AGERC 是**独立二进制**，它的函数**不进** `analysis/functions.json`（那份台账的行号锚点绑在 exe 反编译上）；
> **DLL 内部函数以本附录为台账**（行号锚点绑在 `engine/AGERC.DLL_utf8.c` 上）。

| 行区间 | 函数 | 簇 |
|---|---|---|
| L618-672 | `DllMain` `GetInstance`(空体) `ShowDialog` `OperateMenu` | 导出/基础设施 |
| L679-940 | `SetMapWall*` `SetMapLand*` `SetMapEv*` `SetMapParams` `InitRect` `SetChParams` | 碰撞引擎（不可达） |
| L949-1149 | `FindClash` `GetLand` `GetEv` `SetNameLenMax` `sub_10036820`(MBCS 前导字节判定) | 碰撞引擎 + 命名长度 |
| L1160-1254 | `sub_100368E0`(窗口居中) `sub_10036BA0`(读 exe 版本资源) | 基础设施 |
| L1258-1403 | `sub_10036DE0`(注册码框) `sub_10037000`(关于框) `sub_10037580`(确认框) | 注册码/版本 |
| L1406-1461 | `sub_100377B0`(名字/注释输入) | 存档命名 |
| L1466-1578 | `sub_10037B30`(存读档名称选择) | 存档 UI |
| L1585-1685 | `sub_10038330`(ShowDialog 总调度) | UI 调度 |
| L1694-1756 | `sub_10038B30` `sub_10038BA0` `sub_10038C00` `sub_10039080` `sub_100392C0` | File 类/路径 |
| L1759-1833 | `sub_10039440`(隐藏常驻窗) `sub_100394D0`(浏览目录回调) | UI/截图 |
| L1837-1946 | `sub_100397F0`(选目录) `sub_10039A00`(**菜单裁剪/插子菜单**) | 菜单/截图 |
| L1950-2131 | `sub_10039F10`(**菜单勾选/灰化刷新**) | 菜单 |
| L2136-2547 | `sub_1003AD60`(**38 命令分发**) | 菜单 |
| L2555-2670 | `sub_1003C2F0`(主窗口过程) | 基础设施 |
| L2674-2777 | `sub_1003CA40` `sub_1003CAB0` `sub_1003DBA0`(DirectX 版本) `sub_1003DE10` `sub_1003DE80` `sub_1003DEC0`(点在多边形) `sub_1003E030`(线段相交) `sub_1003E150`(叉积符号) | 几何原语 + 探测 |
| L2787-2909 | `sub_1003E440`(debug 对话框) | 调试 |
| L2913-3087 | `sub_1003EBC0`(**显示设置页**) | 设置对话框 |
| L3092-3186 | `sub_1003F7B0`(消息页) | 设置对话框 |
| L3190-3287 | `sub_1003FDF0`(自动消息页) | 设置对话框 |
| L3291-3448 | `sub_10040680`(音效页) | 设置对话框 |
| L3460-3476 | `sub_10041370`(その他页) | 设置对话框 |
| L3479-3530 | `sub_10041490`(磁盘容量格式化) `sub_10041780`(写剪贴板) | 硬件信息/剪贴板 |
| L3533-3618 | `sub_10041900`(**動作環境页**) | 硬件信息 |
| L3626-3742 | `sub_10041FE0`(消息/自动消息/音效/其它四页**集中回写配置**) | 配置读写 |
| L3747-3945 | `sub_100427F0`(**启动设置 tab 外壳，6 页，写配置 + 套用**) | 设置对话框 |
| L3952-4119 | `sub_100434D0`(**游戏内设置 tab 外壳，5 页，存快照/回滚**) | 设置对话框 |
| L4132-4349 | `sub_10043FB0` `sub_10044020` `sub_10044110` `sub_100441D0` `sub_100442AF/B5` `sub_10044380` `sub_100444A0` `sub_10044600` | Spec 硬件采集（CPUID/内存/主频） |
| L4363-4674 | 安全 cookie / type_info / 异常类 / `_CrtSetReport*` 簇 | CRT 样板 |
| L4682-4771 / L4954-5043 | `sub_100639A0` / `sub_1007DE50`（`_crtMessageBoxW/A`） | CRT 断言弹窗 |
| L4788-4827 | `sub_10078C70`（4KB bump 分配器） | CRT/分配池 |
| L4440-5098（散布） | printf/vswprintf/locale/`__ld12cvt`/`_initterm` 等 | CRT 样板 |

> 机械清单（每个函数的名字/行区间/行数/被调用次数/引用字符串）：
> `.tmp/agercInventory.txt`；配置键矩阵 `.tmp/agercTables.log`；thunk 映射 `.tmp/agercThunkMap.log`；覆盖率核查 `.tmp/agercCoverage*.log`。

## 附录 B. 可复跑（`.tmp/`，未入库）

| 脚本 | 作用 |
|---|---|
| `.tmp/agercInventory.py` | 函数体/声明/导入 API/字符串/关键词的结构盘点 → `agercInventory.txt` |
| `.tmp/agercDeclClassify.py` | 声明区分类（有体/`// idb`/`// weak`/`j_`） |
| `.tmp/agercThunkMap.py` | 把「只有声明」的名字在 `.lst` 里解析成 `jmp TARGET`，验证覆盖率 |
| `.tmp/agercCoverage.py` / `agercCoverage2.py` | `.c` 122 体 vs `.lst` 221 proc 的差集与地址分布 |
| `.tmp/agercTables.py` | 对话框资源→实现表 / 菜单命令 ID 表 / 每函数配置键矩阵 |
| `.tmp/convert_agerc_utf8.py` | cp932+UTF-16LE 混编 → UTF-8（LF）转写（规则见 `agerc-module.md` §4） |
