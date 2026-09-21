# T-0076 · 过程文档（changes.md）

## 2026-09-19

续跑第 1 轮（2026-09，subagent 并行）——B3 筛体 + 首批落地。

### 1. B3 逐条筛体（32 条，排除 0x24f/0x250/0x251 并行处理）
- 新文档 `docs-new/99-records/2026-09-b3/b3-screening-2026-09.md`：32 条逐条读体 → **可实现 13 条 / deferred 19 条**（其中 9 条标「需新模型」，含于 deferred）。
- `analysis/opcode-gaps.json`：25 条改 `deferred` 并逐条追加「★筛体(2026-09)：…」扩展点 note（含此前 6 条同族）。
- 台账：未实现 **35（语料 203）→ 13（语料 65）**；已实现 14 → 19。

### 2. 本轮落地（全部按引擎体，带守卫）
- **`0x24f`/`0x250`/`0x251`（argc 10/10/12）** = `Scene+1048` 转场记录表（96B = 24 dword，键 = op1）的写入端：SetBlindWipe / SlideBlur / ZoomBlur。写了 `[0]` 类别、`[2]` 延迟、`[3]` 时长、`[13]` 效果类别等；两条边界**方向相反**（类型非法 ⇒ 不写记录；分割宽度 < 1 ⇒ 就地改成 (1,0,0,-1) 后照写）。消费端 = 帧渲染器 `sub_4B06D0` 的转场窗（raw 134856-136321）。
  改动：`handlers/gfx-state.ts`、新宿主缝 `native.setTransition(id, writes)`（`native.ts`/`nativeTap.ts` + 两宿主对称）、`renderer/scene/{state,ops,snapshot}.ts`（`scClearTransitions` 按 `sub_4A9BE0` raw 129282-129302 改为**真 clear()**）、新测试 `test/op-24f-250-251-transitions.test.ts`（8 条）。
- **`0x1ba`（argc 2）** = `SetSoundMode` = **按类别的声音开关**（音乐/SE/语音/影片；a2 = 0 关 / 非 0 开）。★**订正**：台账旧注「音频属性档位」是错的；与 `0xBC` 的唯一差别是 a2 传 op2 原值。
- **`0xc1`（argc 0）** = **BGM 暂停/继续切换**（翻转 `Music[260]` → 后端 vtable+12 的 `SetPause(bool)`）。★**订正**：台账旧注「静音/启用开关」是错的。
  改动：`handlers/audio.ts`（+2 handler + 抽 4 段共用体）、`engineFieldIds.ts`（`musicPaused:174714`）、`audio/audioEngine.ts`（`bgm-pause` 意图）、`renderer/audio/webAudioHost.ts`（`setPaused`）、`test/audio-opcodes.test.ts`+`test/audio-engine.test.ts`+`test/fakeAudioHost.ts`。

### 3. bit2 族语义已定（规格文档，供下一轮实现）
- 新文档 `docs-new/99-records/2026-09-b3/b3-bit2-model-spec-2026-09.md`：**bit2 = 「本绘制项已挂 B 族周期/循环动画层」**。
- ★台账旧结论**方向反了**：`+536/+556/+560/+568/+572` 不是「bit2 的消费端」，它们就是**窗字段本身**；bit2 全反编译**唯一读取点**是渲染器 `sub_4AEEA0` raw 133390（`(flags & 4) == 0 ⇒ 跳过整层`），求值 `sub_49BCC0`（raw 117944-118365）分 5 通道（颜色/缩放/旋转/平移往复 + 贴图换格）。
- 实现硬前置：`src/vm/native.ts` 的 `KNOWN_DRAW_ITEM_FLAGS` 需由 `0b011` 扩成 `0b111`；bit2 **不进 wait 门**（`itemAnimationsPending` 不该被它变真）。
- 三条 handler 订正：`0x230`→`sub_4AD580`（唯一走它的），`0x231`→`sub_4AD690`，`0x235`→`sub_4AD900`（旧注「族共用 sub_4AD580」错）。

