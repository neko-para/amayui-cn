---
kind: narrative
state: live
---
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
- ✅ **fade opcode 家族确为视效渐变**：0x20–0x2D 各自映射到 `sub_41D0E0/41D180/41D290/41D390/41D490/41D590/41D6A0/41D780/41D860/41D940/41DA20…`，全部调 `sub_441410`(line 27282 起，mode 0–9 依次 = SetFade / SetLineFade×8 / SetRandomFade；`sub_441410` 的 8 处调用点 = 27282/27311/27348/27383/27422/27559/27837/28192)，启动的计时器是**命令级** `_this + 107461`（`sub_453A60` at 27273/27308/27345/27380/27418/28189）。这些 opcode 在 LOGO/bootstrap 均不存在。
- ✅ **LOGO 场景的「渐变」不由引擎引入（判定：来自 LOGO.MPG 视频内容本身）**：
  - `LOGO.txt` 全程无 fade 指令，boot→LOGO→INIT→TITLE 执行路径也没有 0x20–0x38；`INIT.txt` 仅 mov/copy-local-array/set-string。
  - `play-movie`(0x20F, `sub_4237B0`) 只做：构造 movie 对象 → `sub_454FA0` 取路径 → `sub_488DC0`(Media Foundation) 装载 → `sub_489230` 绑资源 → `sub_4054D0`/`sub_405460` 按 flag 定播放模式 → `sub_4885A0` 设音量 → `sub_4883A0` 开播 → 置 `_this[699204]\|=0x2000`、`_this[675972]=1`。**无任何 `sub_453A60`/`sub_441410` 调用**。
  - 主循环里 `_this[699204]&0x2000` 分支（line 20796-20813 / 20899-20917）只 delete movie 对象并清 0x2000 标志，**不产生画面淡入淡出**。
  - ⚠️ **勿混淆**：主循环里紧邻的 `sub_453A60(_this+430012, 10)`（line 20826）是 **BGM/音乐淡入** 计时器（配 `sub_489D10`(20827)/`sub_489E50`(20835) 对 `_this+697816`=Music 对象做音量渐变；`+697816/4 = 174454`，与 BGM 指令 `sub_420E00` 里 `sub_489D10(_this+174454,…)` 是同一对象）；`10` 是**周期(ms)**，不是 fade mode。
  - ⇒ **实测修正**（用户确认）：`install\DATA5\LOGO.MPG` **前后无渐变**；而 **版权页(SO006/SO005, 步骤1) 出现/消失** 与 **主菜单(SO004, 步骤3) 出现** 都有**黑色渐变**。⇒ 渐变**不来自视频**，也**不来自 fade opcode**（boot→LOGO→INIT→TITLE→消息循环路径从未执行 0x20–0x38；emulator 逐条执行该路径从未碰到它们）。⇒ 属**引擎内建**的「场景切换/加载」渐变机制（在渲染/画面层面，独立于 fade opcode 之外）。⚠️ 「等待」已收敛为 0x400 卫门（见下）；**渐变**的精确画面原语仍在深挖（见下 `0x20B`/`0x323`/0x1000 过渡门）。
- ✅ **LOGO 的 `set-vertex-color(-alpha)` 写的是"顶点色 + 动画窗"**：`sub_426CF0`(0x323, line 33888)→`sub_4AE330` 一次性向网格顶点着色表写 A(operand4)/RGB(operand5)（置 `_this[11627]=1` 重建脏标记），**同时**把 delay/dur 交给该 mesh 的颜色窗 —— 窗的求值在**每帧渲染**里（`sub_4AF1C0` raw 133458，133505-133541 → `sub_4A2050` CalcDiffuse），所以它是**渐变动画**而不是静态遮罩（层序与"背景先、文字后"见 §4.5 与 `copyright-effect.md`；此前这里写"无计时器/无逐帧插值"与同文 §4.5 矛盾）。例 `set-vertex-color-alpha mesh 0 1f4 0 0`=顶点 0..0x1f4 全透明、`… 1194 1f4 ff 0`=顶点 0x1194..+0x1f4 全不透明 → 版权/元素遮罩。
- ✅ **SYSTEM4/LOGO 缺口 opcode 已补齐（等待与渐变的执行者）**：此前"仅映射"的 25 个已确认，关键几个：
  - **等待（版权页）** = `0x21C`(`wait`/`sub_41A260`) 置 `_this[174801]|=0x400` → 主循环 **0x400 卫门**（line 21109-21153）每帧驻留（`sub_407E20(_this+322832)` 图形池挂起/计时检查或 `v95` 影片标志为真则 `goto LABEL_186` 不落派发），脚本 ip 停在 LOGO:47；`sub_407E20` 返 0 且 `!v95` 时清 0x400 才派发。**实机 ip=47/effect_flags=0x400 与之一致。** 时长由 `sub_407E20` 的 byte 369356(时长)/369352(始)/369344(强制结束) 决定。**注意：不是 `0x1F4`/`0x1F5`（LOGO.txt 未用，帧计时原语在 SYSTEM4）。**
  - **渐变（版权页/菜单过渡，未完全定论）** = **引擎内建「场景切换/加载」暗场渐变**，独立于 fade opcode 族、也独立于 present 的清黑（present 的 ClearTarget 被 `_this+46460&1` 守卫、该字段恒 0 → present 从不无条件清黑；present 仅在 `sub_40BE10(...)==1` 图形池脏时执行）。最可能走主循环 0x1000 过渡门（`sub_421AA0` 置 0x1000 + 启动 `_this+430096` 场景 FadeTimer）+ 场景内容分帧提交；`0x20B`(`sub_4A4C70`)=纯色+α 填充、`0x323`(`sub_4AE330`)=静态网格遮罩（均无逐帧计时）。
  - **等待原语族**（非 LOGO）：`0x1F4`/`0x1F5`(帧计时/倒计续跑)、`0x20C`(present 一帧)、`0x1CE`(消息点击-跳读状态机，同时触 `_this[174801]` 与 byte 430600 计时器)。
  - ⇒ **收敛**：「等待」= 0x400 卫门（`0x21C` 置位、`sub_407E20` 图形池挂起计数驱动，独立于此前候选的 0x1F4/0x1F5）；「渐变」= **mesh 顶点色插值动画（CalcDiffuse）**，非 fade opcode、非 present 清黑、非视频。版权页本身的 `draw-texture` 的 p/q(0x1FB op7/op8) 为 0（非 α，是 scale）；真正的 α 来自 `set-draw-color-alpha`(0x203)/`set-vertex-color-alpha`(0x323) 写入的 mesh 状态色 + **α 混合渲染**。`_this+812x`/bit0x8/FadeTimer/gamma/D3D 在版权页暂停时实测全 0。

