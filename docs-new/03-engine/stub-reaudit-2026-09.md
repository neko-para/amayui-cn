# 已 stub 指令的复评与实施台账（2026-09）

> **起因**：模拟器里长期有一批 opcode 被登记成"跳过"（`ENGINE_INTERNAL_OPS` 的纯 no-op 与
> `STUB_NATIVE_OPS` 的记录式桩）。用户要求**逐条重评**：除 **播放视频 / Live2D / 配置键盘输入**
> 三类之外，其余**预期都要实现**。
>
> 本文是那次复评的**结论与进度台账**（逐条判据 + 批次），语义细节不在这里复制 ——
> 每条 opcode 的 handler 结论在 `opcode-table.md` 与第一层 `analysis/functions.json`。
> 逐脚本的用法在第三层 `analysis/scripts.json`。

> ★**轮 6（2026-09）订正**：本文里 `0x327`/`0x328`「根本没注册 ⇒ 命中即硬报错」以及 §1.1 的
> 「A4b 3D 天气效果族待做」**已过期** —— `0x327`/`0x328` 连同同族的 `0x329`/`0x32C`/`0x32E`
> 五条已按「有据 no-op」登记进 `ENGINE_INTERNAL_OPS`（**缺消费端**：emulator 没有 Effect3D / 3D 网格 /
> mesh / 3D 相机 / 3D 图元子系统；逐条机械扫描确认体内**无操作数写原语**）。
> 理由是 `SETWEATHER` **由剧情脚本调用**（`call-script 47`），让它硬停会让整段剧情走不完。
> 处置见 `analysis/opcode-gaps.json`、`src/vm/handlers/stubs.ts` 的块注释与 `tickets/T-0093`；
> 守卫 `test/op-327-32e-setweather-noop.test.ts`。以下 §0/§1 的计数按当时口径保留。

## 0. 口径与总量

| 项 | 数量 | 说明 |
|---|---|---|
| `opcode-table.md` 全表 | 574 | 引擎实际存在的 opcode |
| `OPS`（implemented） | **230** | 真实现（A1–A6 落地后；原 187） |
| `NATIVE_OPS`（native） | **50**（含 5 条记录式桩 `STUB_NATIVE_OPS`） | 经 `NativeBridge` 落宿主（原 53；`0x1BC`/`0x1C9` 属音频族） |
| `ENGINE_INTERNAL_OPS`（纯 no-op） | **14** | 原 48；A1–A6 共移出 34 条 |
| **复评对象（stub 合计）** | **57** | = 48 + 9（复评时口径） |
| 其中已转真实现 | **44** | A1 三 + A2 四 + A3 十二 + A4 十三 + **A5 九** + A6 三 |
| 仍为 stub（未开工批次） | 14 | A4b 3 + 排除项 10 + 真空 1 条 |
| **根本没有 handler**（命中即 `NotImplementedOp`） | 286 → **282** | A3 补了 3 条（`0x1D3`/`0x1D4`/`0x2F3`）+ 接线补 `0x199`；A6 的 `0x14C`/`0x14D` 也已补上（`0x327`/`0x328` 仍未做） |

复评判据（每条都**读过 handler 体**，raw 行号见下）：

1. **是否回写脚本操作数**（`sub_42B4B0` / `sub_42BA00` / `sub_433310` / `sub_418CC0` / `sub_418B90`）
   —— 回写 ⇒ **必须实现**（no-op 时脚本读到旧值 ⇒ 静默逻辑错误）；
2. **是否写"有读者"的引擎字段 / 改控制流** —— 是 ⇒ 必须实现；
3. **是否只碰 emulator 明确不做的子系统**（视频 / Live2D / 键盘·触摸输入）—— 是 ⇒ **排除**；
4. **读体确证"什么都不做"** —— 保留 no-op，但必须注明"已读体确证为空"（与"我们不想做"区分）。

## 1. 结论：**42 条要实现**（另有 2 条同族未注册的 `0x327`/`0x328`）、**14 条排除**、**1 条真·空**

> ★**2026-09 订正一**：`0x324` 原被按"影片族"排除，**是误判** —— 用户指出 `sub_453530` 在
> `engine/天结_unpacked.exe_utf8.lst` 里是 **thunk**（`; Attributes: thunk` → `jmp sub_453150`），
> 不是"外部弱符号"。跟到底后确认它属 **3D 天气/粒子效果族**（见 §1.1 A4b），因此**归入"要实现"**。
> 教训：**"外部弱符号/本文件无实现"不能作为排除理由** —— 反编译产物里没有函数体 ≠ 二进制里没有；
> `.lst` 里 `; Attributes: thunk` 或 `jmp` 一跳就能跟到真身。
>
> ★**2026-09 订正二**：`0x14B` 原列"待裁决（能否跨平台加载原生库）"，现**已定论**：它**不可能加载任意库**
> —— 全语料唯一调用点 `src/SAVE.txt:7 i14b 5250`，而 `0x5250` = 文件 id 21072 = **`AGERC.DLL`**；
> 引擎本体也用硬编码字面量加载同一个 DLL。⇒ 可实现（模型化 AGERC 接口，不加载原生库），
> 见 `docs-new/03-engine/agerc-module.md`。**同时发现 `0x14C`/`0x14D` 根本没注册**（同一条链上的
> `set-agerc-export`/`call-agerc-export`，实测一进「Load Data」就在 `SAVE.BIN` 第 2 条硬报错）。

### 1.1 必须实现（42 条；+ `0x327`/`0x328` 两条同族未注册）

**A1｜会回写脚本操作数（静默逻辑错误）** —— 3 条

