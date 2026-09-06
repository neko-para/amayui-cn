# 03-engine · 绘制模型与淡入淡出

## 1. 绘制分辨率

- ✅ **1280×720**：config 默认 640×480，但**实际 draw 以 1280×720 为准**——背景源 `(0,0,1280,720)` 铺满、按钮最大 `(1263,710)`。
- ⚠️ 此前「1920×1080」判断来自错误的均匀列 dest 读数（按钮延伸到 x≈1596），已作废；正确模型为 op3-6=源裁剪、op7/op8=目标位置。

## 2. draw-texture 语义

- ✅ `draw-texture tex layer x y w h p q`：目标矩形 `(x, y, x+w, y+h)`；`p/q` 读为 int 再强转为 float（可能为 scale/alpha，待渲染层最终定）。
- ✅ 贴图变换是 D3D9 矩阵（`sub_4AC5F0` scale / `sub_4AC660` rot-axis / `sub_4AC750` translate）；正交投影下为 2D 仿射，Canvas2D/Pixi 均可表达。
- ✅ 分层队列：`graphics+258` 的绘制队列；`_this[11627]=1` 置脏标记。颜色填充 `sub_4AD0C0`(0x202)/`sub_4ACF60`(0x203)；文本走 GDI（`sub_456710`，0x204/0x205）。
  - ⚠️ 地址分层：dispatch 表里的 opcode handler 是 `0x202→sub_4231F0` / `0x203→sub_4232C0`（读操作数、组装 ARGB），它们**内部调用** `sub_4AD0C0`(0x202)/`sub_4ACF60`(0x203) 才真正下发颜色（见 [./opcode-table.md](./opcode-table.md)）。
- ✅ **文本/台词渲染走「消息窗对象」**（`this + 0x534C`，即「消息系统」=台词显示子系统）：`show-text`/`end-text-line`/`wait-for-input` 直接调它，字体与布局由 `sub_459F40`（LOGFONT/HFONT/GDI TEXTMETRIC）重建。对象定位与详情见 [./runtime-memory.md](./runtime-memory.md) §1.1。

## 3. 淡入淡出（FadeTimer）

- ✅ 引擎实现 = **FadeTimer 步进计时器**（7 DWORD + vtable）：字段 `[1]elapsed / [2]step / [3]leftover / [4]stop / [5]startTime / [6]stepDur`；`sub_453A20` ctor、`sub_453A60` start、`sub_453AF0` tick。
- ✅ fade opcode 家族 **0x20–0x38**（`sub_41D180…`）：各调 `sub_441410(mode)`：mode0=SetFade、1–8=SetLineFade、9=SetRandomFade。
- ✅ **静态「颜色/α」指令** = `0x202`(sub_4AD0C0) / `0x203`(sub_4ACF60)。
- ✅ boot→TITLE 路径**不调用** fade opcode（0x20-0x38 未触发）；时间性淡入淡出更像主循环场景切换时内部驱动 FadeTimer。
- ✅ **fade opcode 家族确为视效渐变**：0x20–0x2D 各自映射到 `sub_41D0E0/41D180/41D290/41D390/41D490/41D590/41D6A0/41D780/41D860/41D940/41DA20…`，全部调 `sub_441410`(line 49942，mode 0–9 依次 = SetFade / SetLineFade×8 / SetRandomFade)，启动的计时器是**命令级** `_this + 107461`（`sub_453A60` at 26981/27015…）。这些 opcode 在 LOGO/bootstrap 均不存在。
- ✅ **LOGO 场景的「渐变」不由引擎引入（判定：来自 LOGO.MPG 视频内容本身）**：
  - `LOGO.txt` 全程无 fade 指令，boot→LOGO→INIT→TITLE 执行路径也没有 0x20–0x38；`INIT.txt` 仅 mov/copy-local-array/set-string。
  - `play-movie`(0x20F, `sub_4237B0`) 只做：构造 movie 对象 → `sub_454FA0` 取路径 → `sub_488DC0`(Media Foundation) 装载 → `sub_489230` 绑资源 → `sub_4054D0`/`sub_405460` 按 flag 定播放模式 → `sub_4885A0` 设音量 → `sub_4883A0` 开播 → 置 `_this[699204]\|=0x2000`、`_this[675972]=1`。**无任何 `sub_453A60`/`sub_441410` 调用**。
  - 主循环里 `_this[699204]&0x2000` 分支（line 20619-20638 / 20723-20742）只 delete movie 对象并清 0x2000 标志，**不产生画面淡入淡出**。
  - ⚠️ **勿混淆**：主循环里紧邻的 `sub_453A60(_this+430012, 10)`（line 20651）是 **BGM/音乐淡入** 计时器（配 `sub_489D10`/`sub_489E50` 对 `_this+697816`=Music 对象做音量渐变；`+697816/4 = 174454`，与 BGM 指令 `sub_420E00` 里 `sub_489D10(_this+174454,…)` 是同一对象）；`10` 是**周期(ms)**，不是 fade mode。
  - ⇒ **实测修正**（用户确认）：`install\DATA5\LOGO.MPG` **前后无渐变**；而 **版权页(SO006/SO005, 步骤1) 出现/消失** 与 **主菜单(SO004, 步骤3) 出现** 都有**黑色渐变**。⇒ 渐变**不来自视频**，也**不来自 fade opcode**（boot→LOGO→INIT→TITLE→消息循环路径从未执行 0x20–0x38；emulator 逐条执行该路径从未碰到它们）。⇒ 属**引擎内建**的「场景切换/加载」渐变机制（在渲染/画面层面，独立于 fade opcode 之外）。⚠️ 「等待」已收敛为 0x400 卫门（见下）；**渐变**的精确画面原语仍在深挖（见下 `0x20B`/`0x323`/0x1000 过渡门）。