### 3.1 版权页「frame 效果」机制（LOGO.txt，已收敛：mesh 全屏覆盖层 + CalcDiffuse 颜色调制）

**组成**（LOGO.txt）：2 张整屏图（大理石 layer 2a、文字 layer 2b）+ **2 个顶点色全屏四边形**（mesh#1=0x30d42、mesh#2=0x30d43）。

**mesh 建立**（`create-mesh`/0x320, `sub_432150`→`sub_4ADFE0`→`sub_4A2280`，41011/132685/122331；`sub_4ADFE0` 内调用 `sub_4A2280` 于 132755）：
- op1=mesh 句柄、op2/3/4=逐顶点 X/Y/Z **数组基址**（全局 float 槽号；第 i 顶点取 `slot+i`）、op5=逐顶点 **alpha 色数组基址**（全局 int 槽号）、op6=逐顶点 **rgb 色数组基址**、op7/8=**u/v 数组基址**、**op9=顶点数**（语料全为 4）、op10=→entry[6]。
  ★2026-09 更正：旧注把 op5 当成"常量 1.0 的 w 数组"、把 op2..op8 当成标量 —— 实际**都是数组基址**（引擎用取址读法 `sub_42BF60`/`sub_42AEA0`，返回 `base+4*payload`），`w` 数组是引擎内部 `new[]` 后填 1.0 的临时数组，不来自脚本。
- 顶点 36 字节/个：`x,y,z,w(1.0),DWORD diffuse@+16,u,v,attr,attr`。
- 语料里的坐标 = **轴对齐满屏四边形**：`x=(0,1280,0,1280)`、`y=(0,0,720,720)`（`float-mov` 的字面量是**十六进制**：`500`=1280、`2d0`=720）；`z` 数组另有槽位（全 0）。UV 数组来自 INIT2（`u=(0,1,0,1)`、`v=(0,0,1,1)`）。
  逐顶点色数组来自 INIT2 的 `copy-local-array (global-int f8c48) [ff ff ff ff]`（alpha）与 `(global-int f8c4c) [ffffff …]`（rgb）⇒ 逐顶点基础色 = `0xFFFFFFFF`（不透明白），**幕布颜色完全由 state0/state1 决定**。
  （同 handle 在 mode 6 分支下走 `draw-texture` 贴图形态 —— 例如 `SN0000.txt:3095` 的 `draw-texture 19640 11 0 0 43e 95 5d 22c` 是底部 1086×149 的贴片；**mesh 分支没有局部形态**。）
- mesh 条目（`sub_40DC30(_this+266,&a2)`）：`[0]`=bit0 几何已建/bit1 颜色动画 [1]=VB [2]=X源 [3]=Y源 [4]=逐顶点颜色数组 [5]=顶点数 [6]=尾参 [7]/[8]=两级纹理槽（`0x321` 写） [9]=**alpha 混合模式选择子**（`0x322` 的 op2，消费者 `sub_49E390` raw 119370-119399） [10]=窗起点 [11]=delay [12]=dur [13]=**state0** [14]=**state1**。

**两个颜色状态**：
- `set-vertex-color`(0x322, `sub_426C20`→`sub_4AE2C0`)→ `[9]=op2`、`[13]=`**state0** = `(clamp(op3)<<24)|(op4&0xFFFFFF)`，并 `CalcDiffuse(entry,0.0)` 立即烘焙。★**α>255 夹到 255；op3/op4 为负 = 取当前 state0 的对应通道**（raw 33865-33884）。
- `set-vertex-color-alpha`(0x323, `sub_426CF0`→`sub_4AE330`)→ `[10]=0`、**[11]=delay**、**[12]=dur**、`[14]=`**state1** = `(clamp(op4)<<24)|(op5&0xFFFFFF)`（同样有负值回退），置 `|2` 待动画旗标。
- LOGO 里：mesh#1 state0=0xff000000(不透明黑)、state1=0x00000000(透明黑)；mesh#2 state0=0x00000000(透明黑)、state1=0xff000000(不透明黑)。

**CalcDiffuse（sub_4A2050, 122248；`CalcDiffuse エラー` 字串 122281）= 颜色调制**：逐字节通道线性插值 `blend = state1*byte*a3 + state0*byte*(1-a3)`（122289-122293）；然后对每顶点基础色（entry[4]/a2+16）**逐通道乘 blend/0xFF** 写入 VB+16（122316-122317），blend=不透明白(0xFFFFFFFF)则原样直拷（122294-122306，性能等值快路径）。⇒ **mesh 渲染色 = 逐顶点基础色 × 插值态色**。