| opcode | handler | 语义 | 语料 | 状态 |
|---|---|---|---|---|
| `0x1CB` | `sub_42D3D0`(38082) | `op1 ← GetConfig("message:ReadTextSkip")`（`0x1CA` 的读取端） | 30+ 场景脚本 + 本体 `SC0000:443`/`DRAWCHARM:8`/`CHARMEDIT:751` | ✅ 已实现（`handlers/msgwin.ts`） |
| `0x2C8` | `sub_434260`(42379) | **按字符**取子串 → op1 字符串（`0x2C7` 是字节版） | 0 处 | ✅ 已实现（`handlers/strings.ts` + `text/sjis.ts`） |
| `0x2C9` | `sub_4344A0`(42460) | **可变数组元素引用** → op1 指针（按需扩容；负下标抛错） | 0 处 | ✅ 已实现（`handlers/memory.ts` + `operand.ts`） |

**A2｜写"有读者"的引擎状态 / 控制流** —— 4 条　✅ **已实现（2026-09）**

| opcode | handler | 结论 | 读者 | 状态 |
|---|---|---|---|---|
| `0x7B` | `sub_41F530`(28724) | `Engine[cur+122372]` / `[+122412]` | 帧循环 raw 14001/14008、**`0x199`** raw 24506/24520（重显示游标） | ✅ `OPS` `op_set_rewind_cursor` |
| `0x1BB` | `sub_420000`(29223) | `Engine[97055]` = op1 或 `0x80000000`（非法值抛 `SetTBの引数が不正です．`） | `0x1D2`/`0xC4`/`0x1BD`/`0x2F4` 的 push 门、主循环 raw 20319 | ✅ `OPS` `op_set_text_base` |
| `0x25A` | `sub_425DB0`(33188) | `Engine[92379]=1` / `[92380]=op1` + `sub_4A5470` | 主循环 raw 21755；同族 `0x25B` 是模式 2 | ✅ `OPS` `op_set_media_movie` |
| `0xAE` | `sub_4192F0`(24634) | **存档版本分支**：重算 `frames[cur]` 的 ip / 切 `cur` / 装载目标帧 | 控制流；门控 `Engine[95780]`（只在读档时生效） | ✅ `OPS` `op_save_version_branch`（门控路径精确；读档 ip 表/帧装载=已登记缺口） |

**A3｜文本 / 消息子系统**（emulator 已有 `msgwin`/`Font` 建模，只差接线）—— 9 条 + 读取端 3 条　✅ **已实现（2026-09）**

| opcode | handler | 语义 | 语料 | 状态 |
|---|---|---|---|---|
| `0x7A` | `sub_41F4E0`(28710) | 窗对象 `[48]-20/-16 = op2/op3`（`sub_45A910`） | 0 | ✅ `op_msgwin_obj_pre48` |
| `0x1D2` | `sub_420380`(29374) | **文本项记录表 push**（`Font+3364` 的 72B/条） | **42760 / 333 文件** | ✅ `op_text_item_push` |
| `0x1D3` | `sub_42D4A0`(38113) | 文本项查询 → 写 op1（命中）/op2（`+20`） | 15 / 3 | ✅ `op_text_item_query` |
| `0x1D4` | `sub_42D510`(38131) | 语音项查询（选择器 0）→ 写 op1/op2 | 0 | ✅ `op_voice_item_query0` |
| `0x2F3` | `sub_431A10`(40724) | 语音项查询（带选择器）→ 写 op1/op2/op3 | 2 / 2 | ✅ `op_voice_item_query` |
| `0x25C` | `sub_425E70`(33224) | 窗对象 `+224` 起 13 dword 文本块参数（`sub_456510`） | 0 | ✅ `op_msgwin_obj_text_block` |
| `0x25E` | `sub_425F50`(33269) | 窗对象 `+256/+260/+272`（颜色 + ARGB，alpha 截断 255） | 0 | ✅ `op_msgwin_obj_colors` |
| `0x25F` | `sub_425FF0`(33291) | 窗对象 `+264/+268`（颜色 + ARGB） | 0 | ✅ `op_msgwin_obj_colors2` |
| `0x205` | `sub_4233E0`(31470) | **数值直绘进纹理槽**（格式标志；**op2 是 in/out = x 前进量**） | **313 / 35 文件** | ✅ `op_draw_number_string`（GDI 字宽量测=已登记缺口） |
| `0x245` | `sub_4251E0`(32661) | 纹理对象浮点参数（`sub_4081B0`） | 0 | ✅ `op_texture_obj_float` |
| `0x246` | `sub_425250`(32680) | 纹理对象子对象 `vtable+56`（参数 ÷100） | 0 | ✅ `op_texture_obj_param` |
| `0x249` | `sub_425310`(32717) | **按 id 载纹理进槽**（带颜色；先释放旧槽；失败抛异常） | 20 / 8 | ✅ `op_load_texture_by_id` |

**A4｜图元 / 网格 / 纹理 / 渲染状态** —— 13 条　✅ **已实现（2026-09，§6）**
`0x1FC`(31303 复位图元变换)、`0x1FE`(31330 图元变换 4 浮点)、`0x207`(31494 槽→槽 StretchRect)、
`0x20E`(25277 图形提交)、`0x224`(25301 清转场表)、`0x229`(31984 绘制模式)、`0x238`(32303)、
`0x242`(32649 DrawItem`+720`)、`0x256`(33120)、`0x258`(33156 纹理槽标志)、`0x321`(33839 MeshEntry 属性)、
`0x32A`/`0x32D`(34003/34033 3D 模型槽释放 / 3D 颜色)

