# T-0102 · ★★**根因与修复**：`0x202 set-draw-color` 缺"操作数为负 ⇒ 取当前色"的回退（轮 21）

> 这是本票**结案**的那一轮。前面所有"排除项"（纹理/占位块/`0x259`/脚本分支/`global 0`）都对，
> 但它们只是**围绕**症状；真正的分歧在一行 handler 语义上。

---

## 1. 一句话

窗口例程每帧发 **`set-draw-color <win> 0 800 -1 -1`**（标题里那两个 `-1` 是**操作数**，不是"黑"），
引擎的语义是"**动画到当前色**"；模拟器把 `-1/-1` 按位拼成 **`0xFFFFFFFF`（白不透明）** ⇒
**窗口淡入成白色**。真机淡入成"当前色"（= 前一条 `set-draw-color-alpha` 刚设好的**半透明黑**）⇒ 黑。

**修复前 / 后**（同一存档、同一位置 `SC0000.BIN ip=1330`）：

| | 截图（sha256 前 8 位） | 窗口项 `itemColor` 的 α |
|---|---|---|
| 修前 | `e4-sc0000-g0001-paper-window.png`（`8CD3654E…`）**白底纸窗** | `104000:a255`（默认白） |
| 修后 | `e4-adv-window-fixed-black.png`（`B0BFB1F5…`）**半透明黑窗 + 白字** | `104000:a160` ✓ |

---

## 2. 引擎原文（权威）

`0x202 set-draw-color` 的 handler **`sub_4231F0`**（`engine/天结_unpacked.exe_utf8.c` raw 31381-31416）：

```c
v2 = sub_41BF50(_this, 4);          // op4 = α
v3 = sub_41BF50(_this, 5);          // op5 = 颜色
if ( v2 <= 255 ) {
  if ( v2 < 0 ) { v4 = sub_41BF50(_this, 1); v2 = (unsigned)sub_4ADD60(this + 80708, v4) >> 24; }  // ★α<0 ⇒ 当前色的 α
} else v2 = 255;
if ( v3 < 0 ) { v5 = sub_41BF50(_this, 1); v3 = sub_4ADD60(this + 80708, v5); }                   // ★色<0 ⇒ 当前色
v9 = sub_41BF50(_this, 3); v8 = sub_41BF50(_this, 2); v6 = sub_41BF50(_this, 1);
return sub_4AD0C0(this + 80708, v6, v8, v9, (u8)v3 | ((BYTE1(v3) | (((v2 << 8) | BYTE2(v3)) << 8)) << 8));
//                                                       ↑ 最终 = (α & 0xff)<<24 | (color & 0xffffff)
```

`sub_4ADD60(Scene, handle)` = 按 handle 查绘制项、**查不到返回 −1**、否则读 `DrawItem+0x60`（`Item.from`）。

⇒ `set-draw-color h 0 800 -1 -1` 的**确定语义**：`TO = (当前α << 24) | (当前 RGB)`，即"淡入到**当前色**"。
（`0x203` 有一模一样的一对回退，raw 31431-31447 —— 模拟器那边**已经实现**了，`0x202` 漏了。）

## 3. 为什么这一条决定了"白 / 黑"

窗口例程（`src/SC0000.txt:32680-32685`，`SN0000`/`SYSTEM4` 同型）每帧的顺序：

```
draw-texture 19640 11 0 0 43e 95 5d 22c                       ; 窗图（SO001 的框）
set-draw-color-alpha 19640 0 (global f807d) (global a9db)     ; ★工作色 = α=f807d、RGB=a9db
…
set-draw-color 19640 0 800 -1 -1                              ; ★TO := 当前色（= 上面那个半透明黑）
set-draw-color-alpha 19640 0 0 0                              ; FROM := 全透明 ⇒ 淡入
```

`a9db` 的默认值是 **0（黑）**（`src/INITCONFIG2.txt:10` + 配置键 `message:*`），
`f807d` 由 `src/SYSTEM4.txt:654-674` 按模式取 `a9df/a9e0/a9e1` = **0xc0/0xa0/0x80**。

- **引擎**：TO = `0xA0000000`（半透明黑）⇒ 窗口从全透明**淡入成半透明黑** ✓ = 真机
- **修前的模拟器**：TO = `0xFFFFFFFF`（`-1 & 0xff` = 0xff、`-1 & 0xffffff` = 0xffffff）⇒ **淡入成白** ✗

## 4. 修复

`app/amayui-emulator/src/vm/handlers/gfx-item.ts` 的 `op_set_draw_color` 补上两条回退
（回退源与 `0x203` 共用 `native.getDrawItemColor`，且**必须在写入之前取**）：

```ts
const current = (): number => c.native.getDrawItemColor?.(handle) ?? -1;
if (a > 255) a = 255;
else if (a < 0) a = current() >>> 24;
if (b < 0) b = current();
c.native.setDrawColor?.(handle, delay, count, (((a & 0xff) << 24) | (b & 0xffffff)) >>> 0);
```

**守卫** `app/amayui-emulator/test/op-0202-negative-fallback.test.ts`（4 例）：
① `-1/-1` ⇒ TO = `0xa0000000`（**修前必红**：旧实现给 `0xffffffff`）；② α 的 clamp 与"只回退一边"的三种组合；
③ `0x203` 的回退不受影响；④ **引擎棘轮**（`sub_4231F0` 里那两条 `sub_4ADD60` 回退必须还在）。

## 5. 顺带结算的其它条目（都保持成立，但都不是本症状的成因）

| 项 | 结论 |
|---|---|
| 「未配置纹理 ⇒ 引擎整笔忽略」 | **成立**（`DrawTexture` 报错 + `return 0`），但 `Error.log`（`OutErrorLog=1`）里**没有** `TEXTURE=17` ⇒ 这一帧槽 17 **有**纹理、两笔都画了 ⇒ **不是本症状的成因**。见 `texture-absent-draw-policy.md` |
| 模拟器的 1×1 白占位块 | 与引擎不同构（引擎没有替代纹理），**已删**（`presenter` 改为跳过 + 日志）。**不是**本症状的成因（修前日志里 `未绑定纹理槽` 0 条） |
| `0x259` 口径纠错 | 独立成立，保留 |
| `global 0 = 1` / 章节链 | 与真机同值，无关 |
| SO001 的两片源矩形 | 19640 (0,0,1086×149) = **93% 不透明纯白**；19641 (0,151,1092×154) = **84.2% 全透明**（权威值 = `raw-parts/DATA1-png/SO001.png`，与模拟器解码逐值一致 ⇒ 解码没问题） |

## 6. 复现与验证命令（可复算）

```powershell
# 1) 起守护（默认静音）
$env:AMAYUI_WINDOW_EDGE='1'; .\node_modules\.bin\electron.cmd tools/debugsrv.cjs
# 2) 载入存档 071 → 推进过切章
node tools/dbg.cjs click 1070 480 ; node tools/dbg.cjs clickimg 677 181
node tools/dbg.cjs clickimg 190 865 ; node tools/dbg.cjs clickimg 802 400
for ($i=0; $i -lt 60; $i++) { node tools/dbg.cjs --wait 40 click 640 360 }
# 3) 判据：窗口项的 α（日志里的 [present] 摘要）
#    修前 104000:a255 ； 修后 104000:a160
Select-String -Path .tmp/amayui-emulator.log -Pattern '104000:a\d+' | Select-Object -Last 1
# 4) 截图
node tools/dbg.cjs shot fixed-window
```