### 4. 收口
- `npm run verify`：**675 tests / 674 pass / 1 skip / 0 fail**；死写 0。
- 顺手修一条源码棘轮：`test/headless-needs-render.test.ts` 的只读 `sc*` 白名单加 `scTransitionDefaultRecord`（纯工厂，不碰 SceneState）。
- 待办（下一轮）：13 条可实现指令接线（0x230-0x235 窗族 6 条、0x22a/0x22c/0x22d/0x22f 立即变换 4 条、0x132/0x133/0x134 队列 3 条、0xd0、0x1c4、0x23a）；4 条 `engine-internal-unjustified` 收口；路线 C 字形度量（0x1d0/0x1d1）。

## 2026-09-19

续跑第 2 轮（2026-09，subagent 并行 6 路）——B3 主体接线 + 第一层回填 + 漏读存量清尾。

### 1. 「未实现」从 35 降到 6
- **队列族** `0x132`/`0x133`/`0x134`（通用 `Queue_int` 重建/push/pop，容器 = `Engine+258` 起的 11 个队列）+ **`0xd0`**（墙钟 ms）⇒ `CONTROL_OPS`/`ENGINE_FIELD_OPS` + `Engine.dispatchQueues`；守卫 `test/op-132-134-queue.test.ts`(8)、`test/op-d0-wallclock.test.ts`(4)。
  ★**订正**：筛体/实现方案里写的 `Engine.wallClockMs` **在工程里不存在**（全仓无此标识符）；`timeGetTime()` 的既有等价物是 **`Engine.nowMs`** ⇒ 不新增同义字段（已写回 `b3-screening-2026-09.md` §2.4）。
- **bit2 动画窗族 6 条 + `0x244`**（合计语料最大的一族）：`0x230`→`op_reset_draw_item_loop`、`0x231`→`op_set_flipbook_loop`、`0x232`→`op_set_color_loop`、`0x233`→`op_set_scale_loop`、`0x234`→`op_set_rotation_loop`、`0x235`→`op_set_translation_loop`、`0x244`→`op_clear_draw_item_anim_starts`（从 `ENGINE_INTERNAL_OPS` 移出）。
  新宿主缝 **2 个**（`native.setDrawItemLoop` 判别联合承载 0x230-0x235 / `clearDrawItemAnimStarts`，五处同步）；`KNOWN_DRAW_ITEM_FLAGS` `0b011 → 0b111`（否则 bit2 一置即抛 `UnknownFlagError`）；B 层 5 通道求值进 `drawitem/eval.ts`；bit2 **不进 wait 门**（`itemAnimationsPending` 不受它影响）。守卫 `test/draw-item-loop-anim.test.ts`(14)。
  ★**7 处以体订正筛体方案**（已写成 `b3-screening-2026-09.md` §6，并同步 `opcode-table.md` 行内与台账 note）：`0x234` 是**旋转**不是平移、`0x235` 是平移往复不是 flipbook、`0x231` 是换格循环不是旋转、`0x230` 只清 {540,544,548,552,556,560} 且**不置脏**、`0x232` 的 +576 ≠ `0x202` 的 +100、`+524..+536` 是**起点锁存槽**不是 delay、`0x230` 是族里**唯一不置脏**的。
- **`engine-internal-unjustified` 清零（4 → 0）**：`0x10c`（写 VK→掩码位表，emulator 无键码表/VK 表 ⇒ 有据跳过，note 钉「T-0052 落地后必须移进 OPS」）、`0x324`/`0x325`（Effect3D 释放/销毁判据，emulator 无 3D 效果子系统 ⇒ 有据 no-op）、`0x244`（已实现）。★订正两处旧 raw 引用（0x324 的 34000-34012 → 65367-65393；0x325 → 65890-65908）。

