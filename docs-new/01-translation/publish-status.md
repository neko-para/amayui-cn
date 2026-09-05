# 01-translation · 发布 / 补丁 / 进度

## 1. 补丁包内容（patch/）

| 项 | 说明 |
|---|---|
| `BIN\` | 已汉化的游戏脚本文件（全选复制到游戏根目录覆盖） |
| `AGF\` | 已汉化 UI 图片（复制到游戏根目录覆盖；游戏优先读根目录 AGF） |
| `AGERC.DLL` | 主菜单栏汉化补丁（覆盖根目录同名） |
| `Amayui-CN_cnjp.ttf` | 中文字体（Sarasa SC 基底） |
| `README-测试版说明.md` | 安装说明 |
| `CHANGELOG.md` | 改动记录（新版本在前，未发布改动集中「开发中」节） |

## 2. 安装步骤（见 patch README）

1. **复制一份游戏**，后续操作在副本上进行，原版不动。
2. 在副本根目录把 `AGE-EXTEND.TTF` 改名/移出（**必须**，否则中文不生效）。
3. 复制 `BIN\` 全部覆盖到游戏根目录。
4. 复制 `AGF\` 全部覆盖到游戏根目录。
5. 复制 `AGERC.DLL` 覆盖到游戏根目录。
6. 双击安装 `Amayui-CN_cnjp.ttf`。
7. **用 Locale Emulator 令其以「日语（日本）」区域运行** `AGE.EXE`（目录路径须英文/日文，不能含中文，否则乱码/异常）。
8. 进游戏设置，把字体分类（説明文/パラメータ文字数字/ＡＤＶルビ/ＡＤＶメッセージ）设为 **Amayui CN**（パラメータ文字/数字 = 设置界面自身字体，务必也改）。

## 3. 存档

- 本补丁存档：`%USERPROFILE%\AppData\Local\Eushully\天結いキャッスルマイスター`。
- 与心愿屋版存档通用，但位置不同；部分信息（如称号）保存的是获取时的内容，旧存档会导致部分显示异常。

## 4. 常见问题

- 中文没生效？确认 `AGE-EXTEND.TTF` 已移出、字体已安装、日语区域启动、重启游戏。
- 按钮/UI 图片还是日文？确认 `AGF\` 已复制到游戏根目录。
- 窗口顶部主菜单栏还是日文？确认 `AGERC.DLL` 已覆盖。
- 想还原原版？直接玩没动过的原版目录，或删掉打过补丁的副本重新复制一份再装补丁。

## 5. 数据完整性（manifest）

- `install-manifest.json`（install 顶层文件 MD5）/ `raw-manifest.json`（raw 基线 MD5）。
- `npm run check/compare/manifest`（大文件默认跳过，`--full` 强制；`--diff` 按 git 变更只处理 `*.txt`/`*.AGF` 对应产物）。

## 6. 当前进度（翻译已收官）

- **需翻译 465 文件中已译 453**；进度基线见 `PROGRESS.md`（2026-08-08 全量重扫 data：需翻译 465 / 无文本 240）。
- **未翻译 12**：系统/杂项 10（CHECKCONFIG、DEBUGADV、DEBUGADV2、DRAWILLTIP、INIT、INIT2、INITCONFIG0、MUINIT、REACH、TITLE）+ APPEND 2（`$3$AGENCY`、`$4$CNINIT`）。
- 无文本 240 = 基础版 11（ALLMAP、CALLBACK_LOAD、CLOSE、DELEN、DELENMASS、REIGN、REPLAYVOICE、SETHALLTEX、SUNSET、SYSTEM4、UNITECH）+ 追加包空壳 229。
- **后续只持续校对**：统一术语/措辞/语气；`CHANGELOG.md` 记录改动；`scripts/check-lost-quotes.js` 等校对工具（引号丢失、短句一致性 U+E000 停顿数量）。

## 7. 权威

- **`src/*.txt` = 翻译唯一权威、视为已确认**；旧的翻译中间产物已作废、不再引用。翻译进度以 `PROGRESS.md` 快照为准。

## 8. 交叉引用

- 流水线见 `./pipeline.md`；编码/字体见 `./encoding-font.md`；目录纪律见 `../00-overview/conventions.md`。
