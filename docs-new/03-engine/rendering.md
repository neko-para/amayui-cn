# 03-engine · 绘制模型与淡入淡出

## 1. 绘制分辨率

- ✅ **1280×720**：config 默认 640×480，但**实际 draw 以 1280×720 为准**——背景源 `(0,0,1280,720)` 铺满、按钮最大 `(1263,710)`。
- ⚠️ 此前「1920×1080」判断来自错误的均匀列 dest 读数（按钮延伸到 x≈1596），已作废；正确模型为 op3-6=源裁剪、op7/op8=目标位置。

## 2. draw-texture 语义

- ✅ `draw-texture tex layer x y w h p q`：目标矩形 `(x, y, x+w, y+h)`；`p/q` 读为 int 再强转为 float（可能为 scale/alpha，待渲染层最终定）。
- ✅ 贴图变换是 D3D9 矩阵（`sub_4AC5F0` scale / `sub_4AC660` rot-axis / `sub_4AC750` translate）；正交投影下为 2D 仿射，Canvas2D/Pixi 均可表达。
- ✅ 分层队列：`graphics+258` 的绘制队列；`_this[11627]=1` 置脏标记。颜色填充 `sub_4AD0C0`(0x202)/`sub_4ACF60`(0x203)；文本走 GDI（`sub_456710`，0x204/0x205）。

## 3. 淡入淡出（FadeTimer）

- ✅ 引擎实现 = **FadeTimer 步进计时器**（7 DWORD + vtable）：字段 `[1]elapsed / [2]step / [3]leftover / [4]stop / [5]startTime / [6]stepDur`；`sub_453A20` ctor、`sub_453A60` start、`sub_453AF0` tick。
- ✅ fade opcode 家族 **0x20–0x38**（`sub_41D180…`）：各调 `sub_441410(mode)`：mode0=SetFade、1–8=SetLineFade、9=SetRandomFade。
- ✅ **静态「颜色/α」指令** = `0x202`(sub_4AD0C0) / `0x203`(sub_4ACF60)。
- ✅ boot→TITLE 路径**不调用** fade opcode（0x20-0x38 未触发）；时间性淡入淡出更像主循环场景切换时内部驱动 FadeTimer。

## 4. 渲染后端现状（app/amayui-emulator）

- ✅ `PixiBackend`（PixiJS v8 WebGL）：`setTexture([imgid,slot,color])` 绑定 slot→imgid 纹理；`drawTexture([tex,layer,srcX,srcY,srcW,srcH,dstX,dstY])` 按 op3-6=源裁剪、op7/op8=目标位置 1:1 贴；场景切换（脚本名变化）清空绘制层。
- ✅ 视口 1280×720；窗口 `useContentSize:true` + `win.setContentSize(1280,720)`；`autoDensity + devicePixelRatio`（canvas CSS 1280×720、底层按 DPR 高清）。
- ✅ 无界面光栅验证：真实 VM 到 TITLE 产出与真实标题菜单布局吻合（logo+散布按钮+版权+背景）。

## 5. 交叉引用

- 纹理 slot↔AGF 映射见 `./resource-loading.md`；渲染壳工程见 `../04-app/emulator.md`。