### 2. 第一层回填（`analysis/functions.json` + `fields.json`）
- 新增 **`Engine 0x5D8F4 frames[].len_slot`**（stride 0x78）：每条指令写的指令长度槽 `N = 2*argc+1`（B2 计划层要用它自动核验 argc）；偏移/步长经 `sub_41A160`（`15*cur`）等样本独立复核。
- 新增 18 条函数（bit2 族 6 handler + 6 setter + 转场 3 handler + 3 记录函数，全部 `ANALYZED`）+ 5 条支撑函数 + 53 条字段（新作用域 `Layer`、`TransitionRecord`）；唯一 `PARTIAL` = `0x4A2C10`。
- ★**随后被实现轮订正**：`DrawItem/0x244..0x24C` 原记为「平移窗目标位移 XYZ」是误 —— 消费端 raw 118228 是 `D3DXMatrixRotationAxis` ⇒ 那是**旋转轴**；字段已更名为 `rot_win_start`/`rot_win_dur`/`rot_win_axis`，`sub_4AD850` 更名 `sceneAnimRotateWindow_4AD850`、`0x4245B0` 更名 `op_anim_rotate_window_4245B0`（全库已无 `trans_win_*` 残留）。

### 3. `ALLOW_UNDERRUN` 漏读存量清尾（27 → 26 条，「确认是 bug」子节 6 → 1）
- **`0x1f9`**：按体补读 op3（颜色）+ 归一化 ⇒ **删掉白名单条目**（删后守卫仍绿 = 修复的机械判据）；守卫 `test/op-underun-fixups.test.ts`。
- **`0x1d3`/`0x1d4`/`0x2f3`**：核体确认 op3/op4 是**引擎自己的死读**（形参在 `sub_457960`/`sub_457A20` 全函数体不出现）⇒ 移入新分节「核体后有据豁免」，带 raw 证据。
- **`0x33f`**：引擎**三格全读**（op2=α、op3=色，负值取绘制项当前 α/色 ⇒ `Scene+1264` 效果常量），但 emulator 缺这两样模型 ⇒ 保留 + 理由改写为「缺消费端 + 回链 `T-0017`」。
- **`0x249`**（同族同病，新开 **T-0086**，已 done）：抽 `normalizeTextureColor` 与 0x1f9 共用，去掉「负值不下发 + 正值原样透传」。★票面原写「`0x80123456 ⇒ 0xFF123456`」**是错的** —— 该值在 i32 域上是负数 ⇒ 引擎给 0（`.lst` 的 `sar ecx,10h` 佐证），已订正 acceptance 并单列断言。

### 4. 路线 C 的前提被推翻（新票 T-0085）
- `0x1d0`/`0x1d1` **都不是**「GDI 文本度量族」：`0x1d0` = **回看页索引表·带步数读出**（`sub_459860` raw 70629-70724，**零 GDI / 零字体**；op1 = 页窗口号、op2 = 该页在记录表的起始下标，失败 `-1/-1`）；`0x1d1` = **回看页重绘**（`sub_4675A0` raw 80312-81522，1210 行 GDI 文本页渲染器）。
- 真正的 `GetTextExtent` 缺口在 **`set:BlankExtentMode`**（`sub_404EE0` raw 10716-10739；配置项已注册但 emulator 无人读它）⇒ 新票 **T-0085**；两条保持 `deferred`，附判定棘轮 `test/op-1d0-1d1-text-metrics.test.ts`（4 tests，含「有人真实现后请把 ①③ 改成真行为断言」的指示）。

### 5. 派生票据与收口
- **T-0060 done**：真槽续跑链不再命中 `0x231`（诊断从「最高频 0x231@RESETREIGNAN.BIN×333434」变为「被跳过的未实现 opcode 0 个」，轨迹 REIGN.BIN → SETADVFLAG.BIN → SETGARDEN.BIN 正常推进）。
- **T-0084 新开**：转场记录表已忠实落地，但渲染端扫描带（`sub_4B06D0` 转场窗 raw 134856-136321）未实现 ⇒ 画面看不到转场（静默缺失）。
- **T-0086 done**（0x249 归一化）。
- 基线：`npm run verify` 在轮 2 中途为 **675 → 711 tests / 710 pass / 1 skip / 0 fail**，死写 0。
- 待到轮 3 收口：最后 6 条（`0x22a`/`0x22c`/`0x22d`/`0x22f`/`0x1c4`/`0x23a`）；第二层补「bit2 B 族逐帧求值」与「`set:BlankExtentMode` 门」；缺口台账生成器工具修复（`deferred` 节在 md 里不可见 / `counts` 无工具维护）。