**绘制时动画因子**（mesh 绘制 `sub_4AF1C0` RenderPolygon, 133458；133505-133541）：
```
if (entry[0]&2 && entry[12]>0 && _this[46500] < entry[10]+entry[11]+entry[12] && !_this[46512])
   if (_this[46500] > entry[11]+entry[10])
      a3 = (_this[46500]-entry[11]-entry[10])/entry[12];  CalcDiffuse(entry, a3);
   _this[46516] = 1;               // 挂起工作旗标（让 0x400 卫门保持）
else  // 完成/收尾
   entry[11]=0; entry[12]=0; entry[13]=entry[14]; entry[14]=-1; CalcDiffuse(entry,0.0);
```
`_this[46500]` = **引擎只读的全局「场景扫掠/动画时钟」位置**（byte 0xB5A4，DWORD 下标别名 `[11625]`）。**`engine/天结_unpacked.exe_utf8.c` 会写它**（此前「从不写/引擎外递增」结论有误，已修正）：真正字段 = **引擎 `*(_DWORD*)(_this+369332)`**（= 池基 322832 + 46500；DWORD 引擎下标 `[92333]`、池下标 `[11625]`），**来源 = `timeGetTime()`（Windows 毫秒表）**，**不是手动帧计数器**。主循环每帧：`v3=timeGetTime`(20620) → `v94=v5=timeGetTime()`(20640-20642) → 帧同步分支(20746-20751，`effect_flags&0x2400` 含 0x400 等待时也执行) `[369336]=[369332]`(20750 存旧值) → `[369332]=v94`(20751 写新值)，同分支在后置条件满足时 present `sub_4B4040`(20758)。⇒ **实时毫秒**、动画速率**与 fps 无关**（按墙钟走）。脚本级显式时间戳 op：`sub_41A090`(0x1F4/25193，置 107438 于 25206 后取 timeGetTime 于 25207)、`sub_41A1A0`(0x20C/25258，取 timeGetTime 于 25267、present 于 25271)、`sub_41A2C0`(0x23C/25307，恒取 timeGetTime)；均 `[92334]=[92333]; [92333]=timeGetTime()`。**逐帧驱动链**：`sub_4B4040`(present, 136741) → `sub_4B06D0`(每 present 一次, 134417；调用点 136796) → `sub_4AF1C0`(每 mesh/对象, 135596/135770/135993/136106/136299/136564/136667/136916) → `sub_4A2050`(CalcDiffuse)。`sub_4AF1C0`(133458-134274) 是**独立函数**（非 sub_4B06D0），每 present per-object 调用。
<br>**v39 0→1 与刷新**：`v4=entry[10]`（窗起点，entry[10]==0 时锁存为当前时钟 133511-133512）；随时钟从 `entry[11]+v4` 推进到 `entry[11]+v4+entry[12]`，`v39=(钟-entry[11]-v4)/entry[12]` 0→1 → `sub_4A2050` 逐通道插值 `state0(a2+55)→state1(a2+59)`（淡入）。窗口结束（时钟≥起点+时长）或 `_this[46512]`(强制冻结，134936 与 12796 置1/136842 清0) → 收尾分支(133531-133538)：`entry[11]/[12]=0; entry[13]=entry[14]; entry[14]=-1; CalcDiffuse(0.0)` 冻结在 state1；`entry[0]&=~2`、`entry[10]=0`。每帧脏锁存 `_this[46508]/[46516]` 在 present 帧始(136792-136793)清0、帧中由 `sub_4AF1C0`/场景扫掠置1。

**两 mesh 分工（由 state0/state1 + rangeStart/rangeCount 决定）**：
- mesh#1：黑覆盖层 α=0xff→0（淡出=揭示下方内容）→ 对应「背景/内容出现」（window `[0,0x1f4]`）。
- mesh#2：黑覆盖层 α=0→0xff（淡入=盖黑）→ 对应「整体淡出」（window `[0x1194,0x1f4]`）。
- ⇐ 也解释了实测：mesh#1 α=50% → 淡出后仍余 50% 黑罩→**整体变暗**；mesh#2 α=50% → 盖黑只到 50%→**淡出被截断**。

**绘制/提交序（事实，已核）**：两图（layer 2a 大理石、layer 2b 文字）**都在 mesh#1+mesh#2 单一黑覆盖层之下**，mesh 并不插在两图之间，也不是 mesh-to-mesh 存在 z 差（两 mesh 是同位的满屏黑覆盖层、叠在两层之上）。
- 逐 present 提交序（`sub_4B06D0`(134417) 对**绘图项表**(`sub_4AAD40`/`_this+258`=+1032) 与 **mesh 表**(`sub_40DC30`/`_this+266`=+1064) 做**四路归并**（另两路 = **Live2D/变换 572B 节点**，见 §3.1 与 `live2d.md`；口径与本文件 §7 的"四路归并"一致），按**表节点字节 `+12` 处的 key**（= handle = 层序）取小）：因 LOGO 对象 ID 序 `0x30d40 < 0x30d41 < 0x30d42 < 0x30d43`，归并序 = **大理石(2a) → 文字(2b) → mesh#1 → mesh#2** ⇒ 两 mesh 均落在两图**之后** = 满屏黑覆盖层叠在最上。
- 绘图项：`draw-texture` → `sub_422E70`(31270；`SetRect` 31293、调 `sub_4ACE50` 31299) → `sub_4ACE50`(131816)：插入 `sub_4AAD40(_this+258)`，`*v11|=1`，记录 `+4 = a3(op2) = 纹理槽`、`[2..5]`=源矩形、`[9]/[10]/[11]`=描画位置 x/y/z（raw 131824-131838）⇒ **层序不写进记录、就是 map key（= op1）**（`0x215` 也正是读记录 `+4` 当"纹理槽"，见 `sub_4ADC20` raw 132507-132516）；两图各占一个 draw-item 项。
  ★`i214`（`0x214` → `sub_4ABEF0` raw 131135-131139）把两条记录**整块 `qmemcpy` 互换**（740 字节 ×2）、**键不动** ⇒ 换的是"长什么样、画在哪、怎么动"，**绘制次序不变** —— 这正是"层序不在记录里"的反证（若记录里存 sort 字段，交换就会连次序一起换）。
