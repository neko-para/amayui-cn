# AGERC.DLL 主菜单汉化 —— 结构与运行时覆盖补丁说明

## 背景

主窗口菜单栏（Win32 菜单）的模板存放在 `install/DATA1/AGERC.DLL`（849KB 未加壳版，
MD5 `1FAC5B87…`；运行时使用 `install/AGERC.DLL`）。资源目录里它们是**标准资源类型
MENU**：

- `MENU 110`（file `0xC66C4..0xC6E30`）= 主菜单模板（游戏/保存图片/消息/设置/帮助）
- `MENU 124`（file `0xC6E30..0xC6F70`）= 调试菜单模板（调试报告/BIN重载/…）

但数据内容是**引擎自定义格式**，不是标准 `MENUITEMTEMPLATE`：字符串为 `\0` 结尾的
UTF-16LE，解析器依赖字符串终止符定位下一条结构。因此译文必须保持原 UTF-16 单元数，
不足用 U+200B 零宽空格补齐，`\0` 保持原位（曾因“短文本+清零”导致整个菜单消失）。

## 运行时覆盖（两个“改模板无效”的项）

主菜单栏的**“调试”顶级项**并不在 MENU 110 模板里，而是引擎启动时动态插入：

1. `InsertMenuItemA`（IAT `0x10154764`，唯一调用点 `VA 0x39DBE`）在位置 4 插入该项，
   文案取自 AGERC 的 ANSI 串表 `.rdata RVA 0x98000`（file `0x66200`，原为 SJIS 半角片假名
   `ﾃﾞﾊﾞｯｸﾞ(&D)`），子菜单来自 `LoadMenuA(124)`。
2. 消息窗口右键菜单的**“を表示する/を消す”开关项**（ID `0x9c64`）由
   `SetMenuItemInfoA`（IAT `0x10154754`，仅 `VA 0x3A252` / `VA 0x3A28B` 两处调用）按
   当前状态改写，文案来自 `.rdata RVA 0x98128` / `0x98144`（file `0x66328` / `0x66344`）。

这两处走 ANSI 菜单 API：Windows 按当前 ACP 转换。**天结.exe（心愿屋成品）运行在
GBK/无 LE 环境**，把串表写成 GBK 即可显示；但本项目后续基于 **AGE.exe + LE/SJIS**，
GBK 方案在 SJIS 下会乱码，不可用。

## 修复方案（`scripts/patch-menu.js` 的 RUNTIME_MENU_EDITS）

把“ANSI 串 + A 版菜单 API”整体改成“UTF-16 串 + W 版菜单 API”，与区域设置无关：

1. **导入名原位改名（名字等长）**：
   - `InsertMenuItemA` → `InsertMenuItemW`（file `0x791AC`，全 DLL 仅 1 处调用，安全）
   - `SetMenuItemInfoA` → `SetMenuItemInfoW`（file `0x791E6`，全 DLL 仅 2 处调用，安全）
2. **ANSI 串原位改写为 UTF-16LE**（槽位长度刚好够）：
   - file `0x66200`（16B）：`ﾃﾞﾊﾞｯｸﾞ(&D)` → `调试(&D)`
   - file `0x66328`（28B）：`ﾒｯｾｰｼﾞｳｲﾝﾄﾞｳを消す(&H)` → `隐藏消息窗口(&H)`
   - file `0x66344`（32B）：`ﾒｯｾｰｼﾞｳｲﾝﾄﾞｳを表示する(&O)` → `显示消息窗口(&O)`

纯数据补丁，不修改 `.text` 指令、不涉及重定位。`cch` 字段用 MIIM_TYPE 时被忽略，
无需处理 strlen 结果。

## 验证

- 无 LE 直接启动 `install/AGE.EXE`：调试标题由乱码 `棉兽?&D)` 变为 **`调试(&D)`**；
  主菜单全部项（游戏/保存图片/消息/设置/调试/帮助）均为中文。
- UTF-16 + W API 与 ACP 无关，LE/SJIS 环境下同样显示中文（右键开关项走同一机制）。

## 备注

- LE 下首次启动可能弹“設定”对话框（注册表重定向导致设置缺失），属环境问题，
  与本补丁无关；点 OK 保存一次设置后不再出现。
- 调试菜单子项（调试报告/BIN文件重载/…）来自 MENU 124 模板，已在 EDITS 中翻译。