**A4b｜3D 天气 / 粒子效果族（Rain / Snow / Leaf）—— 5 条**（★2026-09 订正新增）

| opcode | handler | 语义 | 现状 |
|---|---|---|---|
| `0x324` | `sub_41A470`(25403) | 取 `Engine[93384]`（3D 效果管理器）→ **thunk** `sub_453530` → `sub_453150`：**释放管理的三个效果对象**（`[258]`=Rain / `[259]`=Snow / `[260]`=Leaf）+ 清 `[312]` | `ENGINE_INTERNAL_OPS`（原误判为影片族） |
| `0x325` | `sub_426DC0`(33925) | 管理器 `[+0x4D8] = op1`、`[+0x4DC] = op2` | `ENGINE_INTERNAL_OPS` |
| `0x326` | `sub_426E10`(33941) | **Set3DEffectSnow**：`Scene+46668>=1` 门槛内惰性建共享 `ID3DXEffect`(资源 202) + 重建 Snow | `ENGINE_INTERNAL_OPS` |
| `0x327` | `sub_426E70`(33956) | **Set3DEffectRain**：`sub_453280` 重建 Rain | ★**根本没注册 ⇒ 命中即硬报错** |
| `0x328` | `sub_432300`(41081) | **Set3DEffectLeaf**：`sub_4183F0` 重建 Leaf 并把数组里的网格槽逐个挂上 | ★**根本没注册 ⇒ 命中即硬报错** |

对象与生命周期（供实现与台账用）：

```
Engine[93384]（字节 0x5B320；Scene = Engine+322832 ⇒ 也是 Scene+50704）
  = 3D 天气/粒子效果管理器，sub_4530B0 构造、operator new(0x4F4)
    创建点：Scene 初始化 sub_4A6EE0（raw 126541-126545）
    销毁点：raw 130401 / 130644-130648
  [258]=Rain  (sub_453280 → sub_48E370，  &Rain___vftable_)
  [259]=Snow  (sub_453330 → sub_4B58C0，  &Snow___vftable_)
  [260]=Leaf  (sub_453410 → sub_478CC0，  &Leaf___vftable_)
  [261]=共享 D3D 设备（传给各 ctor）
  [262..277] / [278..293] / [294..309] = 三组 16-dword 参数块（分别喂 Snow / Leaf / Rain 的 ctor）
  [310]/[311] = 0x325 写的两个 int；[312] = 清空标记
  每帧：帧循环调 sub_4535F0(管理器,-1) + sub_453540(管理器) 推进（raw 136828-136829）
```

**A5｜单行字段写 / 计时 / 音频设备 / 消息面** —— 9 条（`0x14B` 已移入 A6）　✅ **已实现（2026-09，§6）**
`0x93`(24589 消息面显示态 toggle)、`0x94`(24604 消息面可见+清色)、`0x97`(29596 消息面填矩形)、
`0xD9`(24939 清 `effect_flags` 0x1000)、`0x1AD`(24806 `166963=cur`)、`0x1B1`(29155 `21672=op1`)、
`0x1BC`(24845 清消息/声音字段)、`0xAD`(24627 **秒计时器推进**：`(timeGetTime*274877906)>>38`)、
`0x1C9`(29291 **音频设备/驱动初始化** + 写 `Engine+18656/18660`)、
`0x14B`(31056 **加载 AGERC 模块** —— 已定论可实现，见 §1.4 与 `agerc-module.md`)

**A5b｜AGERC 模块接口（与 `0x14B` 同链）—— 2 条**（★2026-09 订正新增）

| opcode | handler | 语义 | 现状 |
|---|---|---|---|
| `0x14C` | `sub_422AB0`(31090) | `set-agerc-export`：`GetProcAddress(Engine+490072, op2)` → 存进 `Engine + 4*op1 + 490076`（槽 0..99，越界抛） | ★**根本没注册 ⇒ 命中即硬报错**（实测：Load Data 一进去就停在这条） |
| `0x14D` | `sub_430170`(43038) | `call-agerc-export`：把 op3 数组 DEC 到缓冲 → `(*槽表[op1])(Engine[96981], 缓冲, 长度, op5, n)` → ENC 回写 | ★**根本没注册 ⇒ 命中即硬报错** |

### 1.2 建议排除（14 条）

| 类别 | opcode | 铁证 |
|---|---|---|
| ~~**Live2D**（11）~~ | ~~`0x341` `0x345` `0x34E` + `0x346`–`0x34D`~~ | ~~异常串直接写着 `L2Dモデル`/`L2Dテクスチャファイル`/`L2Dモーションファイル`（raw 34488/34548/34728）；`0x346`–`0x34D` 是同一批 `Scene+1096` 572B 立绘节点 setter（元素 `+4` = L2D 槽 0..9）~~ |
| **键盘 / 触摸输入配置**（3） | `0x10C`(30617 SetKeyMulti) `0x30A`(33819 SetGesKey) `0x308`(33808 触摸注册) | 越界抛「set-keymulti/SetGesKey 引数不正」；写按键表 |