- ✅ **LOGO 的 `set-vertex-color(-alpha)` 是静态颜色场/遮罩（非渐变动画）**：`sub_426CF0`(0x323, line 33358)→`sub_4AE330` 一次性向网格顶点着色表写 A(operand4)/RGB(operand5)（置 `_this[11627]=1` 重建脏标记），**无计时器/无逐帧插值**。例 `set-vertex-color-alpha mesh 0 1f4 0 0`=顶点 0..0x1f4 全透明、`… 1194 1f4 ff 0`=顶点 0x1194..+0x1f4 全不透明 → 版权/元素遮罩。
- ✅ **SYSTEM4/LOGO 缺口 opcode 已补齐（等待与渐变的执行者）**：此前"仅映射"的 25 个已确认，关键几个：
  - **等待（版权页）** = `0x21C`(`u00416270`/`sub_41A260`) 置 `_this[174801]|=0x400` → 主循环 **0x400 卫门**（line 20934-20977）每帧驻留（`sub_407E20(_this+322832)` 图形池挂起/计时检查或 `v95` 影片标志为真则 `goto LABEL_186` 不落派发），脚本 ip 停在 LOGO:47；`sub_407E20` 返 0 且 `!v95` 时清 0x400 才派发。**实机 ip=47/effect_flags=0x400 与之一致。** 时长由 `sub_407E20` 的 byte 369356(时长)/369352(始)/369344(强制结束) 决定。**注意：不是 `0x1F4`/`0x1F5`（LOGO.txt 未用，帧计时原语在 SYSTEM4）。**
  - **渐变（版权页/菜单过渡，未完全定论）** = **引擎内建「场景切换/加载」暗场渐变**，独立于 fade opcode 族、也独立于 present 的清黑（present 的 ClearTarget 被 `_this+46460&1` 守卫、该字段恒 0 → present 从不无条件清黑；present 仅在 `sub_40BE10(...)==1` 图形池脏时执行）。最可能走主循环 0x1000 过渡门（`sub_421AA0` 置 0x1000 + 启动 `_this+430096` 场景 FadeTimer）+ 场景内容分帧提交；`0x20B`(`sub_4A4C70`)=纯色+α 填充、`0x323`(`sub_4AE330`)=静态网格遮罩（均无逐帧计时）。
  - **等待原语族**（非 LOGO）：`0x1F4`/`0x1F5`(帧计时/倒计续跑)、`0x20C`(present 一帧)、`0x1CE`(消息点击-跳读状态机，同时触 `_this[174801]` 与 byte 430600 计时器)。
  - ⇒ **收敛**：「等待」= 0x400 卫门（`0x21C` 置位、`sub_407E20` 图形池挂起计数驱动，独立于此前候选的 0x1F4/0x1F5）；「渐变」= **mesh 顶点色插值动画（CalcDiffuse）**，非 fade opcode、非 present 清黑、非视频。版权页本身的 `draw-texture` 的 p/q(0x1FB op7/op8) 为 0（非 α，是 scale）；真正的 α 来自 `set-draw-color-alpha`(0x203)/`set-vertex-color-alpha`(0x323) 写入的 mesh 状态色 + **α 混合渲染**。`_this+812x`/bit0x8/FadeTimer/gamma/D3D 在版权页暂停时实测全 0。

