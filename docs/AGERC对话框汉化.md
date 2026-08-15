# AGERC.DLL 对话框汉化流程

> 记录 2026-08-13 对 `AGERC.DLL` 对话框（以 DIALOG 3 退出确认框为样例）的汉化流程、
> 文本编码行为结论与构建方法。
> 相关文档：`menu-patch-notes.md`（主菜单汉化）、`font-build.md`（Amayui CN 字体构建）；
> 相关脚本：`res/build-localized-agerc.ps1`（构建）、`res/inject-localized-agerc.rsh`（ResHacker 脚本示例）。

## 1. 背景与资源结构

- 运行时 DLL：`install/AGERC.DLL`（overlay，优先于 ALF 内文件）；原始文件 `install/DATA1/AGERC.dll`
  （MD5 `1FAC5B87…`，未加壳 PE32）。
- 资源清单（`.rsrc`，语言以 1041/日语为主）：
  - DIALOG（类型 5）共 16 个：id `2,3,4,5,6,8,9,10,100,101,102,103,104,105,134,136`
  - MENU（类型 4）共 2 个：id `110`（主菜单）、`124`（调试菜单）
  - 其余：CURSOR / ICON / GROUP_CURSOR / GROUP_ICON / VERSION / MANIFEST（构建时保持逐字节不变）
- DIALOG 3 = 退出确认对话框（原日文：标题 `終了`、静态文本 `次の方法で終了しますか？`、
  单选 `プログラムを終了する(&E)` / `タイトルに戻る(&T)`、按钮 `OK` / `ｷｬﾝｾﾙ`）。

## 2. 文本编码行为（实测结论）

| 元素 | 文本管线 | 渲染字体 | 结论 |
|---|---|---|---|
| 控件文本（STATIC/BUTTON） | 引擎创建对话框时把模板字符串转 SJIS，非 cp932 字符丢失 | Amayui CN（游戏字体设置） | 用 `res/subs_cn_jp.json` 的日文写法占位，字体把日文码位字形替换为简体 |
| 标题（CAPTION） | 同样经过 SJIS 管线 | Windows 系统标题栏字体（非客户区，DS_SETFONT / Amayui CN 不生效） | 无法显示简体 → **标题栏留空** |
| 菜单（MENU 110/124） | UTF-16 W API（运行时补丁，见 menu-patch-notes.md） | Win32 菜单 | 直接写简体，无需映射 |

- LANGUAGE：DIALOG 3 标记为 `LANG_CHINESE, 0x2`（0x0804）时游戏可正常加载（按语言中性查找）；
  其余资源保持 `LANG_JAPANESE, 0x1`（1041）。
- 映射字典：`res/subs_cn_jp.json`（3000 条：简体 → 日文写法，cp932 可编码；
  字体构建机制见 font-build.md）。本对话框用到的映射：
  `结→俟`、`吗→龜`、`标→標`、`题→題`、`确→確`；其余字符本身就在 cp932 内。

## 3. 字体方案

- `Amayui-CN_cnjp.ttf`（族名 `Amayui CN`；`res/fonts/` 与 `patch/` 各一份）。
- 注册/分发：`npm run register-font`（会话级 AddFontResourceEx）或双击安装字体；
  游戏内把字体分类（説明文、パラメータ文字/数字、ADVルビ、ADVメッセージ）设为 **Amayui CN**。

## 4. DIALOG 3 现状（2026-08-13 定稿）

```rc
3 DIALOGEX 0, 0, 187, 93
STYLE DS_SETFONT | DS_MODALFRAME | DS_CENTER | WS_POPUP | WS_CAPTION | WS_SYSMENU
CAPTION ""
LANGUAGE LANG_CHINESE, 0x2
FONT 9, "Amayui CN"
{
   CONTROL "SYSTEM3", 1028, STATIC, SS_ICON | WS_CHILD | WS_VISIBLE, 7, 20, 20, 20
   CONTROL "要用以下方式俟束龜？", -1, STATIC, SS_LEFT | WS_CHILD | WS_VISIBLE | WS_GROUP, 46, 16, 134, 11
   CONTROL "俟束程序(&E)", 1002, BUTTON, BS_AUTORADIOBUTTON | WS_CHILD | WS_VISIBLE | WS_GROUP, 46, 34, 134, 10
   CONTROL "返回標題(&T)", 1003, BUTTON, BS_AUTORADIOBUTTON | WS_CHILD | WS_VISIBLE, 46, 48, 134, 12
   CONTROL "確定", 1, BUTTON, BS_DEFPUSHBUTTON | WS_CHILD | WS_VISIBLE | WS_TABSTOP, 74, 72, 50, 14
   CONTROL "取消", 2, BUTTON, BS_PUSHBUTTON | WS_CHILD | WS_VISIBLE | WS_TABSTOP, 130, 72, 50, 14
}
```

