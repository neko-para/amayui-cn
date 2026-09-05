# 01-translation · 编码与字体（中文显示层）

## 1. 引擎字体加载两层（关键）

- 若游戏目录存在 `AGE-EXTEND.TTF`，ADV 正文强制用它（内置字体），设置项不生效；
  **移除该文件后引擎回退到系统字体设置**，ＡＤＶメッセージ/説明文/パラメータ 等设置项才真正控制对应文本。
- 故方案 = **注册 cnjp 系统字体 Amayui CN + 游戏内把字体分类指向它**，不改任何游戏文件。
- `install` 中 `AGE-EXTEND.TTF` 已移除（排除名单；原文件备份 `.tmp/font-backup/`）。

## 2. SJIS 码位映射

- 译文写入脚本时用 `res/subs_cn_jp.json`（3000 条：简体→日文写法）把无法 cp932 编码的简体字替换为日文写法占位（如 `说→説`、`为→為`）；
- 引擎按 SJIS 解码后占位字符落在对应日文码位；字体构建把该码位字形替换为中文码位字形，于是显示为简体。

## 3. 字体（基底 = Sarasa Gothic SC）

> **当前基底 = Sarasa Gothic SC**（更纱黑体 SC，OFL，官方 TTF 1.0.40，约 24MB；2026-08 起替换原 WenQuanYi 微米黑，见 `../00-overview/authority.md`）。

| 文件 | 说明 |
|---|---|
| `res/fonts/Amayui-CN_cnjp.ttf` | **当前分发字体**（Sarasa SC 基底 cnjp 替换版，族名 Amayui CN，声明 Shift-JIS 932 码页，23MB） |
| `res/fonts/SarasaGothicSC/SarasaGothicSC-Regular_cnjp.ttf` | 中间产物（cnjp 替换但未改族名） |
| `res/fonts/SarasaGothicSC/*.ttf` / `SarasaGothicJ/*.ttf` | 官方字重（Regular/Bold/Light 等；SC 版含日文假名；J 备用，低优先级） |
| `res/fonts/MSGothic_WenQuanYi.ttf` / `WenQuanYi.ttf` | **旧 WenQuanYi 基底**（已弃用，可回退） |
| `res/fonts/AGE-Extend_cnjp.ttf` | 族名伪装 AGE Extend 并并入外字字形（文件覆盖方案遗留，当前不用） |

## 4. 字体重建（Sarasa 基底，需 fonttools）

```bash
# 1) 标准 cnjp 构建（cmap：日文写法码位 → 简体字形）
python scripts/font_CN_JP.py res/fonts/SarasaGothicSC/SarasaGothicSC-Regular.ttf
#    → res/fonts/SarasaGothicSC/SarasaGothicSC-Regular_cnjp.ttf（23MB，48741 glyphs）

# 2) 族名定制（name 表，全语言一致）：nameID 1/3/4/16='Amayui CN'，6='Amayui-CN'
# 3) OS/2 字符集声明（关键）：ulCodePageRange1/2 对齐 0x603E019F / 0xDFD70000（补 Shift-JIS 932）
```

- ⚠️ **932 码页是关键**：Sarasa SC 只声明 GBK 936，日文环境（game locale）按字符集过滤字体时会把 Amayui CN 排除 → 引擎回退默认字体 → 大量日文写法显示。修复 = 对齐 932 码页。
- ⚠️ fontTools 保存会按 cmap 引用重命名 glyph（gid 不变，仅 post 名变），对渲染无害，勿误判损坏。
- 验证：PIL/GDI+/DirectWrite 抽查「说/説、为/為、这/這」同形；随机 300 字符指纹与基底一致。

## 5. 注册与使用

- 注册：`npm run register-font`（会话级，重启需重跑）或双击安装 `res/fonts/Amayui-CN_cnjp.ttf`（永久）。
- 游戏内：字体分类（説明文、パラメータ文字/数字、ＡＤＶルビ、ＡＤＶメッセージ）设为 **Amayui CN**；
  ＡＤＶメッセージ落在 `SYS4REG.INI`（`[message] Font=`）；パラメータ文字/数字 = 设置界面自身字体，按索引持久化在 `SAVE.DAT`（需进游戏设置一次）。
- 外字：`Amayui-CN_cnjp.ttf` 不含 U+E000–E010；游戏中停顿标记由引擎处理/回退（可接受）；若目标机器显示异常（方块），把原字体的 U+E000–E010 字形并入 Amayui CN。

## 6. 交叉引用

- 流程见 `./pipeline.md`；目录纪律见 `../00-overview/conventions.md`。