> ★★**Live2D 那一行已改判（2026-09，`tickets/T-0054`）**：原来把它整族归为"排除项"，理由是
> "emulator 不做的子系统"。实际后果**不是"少一个功能"，而是三处界面的立绘永不出现且不报错**：
> ① `0x344` 建出的 572B 节点**本身就是绘制依据**（`sub_4B0360` 只在 `节点+4` 指向的 L2D 槽
> **真有模型**时才出画，raw 134320）⇒ 不建节点 = 没有东西可画；② `global a9d0` 这条开关没人读 ⇒
> "L2D 支 / `SO004A` 静图回落支"的分叉无从生效。
> ⇒ 11 条**全部转真实现**：`0x341`/`0x345`/`0x34E` 走 `LIVE2D_NATIVE_OPS`（宿主读 `.MOC`/PNG/`.MTN`），
> `0x342`/`0x344`/`0x346`–`0x352` 走 `LIVE2D_OPS`（运行态在 `Engine.l2dSlots`/`Engine.l2dNodes`）。
> **`0x346`–`0x34D` 原先"无模型时天然无输出 ⇒ no-op 安全"的理由只对画面成立、对模型不成立**
> —— 它们写的是节点字段，跳过 ⇒ 节点表永远为空，将来真有模型时也没有节点可画。
> 详见 `handlers/live2d.ts` 的对照表与 `docs-new/03-engine/live2d-moc-format.md`。

> ★原表里的"**播放视频**（1）：`0x324`"一行已**删除** —— 见 §1 的订正与 §1.1 A4b：
> `0x324` 是 3D 效果管理器的销毁，属"要实现"。
> 真正属于影片族的 opcode 是 `0x20F`(play-movie) / `0x23D`(销毁 movie/纹理槽 42..999) 等 ——
> 它们**不在**本次 57 条 stub 名单里（`0x20F` 走 `NATIVE_OPS` 的宿主桩，`0x23D` 已真实现）。

### 1.3 读体确证为空（1 条）
`0xAF`（`sub_419690` 24776）：体内只有 `_this[30*cur+95805]=1`（每条 handler 都写的每步元数据）
⇒ **确实什么都不做**。保留 no-op，但性质是"已经最优"，不是"跳过"。

### 1.4 已定论：`0x14B` 可实现（不是"待裁决"）　✅ **A6 已落地（§6）**

`0x14B`（`sub_4229D0` 31056）看着像"运行时加载任意 Win32 DLL"，但**实际不可能加载任意库**：

- 脚本侧**全语料唯一调用点**：`src/SAVE.txt:7 i14b 5250` ⇒ 文件 id `0x5250` = 21072 = **`AGERC.DLL`**；
- 引擎本体用**硬编码字面量** `tstrFilename[] = "AGERC.DLL"`（raw 4927）在 WinMain 里加载同一个 DLL
  （`sub_48E730` raw 109387），并解析 `_GetInstance@0`/`_ShowDialog@12`/`_OperateMenu@16` +
  用配置 `set:RCVersion` 做**版本锁**（不符 ⇒ MessageBox「AGERC.DLLのバージョンが異なります．」+ 退出）；
- `AGERC.DLL` 是 Eushully 自己的模块（版本资源 `FileDescription = "ARCGameEngine Resource"`，
  21 个导出：3 个 UI + `_SetNameLenMax@20` + 17 个地图/地块/碰撞）。

⇒ **可实现**：把 `0x14B`/`0x14C`/`0x14D` 整体模型化（内置 AGERC 导出表 + 100 槽指针表），
**不加载任何原生库**。详见 `docs-new/03-engine/agerc-module.md`。
**待裁决项归零。**

> ★2026-09 追加订正（读了 `AGERC.DLL` 本体反汇编后）：那 **17 个地图/地块/碰撞导出在《天結》里没有任何调用者**
> （exe 的 `.c` 与 `.lst` 全 0 命中；exe 只 `GetProcAddress` 3 个 UI 导出），它们是共享模块给同期别的作品/工具复用的部分
> ⇒ **A6 只需实现 `_SetNameLenMax@20`**（脚本侧唯一用到，消费者是 AGERC 的注释输入对话框宽度上限）。
> AGERC 内部的功能面（顶部菜单 38 命令 / 设置对话框族 / 配置键全集 / 截图·注册码·硬件采集 / 碰撞微引擎细节）
> 见 `docs-new/03-engine/agerc-internals.md`。

## 2. 实施批次与状态

| 批 | 内容 | 条数 | 状态 |
|---|---|---|---|
| **A1** | `0x1CB` `0x2C8` `0x2C9`（回写操作数 ⇒ 静默逻辑错误） | 3 | ✅ **已完成**（§3） |
| **A2** | `0x7B` `0x1BB` `0x25A` `0xAE` | 4 | ✅ **已完成**（§5） |
| **A3** | 文本/消息族 9 条 + 读取端 `0x1D3` `0x1D4` `0x2F3` | 12 | ✅ **已完成**（§5；含接线项 `0x199`） |
| **A4** | 图元/网格/纹理/渲染状态 13 条 | 13 | ✅ **已完成**（§6） |
| A4b | **3D 天气效果族** `0x324` `0x325` `0x326` `0x327` `0x328`（后两条未注册） | 5 | 待做 |
| **A5** | 单行字段/计时/音频设备/消息面 9 条 | 9 | ✅ **已完成**（§6） |
| **A6** | **AGERC 模块接口** `0x14B` `0x14C` `0x14D`（模型化，无原生依赖；导出表里只有 `_SetNameLenMax@20` 需要真实实现——另 17 个地图导出本作不可达，见 §1.4 订正） | 3 | ✅ **已完成**（§6；这一条解锁了整个存档/读档界面） |
| ~~A7~~ | 读取端 `0x1D3` `0x1D4` `0x2F3` | — | ✅ **并入 A3 完成**（不必再单列） |

> ★`0x327`/`0x328` **当前不在任何表里**（命中即 `NotImplementedOp`）——
> 它们不是"被 stub"，而是"压根没做"。本台账把它们一并收进批次，**故意不上桩**：登记成 no-op 会把缺口藏起来。
> （原清单里的 `0x1D3`/`0x1D4`/`0x2F3` 已在 A3 落地、`0x14C`/`0x14D` 已在 A6 落地，故从此条划掉。）