### 3.1 版权页「frame 效果」机制（LOGO.txt，已收敛：mesh 全屏覆盖层 + CalcDiffuse 颜色调制）

**组成**（LOGO.txt）：2 张整屏图（大理石 layer 2a、文字 layer 2b）+ **2 个顶点色全屏四边形**（mesh#1=0x30d42、mesh#2=0x30d43）。

**mesh 建立**（`u0043AA20`/0x320, `sub_432150`→`sub_4ADFE0`→`sub_4A2280`，40262/130665/120518）：
- op1=mesh 句柄、op2/3/4=逐顶点 X/Y/Z-u 源数组、op5=常量1.0(w)、op6=**逐顶点颜色数组**（用 key `_this[388236]` 解码）、op7/8=属性源、**op9=顶点数**（LOGO 里=4）、op10=尾参→entry[6]。
- 顶点 36 字节/个：`x,y,z/u,w(1.0),DWORD diffuse@+16,4个attr浮点`。
- mesh 条目（`sub_40DC30(_this+266,&a2)`）：`[1]`=VB [2]=X源 [3]=Y源 [4]=逐顶点颜色数组 [5]=顶点数 [6]=尾参 [9]=色 [11]=rangeStart [12]=rangeCount [13]=**state0** [14]=**state1**。

**两个颜色状态**：
- `set-vertex-color`(0x322, `sub_426C20`→`sub_4AE2C0`)→ entry[13]=**state0**（ARGB=(op3<<24)|op4），并 `CalcDiffuse(entry,0.0)` 立即烘焙。
- `set-vertex-color-alpha`(0x323, `sub_426CF0`→`sub_4AE330`)→ entry[10]=0、**[11]=起点**、**[12]=点数**、[14]=**state1**（ARGB=(op4<<24)|op5），置 `|2` 待动画旗标。
- LOGO 里：mesh#1 state0=0xff000000(不透明黑)、state1=0x00000000(透明黑)；mesh#2 state0=0x00000000(透明黑)、state1=0xff000000(不透明黑)。

**CalcDiffuse（sub_4A2050, 120438）= 颜色调制**：逐字节通道线性插值 `blend = state1*byte*a3 + state0*byte*(1-a3)`（120475-120479）；然后对每顶点基础色（entry[4]/a2+16）**逐通道乘 blend/0xFF** 写入 VB+16（120502-120503），blend=不透明白(0xFFFFFFFF)则原样直拷（120482-120492，性能等值快路径）。⇒ **mesh 渲染色 = 逐顶点基础色 × 插值态色**。