游戏内显示效果（占位 → 简体）：

| .rc 文本（占位） | 游戏显示 |
|---|---|
| 要用以下方式俟束龜？ | 要用以下方式结束吗？ |
| 俟束程序(&E) | 结束程序(&E) |
| 返回標題(&T) | 返回标题(&T) |
| 確定 | 确定 |
| 取消 | 取消 |

## 5. 构建流程

入口：`res/build-localized-agerc.ps1`（PowerShell，UTF-8 BOM）。

```powershell
powershell -ExecutionPolicy Bypass -File res\build-localized-agerc.ps1
```

流程：
1. 前置检查：定位 ResourceHacker（exe 名是 `ResourceHacker.exe` 而非 `ResHacker.exe`；
   安装：`winget install -e --id AngusJohnson.ResourceHacker`）。
2. 读取 `res/AGERC.DLL.rc`（UTF-16LE + BOM），去除零宽空格 U+200B（旧“等长补位”方案遗留，
   现在重建资源不需要）。
3. `ResourceHacker -open clean.rc -save .res -action compile` 编译。
   **注意**：ResourceHacker 是 GUI 子系统程序，PowerShell `&` 调用不等待，必须
   `Start-Process -Wait`（脚本内已封装 `Invoke-ResourceHacker`）。
4. 备份旧输出 → 对 DIALOG、MENU 分别执行「delete 全部 → addoverwrite 注入」。
   （addoverwrite 按 类型+名称+语言 匹配，语言变更时会残留旧语言条目，必须先删除。）
5. 校验：PE 有效、菜单中文文本存在、DIALOG/MENU 模板可解析、全部字符串 cp932 可编码。
6. 中间产物默认清理（`-Keep` 保留）；备份存放于 `.tmp\agerc-backups\`。

依赖与坑：
- 游戏运行时 `install/AGERC.DLL` 被占用，**构建前需退出游戏**。
- `.rc` 为 UTF-16LE + BOM，编辑脚本须保持该编码（本项目用 Python 以 `utf-16` 读写）。
- 全文件扫描会检出 1 个 U+200B，位于 **ICON 13 像素数据**（原版自带字节），与汉化无关，脚本只警告。

## 6. 验证方法

- Windows API：`LoadLibraryEx(LOAD_LIBRARY_AS_DATAFILE)` + `EnumResourceNames` /
  `FindResourceEx` / `LoadResource`，确认 DIALOG/MENU 可枚举、可读取（语言 0x0804/0x0411）。
- DLGTEMPLATEEX 模板解析要点：
  - 头：`dlgVer=1`、`signature=0xFFFF`；字段顺序 `menu → class → title → font(pts,weight,italic,charset,face)`
    连续排列，**字体串结束后对齐 4 字节**才是第一个控件；
  - 控件：固定 30 字节（helpID/exStyle/style/x,y,cx,cy/id/class/title），class/title 为
    序数（0xFFFF+ordinal，0x0080=Button、0x0082=Static）或 UTF-16 串；**字符串 NUL 结束后紧跟
    extraCount WORD**，下一控件 4 字节对齐。
- 非 DIALOG/MENU 资源与原始 DLL 逐字节一致。

## 7. 翻译其它对话框的操作步骤

1. 在 `res/AGERC.DLL.rc` 找到对应 `DIALOGEX` 块，翻译控件文本。
2. **CAPTION 留空**（标题栏由系统字体绘制，Amayui CN 不生效）。
3. 控件文本逐字查 `res/subs_cn_jp.json`：cp932 编码不了的简体字换成映射的日文写法占位。
4. 需要时把整块 `LANGUAGE` 改为 `LANG_CHINESE, 0x2`（游戏按语言中性查找可加载；
   若发现加载不出来再改回日语）。
5. 运行构建脚本，按第 6 节校验，再进游戏实测。

## 8. 已排除/不再使用的方案

- 直接写简体 + 微软雅黑 FONT：控件文本非 cp932 字符被引擎丢弃（标题也丢）。
- 改 LANGUAGE 为中文期望改变引擎编码行为：语言 ID 只影响资源查找，不影响文本编码
  （对照实验：同模板两种 LANGUAGE 编译产物仅目录语言 ID 不同、数据块逐字节一致）。
- 标题用日文写法占位：能过 SJIS，但标题栏用系统字体、无字形替换，显示为日文汉字本身。
- 客户区 STATIC 标题：能正确显示，但按需求最终选择不显示标题、不加额外文案。