- mesh：`create-mesh` → `sub_432150`(41011) → `sub_4ADFE0`(132685) → 插入 mesh 表 `sub_40DC30(_this+266)`（132753 `v19=sub_40DC30`），存 `entry[5]`=vcount、`[6]`=a13、`[13]`=state0、`[14]`=state1，并拷逐顶点色进 `entry[2]/[3]/[4]`（132759-132782）。图像由 `sub_4AEEA0`/`SUB_4B0360` 绘；mesh 由 `sub_4AF1C0` 绘（调用点 135596/135770/135993/136106/136299/136564/136667/136916）。
- **背景先、文字后** = **两组正交颜色动画**（非 z 序、非"覆盖层+LAYER 次序"）：背景(2a) 由 mesh#1 **vertex-color** 动画揭示（窗`[0,0x1f4]`）；文字(2b) 由 draw-item **diffuse-alpha** 动画揭示（L34+L36 作用于 0x30d41，窗≈`[start+0x12c, start+0x12c+0x12c]`，透明→不透明）。两者像素级相乘 ⇒ 跟随各自窗口，非 LAYER 次序列、非 mesh 间 z。**注：此前"LAYER 2a<2b / 均匀覆盖层依次暴露"的解释不成立，已推翻。**

**0x400 等待（"等几秒"，高置信度结论，时长来源仍待定）**：`sub_407E20`(12762, 图形池 base `_this+322832`；计时器读 `_this[11631]` 于 12768、返回 `_this[11629]` 于 12783) 恒返回 `_this[11629]`（=引擎 byte 369348）**叠加一个等待计时器**（起点 `_this[11630]`=369352、时长 `_this[11631]`=369356；装载者 = `0x238` 的 handler `sub_4248C0` raw 32303-32312 `Engine[92338]=0; Engine[92339]=op1`，即 `Engine[92339]` = byte 369356 ⇒ **有置正点**，此前"全文件只被清零、从不设正"是错的）。`_this[369348]` 由**图形池绘制项 setter**（131881/131977/132823/132844…等，`set-draw-color-alpha`/mesh 绘制项）置 1。⇒ 0x400 卫门在 `_this[369348]` 非零时驻留；`sub_4B4040`(present 帧始, 136792-136793) 清 `46508/46516`（引擎另一组旗标）。⚠️ **注意字节歧义**：`_this[11629]` 在 base=池(+322832) 是 byte 369348，在 base=引擎(0) 是 byte 46516 —— mesh 绘制 `sub_4AF1C0` 置的是**46516**（133528），与 `sub_407E20` 返回的 **369348** **已核（`tickets/T-0174`）：两处就是同一个 dword** —— 这些偏移都以**同一个对象**（图形池／场景管理器 = `Engine + 322832`）为基：`sub_407E20` 的 `_this[11629]` = 池 + 46516 = 引擎 + 369348（它的调用点 raw 21111 写作 `sub_407E20((_DWORD *)(_this + 322832))`，**显式传池基**），而 mesh-draw `sub_4AF1C0` 在 133528 写的 `_this + 46516` 用的是**同一个** `_this`（同一函数内与 `sub_4AEEA0(_this, …)` 同基，raw 135581/135596）。★**别把 `[11627]`（= 池 + 46508）混进来**：它由 `sub_407E20` 自己（raw 12773 `_this[11627] = 1`）与 131881/131977/132823/132844 那些绘制项 setter 置 1，而 `sub_407E20` **返回的是 `[11629]`**（raw 12783）。⇒ 0x400 门 = 「等待计时器在跑（`[11631]` 非零；超时判据 `[11625] > [11630] + [11631]`，raw 12768-12779）」**或**「`[11629]` 非零」；两个旗标每帧被 present 的 `46508/46516 = 0`（136792-136793）清掉，再由**本帧**的 mesh 动画重新置起 ⇒ **「等几秒」的精确驱动者到此收敛**：mesh#2 的动画窗（delay `0x1194` = 4500ms ＋ dur `0x1f4` = 500ms）在它活跃的每一帧都把 `[11629]` 置起，门因此持续到该窗走完（不再是"未收敛项"）。

**淡出（= mesh#2 盖黑，引擎真渐变）→ 硬切到 movie**：`CalcDiffuse` 只有 `state0→state1` 一条动画，无反向淡回。mesh#2 从透明黑(0x00000000)→不透明黑(0xff000000) 即「整页被黑罩逐渐盖住」→ 这是用户看到的「整体淡出」（帧 33-35 逐帧 97→23→0，**引擎真渐变**，非视频开场、非硬切）。当 mesh#2 盖到纯黑(state1) 后脚本才执行：`release-texture`(0x1FA, sub_422E00, 31245) **硬 COM-Release** 两张图 + `play-movie`(0x20F, sub_4237B0, 31604) 建播放器开播——**从「纯黑页」到「影片第一帧」是瞬时替换（硬切，无交叉淡化）**；因影片开场常为黑/暗，观感近乎无缝。⚠️（此前「无引擎淡出/淡黑来自视频开场」的说法不准确，已修正为：淡出=mesh#2 盖黑渐变；硬切只发生在纯黑后→影片。）

**已收敛结论**：「为什么逐帧渐变」= mesh 全屏覆盖层的 **CalcDiffuse 颜色调制**（`this[46500]` 外部推进的动画时钟 → a3 0→1 → state0→state1），**不是指令耗时、不是 fade opcode、不是 present 清黑、不是异步纹理装载**。「为什么先后(背景→文字)」= **两组正交颜色动画**：背景(2a)=mesh#1 **vertex-color** 动画（黑覆盖层淡出揭示，窗`[0,0x1f4]`）；文字(2b)=draw-item **diffuse-alpha** 动画（L34+L36 作用于 0x30d41，窗`[start+0x12c,start+0x12c+0x12c]`≈[300,600]ms，透明→不透明）。两者**像素级相乘** ⇒ 背景跟 mesh#1、文字独立 fade、慢速时被主导；「先揭示 / 后盖黑」由 mesh#1 window`[0,0x1f4]`（淡出揭示）、mesh#2 window`[0x1194,0x1f4]`（后盖黑）决定；「整体淡出」= mesh#2 盖黑 + 硬切；「为什么等几秒」= 0x400 卫门 + 图形池挂起旗标。
   ⚠️ **尚未收敛**：① ~~`this[46500]` 的**外部推进速率**~~ **已收敛**（见上：= 主循环每帧写入 `timeGetTime()` 毫秒值到引擎 `[369332]`，实时墙钟、非帧计数器；旧值存 `[369336]`，逐帧 delta = 前后毫秒差）；② ~~文字层相对两 mesh 的确切 z 序~~ **已收敛（已推翻原"z 序/覆盖层次序"归因）**："先后"实为**文字图(2b) 有独立的 draw-item diffuse-alpha 动画**（L34 L36 作用于 0x30d41，窗 ≈[300,600]ms，透明→不透明，**逐像素 alpha 淡入**），与背景(2a) 的 mesh#1 vertex-color 动画**正交相乘**，非 z 序、非 mesh 间 z、非"均匀覆盖层+LAYER 次序"；③ 0x400 等待 **~5s 静态显示**的精确时长驱动者（已由「计时器递增策略」部分推导：mesh#2 delay=0x1194=4500ms、dur=0x1f4=500ms ⇒ 脚本停在那的墙钟窗口≈[4500,5000]ms，5s 主时长即墙钟 5000ms；`_this[369348]` 何时被清）。