**绘制时动画因子**（mesh 绘制 `sub_4AF1C0` RenderPolygon, 131435；131491-131501）：
```
if (entry[0]&2 && entry[12]>0 && _this[46500] < entry[10]+entry[11]+entry[12] && !_this[46512])
   if (_this[46500] > entry[11]+entry[10])
      a3 = (_this[46500]-entry[11]-entry[10])/entry[12];  CalcDiffuse(entry, a3);
   _this[46516] = 1;               // 挂起工作旗标（让 0x400 卫门保持）
else  // 完成/收尾
   entry[11]=0; entry[12]=0; entry[13]=entry[14]; entry[14]=-1; CalcDiffuse(entry,0.0);
```
`_this[46500]` = **引擎只读的全局「场景扫掠/动画时钟」位置**（byte 0xB5A4，DWORD 下标别名 `[11625]`）。**engine.cpp 会写它**（此前「从不写/引擎外递增」结论有误，已修正）：真正字段 = **引擎 `*(_DWORD*)(_this+369332)`**（= 池基 322832 + 46500；DWORD 引擎下标 `[92333]`、池下标 `[11625]`），**来源 = `timeGetTime()`（Windows 毫秒表）**，**不是手动帧计数器**。主循环每帧：`v3=timeGetTime`(20445) → `v94=v5=timeGetTime()`(20465-20467) → 帧同步分支(20571-20576，`effect_flags&0x2400` 含 0x400 等待时也执行) `[369336]=[369332]`(20575 存旧值) → `[369332]=v94`(20576 写新值)，同分支在后置条件满足时 present `sub_4B4040`(20583)。⇒ **实时毫秒**、动画速率**与 fps 无关**（按墙钟走）。脚本级显式时间戳 op：`sub_41A090`(0x1F4/24953，置 107438 后取 timeGetTime)、`sub_41A1A0`(0x20C/25014，取 timeGetTime+present)、`sub_41A2C0`(0x23C/25059，恒取 timeGetTime)；均 `[92334]=[92333]; [92333]=timeGetTime()`。**逐帧驱动链**：`sub_4B4040`(present, 134702) → `sub_4B06D0`(每 present 一次, 134755) → `sub_4AF1C0`(每 mesh/对象, 134875/133736/…) → `sub_4A2050`(CalcDiffuse)。`sub_4AF1C0`(131435-131622) 是**独立函数**（非 sub_4B06D0），每 present per-object 调用。
<br>**v39 0→1 与刷新**：`v4=entry[10]`（窗起点，entry[10]==0 时锁存为当前时钟 131486）；随时钟从 `entry[11]+v4` 推进到 `entry[11]+v4+entry[12]`，`v39=(钟-entry[11]-v4)/entry[12]` 0→1 → `sub_4A2050` 逐通道插值 `state0(a2+55)→state1(a2+59)`（淡入）。窗口结束（时钟≥起点+时长）或 `_this[46512]`(强制冻结，132902 置1/134801 清0) → 收尾分支(131506-131513)：`entry[11]/[12]=0; entry[13]=entry[14]; entry[14]=-1; CalcDiffuse(0.0)` 冻结在 state1；`entry[0]&=~2`、`entry[10]=0`。每帧脏锁存 `_this[46508]/[46516]` 在 present 帧始(134751-134752)清0、帧中由 `sub_4AF1C0`/场景扫掠置1。

**两 mesh 分工（由 state0/state1 + rangeStart/rangeCount 决定）**：
- mesh#1：黑覆盖层 α=0xff→0（淡出=揭示下方内容）→ 对应「背景/内容出现」（window `[0,0x1f4]`）。
- mesh#2：黑覆盖层 α=0→0xff（淡入=盖黑）→ 对应「整体淡出」（window `[0x1194,0x1f4]`）。
- ⇐ 也解释了实测：mesh#1 α=50% → 淡出后仍余 50% 黑罩→**整体变暗**；mesh#2 α=50% → 盖黑只到 50%→**淡出被截断**。