## 2026-09-19

续跑第 3 轮 + 收口（2026-09，subagent）——**B3 缺口清零**与两处工具修复。

### 1. 最后 6 条：全部按纪律归 `deferred`（有据，无造假实现）
| opcode | argc | 体内真实行为（raw） | 扩展点 |
|---|---|---|---|
| `0x22a` | 3 | 三条 float 各 ÷100 → `sub_49A720` = `Scene[306]=1` + `D3DXMatrixScaling(Scene+307)`（raw 32003-32016 / 117117-117126） | Scene 变换锚 + presenter 20..29 层合成级 |
| `0x22c` | 3 | 三条 float **不除** → `sub_49A820` = `Scene[306]=1` + `D3DXMatrixTranslation(Scene+371)`（32034-32046 / 117153-117162） | 同上 |
| `0x22d` | 5 | op1/op2 int（落 `Scene[295]/[300]`）、op3/4/5 ÷100 → `sub_49A870` = `[280]\|=2`/`[293]=0` + `D3DXMatrixScaling(Scene+323)`（32048-32064 / 117165-117179） | 同上 |
| `0x22f` | 5 | op1/op2 int（落 `Scene[297]/[302]`）、op3/4/5 轴 float 不除 → `sub_49A9C0` = **`D3DXMatrixTranslation(Scene+387)`**（32087-32103 / 117222-117236） | 同上 |
| `0x1c4` | 1 | ★**归口整条错**：不是「场景层是否已挂项」，而是 **语音总线占线查询**（`Engine+84128` = 语音对象；`sub_404CB0` raw 10583-10598 判 3 通道 `flags&3==3`） | 音频侧对外回读缝（`NativeBridge` 只有 intent 方向，VM/音频跨进程） |
| `0x23a` | 2 | `_this[op2 + 91322]` 缺项 ⇒ 0，否则 `v2[+1068] != 0`（39990-40001） | 先确证 91322 表元素类型（仅 2 处读、**无写点**；与 94672 的 L2D 槽表**不是**同一张）+ 建 `+1068` 状态格与消费者 |

**以体订正筛体 6 处**：① `0x22a`/`0x22c` 的「op1 = handle」与体不符（三条读全在 float 池、体内无 handle 查表）；② `0x22d` 的 op1/op2 是 int 不是 handle；③ `0x22f` 被调体是 `+387 + MatrixTranslation`（不是筛体写的 `+323 + MatrixScaling`，那属 `0x22d`）⇒ 两条**不是**"缩放 vs 旋转"对照；④ `0x1c4` 归口整条错（见上）；⑤ `0x23a` 的「91322 == 94672 同族」**未获确证**；⑥ 四条 Scene 变换的**真实消费端**（筛体未给）：`sub_4A1E90` raw 122130-122157 → `sub_49AA30` → 合成 `Scene 世界矩阵 Scene+46600` → RenderScene raw 133407 **只乘进层号 ∈ [20,30) 的项**（判据 raw 133403-133405）。

