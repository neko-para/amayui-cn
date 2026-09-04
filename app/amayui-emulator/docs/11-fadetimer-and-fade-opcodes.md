# 11 FadeTimer 与淡入淡出 opcode 家族（engine.cpp 实证）

> 状态：**结构已确认**（逆向）。记录 AGE/Eushully 引擎的淡入淡出（フェード）实现：
> 一个**步进计时器类 `FadeTimer`** + 一**族 fade opcode**（`SetFade`/`SetLineFade`/`SetRandomFade`）。
> 依据：`engine/engine.cpp` 的 `sub_453A20..sub_453C10`（FadeTimer 类）、`sub_41D180..sub_41EA30`（fade opcode handler）、
> `sub_441060/sub_441410`（fade 绘制）、`docs/re/engine/06`（opcode→handler 表）。

---

## 0. 一句话结论

引擎的「淡入淡出/渐变」= 一个 **FadeTimer 步进计时器**（记录起点时间 + 步长，每帧推进一个 step），
配合 fade opcode（0x20–0x38）调用 `sub_441410(mode,…)` 按当前 step/time 画出对应梯度/混合。
**不是**单条指令一次完成，而是「启动 FadeTimer + 逐帧绘制」的动画。

---

## 1. FadeTimer 类结构（7 DWORD + vtable）

构造函数 `sub_453A20`（0x453A20，engine.cpp 64892）：

```c
void sub_453A20(_DWORD *_this) {
  *_this = &FadeTimer___vftable_;  // vtable = sub_453C10（析构）
  _this[1] = 0;  // elapsed
  _this[2] = 1;  // step（当前步序/计数）
  _this[3] = 0;  // leftover / step-delta
  _this[4] = 0;  // stop flag（0=运行，非0=停止/完成）
  _this[5] = 0;  // start timestamp (timeGetTime)
  _this[6] = 0;  // step 时长 (ms) / 数量
}
```

| 字段 | 含义 | 对应方法 |
|---|---|---|
| `[0]` | vtable（`&sub_453C10`=析构） | — |
| `[1]` | 已过时间（`timeGetTime()-start`） | `sub_453AF0` 写 |
| `[2]` | 当前步序（起点 1，每步 +1） | `sub_453A60` 起点 1；`sub_453AF0` 递增 |
| `[3]` | 余量/time 差（`elapsed - step*dura`） | `sub_453AF0` 写 |
| `[4]` | 停止标志（0=运行；非 0=完成/停止） | `sub_453BC0` 置 1 |
| `[5]` | 起点时间戳（`timeGetTime`） | `sub_453A60/90/B0` 写 |
| `[6]` | 步长(ms)或数量 | `sub_453AD0`/`sub_453A60` 写 |

### 1.1 核心方法（engine.cpp）

| 函数 | 作用 |
|---|---|
| `sub_453A20`(64892) | 构造函数：set vtable + 字段默认（`[2]=1` 其余 0） |
| `sub_453A50`(64905) | 仅 set vtable（供析构复位） |
| `sub_453A60`(64911) | **启动**：`[2]=1, [5]=timeGetTime(), [6]=a2(或 1)` |
| `sub_453A90`(64925) | 启动：`[2]=1, [5]=timeGetTime()` |
| `sub_453AB0`(64935) | 启动：`[2]=1, [5]=timeGetTime()-a2` |
| `sub_453AD0`(64947) | 仅设 `[6]=a2(或 1)`（不改时间） |
| `sub_453AF0`(64959) | **推进**：`[4]`非0 返 -1；否则 `[1]=elapsed`、`[3]=elapsed-step*dura`、`[2]=step+1`；`Sleep` 到整步；返 `elapsed/step - step` |
| `sub_453B60`(64999) | 推进变体（基于负余量） |
| `sub_453BB0`(65025) | 返 `timeGetTime()-[5]`（elapsed） |
| `sub_453BC0`(65031) | `[4]=1`（停止/完成） |
| `sub_453C10`(65050) | 析构：`sub_453A50()` + 可选 `delete` |

⇒ FadeTimer 是个**步进计时器**：记录起点 `[5]`、步长 `[6]`，每帧 `sub_453AF0` 把「距起点的毫秒数」折成步序 `[2]`/余量 `[3]`，供上层据此取渐变颜色/α。