**绘制/提交序（事实，已核）**：两图（layer 2a 大理石、layer 2b 文字）**都在 mesh#1+mesh#2 单一黑覆盖层之下**，mesh 并不插在两图之间，也不是 mesh-to-mesh 存在 z 差（两 mesh 是同位的满屏黑覆盖层、叠在两层之上）。
- 逐 present 提交序（`sub_4B06D0`(132387) 对**绘图项表**(`sub_4AAD40`/`_this+258`=+1032) 与 **mesh 表**(`sub_40DC30`/`_this+266`=+1064) 做**三路归并**，按项 `+12` 处 sort-key 取小）：因 LOGO 对象 ID 序 `0x30d40 < 0x30d41 < 0x30d42 < 0x30d43`，归并序 = **大理石(2a) → 文字(2b) → mesh#1 → mesh#2** ⇒ 两 mesh 均落在两图**之后** = 满屏黑覆盖层叠在最上。
- 绘图项：`draw-texture` → `sub_422E70`(30846) → `sub_4ACE50`(129796)：插入 `sub_4AAD40(_this+258)`，`*v11|=1`，`payload+4=a3(op2)=LAYER`、`+2..5`=rect、`+9/+10/+11`=scale/uv（129804-129816）⇒ **layer=op2**；两图各占一个 draw-item 项。
- mesh：`u0043AA20` → `sub_432150`(40262) → `sub_4ADFE0`(130665) → 插入 mesh 表 `sub_40DC30(_this+266)`（130708 `v19=sub_40DC30`），存 `entry[5]`=vcount、`[6]`=a13、`[13]`=state0、`[14]`=state1，并拷逐顶点色进 `entry[2]/[3]/[4]`（130732-130761）。图像由 `sub_4AEEA0`/`SUB_4B0360` 绘；mesh 由 `sub_4AF1C0` 绘（调用点 133562/133736/133956/134069/134260/134525/134628/134875）。
- **背景先、文字后** = **两组正交颜色动画**（非 z 序、非"覆盖层+LAYER 次序"）：背景(2a) 由 mesh#1 **vertex-color** 动画揭示（窗`[0,0x1f4]`）；文字(2b) 由 draw-item **diffuse-alpha** 动画揭示（L34+L36 作用于 0x30d41，窗≈`[start+0x12c, start+0x12c+0x12c]`，透明→不透明）。两者像素级相乘 ⇒ 跟随各自窗口，非 LAYER 次序列、非 mesh 间 z。**注：此前"LAYER 2a<2b / 均匀覆盖层依次暴露"的解释不成立，已推翻。**

**0x400 等待（"等几秒"，高置信度结论，时长来源仍待定）**：`sub_407E20`(12679, 图形池 base `_this+322832`) 恒返回 `_this[11629]`（=引擎 byte 369348，因其中间计时 `_this[11631]`=369356 全文件只被清零、从不设正）。`_this[369348]` 由**图形池绘制项 setter**（129957/130051/130091…等，`set-draw-color-alpha`/mesh 绘制项）置 1。⇒ 0x400 卫门在 `_this[369348]` 非零时驻留；`sub_4B4040`(present 帧始, 134751-134752) 清 `46508/46516`（引擎另一组旗标）。⚠️ **注意字节歧义**：`_this[11629]` 在 base=池(+322832) 是 byte 369348，在 base=引擎(0) 是 byte 46516 —— mesh 绘制 `sub_4AF1C0` 置的是**46516**（131503），与 `sub_407E20` 返回的 **369348** 是**两个不同字节**。⇒ 「等几秒」的确是 0x400 卫门 + 图形池挂起旗标，但**精确时长（~5s 静态显示）的驱动者**（mesh 动画只覆盖短促淡入/淡出，非 5s）仍是未收敛项（候选：`_this[369348]` 何时被清/另一 pending 源）。

**淡出（= mesh#2 盖黑，引擎真渐变）→ 硬切到 movie**：`CalcDiffuse` 只有 `state0→state1` 一条动画，无反向淡回。mesh#2 从透明黑(0x00000000)→不透明黑(0xff000000) 即「整页被黑罩逐渐盖住」→ 这是用户看到的「整体淡出」（帧 33-35 逐帧 97→23→0，**引擎真渐变**，非视频开场、非硬切）。当 mesh#2 盖到纯黑(state1) 后脚本才执行：`release-texture`(0x1FA, sub_422E00, 30822) **硬 COM-Release** 两张图 + `play-movie`(0x20F, sub_4237B0, 31165) 建播放器开播——**从「纯黑页」到「影片第一帧」是瞬时替换（硬切，无交叉淡化）**；因影片开场常为黑/暗，观感近乎无缝。⚠️（此前「无引擎淡出/淡黑来自视频开场」的说法不准确，已修正为：淡出=mesh#2 盖黑渐变；硬切只发生在纯黑后→影片。）