每批收口都要同步：三张表搬迁（no overlap）、`test/registry-tables.test.ts`、死写棘轮、
E2 用例、`opcode-table.md` 行、emulator 注册表与三层数据层。

## 3. A1 的落地记录（已完成）

| 落点 | 内容 |
|---|---|
| `handlers/msgwin.ts` | `op_get_read_text_skip`（0x1CB）：`op1 ← readTextSkipOf(e)`（运行期覆盖优先，否则启动配置）。与 `op_set_read_text_skip`（0x1CA）成对 |
| `handlers/strings.ts` + `text/sjis.ts` | `op_substr_chars`（0x2C8）+ 纯函数 `sjisSubstrChars`（字符计数 + 复刻 `op4<=0` 时的双/单字节不对称） |
| `handlers/memory.ts` | `op_array_element_ref`（0x2C9）：`setRefOperand(op1, refAt(base, idx))`；负下标抛 ShowMessage 同文；只补**缺失槽**（`hasRefValue`）以对齐引擎的 `ENC(0)` 初始化 |
| `operand.ts` | `refFromOperand` 新增 6 个**数组操作数标签**：`0x8003/0x8004/0x8005/0x8009/0x800A/0x800B`（此前遇到就抛 ⇒ 任何数组取址都用不了） |
| `ref.ts` | 新增 `hasRefValue`（区分"从未写入"与"存着编码 0"）；`writeRef` 接受 `string`（字符串数组扩容要写空串） |
| `handlers/stubs.ts` | 从 `ENGINE_INTERNAL_OPS` 移除这三条并留注释 |
| 守卫 | `test/op-1cb-2c8-2c9.test.ts`（18 例：注册表棘轮 / 0x1CB↔0x1CA 往返 + 配置回落 / 字符 vs 字节对照 / 数组引用与 `lea+lookup-array` 等价 / 扩容不覆盖已有值 / 负下标与类型异常） |

**结论口径**：`0x2C8`/`0x2C9` 在 941 个 `src/*.txt` 里**没有任何调用点**（`0x2C7` 才被大量使用），
实现它们是为了补全语义并消除"命中即硬报错"的隐患；`0x1CB` 则有真实调用（本体 + 扩展包），
是这一批里唯一有**立即可见收益**的一条。

## 4. 状态总表（逐条状态列表 · 2026-09 实算）

> **本表由代码实算生成**（`.tmp/stubStatusTable.mts` 直读 `OPS`/`NATIVE_OPS`/`ENGINE_INTERNAL_OPS`
> 与 `scripts/asm/opcodes.json`），不是人工维护的清单 —— 表里写的就是**当前运行时行为**：
> `OPS`/`NATIVE_OPS` = 真实现；`ENGINE_INTERNAL_OPS` = 记录式 no-op；**无（硬报错）** = 命中即 `NotImplementedOp`。
> 口径 = 复评时的 57 条（48 纯 no-op + 9 记录式桩）+ 7 条"压根没做"的 + 1 条接线项（`0x199`）。
>
> 合计：`OPS` **230** / `NATIVE_OPS` **50**（含 5 条记录式桩）/ `ENGINE_INTERNAL_OPS` **14**。
> 已转真实现 **44 条**：A1 3 + A2 4 + A3 12 + A4 13 + A5 9 + A6 3
> （A3 的 3 条读取端与 A6 的 `0x14C`/`0x14D` 原本属“压根没做”；`0x199` 是随 A2 补的接线项）。

### A1

| opcode | argc | handler | 现在落在哪张表 | 说明 |
|---|---|---|---|---|
| `0x1CB` | 1 | `sub_42D3D0` | `OPS`(op_get_read_text_skip) |  |
| `0x2C8` | 4 | `sub_434260` | `OPS`(op_substr_chars) |  |
| `0x2C9` | 3 | `sub_4344A0` | `OPS`(op_array_element_ref) |  |

### A2

| opcode | argc | handler | 现在落在哪张表 | 说明 |
|---|---|---|---|---|
| `0x7B` | 2 | `sub_41F530` | `OPS`(op_set_rewind_cursor) |  |
| `0x1BB` | 1 | `sub_420000` | `OPS`(op_set_text_base) |  |
| `0x25A` | 1 | `sub_425DB0` | `OPS`(op_set_media_movie) |  |
| `0xAE` | 0 | `sub_4192F0` | `OPS`(op_save_version_branch) |  |

### A3

| opcode | argc | handler | 现在落在哪张表 | 说明 |
|---|---|---|---|---|
| `0x7A` | 3 | `sub_41F4E0` | `OPS`(op_msgwin_obj_pre48) |  |
| `0x1D2` | 2 | `sub_420380` | `OPS`(op_text_item_push) |  |
| `0x25C` | 8 | `sub_425E70` | `OPS`(op_msgwin_obj_text_block) |  |
| `0x25E` | 5 | `sub_425F50` | `OPS`(op_msgwin_obj_colors) |  |
| `0x25F` | 4 | `sub_425FF0` | `OPS`(op_msgwin_obj_colors2) |  |
| `0x205` | 6 | `sub_4233E0` | `OPS`(op_draw_number_string) |  |
| `0x245` | 2 | `sub_4251E0` | `OPS`(op_texture_obj_float) |  |
| `0x246` | 2 | `sub_425250` | `OPS`(op_texture_obj_param) |  |
| `0x249` | 3 | `sub_425310` | `OPS`(op_load_texture_by_id) |  |
| `0x1D3` | 5 | `sub_42D4A0` | `OPS`(op_text_item_query) |  |
| `0x1D4` | 4 | `sub_42D510` | `OPS`(op_voice_item_query0) |  |
| `0x2F3` | 6 | `sub_431A10` | `OPS`(op_voice_item_query) |  |