### 2. 工具修复（两处"静默"，均用注入漂移反证）
1. **`counts` 工具化**：`analysis/opcode-gaps.json` 的 `counts` 原为**手写** ⇒ 本轮实测漂移（声明 `deferred 25 / unimplemented 6` vs 实际 `31 / 0`）且无人发现。现在 `scripts/build-opcode-gaps.mjs` **重算并回填**（定点文本替换，不翻新格式）；只读模式把漂移报成 problem ⇒ `test/opcode-gaps.test.ts` 会红（已反证：注入漂移 → 守卫 1 fail；还原 → 全绿）。
2. **`--check` 真失败**：早前 `gaps:check` 只打印 `✗` 仍 `exit 0`（假"通过"）。现在 md 陈旧与 counts 漂移**都 exit 1**（已反证）。
3. **md 新增 §6 deferred 段**：此前 31 条 deferred 在生成物里**完全不可见**（只活在 JSON），正是「不静默跳过」纪律的漏洞（C 在 `T-0081` notes 里报的）。
4. **`capabilities.js --validate` 补类型检查**：`--set emulator.note=a, b` 会把值按 ASCII 逗号拆成**数组**，而旧 validate 只查语义 ⇒ 数组型 note 一路"校验通过"，直到守卫测试才炸。现在 validate 直接报「必须是字符串」（已反证）。

### 3. 收口状态
- 缺口台账：**未实现 0（语料 0）/ unjustified 0 / 有据 no-op 8 / 已实现 30 / deferred 31**（69 条）。
- 能力台账（第二层）：**132 条**（已核验 47 / 未建模未核验 7 / 部分 32 / 缺失 22 / n/a 24）。本轮新增/订正 3 条：`drawitem-loop-anim-frame-drive`（新，partial/E2）、`text-blank-extent-mode-gate`（新，absent/E1，T-0085）、`clock-read-transition-window`（absent → **partial**/E2，记录表已建模、扫描带仍缺 ⇒ T-0084）。
- 第一层：`Engine 0x5D8F4 frames[].len_slot`（`N = 2*argc+1`）已建模；并把 `DrawItem 0x244..0x24C` 由「平移窗目标位移」**订正为旋转轴**（`rot_win_axis`），`trans_win_*` 全库清零。
- 票据：**86 张**（doing 4 / open 19 / done 62 / dropped 1）。本轮 `T-0060`、`T-0086` 收口，`T-0084`/`T-0085` 新开；`tickets/` 的 evidence 行号漂移警告已清零。
- `npm run verify`：**722 tests / 721 pass / 1 skip / 0 fail**，死写 0。
- 批次总账与交接：`plan-2026-09.md` **§2d**（本轮）+ `handoff.md` 已整体刷新；`audit-2026-09.md` §6 已补本轮两行并订正「B3 剩余」段。

## 2026-09-20

### 订正（轮 4，subagent）：上一轮「Scene 级变换四条」的消费端读法有误

第 3 轮记录里我写了「四条 Scene 变换的真实消费端 …… RenderScene raw 133407 **只乘进层号 ∈ [20,30) 的项**（判据 raw 133403-133405）」—— **层号门的读法记反了**。轮 4 读体订正：

- RenderScene raw 133403 的 `if` 判据是 **`(unsigned)(layer − 20) > 9`** ⇒ **落在区间外**的项拿**完整** Scene 世界矩阵；
- **真正只作用于 20..29 层的是同一处的 `else` 支**（raw 133411-133438）：`D3DXMatrixDecompose` 后**只把 2D 缩放与平移**装回 work 矩阵。
- 另：`0x22f` 的被调体确证是 **`D3DXMatrixTranslation(Scene+387)`**（raw 117232），`+323`/`D3DXMatrixScaling` 属 `0x22d` —— 筛体把两条的被调体记混。

⇒ 结果：这 4 条已从 `deferred` 转 **implemented**（`op_scene_scale`/`op_scene_translation`/`op_scene_axis_scale`/`op_scene_axis_translation`；新宿主缝 4 条五处同步；`SceneState.sceneXform` + presenter 归并循环三路消费；守卫 `test/op-22a-22f-scene-world.test.ts`(13) 与 `test/op-22a-22f-scene-xform.test.ts`(12，判定棘轮已按文件头指示翻转)）。台账：`implemented` 30 → **34**、`deferred` 31 → **27**。

**教训**（已写进 `handoff.md` 纪律 3）：筛体/规格文档的推断是线索不是结论；本轮四条里就有 1 处「门读反」+ 1 处「被调体记混」，都是读体才纠正的。
