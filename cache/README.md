# cache/ —— 构造运行环境用的**数据样本**（不是代码，也不进 overlay）

这里的文件是**从真游戏目录取样**的原始玩家数据，用来在"没有真游戏安装"的机器上
构造出可复现的运行环境。它们**只读**：环境构造靠复制，永远不要就地修改，
也不要把 emulator 写出来的东西放回这里。

## 内容

| 文件 | 是什么 | 取样自 |
|---|---|---|
| `SAVE79.DAT` | 一个**真存档槽**（`S4SD`/`460B`，`format=3` = 模幂混淆 + LZSS；含帧记录与三个池） | `%LOCALAPPDATA%\Eushully\天結いキャッスルマイスター\SAVE\SAVE79.DAT` |
| `SAVE79.STH` | 上面那个槽的缩略图（320×180 24bpp **BMP**；引擎头里的 `bfSize` 故意少写 14，见 `src/vm/bmp.ts`） | 同目录 `SAVE79.STH` |

`SAVE79` 这个槽号不是随便挑的：`app/amayui-emulator/tools/shot.cjs --load` 走的是
「读档列表 → 左翻页到 `070..079` → 载入当前选中槽」这条路，判据是日志里的
`savedCur=2`（槽 79 的特征）。所以 079 是**读档链 E4 回归**用的那一格。

## 怎么构造环境（macOS / 无 `LOCALAPPDATA` 时的默认落点）

`resolveSystemPaths()`（`app/amayui-emulator/src/arch/systemPaths.ts`）在没有
`LOCALAPPDATA` 时把系统存档目录退到**仓库内**的：

```text
base    = <repo>/.tmp/appdata/Eushully/天結いキャッスルマイスター
overlay = <repo>/.tmp/appdata/Eushully/天結いキャッスルマイスター.overlay
```

读 = overlay → base；写 = 只写 overlay（真游戏那层一个字节都不动）。

```bash
cd <repo>
OV=".tmp/appdata/Eushully/天結いキャッスルマイスター.overlay"
mkdir -p "$OV/SAVE"
cp cache/SAVE79.DAT cache/SAVE79.STH "$OV/SAVE/"
# ★把 mtime 拨回**头里记的存档时间**：`save-slot.test.ts` 的 E4 断言
#   「头 +264..+276 六个 u16 = 文件 mtime」。样本是拷出来的，mtime 会漂成拷贝时间，
#   不拨回去这条断言会红在一个**与环境有关**、与实现无关的地方。
touch -t 202609190038.58 "$OV/SAVE/SAVE79.DAT" "$OV/SAVE/SAVE79.STH"
```

验证：

```bash
cd app/amayui-emulator
npm run shot -- --load 79 --name mycase --page 870,900   # → .tmp/mycase-*.png
```

## 两个刻意的限制（不要用"造假"绕过）

1. **不放 `base/`**。`overlay.test.ts` 的「真实 base 目录就在本机」只在 base **存在**时才校验
   「`SYS4REG.INI` 或 `SAVE\SAVE.DAT` 至少有一个」。本机**没有真游戏安装**（这两份都没有），
   所以正确做法是**不建 base**（该测试自报 skip），而不是塞一份 emulator 自己写的
   `SAVE.DAT`／把 overlay 的 `SYS4REG.INI` 复制过去 —— 实测那样做会让
   `config-version-substr.test.ts`（读 base 的 INI 取 `set:GameVersion`）从 1.07.0019 掉成
   0.00.0000、`engine-config.test.ts` 的字体名断言空值而红，**红在与实现无关的地方**。
2. **槽号不复制成 `SAVE00`**。有若干 E3/E4 用例把槽号硬编码成 `SAVE00.DAT`／`SAVE00.STH`
   （`save-slot.test.ts`、`save-thumb.test.ts`、`slot-load-resume.test.ts`）。在只有 079 的机器上
   它们自报 skip 是**如实**的；把 079 改名成 00 能让它们跑起来，但那是在"环境"里做假。
   需要跑这些用例时，应当补一份**真的** `SAVE00`（或整套真游戏目录），而不是改名。