### A4

| opcode | argc | handler | 现在落在哪张表 | 说明 |
|---|---|---|---|---|
| `0x1FC` | 1 | `sub_422F80` | `OPS`(op_reset_prim_transform) |  |
| `0x1FE` | 5 | `sub_423060` | `OPS`(op_prim_transform4) |  |
| `0x207` | 8 | `sub_423480` | `OPS`(op_blit_slot_to_slot) |  |
| `0x20E` | 0 | `sub_41A200` | `OPS`(op_commit_graphics) |  |
| `0x224` | 0 | `sub_41A290` | `OPS`(op_clear_transitions) |  |
| `0x229` | 5 | `sub_423FE0` | `OPS`(op_set_draw_mode) |  |
| `0x238` | 1 | `sub_4248C0` | `OPS`(op_set_canvas_size) |  |
| `0x242` | 2 | `sub_4251A0` | `OPS`(op_set_draw_entry_param) |  |
| `0x256` | 5 | `sub_425C30` | `OPS`(op_set_slot_params) |  |
| `0x258` | 2 | `sub_425D20` | `OPS`(op_set_slot_flags) |  |
| `0x321` | 3 | `sub_426BD0` | `OPS`(op_set_mesh_entry_attr) |  |
| `0x32A` | 1 | `sub_426F80` | `OPS`(op_release_3d_slot) |  |
| `0x32D` | 2 | `sub_427040` | `OPS`(op_set_3d_color) |  |

### A4b

| opcode | argc | handler | 现在落在哪张表 | 说明 |
|---|---|---|---|---|
| `0x324` | 0 | `sub_41A470` | `ENGINE_INTERNAL_OPS` |  |
| `0x325` | 2 | `sub_426DC0` | `ENGINE_INTERNAL_OPS` |  |
| `0x326` | 4 | `sub_426E10` | `ENGINE_INTERNAL_OPS` |  |
| `0x327` | 1 | `sub_426E70` | **无（硬报错）** |  |
| `0x328` | 3 | `sub_432300` | **无（硬报错）** |  |

### A5

| opcode | argc | handler | 现在落在哪张表 | 说明 |
|---|---|---|---|---|
| `0x93` | 0 | `sub_4191D0` | `OPS`(op_message_surface_off) |  |
| `0x94` | 0 | `sub_419230` | `OPS`(op_message_surface_fill) |  |
| `0x97` | 5 | `sub_420910` | `OPS`(op_message_surface_rect) |  |
| `0xD9` | 0 | `sub_419970` | `OPS`(op_clear_flag_1000) |  |
| `0x1AD` | 0 | `sub_4196F0` | `OPS`(op_store_cur_166963) |  |
| `0x1B1` | 1 | `sub_41FEA0` | `OPS`(op_set_field_21672) |  |
| `0x1BC` | 0 | `sub_4197A0` | `NATIVE_OPS`(op_clear_message_sound_fields) |  |
| `0xAD` | 0 | `sub_4192C0` | `OPS`(op_seconds_timer) |  |
| `0x1C9` | 3 | `sub_420160` | `NATIVE_OPS`(op_audio_device_init) |  |

### A6

| opcode | argc | handler | 现在落在哪张表 | 说明 |
|---|---|---|---|---|
| `0x14B` | 1 | `sub_4229D0` | `OPS`(op_agerc_load) |  |
| `0x14C` | 2 | `sub_422AB0` | `OPS`(op_agerc_bind_export) | set-agerc-export |
| `0x14D` | 6 | `sub_430170` | `OPS`(op_agerc_call_export) | call-agerc-export |

### 排除

| opcode | argc | handler | 现在落在哪张表 | 说明 |
|---|---|---|---|---|
| `0x341` | 2 | `sub_427BA0` | `NATIVE_OPS`(stubSubsystem) |  |
| `0x345` | 3 | `sub_427CF0` | `NATIVE_OPS`(stubSubsystem) |  |
| `0x34E` | 4 | `sub_428200` | `NATIVE_OPS`(stubSubsystem) |  |
| `0x346` | 1 | `sub_427DD0` | `ENGINE_INTERNAL_OPS` |  |
| `0x347` | 4 | `sub_427E10` | `ENGINE_INTERNAL_OPS` |  |
| `0x348` | 5 | `sub_427EA0` | `ENGINE_INTERNAL_OPS` |  |
| `0x349` | 4 | `sub_427F30` | `ENGINE_INTERNAL_OPS` |  |
| `0x34A` | 4 | `sub_427FB0` | `ENGINE_INTERNAL_OPS` |  |
| `0x34B` | 6 | `sub_428030` | `ENGINE_INTERNAL_OPS` |  |
| `0x34C` | 7 | `sub_4280D0` | `ENGINE_INTERNAL_OPS` |  |
| `0x34D` | 6 | `sub_428170` | `ENGINE_INTERNAL_OPS` |  |
| `0x10C` | 2 | `sub_4220B0` | `ENGINE_INTERNAL_OPS` |  |
| `0x30A` | 2 | `sub_426B60` | `ENGINE_INTERNAL_OPS` |  |
| `0x308` | 1 | `sub_426B20` | `NATIVE_OPS`(stubSubsystem) |  |

### 真空

| opcode | argc | handler | 现在落在哪张表 | 说明 |
|---|---|---|---|---|
| `0xAF` | 0 | `sub_419690` | `ENGINE_INTERNAL_OPS` |  |