**计时器递增策略（已定，相对独立逻辑）**：动画时钟不是手动帧计数器，而是 **`timeGetTime()`（Windows 毫秒表）**。
- 字段：引擎 `(_this+369332)`（DWORD 下标 `[92333]`；= 池基 322832+46500=369332，mesh-draw 以池基读成 `[46500]`、sub_407E20 以池基读成 `[11625]`）；旧值存 `(_this+369336)`=`[92334]`。
- 每帧写入：主循环(20464 起，`while(1)` 级联于 20615) 20620 `v3=timeGetTime` → 20640 `v94=v5=timeGetTime()` → 帧同步分支 20746-20751（`if(![429752] || effect_flags&0x400)` 外层 20643，内层 `else if([667860] || effect_flags&0x2400)` 20746）`[369336]=[369332]; [369332]=v94`；同分支 20758 满足条件时 present。
- ⇒ 动画按**墙钟毫秒**走：与帧率无关，clock 每秒约 +1000。脚本级显式时间戳 op：`sub_41A090`(0x1F4)、`sub_41A1A0`(0x20C, 时间戳+present)、`sub_41A2C0`(0x23C)，均 `[92334]=[92333]; [92333]=timeGetTime()`。
- ⇒ **窗口单位 = 毫秒**：mesh#1 delay=0/dur=0x1f4=500 ⇒ 淡入 0~500ms；mesh#2 delay=0x1194=4500/dur=500 ⇒ 淡出 4500~5000ms；静止显示窗 = 500~4500ms(4s)。版权页总时长 ≈ 5000ms（墙钟 5s），与实测「~5s」一致。

**「背景先、文字后」（已定，逐像素 alpha 淡入）**：文字(2b) 与背景(2a) 由**两组正交颜色动画叠加**，像素级相乘。
- **背景(2a)** = mesh#1(0x30d42) 的 **vertex-color** 动画（`set-vertex-color-alpha` 0x323 → 透明黑→不透明黑覆盖层淡出，窗口 `[0,0x1f4]=[0,500]ms`）。
- **文字(2b)** = draw-item 的 **diffuse-alpha** 动画：L34 `set-draw-color-alpha(0x203)` + L36 `set-draw-color(0x202)` 都作用于 **0x30d41（文字图，`add 30d40 1` 是绝对赋值=0x30d41，非 mesh#1）**。
  - 字段（`sub_4ACF60`(131870) / `sub_4AD0C0`(131956)）：flags`|=2`（启用位，131969）、+48=混合模式(0默认)（131878）、**+52=START**（**`sub_49AA30`**(117239 起) 首帧锁存 `this[46500]` 于 item+52）、**+56=DELAY=0x12c=300**（131972）、**+76=COUNT=0x12c=300**、**+96=FROM=0x00FFFFFF（透明白，alpha=0）**（131880）、**+100=TO=0xFFFFFFFF（不透明白，alpha=255）**（131976）。
  - 逐帧（**`sub_49AA30`**(117239 起)，`&2` 门控 117430、首帧锁存 start 于 117438、窗末判定 117449、插值回写 item+96 于 117470-117479，clock=this[46500]）：`if(flags&2){ if(!item+52) item+52=clock; if(clock>=start+delay+count) item+96=item+100; else if(clock>delay+start) 按 (clock-start-delay)/count 插值; }` 回写 item+96。
  - 工作色=item+96 作为 a7(diffuse) 传纹理绘制：`sub_4AEEA0`(133326；调 `sub_4A2D50` 于 133443)→`sub_4A2D50`(122890, a7 传 vtable+20，调用点 123146/123208)。**from→to 只变 alpha 字节（0x00→0xFF），RGB 恒白 → 逐像素 alpha 调制**（diffuse.alpha×纹理.alpha），SO005 整幅含阴影/多色/半透明一起淡入（非平面 RGB 染色）。
  - 文字窗 = `[start+300, start+600]`ms：先透明 300ms、再 300ms 渐显（观感≈500ms）；改 L36 `12c 12c` 为 `0 1`→瞬时、`0 4500`→慢速（实测锁定）。
- ⇒ 背景跟 mesh#1、文字独立 fade，两槽正交相乘 → 解释"背景先、文字后"、文字不随 mesh#1、image-swap 跟随槽位等全部实测。

## 4. 渲染后端现状（app/amayui-emulator）

- ✅ `PixiBackend`（PixiJS v8 WebGL）已改为 **引擎式"配置对象 + 每帧 present 合成"**：`drawItems`/`meshes` 两张以句柄为键的持久场景图；`present()` 做**四路归并**（draw-item 按 `layer`、文本窗按 `layerOfFrame`、mesh 按 `handle`、**Live2D 572B 立绘节点按节点 key**，同键序 item→text→mesh→L2D 节点 —— 与引擎 `sub_4B06D0` 的"按 sort-key 归并"同构，见 §3.1），动画（mesh `calcDiffuse`、draw-item `itemColor`）逐帧求值（墙钟）；`sceneDirty`/`needsRender` 驱动引擎式 present（`0x400` 动画等待每帧 present）。**版权页 frame 效果已实现**（背景先、文字后、~5s、整体淡出），LOGO→TITLE 不再闪现。
  - ★`sub_4B06D0` 把两表**归并**到同一个序（sort-key = 项的 `+12`/mesh 的 handle），**不是**"图在下、mesh 覆盖层在上"（sort-key = 项的 `+12`/mesh 的 handle），所以 mesh 也会插在两图之间。SN0000 序章的实测层序 = 背景 `101000` → 淡入幕 `0x19258`(=`102488`) → 暗幕 `0x19640`(=`104000`) → 立绘 `104501+` → 文本 `105000`，正是归并序（旧实现会把两块幕布都压到文本之上 ⇒ 整屏黑）。
