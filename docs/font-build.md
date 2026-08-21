# 字体构建流程（Amayui CN）

> 用途：生成并维护简体中文渲染字体 `Amayui-CN_cnjp.ttf`（游戏内各字体分类指向它，配合
> SJIS 码位映射把“日文写法占位”还原为简体字形）。
>
> 当前基底：**SarasaGothicSC-Regular**（更纱黑体 SC，2026-08 起替换原 WenQuanYi 微米黑，
> 见 §8）。日文假名支持：SC 版已含平假名/片假名；和制汉字字形提取（J 版）为低优先级待办，暂未处理。

## 1. 原理

- 译文写入脚本时用 `res/subs_cn_jp.json`（3000 条：简体 → 日文写法）把无法 cp932 编码的简体字
  替换为日文写法占位（如 `说→説`、`为→為`）；
- 引擎按 SJIS 解码后，占位字符落在对应日文码位；
- 字体构建把“日文码位的字形”替换为“对应中文字码位的字形”，于是占位文本在游戏中显示为简体。

## 2. 依赖

- Python 3 + `fonttools`（`pip install fonttools`）
- 替换字典：`res/subs_cn_jp.json`（3000 条，简体→日文写法）
- 基底字体（当前）：`res/fonts/SarasaGothicSC/SarasaGothicSC-Regular.ttf`（更纱黑体 SC Regular，
  官方 TTF 1.0.40；另有 `SarasaGothicJ/` 日文字形备用）
- 基底字体（旧，可回退）：WenQuanYi（文泉驿微米黑），`res/fonts/MSGothic_WenQuanYi.ttf`
  （族名伪装为 `ＭＳ ゴシック` 的版本）

## 3. 构建步骤

### 3.1 标准 cnjp 字体（上游 SExtractor 同款流程）

```bash
python scripts/font_CN_JP.py res/fonts/MSGothic_WenQuanYi.ttf
```

或 `--dict` 指定其它字典（默认 `res/subs_cn_jp.json`）；输入路径相对于执行时的工作目录。

脚本行为（`font_CN_JP.py`，fonttools 版）：

1. 读入 `res/subs_cn_jp.json`（脚本按自身位置解析，与执行目录无关）；
2. `Reverse = True`：键值互换（得到 日文写法 → 简体）；
3. 遍历 cmap（跳过 mac 平台），对每个（日文码位, 中文字形来源）做
   `cmap[中文字符] = cmap[日文字符]`——把日文码位渲染为简体字形；
4. 输出 `<输入名>_cnjp.ttf`。

> “平台/编码不存在”提示属正常现象（部分平台没有对应字符）。

### 3.2 项目定制（Amayui CN）

在 cnjp 基底上进一步：

1. **族名**：统一改为 `Amayui CN`（name 表全语言一致；PostScript 名 `Amayui-CN`），
   使游戏字体枚举中显示为唯一、可辨识的名字；
2. **外字**：见 §4 说明——当前分发字体**不含**外字字形，如需并入可参考 AGE-Extend 变体做法。

> 注意：定制步骤（改族名、并入外字）当前**未固化为一键脚本**，产物已入库可复用；
> 若需重建，需用字体工具（如 fontTools 脚本 / FontCreator）手工完成上述两步。

## 4. 产物与实测状态

| 文件 | 族名 | 外字 U+E000–E010 | 用途 |
|---|---|---|---|
| `Amayui-CN_cnjp.ttf` | Amayui CN | **无**（实测确认） | 当前方案：注册/分发，游戏内字体分类指向它；**基底 SarasaGothicSC（2026-08 起，23 MB）** |
| `SarasaGothicSC/SarasaGothicSC-Regular_cnjp.ttf` | Sarasa Gothic SC | 无 | 中间产物（未改族名版） |
| `AGE-Extend_cnjp.ttf` | AGE Extend（伪装） | 有 | 旧“文件覆盖 AGE-EXTEND.TTF”方案遗留，弃用 |
| `MSGothic_WenQuanYi_cnjp.ttf` 等 | ＭＳ ゴシック / WenQuanYi | 无 | 基底/中间产物（旧 WenQuanYi 线） |

外字实况：

- 原版引擎字体 `AGE-EXTEND.TTF`（DATA1 内解出，备份于 `.tmp\font-backup\AGE-EXTEND.TTF.data1.bak`，
  323KB）含 U+E000–E010 等 104+ 私有区字形（停顿标记，三角旗+斜线符号）；
- `Amayui-CN_cnjp.ttf` 本身不含这些字形；游戏中停顿标记（U+E000–E010）实测可显示
  （表现为短横线，由引擎对缺字形的处理/回退实现），可接受，中文侧无需占位符；
- 若目标机器显示异常（方块），把原字体中的 U+E000–E010 字形并入 Amayui CN
  （做法同 AGE-Extend 变体），或改分发 AGE-Extend 变体。

## 5. 使用与分发

- 注册：`npm run register-font`（会话级，重启后需重跑）或双击安装 `res/fonts/Amayui-CN_cnjp.ttf` 永久生效；
- 游戏内：设置界面把字体分类（説明文、パラメータ文字/数字、ＡＤＶルビ、ＡＤＶメッセージ）
  设为 **Amayui CN**（パラメータ文字/数字 = 设置界面自身字体）；