**已收敛结论**：「为什么逐帧渐变」= mesh 全屏覆盖层的 **CalcDiffuse 颜色调制**（`this[46500]` 外部推进的动画时钟 → a3 0→1 → state0→state1），**不是指令耗时、不是 fade opcode、不是 present 清黑、不是异步纹理装载**。「为什么先后(背景→文字)」= **两组正交颜色动画**：背景(2a)=mesh#1 **vertex-color** 动画（黑覆盖层淡出揭示，窗`[0,0x1f4]`）；文字(2b)=draw-item **diffuse-alpha** 动画（L34+L36 作用于 0x30d41，窗`[start+0x12c,start+0x12c+0x12c]`≈[300,600]ms，透明→不透明）。两者**像素级相乘** ⇒ 背景跟 mesh#1、文字独立 fade、慢速时被主导；「先揭示 / 后盖黑」由 mesh#1 window`[0,0x1f4]`（淡出揭示）、mesh#2 window`[0x1194,0x1f4]`（后盖黑）决定；「整体淡出」= mesh#2 盖黑 + 硬切；「为什么等几秒」= 0x400 卫门 + 图形池挂起旗标。
   ⚠️ **尚未收敛**：① ~~`this[46500]` 的**外部推进速率**~~ **已收敛**（见上：= 主循环每帧写入 `timeGetTime()` 毫秒值到引擎 `[369332]`，实时墙钟、非帧计数器；旧值存 `[369336]`，逐帧 delta = 前后毫秒差）；② ~~文字层相对两 mesh 的确切 z 序~~ **已收敛（已推翻原"z 序/覆盖层次序"归因）**："先后"实为**文字图(2b) 有独立的 draw-item diffuse-alpha 动画**（L34 L36 作用于 0x30d41，窗 ≈[300,600]ms，透明→不透明，**逐像素 alpha 淡入**），与背景(2a) 的 mesh#1 vertex-color 动画**正交相乘**，非 z 序、非 mesh 间 z、非"均匀覆盖层+LAYER 次序"；③ 0x400 等待 **~5s 静态显示**的精确时长驱动者（已由「计时器递增策略」部分推导：mesh#2 delay=0x1194=4500ms、dur=0x1f4=500ms ⇒ 脚本停在那的墙钟窗口≈[4500,5000]ms，5s 主时长即墙钟 5000ms；`_this[369348]` 何时被清）。

**计时器递增策略（已定，相对独立逻辑）**：动画时钟不是手动帧计数器，而是 **`timeGetTime()`（Windows 毫秒表）**。
- 字段：引擎 `(_this+369332)`（DWORD 下标 `[92333]`；= 池基 322832+46500=369332，mesh-draw 以池基读成 `[46500]`、sub_407E20 以池基读成 `[11625]`）；旧值存 `(_this+369336)`=`[92334]`。
- 每帧写入：主循环(20422 起) 20445 `v3=timeGetTime` → 20465 `v94=v5=timeGetTime()` → 帧同步分支 20571-20576（`if(![429752] || effect_flags&0x400)` 外层 20468，内层 `else if([667860] || effect_flags&0x2400)` 20571）`[369336]=[369332]; [369332]=v94`；同分支 20583 满足条件时 present。
- ⇒ 动画按**墙钟毫秒**走：与帧率无关，clock 每秒约 +1000。脚本级显式时间戳 op：`sub_41A090`(0x1F4)、`sub_41A1A0`(0x20C, 时间戳+present)、`sub_41A2C0`(0x23C)，均 `[92334]=[92333]; [92333]=timeGetTime()`。
- ⇒ **窗口单位 = 毫秒**：mesh#1 delay=0/dur=0x1f4=500 ⇒ 淡入 0~500ms；mesh#2 delay=0x1194=4500/dur=500 ⇒ 淡出 4500~5000ms；静止显示窗 = 500~4500ms(4s)。版权页总时长 ≈ 5000ms（墙钟 5s），与实测「~5s」一致。