### 接线项

| opcode | argc | handler | 现在落在哪张表 | 说明 |
|---|---|---|---|---|
| `0x199` | 0 | `sub_418FC0` | `OPS`(op_redisplay_text) |  |

## 5. A2 / A3 落地记录（2026-09，已完成）

| 落点 | 内容 |
|---|---|
| `vm/textItems.ts`（新） | **文本项记录表模型**：72B/条记录（`+20/+24/+28/+32/+40`）、三处 push（文本项 + 两种语音项）、组首标记（`Font[win+849]`）、两条查询扫描（"组内最后一次命中"+"下一条是组首即停"、越界保持初值） |
| `handlers/text-items.ts`（新） | `0x1BB`（SetTB 记账开关，非法值按引擎同文抛错）、`0x1D2`（push，受 `Engine[97055]` 门控）、`0x1D3`/`0x1D4`/`0x2F3`（查询 → 回写操作数）；导出 `pushVoiceRecord` 供音频族复用 |
| `handlers/audio.ts` | `0xC4`/`0x1BD`/`0x2F4` 在播语音的**同一 handler 末尾**登记语音记录（引擎 raw 29904-29908 / 30058-30062 / 33650-33654）—— 这是 `REPLAYVOICE` 能查到语音 id 的前提 |
| `handlers/msgwin.ts` | `0x7A`（对象 `[48]` 前两个 dword）、`0x25C`（13 dword 文本块）、`0x25E`/`0x25F`（颜色 + ARGB 组装）、**`0x205`（数值直绘：格式化纯函数 `formatNumberCell` + `op2` 回写 x 前进量 + 全角转换 `sub_41A6C0`）**；`0x71` 补上"组首标记" |
| `handlers/gfx-texture.ts` | `0x249`（按 id 载纹理进槽 + 已使用标记）、`0x245`/`0x246`（纹理对象参数 → 新宿主缝 `setTextureObjectFloat`/`setTextureObjectParam`） |
| `handlers/frame.ts` | `0x7B`（重显示回退游标）、**`0x199`（重显示，0x7B 的读取端；668 处，此前命中即硬报错）**、`0xAE`（存档版本分支：门控路径精确，读档 ip 表/帧装载为已登记缺口） |
| `handlers/engine-fields.ts` | `0x25A`（模式 1 = 影片；`0x25B` 的注释订正为"模式 2 由它自己写"） |
| 模型 | `Engine.textItems`（含 `0x9` teardown 复位）、`MsgObject` 新增 `block224/f256/f260/f272/f264/f268/pre48a/pre48b`、`MsgWindow.textSlotArg` 语义订正（**记账门 + 文本对象槽参数**同一字段）并在 `reset()` 里清 0 |
| 守卫 | `test/op-a2-a3.test.ts`（11 例：注册表棘轮 / 0x7B↔0x199 往返 / SetTB 三态 / 0x25A 字段 / 0xAE 门控与版本匹配 / 记录表 push+查询+组首+越界 / 语音记录与选择器 / 窗对象字段与 ARGB / 数字格式化与 x 回写 / 纹理槽与宿主缝转发） |
| 既有测试更新 | `test/adv-msgwin.test.ts` 的 0x1D2 用例改为"真实现"口径；`test/skip-unknown.test.ts` 的"纯 no-op 样本"从 `0x7A` 换成 `0xAF`（0x7A 已是真实现，3 操作数） |

**订正记录（读体推翻了文档早前的说法）**
- `0x205` 的 `op6` 位 **`bit16` 是"半角"而非"全角"**：`sub_4072F0` 在 `(flags & 0x10000) == 0` 时调
  `sub_41A6C0`（raw 25539-25593）把 ASCII 逐字转成 **SJIS 全角**（`'0'→0x82B0`、`'-'→0xA3AD`、`'+'→0xA3AB`）。
  `opcode-table.md` 该行已按此订正。
- `0x7B` 写的是**文本重显示游标**（读者 `0x199` 与主循环 raw 14001），不是"点击路由游标"
  （路由表是 `0x090` → `Engine.routes`，两回事）。
- `Engine[97055]` 是**记账门 + 文本对象槽参数**同一字段：`i1bb 0` … `i1bb 1` 成对包住"不要记账"的片段
  （典型：`SC0000.txt:1554-1560` 的语音重播 `i1bb 0; i1cf 10001; play-voice 7c; i1bf; i1bb 1`）。

## 6. A4 / A6 落地记录（2026-09，已完成）

### A6｜AGERC 模块接口（`0x14B` / `0x14C` / `0x14D`）—— 解锁存档/读档界面

| 落点 | 内容 |
|---|---|
| `handlers/agerc.ts`（新） | 三条 handler + **21 个导出的内置表**（PE 实读）+ `AGERC_FILE_ID = 0x5250` |
| `Engine.agerc`（模型） | `loaded`（= `Engine+490072` 句柄）、`exports`（`Engine[122519+slot]` 槽 0..99）、`nameLenMax`（AGERC 内 `dword_100A9000`，初值 18） |
| 语义 | `0x14B` 重载语义（已有句柄 ⇒ 卸载 + 清槽）且**只接受 AGERC.DLL**；`0x14C` 校验导出名与槽号（越界抛引擎同文）；`0x14D` 把 op3 的数组**按 DEC 读出** → 调槽 → **ENC 回写** → `op2 ← 返回值`；op5 数组原样传入 |
| `_SetNameLenMax@20` | **唯一有行为的导出**：`nameLenMax = buf[0]`（`SAVE.txt:6-9` 传 12 ⇒ 存档名/注释最多 12 全角字） |
| 其余 20 个导出 | 名字**可绑定**（真机 `GetProcAddress` 也确实成功），但**调用即抛**明确的"未建模"错误（本作不可达，静默返回 0 会更危险） |
| 缺口 | emulator 运行期没有 id→名字表（`FileSource` 是异步接口）⇒ 非 AGERC 的 id 报错里给的是 id 而非解析出的文件名 |