---

## 2. FadeTimer 的嵌入位置（每 UI/层一个）

`sub_453A60` 在引擎 `_this` 的多个偏移上被调，即**多路 FadeTimer**（每消息窗/每图形层/每效果一个）：

- `_this + 107461`、`+107496`、`+107503`、`+107524`、`+107545`、`+107643`（DWORD 索引，≈byte 429840→430572）
- `_this + 430012`、`+429844`、`+429872`、`+429956`、`+430572`（byte 偏移）

这些对象由图形/消息窗子系统持有（如 `_this+1978`（图形对象）上调用 fade 方法，见 `sub_41D180` at 26972/26990）。

---

## 3. 淡入淡出 opcode 家族（0x20–0x38）

fade opcode handler 的模式（见 `sub_41D180`，engine.cpp 26959）：

```
arity=5; v2=_this[174801]; if (v2&0x8000000) sub_441060(op1,0);        // 走简化线淡
else { _this[174801]|=8; dur=clamp(op2,64?/16); sub_453A60(_this+107461, dur);  // 启动 FadeTimer
       sub_478090/sub_477220(…);  sub_441410(op1,0xFFFFFFFF,mode,…); }            // 画出对应 fade
```

| opcode | u 名 | handler | fade 类型 |
|---|---|---|---|
| 0x21 | u00418860 | `sub_41D180` | **SetFade**（mode 0：整屏源/目标纹理混合淡入淡出） |
| 0x22 | u00418920 | `sub_41D290` | SetFade 变体 |
| 0x23 | u004189D0 | `sub_41D390` | … |
| 0x24 | u00418A90 | `sub_41D490` | … |
| 0x25 | u00418B40 | `sub_41D590` | **SetLineFade**（按行淡入淡出） |
| 0x26–0x2e | u00418C00… | `sub_41D6A0…sub_41DFA0` | SetLineFade 各变体 |
| 0x20 | u004187C0 | `sub_41D0E0` | 相关效果 |
| 0x2f–0x38 | u004195A0… | `sub_41E0A0…sub_41EA30` | 文本/效果 op |

绘制方法：
- `sub_441060(_this, a2, a3)`(49789)：简化 fade 绘制（无 FadeTimer 居中模式）。
- `sub_441410(_this, a2, a3(mode), a4, a5, a6)`(49942)：按 `mode` 画 fade——`mode 0`=SetFade 整屏混合、`1–8`=SetLineFade、`9`=SetRandomFade（`a4=0xA0` 块大小）。内部含 `"関数：SetFade/SetLineFade/SetRandomFade エラー…"` 校验（~50082/51807/53243）。

---

## 4. 与 LOGO→菜单过渡的关系 / 模拟器现状

- **boot→TITLE 脚本路径不调用 fade opcode（0x20–0x38）**：用 opcode 审计跑启动链，`u00418860` 等 fade opcode **未出现**。⇒ LOGO→菜单的淡入淡出**不是脚本显式发出**，更像引擎主循环在场景切换（`interpreterMainLoop_412290` 检测某状态/标志）时内部驱动 FadeTimer 过渡，或由其它未分析脚本调用。
- **模拟器现状**：fade opcode 0x20–0x38 **未在 `ops.ts` 实现**（不属 NATIVE_OPS/ENGINE_INTERNAL_OPS，也未在 OPS）。启动→TITLE 未触发故不报错；一旦场景切换/消息框淡入淡出触发即会 `unimplemented`。
- 之前确认的**常被忽略的「颜色/α」渐变指令** `0x202`(sub_4AD0C0)/`0x203`(sub_4ACF60)：给绘制命令设填充色+α。**这是静态颜色/α，与 FadeTimer 的时间性淡入淡出不同**：前者设一次色，后者随时间推进渐变。

---

## 5. 拟在模拟器中如何复现（供后续）