- ✅ **mesh 已按真实几何 + 真实颜色合成（2026-09）**：见 §3.1 的顶点/颜色表；绘制门 = `entry[0]` bit0。
  轴对齐四边形走 `Graphics.rect()`，非轴对齐走三角扇 —— ★**不要用 `poly()` 一次喂 4 个条带序顶点**：Pixi v8 按给定顺序连点，`(0,0),(1280,0),(0,720),(1280,720)` 会自交成"蝴蝶结"，填充只剩上下两片 ⇒ 画面上出现贯穿全屏的大 X（实测）。
- ✅ **Live2D 立绘已按真实三角批次合成（2026-09，`T-0054`）**：572B 立绘节点这一路现在真的出画 —— 每帧对通过门控的节点求值变形几何，**一个网格一个批次**（positions 已含画布居中平移、uvs 取 `.moc` 的 `+60` 原样、indices 是三角形列表，alpha 取该网格的 opacity），再按节点 key 与其它三路归并。几何只在 `src/live2d/render.ts` 算一次，**快照导出的是同一份**（`SceneSnapshot.l2d.nodes[].batches/triangles/tex`）⇒ "报告里有、画面上没有"这类故障变成可断言的。摆放公式与顶点流的事实见 `./live2d.md` §5.1；纹理走 `pixi/l2dTextures.ts`（普通 PNG，**不是** AGF，所以不经 `TextureCache`）。
  - ★**两个只有真机才暴露的坑（Node 测试全绿也没用）**：① `src/live2d/**` 跑在渲染进程，**不能用 Node 全局** —— `moc.ts` 曾用 `Buffer` 解字符串，真机报 `Buffer is not defined` ⇒ 槽空 ⇒ 立绘不出画（源码棘轮见 `test/live2d-render.test.ts`）；② 批次**不能按纹理号合并** —— 同纹理里只要有一个 `opacity = 0` 的网格，整张纹理就被压成透明（TITLE 的角色纹理 3062 个三角形因此全部消失，只剩背景与特效）。
- ✅ **撤幕留帧策略（emulator 侧，2026-09）**：撤掉**满屏覆盖幕**（`0x1F7` 删掉一个铺满视口的 mesh）后，最多跳过 `HOLD_MAX_FRAMES=60` 次 present（≈1 秒），直到**新内容真的可见**为止。
  为什么需要：实测（`.tmp` 日志）批边界会落在"幕已撤、旧图元未清、新幕未建"的脚本级 teardown 中间，于是画出**一帧没有覆盖幕的旧场景**（`[meshsig 17480ms] meshes={0:0} items=29`，29 个图元正是 GAMESTART 配置界面）—— 用户看到的就是"配置界面向黑渐变完成后又闪了一下"。这条是 **emulator 侧策略**（非引擎 opcode 语义）：引擎那边 present 由"场景脏 + 动画待播"驱动且**从不整屏清 backbuffer**（`ClearTarget` 被 `_this+46460&1` 守卫、该字段恒 0），撤幕帧屏上留的是上一帧的黑，而重写侧是"每批指令后整帧重合成"，粒度对不上。实现见 `pixiBackend.ts` 的 `#holdFrameAfterCurtainDrop`/`#releaseFrameHoldIfVisible`。
  - ★两处收紧（用户实测"进 SN0000 时**背景**闪一下"）：① **建项 ≠ 可见** —— 引擎建几何（`0x320`）与设色（`0x322`）是两条指令，中间那一帧的幕还是全透明 ⇒ 解除判据 = "**`state0` 的高字节 alpha > 0**"（`pixiBackend.ts` 的 `#meshVisible`；`calcDiffuse` 输出那条已废弃的实现不成判据），`0x1F6 clearDrawContainer` 也**不再解除**留帧（改为续期）；② 上限 8 → 60 帧 —— 8 帧在慢机上不够跨过"撤幕 → 清容器 → 建新场景"这串脚本级操作。
  - 日志可复现：`.tmp/amayui-emulator.log` 里 `[frame-hold] 满屏幕布 0x30d40 被撤 → …` → `createMesh 0x19258 颜色仍透明 → 继续留帧` → `setVertexColor 0x19258 → 新内容可见，解除留帧`（解除时刻的幕是**不透明黑**，与留帧中屏上那帧黑完全相同 ⇒ 无缝），随后才是 `setVertexColorAlpha 0x19258 … → state1=0` 的 3.6s 淡出。
  - ★★**武装判据（2026-09-26，`T-0182`）**：判据**只留共享层一份** —— `drawitem/eval.ts` 的
    `meshFillsViewport`（几何：**与视口的交集面积** ≥ `FRAME_HOLD_COVER_RATIO`）∩ `meshCoversViewport`
    （此刻 `state0` α>0；窗还开着时只要任一端 α>0 就算"可能盖着"），区间版 = `meshesCoverViewInRange`。
    **宿主侧不许再手写几何判据**：旧实现写在 `pixiBackend.#coversViewportMeshInRange` 里，口径是
    `min(xs) <= 0 && max(xs) >= VIEW_W`；`T-0155` 给 `0x320` 的顶点加了引擎的半像素偏移
    （`x/y -= 0.5`）之后，语料里每一块满屏幕布都成了 `(-0.5,-0.5)..(1279.5,719.5)` ⇒
    `1279.5 >= 1280` 为假 ⇒ **判据恒假**、撤幕留帧**再没武装过**（症状：TITLE → GAMESTART → SN0000 时，
    渐黑之后、SN0000 渐入之前闪出一帧 TITLE 背景 + GAMESTART 配置界面；`tickets/T-0182`）。
    另一条推论：撤一块**已经全透明**的幕在画面上什么都没改变（TITLE 入场渐显 `TITLE.txt:731-748`
    撤幕那一刻 `state0` 已被窗末烘焙成 0）⇒ 那里**不该**武装，否则白冻 60 帧（连标题立绘的 Live2D
    动作一起冻住）——「几何铺满」与「此刻真的盖着」必须分开判。
