# 字体构建流程（Amayui CN）

> 用途：生成并维护简体中文渲染字体 `Amayui-CN_cnjp.ttf`（游戏内各字体分类指向它，配合
> SJIS 码位映射把“日文写法占位”还原为简体字形）。

## 1. 原理

- 译文写入脚本时用 `res/subs_cn_jp.json`（3000 条：简体 → 日文写法）把无法 cp932 编码的简体字
  替换为日文写法占位（如 `说→説`、`为→為`）；
- 引擎按 SJIS 解码后，占位字符落在对应日文码位；
- 字体构建把“日文码位的字形”替换为“对应中文字码位的字形”，于是占位文本在游戏中显示为简体。

## 2. 依赖

- Python 3 + `fonttools`（`pip install fonttools`）
- 替换字典：`res/subs_cn_jp.json`（3000 条，简体→日文写法）
- 基底字体：WenQuanYi（文泉驿微米黑），`res/fonts/MSGothic_WenQuanYi.ttf`（族名伪装为 `ＭＳ ゴシック` 的版本）

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
| `Amayui-CN_cnjp.ttf` | Amayui CN | **无**（实测确认） | 当前方案：注册/分发，游戏内字体分类指向它 |
| `AGE-Extend_cnjp.ttf` | AGE Extend（伪装） | 有 | 旧“文件覆盖 AGE-EXTEND.TTF”方案遗留，弃用 |
| `MSGothic_WenQuanYi_cnjp.ttf` 等 | ＭＳ ゴシック / WenQuanYi | 无 | 基底/中间产物 |

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