1. **建模 FadeTimer**：一个 `{elapsed, step, leftover, stop, startTime, stepDur}` 对象，暴露 `start(dur)`/`tick()`（类比 `sub_453A60`/`sub_453AF0`）。
2. **渲染层做时间性淡入淡出**：场景切换（如 LOGO→菜单）时，在主循环/渲染 tick 上推进 FadeTimer，按当前进度把当前帧叠加一个全屏 α 遮罩（0→1 或 1→0），即淡入淡出。可参考 `sub_441410 mode 0`（源→目标纹理混合）或直接用全屏渐变 α。
3. **fade opcode 0x20–0x38**：若要按脚本精确复刻某场景 fade（而非整屏过渡），再实现这些 handler（读 op1/op2 → 启动 FadeTimer → 叠渐变）。目前启动链不触发，可后置。

> 关键：**FadeTimer 是时间基准（步进计时），实际渐变效果由调用者按 step/time 计算**。模拟器复现「淡入淡出」最省力的点 = 场景切换时按 FadeTimer 进度叠全屏 α，而非逐条实现 fade opcode。

---

## 6. LOGO 场景的指令逐个对照（结论：无专用 fade opcode）

逐一核对 `src/LOGO.txt` 全部指令与 engine.cpp handler：

| LOGO 指令 | opcode | handler（engine.cpp） | 作用 |
|---|---|---|---|
| `set-texture` | 0x1F9 | `sub_422CB0`(30769) | SO006→slot 0x2a / SO005→slot 0x2b |
| `draw-texture` | 0x1FB | `sub_422E70`(30846) | 贴背景/版权（源矩形=op3-6，目标=op7/8） |
| `u0042B990` | 0x2D5 | `sub_430C30` | 设 global-float（quad 矩形参数） |
| `u0043AA20` | 0x320 | `sub_432150` | 顶点/几何设置（quad） |
| `set-draw-color-alpha` | 0x203 | `sub_4232C0`→`sub_4ACF60`(129850) | **设绘制命令的颜色+α**（静态） |
| `set-draw-color` | 0x202 | `sub_4231F0`→`sub_4AD0C0`(129936) | **设绘制命令的颜色+α**（静态） |
| `set-vertex-color` | 0x322 | `sub_426C20`→`sub_4AE2C0`(130789) | **设绘制命令的颜色+α**（静态） |
| `set-vertex-color-alpha` | 0x323 | `sub_426CF0`→`sub_4AE330`(130806) | **设绘制命令的颜色+α**（静态） |
| `u00420270` | 0x1F7 | `sub_422BC0`→`sub_4AB950/4ABB60` | 纹理命令选择/层管理 |
| `release-texture` | 0x1FA | `sub_422E00`(30822) | release 纹理/层 |
| `create-texture` | 0x1F8 | `sub_422C20`(30797) | 建纹理对象 |
| `play-movie` | 0x20F | `sub_4237B0`(31165) | **视频/动画显示**（LOGO.MPG，`sub_454FA0` 取文件） |
| `u00415BF0` | 0x101 | `sub_419CC0`(24831) | 清 `_this[174801]&=~0x8000000` + 设 `[122367/122370]`（**退出屏幕效果态**） |
| `u00416270` | 0x21C | `sub_41A260`(25043) | `_this[174801]|=0x400`（**屏幕效果旗标**） |

**结论**：
- LOGO **没有** `SetFade`/`SetLineFade`/`SetRandomFade`（opcode 0x20–0x38）任何一条，也**没有**启动 FadeTimer（`sub_453A60`）的指令。
- LOGO 里与「渐变/屏幕效果」相关的指令 = **颜色/α 设置器** `0x203`(sub_4ACF60)/`0x202`(sub_4AD0C0)/`0x322`(sub_4AE2C0)/`0x323`(sub_4AE330)（把颜色+α 写进绘制命令，**静态**），以及**屏幕效果旗标** `0x21C`(设 `0x400`) / `0x101`(清 `0x8000000`)。
- ⇒ **LOGO 的淡入淡出不在 LOGO 指令里**，而是引擎主循环在场景切换时驱动 `FadeTimer` + 检查 `_this[174801]` 旗标做出的**过渡**。LOGO 脚本只负责铺场景（SO006/SO005 + 颜色）并设置/清除若干屏幕效果旗标。

> 若要让模拟器复现 LOGO 的淡入淡出，正确路径是：**引擎层（主循环/渲染 tick）在场景切换时推进 FadeTimer 并叠全屏 α**（参考 `_this[174801]` 旗标与 `sub_441410 mode 0` 的混合思路），而不是在 LGOO 脚本里找 fade 指令。