- ✅ 视口 1280×720；窗口 `useContentSize:true` + `win.setContentSize(1280,720)`；`autoDensity + devicePixelRatio`（canvas CSS 1280×720、底层按 DPR 高清）。
- ✅ 严格 flag：draw-item/mesh 只认 bit0|bit1，未知位（如 draw-item `&4`）抛 `UnknownFlagError` 中断；未实现 opcode 抛 `NotImplementedOp`。
- ✅ 诊断日志：`log-line`/`log-line-sync` IPC → `app/amayui-emulator/.tmp/..`(实际 `E:\Games\Eushully\天結\.tmp\amayui-emulator.log`)；renderer 逐行/批次落盘 + 关窗同步兜底。
- ✅ 无界面光栅验证：真实 VM 到 TITLE 产出与真实标题菜单布局吻合（logo+散布按钮+版权+背景）。
- 机制权威记录见 `./copyright-effect.md`；实现模型/改动文件/验证见 `../04-app/emulator-copyright-effect.md`。

## 4.5 draw-item 的世界矩阵：pivot 是**绝对坐标**，位置必须跟着它走

引擎侧（`sub_49AA30` raw 117425-117429，行向量序）：

```text
M = T(-pivot) · S · R · Tt · T(+pivot)        ⇒  v' = S·R·(v − pivot) + t + pivot
```

- `pivot` 由 `0x217` **原样**写进 DrawItem 的 pivot 三元组（**绝对坐标**，与 `0x219` 写的描画位置是两回事）；
  `DrawItem+0x68`（useWorld）只由变换类指令（`0x1FD`/`0x1FF`/`0x21E`/`0x21F`/`0x220`）置位，未置位的项走**纯 2D**。
  **逐字段清单（各偏移、门控读者与 raw 行号）见台账 `engine-capabilities.json#drawitem-world-matrix-composition`**（其 `narrative` 指回本文件），这里不重复。
- Pixi 的语义是 `screen(l) = position + S·R·(l − sprite.pivot)`，要与上式逐项相等必须**同时**取：

```text
sprite.position = pivot + t          sprite.pivot = pivot − pos
```

⚠️**只改 `sprite.pivot` 而位置仍用 `pos` 是错的**（只有 `pivot == pos` 时才恰好等价，所以长期没暴露）。
实测症状（2026-09 用户）：设置界面「打开字体选择器 → 右键退出 → 再滚动」时，右侧滚动条的**中段**
（唯一带 `0x1FD` 缩放的段）漂到列表中间。原因链：

1. `CONFIG1.txt:1045` 打开选择器前把脚本全局 `707ffa/707ffb`（弹窗原点，`0x348/0x78+0x32·n`）置位，
   而**没有任何脚本把它复位**（全语料无 `mov (global-int 707ffa) 0`）；
2. 滚动条中段的 pivot 被算成 `707ffa + 32e`（`CONFIG1.txt:2960`、`CONFIG2.txt:1424`），
   描画位置却是 `32e` ⇒ `pivot − pos = 0x348 = 840`；
3. 渲染侧位置写成 `pos` ⇒ 中段整体**左移 840px**（scaleX = 1）⇒ 一条灰条横在列表上。

修法：`itemRenderPlacement`（`src/renderer/drawitem/eval.ts`）同时给出
`position = pivot + t` 与 `pivot = pivot − pos`，`presenter.ts` 只用它；守卫
`test/config1-chain.test.ts`（真语料跑完整序列，断言中段**渲染出来的**左边缘回到轨道 x）。
上/下盖没有变换指令 ⇒ 纯 2D 路径，不受影响（这正是"只有中段漂"的原因）。

## 4.6 alpha 混合选择子：`DrawItem+0x30` / `MeshEntry[9]` / 场景默认（2026-09，`T-0017`）

**同一套 4 值枚举**，三条同族路径各自消费（判定全是 `cmp 1/2/3` 的 if 链、无跳转表）：

| 值 | D3D 组合 | 语义 | draw-item（`sub_4A2D50` raw 123089-123121） | mesh/model（`sub_49E390` raw 119369-119399 / `sub_49E700` raw 119512-119578） |
|---|---|---|---|---|
| `0` / ≥4 | — / `SRCALPHA+INVSRCALPHA` | 默认 | **一个 blend state 都不设**（继承当前） | **显式**设 `(19,5)(20,6)` |
| `1` | `SRCALPHA(5)` / `ONE(2)` | 加算 | 设 | 设 |
| `2` | `ONE(2)` / `ZERO(1)`，**门控** | 覆盖 | 设 | 设 |
| `3` | `BLENDOP_REVSUBTRACT(3)` + `(5)`/`(2)` | 减算（`dst − src·sa`） | 设 | 设 |

- **写入**：`0x203` 的 op2 → `DrawItem+0x30`（`sub_4ACF60` raw 131878）；`0x322` 的 op2 → `MeshEntry[9]`（`sub_4AE2C0` raw 132818）；
  场景默认 = `0x33F` op1 → `Scene+1260`（`sub_427A90` raw 34442-34444）。
- **送达**：draw-item 见 `sub_4AEEA0` raw 133443（第 6 参 = 元素 `+0x30`）；mesh 见 `sub_4AF1C0` raw 133617（第 8 参 = `entry[9]`）。
- ★**值 2 是有门控的**：只有当 `Scene+46456`（当前渲染目标槽，由 `0x20D` 写）指向的纹理其 `CTexture+1048`
  （创建模式，由 `0x1F8` 的 op4 写）**== 1**（= 往 mode-1 离屏表面画）时才设 `(ONE,ZERO)`；否则**什么都不设**。
