# 天結いキャッスルマイスター 工程文档（权威索引）

> 本文档是整份工程文档体系的**新权威索引**，按「四大方向」组织，取代已被淘汰/互相冲突的旧散篇与旧版
> 根索引（此前的 `docs/README.md` 目录树把 `docs/translate/` 的内容误画在 `docs/` 根层级，即为一处已勘误的冲突）。
>
> 订立原则（2026-09 起）：
> - **汉化已完成**：`src/*.txt`（941 个）的翻译结果是**翻译域唯一权威、视为已确认**；后续仅持续校对、整体修正。
> - **`docs/translate/`（302 篇 keywords-*/prob-*）为过时的中间产物**，待**整体合并去重**（后续任务，当前不作逐篇整理）。
> - **引擎与游戏业务数据解耦**：引擎内部机制（VM/opcode/`this` 布局/资源加载）在 `docs/engine`；游戏业务数据
>   （掉落/技能/物品/地图及其地址）在 `docs/data`。**除非有确切证据（进程内实测读取并与脚本语义互证），不把两者联系起来**。
> - **汉化字体基底 = Sarasa Gothic SC**（更纱黑体 SC，2026-08 起替换原 WenQuanYi）；渲染用 Sarasa SC，游戏内为 Amayui CN（Sarasa 基底 cnjp 替换版）。
> - 旧散篇（`docs/re/engine/*`、`docs/re/src/*`、`docs/images/SO*`、`AGERC对话框汉化.md`、`font-build.md` 等）
>   **保留为详细参考**，各方向新 README 用相对链接指向它们；不再以旧散篇作事实源。
> - 本工程根：`E:\Games\Eushully\天結`（git 仓库，`/install`、`/raw` 已被 `.gitignore` 排除）。
> - 游戏本体：`E:\Games\Eushully\天結いキャッスルマイスター`（Eushully，2017-05-26，v1.07 + AP01-05）。

## 1. 一句话现状

用 **TypeScript + Electron + PixiJS v8** 重写《天結いキャッスルマイスター》的 AGE/System4 引擎 VM
（解释器已能无界面跑启动链到 `TITLE.BIN`，Electron 渲染壳已接通、标题真实图像已接入），
同时以「方案 B：改数据文件」完成**简体中文重制补丁**（翻译已收官，仅剩校对），
并配套**进程内存查看器**与**数据查询/制作规划 App** 两个落地工具。

## 2. 四大方向

| 方向 | 目标 | 权威文档 | 权威素材/代码 |
|---|---|---|---|
| **① 游戏汉化** | 重制简体中文补丁（方案 B：改数据文件） | [`translation/README.md`](./translation/README.md) | `src/*.txt`（**唯一权威**）、`data/*.txt`（日文基线）、`res/`、`scripts/`、`tools/`、`patch/` |
| **② 游戏数据分析** | 反向业务数据/静态表结构 | [`data/README.md`](./data/README.md) | `docs/re/src/*`（详细）、`app/amayui-inspector/`、`app/amayui-toolkit/`、`scripts/` 提取、`output/` |
| **③ 游戏引擎分析** | 反向 AGE 引擎 VM/字节码/机制 | [`engine/README.md`](./engine/README.md) | `engine/`（反编译 C）、`docs/re/engine/*`（详细）、`app/amayui-emulator/` |
| **④ app 工具** | 三个可运行子工程 | [`app/README.md`](../app/README.md) | `app/amayui-emulator/`、`app/amayui-inspector/`、`app/amayui-toolkit/` |

## 3. 目录结构（实际）

```
天結\
├─ CONTEXT.md / PROGRESS.md / PENDING.md / TODO.md  → 会话/工作临时快照（非正式文档）
├─ docs\
│   ├─ README.md            ← 本索引（新权威）
│   ├─ engine\  README.md   ← ①③ 引擎分析权威（新）
│   ├─ data\     README.md  ← ② 数据分析权威（新）
│   ├─ translation\ README.md ← ① 汉化权威（新）
│   ├─ re\  engine\（15 篇+README+member_functions.detected.txt）· src\（12 篇+README）· README.md
│   │         → 旧方向散篇，被 engine/ data/ 新 README 取代，保留为详细参考
│   ├─ images\  README+FONT.md+阴刻文字.md+SO0xx.md（9 图） → UI 图片汉化详情
│   ├─ AGERC对话框汉化.md / font-build.md    → 汉化边角详文（转入 translation/README 参考）
│   └─ translate\  keywords-*(48)+prob-*(249)+零散 5（302 篇）→ 待合并去重（后续）
├─ engine\   engine.cpp/hpp、天结_unpacked.exe_*.c/.lst、defs.h、hxclang_prelude.h
├─ app\
│   ├─ amayui-emulator\  README + docs\（01,02,03,04,06,07,08,09,10,11）
│   ├─ amayui-inspector\ README + docs\技术方案.md
│   └─ amayui-toolkit\   docs\（README + 01~06）
├─ scripts\  README + alf\ re\ uimap\ + 单文件工具
├─ tools\    README + alf\ eushully-decompiler\ Eushully_AGF_TooL\ Eushully-Editor\ unpack\
├─ patch\    README-测试版说明.md + CHANGELOG.md + BIN\ AGF\ AGERC.DLL + Amayui-CN_cnjp.ttf
├─ plugins\  htmlcard\ uimap（DSH 工具插件）
├─ res\      fonts\ images\ subs_cn_jp.json + AGERC 相关 .rc/.ps1/.rsh
├─ output\   callgraph*.html/.gv/.json + 各类 CSV 导出
├─ data\ / src\   各 941 个 txt
└─ install\ / raw\ / .tmp\   运行/临时大目录（/install、/raw 被 gitignore）
```

## 4. 文档层级约定

每个方向的权威 README 采用统一结构：**地位声明 → 核心结论（三级事实度） → 细则（指向旧散篇） → 冲突与取舍 → 待确认/待办**。
旧散篇为「事实细节的原始出处」，不再与新 README 冲突追平；若某处仍有分歧，以**方向 README + `docs/re/README.md` 地址表**为准。

## 5. 常见入口

- 引擎地址/索引速查、opcode→handler 全表：`docs/re/README.md`、`docs/re/engine/06-opcode到handler映射表.md`
- 汉化流水线/编码/字体/工具链：`scripts/README.md`、`tools/README.md`
- 翻译完成度/未翻译清单：`PROGRESS.md`、`PENDING.md`（临时快照）
- UI 图片总览与效果速查：`docs/images/README.md`、`docs/images/FONT.md`