### A4｜图元 / 网格 / 纹理 / 渲染状态（13 条）—— 2 条建模 + 11 条宿主缝

| 落点 | 内容 |
|---|---|
| `handlers/gfx-state.ts`（新） | 13 条 handler（`GFX_STATE_OPS`，进 `OPS`） |
| **建模的两条** | `0x238` → `Engine[92338]=0` / `[92339]=op1`；`0x258` → `Engine.texSlotFlags`（bit0/bit1 两张镜像表同值，11356 处调用） |
| **宿主缝 11 条** | `native.resetPrimTransform` / `setPrimTransform4` / `blitSlotToSlot` / `commitGraphics` / `clearTransitions` / `setDrawModeBlock` / `setDrawEntryParam` / `setSlotParams` / `setMeshEntryAttr` / `release3DSlot` / `set3DColor` |
| 共享场景层 | `scene/state.ts` 新增 `render4`（记录 + 报告用）；`scene/ops.ts` 新增 11 个 `sc*`；`headlessScene` 与 `pixiBackend` **都实现**（两个宿主走同一份语义，不会漂移） |
| 判据 | 13 条**都不回写脚本操作数、不改控制流**（从 VM 视角不可观测）—— 建模/转发的意义是"渲染模型与引擎一致"+ 不再以"无依据的 no-op"出现在本台账里 |
| 缺口 | `render4` 目前只**记录**（Pixi 管线尚未逐条消费）：变换复位/槽→槽 blit/Clear/转场表/绘制模式/网格属性/3D 颜色对画面的影响待渲染器接入；3D 一族（`0x32A`/`0x321`/`0x32D`）在本作重写侧无 3D 管线 |

> 语料用量提醒：`0x258` 11356 处 / 334 个脚本、`0x238` 2056 处、`0x20E` 786 处、`0x229` 716 处 ——
> 它们**不在** TITLE→SN0000 与 CONFIG1 两条可复跑链路上（实测 0 命中），主要由场景/战斗脚本使用；
> 正确性由 `test/op-a4-a6.test.ts` 的 8 例锁定。

### 6.1 A6 之后：同一条路上的**下一个**缺口（不在本台账 57 条内）

`TITLE →「Load Data（ロード）」` 现在能跑进 `SAVE.BIN` 628 条指令（A6 之前停在 ip=2），
下一个硬报错是 **`0x1A0`**（`sub_42DC70` raw 38366-38404，argc 9）= **存档文件读取**：
`"%s\SAVE%2.2d.DAT"` → `CreateFileA` → `sub_438120(Engine+20764, hFile, Engine+382688, Engine+698912, buf)` 反序列化；
失败时 `op1 ← 1`（语料 **339 处 / 335 个脚本**）。它属"**压根没有 handler**"的 286 条，
需要另立批次（连同读档后的 `save-int`/`save-string` 表恢复）。

### A5｜单行字段 / 计时 / 音频设备 / 消息面（9 条）—— 3 条建模 + 6 条字段·意图

| 落点 | 内容 |
|---|---|
| `handlers/panel.ts`（新） | `0x91`/`0x92`（显示态开 + `sub_404020`；`0x92` 另写回退 label `[7467]`）、`0x93`（清 `effect_flags & 0x800000` + `sub_403EF0` **真正清空路由表** + toggle `12956/12957`）、`0x94`（置 `12957` + 步长/待填充 + 首次按鼠标重做命中测试）、`0x97`（**键位绑定** → `routes.bindKeyBit`；★2026-09 订正：旧的「填矩形 → 宿主缝 `native.fillPanelRect`」语义是错的，该直通链路已删） |
| `handlers/engine-fields.ts` | `0xD9`（清 `effect_flags & 0x1000`，派发中时同清 `95779`）、`0xAD`（**秒计时器**：`_this[5449] ← timeGetTime/1000`，用 `BigInt` 复刻 `274877907 * t >> 38` 的定点算术）、`0x1AD`（`_this[166963] = cur`，**1100 处**）、`0x1B1`（`_this[21672] = op1`） |
| `handlers/audio.ts` | `0x1BC`（清语音通道状态位 `21315..21320` + 寄存槽 `122501`/`122505..122510` + 对 3 个通道发 `voice-reset`，**213 处**）、`0x1C9`（音频设备初始化：写 `18656`/`18660`；驱动装载=已登记缺口） |
| 守卫 | `test/op-a5.test.ts`（11 例：注册表棘轮 / 面板复位与 toggle / 步长与命中测试 / **键位绑定** / 显示态 0x91+0x92 / 清位 / 秒计时器 BigInt 算术 / 字段写 / 语音清理意图 / 设备参数 / 不写操作数） |
| 既有测试更新 | `test/game-start-chain.test.ts` 的棘轮：本链路采集到的 25 条（9 + A4 9 + A5 7）**全部**已转真实现 ⇒ 该链路不再有任何 `ENGINE_INTERNAL_OPS` |

**这一批的意义**：A5 的 9 条**都不回写操作数**（属"单行字段写"），但从"无依据的 no-op"变成了
**有依据的字段写 / 意图下发**；其中 `0x1AD`（1100 处）与 `0x1BC`（213 处）在本体脚本里用量最大。