- 分发：随 `patch\` 打包（`npm run sync-patch` 从 `res/fonts/` 复制字体条目）。

## 6. 注意事项

- SExtractor 自带的老版 cnjp 字体缺 `顕→显` 替换，**必须按当前字典重新生成**，不要直接复用旧产物；
- 字典维护：`res/subs_cn_jp.json` 删除某条目 = 该简体字不再可用（渲染时按字典缺失报错）；
- 构建依赖字典、基底、工具三者的版本一致性；重生成后需重新装字体并重启游戏验证。

## 7. 旧方案（v1，仅历史参考）

`tools/SExtractor/tools/Font/v1/`：otfcc（`otfccdump` → 改 cmap JSON → `otfccbuild`）
+ FontCreator（伪装 `MS Gothic`/`ＭＳ ゴシック` 族名）。已被 fonttools 版替代。

## 8. 基底更新：WenQuanYi → SarasaGothicSC（2026-08）

### 8.1 动机

- WenQuanYi 微米黑只有常规字重，`font-weight:900` 渲染仍细（SVG text 场景下合成粗体基本无效），
  且 UI 渲染（SO009B 等）需要更合适的字体；
- 需要同时支持简体中文 + 日文假名（引擎残留日文），并具备原生 Bold。

### 8.2 选型

- 基底：**SarasaGothicSC-Regular.ttf**（更纱黑体 SC，OFL，官方 TTF 1.0.40，~24 MB）；
- 日文备用：`SarasaGothicJ-Regular.ttf`（后续和制汉字字形提取用，低优先级）；
- 未采用 Mono/UI 变体：游戏内非中文基本是数字/符号，且现有翻译大量使用全角数字
  （宽度恒 1em，与等宽无关）；Gothic 半角数字已由 Iosevka 拉丁提供 tabular 对齐。

### 8.3 构建步骤（2026-08-22 实测）

```bash
# 1) 标准 cnjp 构建（cmap 替换：日文写法码位 → 简体字形）
python scripts/font_CN_JP.py res/fonts/SarasaGothicSC/SarasaGothicSC-Regular.ttf
#    → res/fonts/SarasaGothicSC/SarasaGothicSC-Regular_cnjp.ttf（23 MB，48741 glyphs）

# 2) 族名定制（name 表，全语言一致）
#    nameID 1/3/4/16 = 'Amayui CN'，6 = 'Amayui-CN'，2/17 = 'Regular'
#    脚本参照 .tmp/rename_amayui_cn.py（fontTools 改 name 表）
#    → 输出 res/fonts/Amayui-CN_cnjp.ttf（覆盖旧版，register-font 引用此路径）

# 3) OS/2 字符集声明修复（关键，见 §8.5）
#    ulCodePageRange1/2 对齐旧版值 0x603E019F / 0xDFD70000（补 Shift-JIS 932）
```

### 8.4 验证方法（构建后必做）

- **cmap 替换**：PIL（FreeType）/ GDI+（System.Drawing）/ DirectWrite（WPF GlyphTypeface
  `CharacterToGlyphMap`）三种路径抽查「说/説、为/為、这/這、时/時、对/対」gid 或渲染同形；
- **非替换字符完整性**：随机 300 字符 FreeType 渲染指纹与基底一致（差异应全部为字典替换条目）；
- **OS/2 码页位**：`(os2.ulCodePageRange1 >> 17) & 1 == 1`（932）。

### 8.5 踩坑记录

1. **fontTools 保存会按 cmap 引用重命名 glyph**（如 gid 41097 从 `uni8BF4` 改名为 `uni8AAC`、
   原 `uni8AAC` 改名为 `glyph40770`）：gid 顺序与轮廓不变，仅 post 表名字变化，**对渲染无害**
   （FreeType/GDI/DirectWrite 均按 gid 取形），勿据此误判字体损坏；
2. **CMAP 替换"似乎失效"的真相 = OS/2 码页声明**：SarasaGothicSC 只声明 GBK 936
   （`ulCodePageRange1=0x8004019F`），**缺 Shift-JIS 932**；日文环境（游戏 locale）按字符集
   过滤字体时 Amayui CN 被排除 → 引擎回退默认字体 → 大量日文写法显示。
   **修复**：`ulCodePageRange1/2` 对齐旧版（WenQuanYi）`0x603E019F / 0xDFD70000`。
   安装后若仍不生效：完全退出游戏 + 重启 `FontCache` 服务（或重启电脑）再测；
3. 替换方向：字典 `res/subs_cn_jp.json` 键=简体、值=日文写法，脚本 `Reverse=True` 互换后
   `cmap[日文写法] = cmap[简体]`（产物中「説」渲染为「说」形状，方向正确）。

### 8.6 产物与备份

| 文件 | 说明 |
|---|---|
| `res/fonts/Amayui-CN_cnjp.ttf` | **当前分发字体**（Sarasa SC 基底，23 MB，族名 Amayui CN，含 932 码页声明） |
| `res/fonts/SarasaGothicSC/SarasaGothicSC-Regular_cnjp.ttf` | 中间产物（未改族名版） |
| `.tmp/font-backup/Amayui-CN_cnjp.ttf.wenquanyi.bak` | 旧版（WenQuanYi 基底，可回退） |
| `.tmp/font-backup/Amayui-CN_cnjp.ttf.sarasa-nocp.bak` | 无 932 码页声明的坏版本（仅留档） |

安装：复制到 `%LOCALAPPDATA%\Microsoft\Windows\Fonts\`（永久）或 `npm run register-font`（会话级）；
需重启游戏 + 刷新 FontCache 生效。

### 8.7 后续计划（优先级：低，暂不处理）

- **和制汉字字形提取**：字典未覆盖的日文特有汉字（如 働・峠・辻・畑）在 SC 基底中可能缺失或
  用简体字形；后续从 `SarasaGothicJ-Regular.ttf` 按码位提取字形替换进产物。