**「背景先、文字后」（已定，逐像素 alpha 淡入）**：文字(2b) 与背景(2a) 由**两组正交颜色动画叠加**，像素级相乘。
- **背景(2a)** = mesh#1(0x30d42) 的 **vertex-color** 动画（`set-vertex-color-alpha` 0x323 → 透明黑→不透明黑覆盖层淡出，窗口 `[0,0x1f4]=[0,500]ms`）。
- **文字(2b)** = draw-item 的 **diffuse-alpha** 动画：L34 `set-draw-color-alpha(0x203)` + L36 `set-draw-color(0x202)` 都作用于 **0x30d41（文字图，`add 30d40 1` 是绝对赋值=0x30d41，非 mesh#1）**。
  - 字段（`sub_4ACF60`(129850) / `sub_4AD0C0`(129936)）：flags`|=2`（启用位）、+48=混合模式(0默认)、**+52=START**（`sub_49A300`(115116) 首帧锁存 `this[46500]` 于 item+52）、**+56=DELAY=0x12c=300**、**+76=COUNT=0x12c=300**、**+96=FROM=0x00FFFFFF（透明白，alpha=0）**、**+100=TO=0xFFFFFFFF（不透明白，alpha=255）**。
  - 逐帧（`sub_49A300`(115116)，clock=this[46500]）：`if(flags&2){ if(!item+52) item+52=clock; if(clock>=start+delay+count) item+96=item+100; else if(clock>delay+start) 按 (clock-start-delay)/count 插值; }` 回写 item+96。
  - 工作色=item+96 作为 a7(diffuse) 传纹理绘制：`sub_4AEEA0`(131306)→`sub_4A2D50`(121065, a7 传 vtable+20)。**from→to 只变 alpha 字节（0x00→0xFF），RGB 恒白 → 逐像素 alpha 调制**（diffuse.alpha×纹理.alpha），SO005 整幅含阴影/多色/半透明一起淡入（非平面 RGB 染色）。
  - 文字窗 = `[start+300, start+600]`ms：先透明 300ms、再 300ms 渐显（观感≈500ms）；改 L36 `12c 12c` 为 `0 1`→瞬时、`0 4500`→慢速（实测锁定）。
- ⇒ 背景跟 mesh#1、文字独立 fade，两槽正交相乘 → 解释"背景先、文字后"、文字不随 mesh#1、image-swap 跟随槽位等全部实测。

## 4. 渲染后端现状（app/amayui-emulator）

- ✅ `PixiBackend`（PixiJS v8 WebGL）已改为 **引擎式"配置对象 + 每帧 present 合成"**：`drawItems`/`meshes` 两张以句柄为键的持久场景图；`present()` 按 layer/handle 升序合成（图在下、mesh 黑覆盖层在上），动画（mesh `#calcDiffuse`、draw-item `#itemAlpha`）逐帧求值（墙钟）；`sceneDirty`/`needsRender` 驱动引擎式 present（`0x400` 动画等待每帧 present）。**版权页 frame 效果已实现**（背景先、文字后、~5s、整体淡出），LOGO→TITLE 不再闪现。
- ✅ 视口 1280×720；窗口 `useContentSize:true` + `win.setContentSize(1280,720)`；`autoDensity + devicePixelRatio`（canvas CSS 1280×720、底层按 DPR 高清）。
- ✅ 严格 flag：draw-item/mesh 只认 bit0|bit1，未知位（如 draw-item `&4`）抛 `UnknownFlagError` 中断；未实现 opcode 抛 `NotImplementedOp`。
- ✅ 诊断日志：`log-line`/`log-line-sync` IPC → `app/amayui-emulator/.tmp/..`(实际 `E:\Games\Eushully\天結\.tmp\amayui-emulator.log`)；renderer 逐行/批次落盘 + 关窗同步兜底。
- ✅ 无界面光栅验证：真实 VM 到 TITLE 产出与真实标题菜单布局吻合（logo+散布按钮+版权+背景）。
- 机制权威记录见 `./copyright-effect.md`；实现模型/改动文件/验证见 `../04-app/emulator-copyright-effect.md`。

## 5. 交叉引用

- 纹理 slot↔AGF 映射见 `./resource-loading.md`；渲染壳工程见 `../04-app/emulator.md`。
