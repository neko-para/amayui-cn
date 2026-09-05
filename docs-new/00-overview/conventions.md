# 00-overview · 目录纪律与数据分层

## 1. 目录地图

```
E:\Games\Eushully\天結\
├── raw\        软连接(junction) → 游戏本体（只读参照，勿写）
├── install\    可运行测试树（与本体完全独立的全量真拷贝，含 DATA1-8 解包子目录）
├── data\       只读比较基线（941 个反汇编 txt，原始日文，不再修改）
├── src\        可编辑开发源（941 个 txt，含翻译语法；翻译真值）
├── scripts\    Node.js 工程脚本（setup/verify/manifest/translate/agf/uimap/re）
├── tools\      本地工具链（alf / eushully-decompiler / Eushully_AGF_TooL / Eushully-Editor / unpack）
├── res\        工程自有资源（fonts/、images/、subs_cn_jp.json、AGERC 相关）
├── patch\      可分发补丁（BIN/、AGF/、AGERC.DLL、Amayui-CN_cnjp.ttf、说明、CHANGELOG）
├── plugins\    DSH 工具插件（htmlcard / uimap）
├── output\     提取/调用图产物（callgraph*.html/.gv/.json、*.csv）
├── engine\     反编译 C（engine.cpp/hpp、天结_unpacked.exe_*.c/.lst、defs.h、hxclang_prelude.h）
├── app\        三子工程（amayui-emulator / amayui-inspector / amayui-toolkit）
├── docs-new\   ★ 本文档体系：唯一新来源
├── data\src 之外：manifest（install-manifest.json、raw-manifest.json）
└── 根注释：CONTEXT.md / PROGRESS.md / PENDING.md / TODO.md 为会话/工作临时快照，非正式文档
```

> ⚠️ `raw/`、`install/` 被 `.gitignore` 排除。`install/` 是本体独立真拷贝（无硬链接），对 ALF/AGF 重打包
> 直接在 `install/` 内副本进行，不会波及本体。

## 2. 数据分层（翻译）

| 层 | 角色 | 修改 |
|---|---|---|
| `data/*.txt` | 只读日文基线 | 不改（assemble 骨架校验以此为准） |
| `src/*.txt` | 可编辑开发源（翻译语法） | 改（**翻译真值**） |

## 3. 排除项（不进入 install）

`config.js` 中排除：`天结.exe`（心愿屋汉化壳，方案 B 弃用）、`*.dmp`（崩溃转储）、
`AGE-EXTEND.TTF`（引擎内置字体，已确认移除后回退系统字体设置，无需外挂）。

## 4. 数据完整性（manifest）

- `install-manifest.json`：install 顶层文件 MD5（追踪改动；DATA1-8 子目录不计入）。
- `raw-manifest.json`：raw 顶层文件 MD5（原始基线）。
- 命令：`npm run verify` / `manifest` / `manifest-raw` / `check` / `compare`（秒级对比）。
- 大文件（>50MB，如 `DATA*.ALF`）默认跳过，`--full` 强制；`--diff` 按 git 变更只处理 `*.txt`/`*.AGF` 对应产物。

## 5. 运行与工具

- 反汇编/重汇编：`tools/eushully-decompiler/build/Release/age-asm.exe -d|-a|-x`。
- ALF 解包（**推荐 Node 重写版**）：`node scripts/alf/unpack_alf.mjs SYS4INI.BIN`（跨平台，无 Wine/Windows CRT；
  `--out <目录>` 指定输出根，归档按索引所在目录解析）。调试文件 `lzssdata*.bin` 默认**不写**（`DEBUG_DUMP=true` 才写）。
  旧 Windows C 版 `tools/alf/unpack_alf.exe` 仅作参考。
- ⚠️ `age-asm.exe` 用 ANSI 接收路径（ACP=936），含日文/中文绝对路径会被搅乱；用 ASCII 别名 junction：
  `New-Item -ItemType Junction -Path "E:\Games\Eushully\wk" -Target "E:\Games\Eushully\天結"`，之后全用 `E:\Games\Eushully\wk\...`。
