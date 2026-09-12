# 脚本台账 · `ROOM`

> 由 `analysis/scripts.json` 生成（`node scripts/build-scripts.mjs`）—— **勿手改本文件**。

| 项 | 值 |
|---|---|
| 脚本 | `ROOM.BIN`（真源 `src/ROOM.txt`） |
| 状态 | 🟠 部分 |
| 是什么 | **回想（EU-ROOM）菜单**：一张背景 + 四个按钮（CG鑑賞 / シーン回想 / BGM鑑賞 / 情報画面），每个按钮旁显示 `回収数` 与 `回収率`。由 TITLE 菜单第 2 项 `call-script 526c` 进入。 |
| 怎么进/出 | TITLE.txt:365 `call-script 526c`；本脚本自己 `exit` 回 TITLE。进界面即 `play-bgm 29`（曲号 0x29 = BGM041）+ `call-script 524c SETMEMOIR` 重算收集度。 |

## 结构（读了哪些段）

| 行区间 | 锚点（必须出现在该区间内） | 职责 |
|---|---|---|
| `55-69` | `play-bgm 29` | 初始化：坐标数组（local b/33/5b…）、`play-bgm 29`（回想 BGM）、`call-script 524c`（SETMEMOIR 重算收集度） |
| `71-116` | `i21d 0 1f4` | ★`i21d 0 1f4`（0x21D CopyScene：把全屏过渡幕布 handle 0 复制成 0x1f4）+ `set-draw-color 1f4 …` 做进入/切换按钮时的淡入淡出；随后 4 个 joy-callback + 鼠标回调表 |
| `139-148` | `get-input-type` | 主轮询：`get-input-type` 分派（1 = 按下 → label_00002910 派发按钮；2/3 = 抬起/移动 → 重画） |
| `386-423` | `call-script 524d` | ★按钮派发：`local106 == 1` ⇒ CGMODE(524d)；`== 2` ⇒ HMODE(524e) + SETMEMOIR(524c)；`== 3` ⇒ **MMODE(524f)（BGM 鑑賞）**；回车后 `mov local106 (global-int 107a0a)` 复原光标项 |
| `490-510` | `play-voice (local-ptr 0)` | 角色语音试听路径：`i1bb 0`→`i1cf 10001`→`play-voice (local-ptr 0)`→**`i1bf`（跳读态置）**→`i1bb 1`（快进/跳读时不要给语音压低 BGM，见 0x1BF 的唯一读者 play-bgm） |

## 关键槽 / 局部量

| 名字 | 含义 |
|---|---|
| `local 106` | 当前光标命中的按钮序号（1..4；3 = BGM鑑賞） |
| `local 2` | 输入状态（0 空闲 / 1 按下 / 2 / 3；由 get-input-type 写） |
| `global 107a0a` | 上次光标项（退出到 TITLE 前复原用） |
| `local 33 / local b` | 四个按钮的命中区坐标数组（x / y） |

## 不变量（拿它做回归断言）

- 按钮 3（BGM鑑賞）走 `call-script 524f`，且必须**先**由 `call-script 524c SETMEMOIR` 算好 `122731/12272f/122730`（否则 MMODE 列表全空）
- 进入界面时 `play-bgm 29` 会解锁曲号 0x29（文件 id 0x1f）—— 这是"回収数"里最快 +1 的一条

## 坑（踩过一次，别再踩）

- ★四个按钮的 `回収数/回収率` 不是脚本自己算的：全部来自 `SETMEMOIR` 写的 `10e3ad/10e3ac`（CG）、`122519/12251c`（场景）、`12272f/12272e`（BGM）
- `i21d 0 1f4` 的 0x21D 与 `set-draw-color 1f4 …` 是**一对**：不实现 0x21D 就没有那块过渡幕布可画

## 缺口

- 左列四个按钮的贴片/命中区细节、`label_00002910` 的返回路径未逐行读（用到的部分已读）。

## 相关

- 引擎常态能力：`gallery-unlock-file-used-flags`（见 `docs-new/03-engine/engine-capabilities.md`）
- 函数结论：`0x42D8E0`（见 `analysis/functions.json`）
- 函数结论：`0x419840`（见 `analysis/functions.json`）
- 函数结论：`0x423C60`（见 `analysis/functions.json`）
- 函数结论：`0x419720`（见 `analysis/functions.json`）
- 主题文档：`docs-new/03-engine/gallery-and-unlock-flags.md`
- 守卫测试：`app/amayui-emulator/test/gallery-bgm-list.test.ts`

## 证据与备注

- 证据：src/ROOM.txt 的区间见 layout；运行期：`npm run shot -- --gallery` 出图 `.tmp/gallery-4-room.png`（四按钮 + 回収数）
- 备注：结构与 CGMODE/HMODE/MMODE 同构（背景 + 四按钮 + 同样的 i21d 过渡幕布 + 回调表）。未读：`label_00001dec`/`label_000022c4`/`label_00001f78` 三个绘制子程序的细节。