- ★**场景默认那一档没有门控**：`sub_4535F0`（65841）的 `Scene+1260 == 2` 分支无条件 `(ONE,ZERO)`（raw 65861-65869）。
- ★**两处 `DESTBLEND` 的寄存器实参被 Hex-Rays 丢了**，由 `engine/天结_unpacked.exe_utf8.lst` 逐指令解出
  （`.text:004A3191 push 1`、`.text:004A31BB push 2`）——凡「`.c` 里实参只剩 `(v10, 20)`」都应去 `.lst` 取。

### ✅ 已收敛：合并段的 blend 状态由 **ID3DXSprite 的 Begin/End** 重设（`T-0041`，2026-09-16）

读代码会一度得到"状态泄漏"：draw-item 的 `0` 不重置（raw 123100-123117 跳 LABEL_42）、mesh 画完留
`(ONE,ZERO)`（raw 119474-119476 / `.lst:0049E681`-`0049E6AF`）、`sub_4535F0` 尾部也是 `(ONE,ZERO)`
（`.lst:00453777`-`00453791`），而 2D 合并段（`sub_4B06D0` raw 134417-136734）里"没有任何 SetRenderState"。
**最后一条是 grep 假象**：本引擎的 `SetRenderState`/`SetSamplerState` 全是**设备 vtable 间接调用**
（`(*(*(device)+228))(...)` / `+276`；228 = 57×4 = `IDirect3DDevice9::SetRenderState` 的槽），符号 grep 看不到。

真正的重设点是**每项一次 `ID3DXSprite::Begin`** —— `sub_4A2D50`（2D draw-item 绘制）在设置任何状态**之前**
先 `SetTransform` 再 `Begin(16)`：

| 环节 | raw | 事实 |
|---|---|---|
| 精灵对象 | 122816-122823 `sub_4A2BA0` | `j_D3DXCreateSprite(device, &Scene+42452)` ⇒ `Scene+42452` 就是 **`ID3DXSprite*`**（「関数：CSprite エラー」只是包装命名） |
| **每项的开始** | **123087-123088** | `(sprite+20) = SetTransform(matrix)` → `(sprite+32) = Begin(16)`；`16 = D3DXSPRITE_ALPHABLEND` ⇒ D3DXSprite 在 Begin 时按自身默认设 render state（`ALPHABLENDENABLE=TRUE`、`SRCBLEND=SRCALPHA`、`DESTBLEND=INVSRCALPHA`、采样器） |
| 引擎的每项覆盖 | 123090-123120 | **Begin 之后**才设采样器（`+276` = SetSamplerState：MIN/MAG=LINEAR、MIP=NONE）、`SetRenderState(15 /*ALPHATESTENABLE*/, 0)`，再按选择子设 blend：`1` ⇒ `(19,5)+(20,2)`；`3` ⇒ `(171,3)+(19,5)+(20,2)`；`2` ⇒ 门控 `(19,2)+(20,1)`；**`0`/≥4 不设** ⇒ 落到 **sprite 的默认**（正常 alpha 混合） |
| 绘制 | 123208 / 123224（`CTexture` vtable+20 = `sub_48AE60`） | `sub_48AE60` 把 (texture, rect, center, pos, color) 转给 **`sprite+36` = Draw**（⇒ 这份 D3DX 的槽序：Begin=32 / Draw=36） |
| 每项的收尾 | 123244 | `sprite+44`（`End`/`Flush`） |

⇒ **结论**：① 真机上「前一个 `1/2/3` 项之后的 `0` 项」= **sprite 默认（`SRCALPHA`/`INVSRCALPHA`）**，**不继承**前一项；
② 「mesh 之后的 `0` 项」同理（下一项的 `Begin` 先重设默认）；③ `sub_4535F0`/mesh 留下的 `(ONE,ZERO)`
只对**不走 sprite 的路径**（mesh/3D）有意义；④ `sub_49E390`（mesh 的纹理四边形，唯一调用点 raw 133617）
与 `sub_49E700`（DrawModel）在选择子 `0`/≥4 时**显式**设 `(19,5)+(20,6=INVSRCALPHA)`（`sub_49E390` raw 119389-119394：`(19,5)` 于 119392、`v19=6` 于 119393、`(20)` 于 119375；`sub_49E700` raw 119530-119534：`(19,5)` 于 119533、`(20)` 于 119517）—— mesh 侧本来就不泄漏。

⇒ emulator 侧：**默认档（每项从默认开始）就是引擎事实**；`BlendWalkOptions.leakStateAcrossEntries`
保留为**实验开关**（按"字面读法"复刻那个并不存在的泄漏），默认 false。E4 交叉验证：打开泄漏档会把 TITLE 的
logo 透明区写成黑（与真机矛盾），关闭档与 `t17before` 逐字节相同（`T-0017` 的截图对照）。

### Pixi 落地（`T-0017`）
`blendModesMap` 里注入两个自定义档：`d3d-opaque = [ONE, ZERO]`、`d3d-rev-subtract = [ONE,ONE,ONE,ONE,FUNC_REVERSE_SUBTRACT,FUNC_REVERSE_SUBTRACT]`
（Pixi 的源是**预乘**的 ⇒ 引擎的 `(SRCALPHA,ONE)` = `'add'`、`(SRCALPHA,INVSRCALPHA)` = `'normal'`、
`REVSUBTRACT+(SRCALPHA,ONE)` = 这里的 `d3d-rev-subtract`）。★**不要用 Pixi 内建的 `'none'`**：
它是 `[0, 0]` = **画黑**，不是引擎的 `(ONE,ZERO)`「覆盖」（实测踩过）。

## 5. 交叉引用

- 纹理 slot↔AGF 映射见 `./resource-loading.md`；渲染壳工程见 `../04-app/emulator.md`。
