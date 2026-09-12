# 引擎「常态能力」台账（第二层）

> 由 `analysis/engine-capabilities.json` 生成：`node scripts/build-capabilities.mjs`。
> 这些能力**无法靠枚举 opcode 发现**：它们是引擎自己的逐帧流程与各子系统的持续行为，
> 缺失时**不会报错、只会表现不对**（例如版权页文字不淡入 ⇒ 才发现缺了逐帧颜色插值）。
> 因此单列一张可核对清单 —— **出现症状时先查这里**，避免每次从零研究。
>
> `emulator` 列的判定口径见下；`E0–E4` 是证据等级（E0 未读体 / E1 已读体 / E2 合成单测 / E3 场景断言 / E4 真机对照）。

## 统计

| 状态 | 条数 | 含义 |
|---|---|---|
| `modeled-verified` | 21 | 已建模且有守卫（E2/E3） |
| `modeled-unverified` | 7 | 已建模但只有静态结论（E1）或缺少守卫 |
| `partial` | 21 | 只实现了一部分（缺口写在该条 note） |
| `absent` | 23 | 引擎有、emulator 完全没有 |
| `n/a-known` | 25 | 与本 2D 精灵 + 消息窗重写无关（必须写 why） |
| **合计** | **97** | 需要关注（非 n/a 且非已核验）= **51** |

## 按子系统

| 子系统 | 条数 | 其中 缺失/部分 |
|---|---|---|
| 3D | 15 | 1 |
| Live2D | 2 | 2 |
| 声音 | 5 | 1 |
| 帧循环 | 13 | 8 |
| 消息窗 | 22 | 15 |
| 渲染 | 23 | 11 |
| 资源 | 11 | 2 |
| 转场 | 4 | 4 |
| 输入 | 2 | 0 |

## 全部条目

| id | 子系统 | 能力 | emulator | 依据 / 守卫 |
|---|---|---|---|---|
| `frame-pump-sound-channels` | 声音 | 每帧声音通道老化 | ✅ 已核验 | E2 · `test/audio-engine.test.ts` |
| `frame-pump-input-refresh` | 输入 | 每帧输入态刷新 | 🟡 已建模未核验 | E1 · `test/input.test.ts` |
| `frame-pump-music-fade` | 声音 | 每帧 BGM 淡出推进 | ✅ 已核验 | E2 · `test/audio-engine.test.ts` |
| `frame-render-gate-mainloop` | 帧循环 | 主循环帧提交门控 | 🟡 已建模未核验 | E1 |
| `scene-frame-commit` | 渲染 | Scene 逐帧提交（四路归并 + 绘制） | 🟠 部分 | E2 · `test/draw-item-slot-coverage.test.ts` |
| `scene-beginscene-recursion-gate` | 渲染 | BeginScene/EndScene 递归门 | ➖ n/a | E1 |
| `scene-frame-texture-gate-46672` | 3D | 帧纹理（离屏表面）指针门 | ➖ n/a | E1 |
| `scene-framebuffer-offset-compensate-46696` | 渲染 | 双缓冲显示偏移补偿开关 | ➖ n/a | E1 |
| `scene-capture-target-flag-46680` | 渲染 | Capture 目标为主/后缓冲（38 号）标记 | ➖ n/a | E1 |
| `scene-render-3d-frame-request-46700` | 3D | 请求显式渲染一帧 3D | ➖ n/a | E1 |
| `scene-3d-effect-level-writer` | 3D | 3D 效果等级的初始化决策 | ➖ n/a | E1 |
| `scene-dirty-flag-lifecycle` | 帧循环 | Scene+46508 「本帧需要重画」脏标志 | 🟠 部分 | E1 |
| `scene-freeze-flag` | 帧循环 | Scene+46512 动画强制冻结 | ❌ 缺失 | E0 |
| `scene-pending-flag-0x400-gate` | 转场 | Scene+46516 转场/等待在途标志（0x400 卫门值） | 🟠 部分 | E3 · `test/scene-report.test.ts` |
| `scene-flag-46528-bits` | 帧循环 | Scene+46528 bit1/bit2 冻结豁免 | ❌ 缺失 | E0 |
| `scene-norender-mode` | 渲染 | Engine+167990 无渲染/隐藏窗口模式 | 🟠 部分 | E1 · `test/engine-config.test.ts` |
| `3d-effect-level-gate` | 3D | Scene+46668 3D 特效等级 | ➖ n/a | E1 |
| `scene-render-freeze-46676` | 渲染 | Scene+46676 3D/文字渲染冻结总闸 | ❌ 缺失 | E0 |
| `engine-main-window-hwnd` | 渲染 | Engine+387924 主窗口 HWND（旧名 FileSource） | ➖ n/a | E1 |
| `filesource-script-load` | 资源 | 脚本装载把主窗口 HWND 当资源来源传入 | ➖ n/a | E1 · `test/boot.test.ts` |
| `scene-draw-total-gate-1056` | 渲染 | Scene+1056 主绘制总门 | ❌ 缺失 | E0 |
| `clock-write-clock-freeze` | 帧循环 | 每帧时钟写入与时钟冻结门 | 🟠 部分 | E2 · `test/ops-cg-digit-clock.test.ts` |
| `clock-read-drawitem-5-windows` | 渲染 | DrawItem 5 窗动画驱动（透明度 / 旋转×2 / 轴角 / UV） | ✅ 已核验 | E3 · `test/draw-item-anim-window.test.ts` |
| `clock-read-meshentry-color-window` | 渲染 | MeshEntry 颜色/α 动画窗 | 🟠 部分 | E1 |
| `clock-read-transition-window` | 转场 | 转场窗口进度与扫描带绘制 | ❌ 缺失 | E0 |
| `render-range-clip-by-index` | 渲染 | 按索引区间的绘制范围裁剪 | ❌ 缺失 | E0 |
| `render-merge-two-pass-reorder` | 渲染 | 四路归并（DrawItem/MeshEntry/两 572B 节点）与 |0x10000 回置 | 🟠 部分 | E2 · `test/draw-item-slot-coverage.test.ts` |
| `render-3d-layer-dual-commit` | 3D | 3D 层对偶逐帧提交 | ➖ n/a | E1 |
| `render-endscene-and-2d-stack` | 渲染 | 2D 矩阵栈 Begin/End 配对与 EndScene | ➖ n/a | E1 |
| `transition-table-flush` | 转场 | 转场表帧尾收尾（sub_4A9BE0） | ❌ 缺失 | E0 |
| `lazy-effect-200-201-release` | 3D | 2D/3D effect 槽（46480 起 5 槽）的批量释放 | ➖ n/a | E1 |
| `renderer-state-reset-each-frame` | 渲染 | 渲染态重置（sub_498B60） | ➖ n/a | E1 |
| `audio-device-init` | 声音 | DirectSound 设备/对象重建 | 🟠 部分 | E2 · `test/audio-engine.test.ts` |
| `movie-object-lifecycle` | 帧循环 | 电影对象帧内生命周期 | ❌ 缺失 | E0 |
| `scene-drawtable-flush-and-dirty` | 渲染 | 清空绘制节点并置脏（opcode 侧） | 🟡 已建模未核验 | E1 · `test/scene-report.test.ts` |
| `script-queue-dispatch` | 帧循环 | 脚本派发队列出队 | ❌ 缺失 | E0 |
| `script-frame-refresh-opcode-20c` | 帧循环 | opcode 0x20C 脚本帧刷新并提交 | ✅ 已核验 | E2 · `test/engine-config.test.ts` |
| `live2d-slot-probe` | Live2D | Live2D 10 槽探测（强制重画理由之一） | ❌ 缺失 | E0 |
| `vertex-buffer-lock-scale` | 渲染 | 顶点缓冲 Lock/Unlock + 视口缩放改写 | ❌ 缺失 | E0 |
| `world-matrix-identity-refresh` | 3D | 每帧世界/投影矩阵复位与链乘 | 🟠 部分 | E2 · `test/draw-item-anim-window.test.ts` |
| `sprite-2d-draw-layer` | 渲染 | 无脚本/标题态额外 2D 层绘制 | ❌ 缺失 | E0 |
| `scene-slot-release-1000` | 渲染 | 1000 个场景对象槽的逐帧老化释放 | 🟠 部分 | E1 |
| `lazy-effect-200-201` | 3D | 惰性创建 2D/3D effect（资源 200/201） | ➖ n/a | E1 |
| `lazy-3d-effect-203` | 3D | 惰性创建 3D effect（资源 203） | ➖ n/a | E1 |
| `lazy-3d-effect-202-snow` | 3D | 惰性创建 3D effect（资源 202，雪花） | ➖ n/a | E1 |
| `lazy-sprite-recreate` | 渲染 | CSprite 释放后重建 | ➖ n/a | E1 |
| `lazy-d3d9-device-init` | 渲染 | D3D9 对象与设备的释放-重建 | ➖ n/a | E1 |
| `lazy-texture-slot` | 资源 | CTexture 槽（1000）释放-重建 | 🟡 已建模未核验 | E2 · `test/texture-slot-resolve.test.ts` |
| `lazy-mesh-slot` | 3D | mesh 槽（1000）释放-重建 + 惰性分配器单例 | ➖ n/a | E1 |
| `lazy-mesh-alloc-hierarchy-singleton` | 3D | D3DX 网格加载分配器单例 | ➖ n/a | E1 |
| `lazy-live2d-slot` | Live2D | Live2D 槽（10）释放-重建 | ❌ 缺失 | E0 |
| `lazy-vram-query-32` | 资源 | 显存容量查询惰性缓存（32 位） | ➖ n/a | E1 |
| `lazy-vram-query-64` | 资源 | 显存容量查询惰性缓存（64 位 QWORD） | ➖ n/a | E1 |
| `lazy-movie-object` | 帧循环 | 电影对象按显示模式创建 | ❌ 缺失 | E0 |
| `lazy-movie-dll` | 资源 | 电影解码 DLL 重载与函数指针惰性解析 | ❌ 缺失 | E0 |
| `lazy-movie-texture-slot` | 资源 | 电影纹理槽（每索引）惰性创建 | ❌ 缺失 | E0 |
| `lazy-gdi-font-set` | 消息窗 | 消息窗字体句柄组的重建（主/注音两套，CreateFontIndirectA ×8 / ×4） | ❌ 缺失 | E0 |
| `lazy-script-operand-hashmap-node` | 资源 | 脚本 VM 操作数 HashMap 节点惰性分配 | 🟡 已建模未核验 | E1 · `test/xval.test.ts` |
| `lazy-transition-map-node` | 转场 | 过渡表节点惰性插入（表头 eager） | ❌ 缺失 | E0 |
| `lazy-drawitem-map-node` | 渲染 | DrawItem 表节点惰性插入（表头 eager 130312） | ✅ 已核验 | E3 · `test/draw-item-anim-window.test.ts` |
| `lazy-mesh-map-node` | 3D | MeshEntry 表节点惰性插入（表头 eager 130348） | 🟡 已建模未核验 | E1 |
| `lazy-572b-node-map` | 渲染 | 572B 节点表（精灵/特效）惰性插入（表头 eager 130366/130384） | ❌ 缺失 | E0 |
| `lazy-scene-effect-release-gap` | 3D | Scene+46492 / +46496 两张 effect 的释放缺口 | ➖ n/a | E1 |
| `bullet-dirty-from-freeze-or-pending` | 帧循环 | 冻结/pending 强制延续刷帧 | 🟠 部分 | E1 |
| `chained-3d-layer-commit` | 3D | 3D 场景层四路归并与扫描带绘制 | ➖ n/a | E1 |
| `adv-flag-lifecycle` | 消息窗 | ADV 激活位（effect_flags 0x8000000）的设置与清除 | 🟠 部分 | E2 · `test/adv-msgwin.test.ts` |
| `adv-perframe-dispatch` | 帧循环 | ADV 激活时的每帧处理：派发 1 条脚本指令 + 输入泵 | ✅ 已核验 | E2 · `test/adv-msgwin.test.ts` |
| `adv-text-reveal-progress` | 消息窗 | 消息文本显示进度判定（ReadTextSkip 门 + 分段表查表） | 🟠 部分 | E2 · `test/adv-msgwin.test.ts` |
| `msgwin-text-object` | 消息窗 | 文本对象（Engine+85296，dword 写法 Engine[21324]）的槽模型与排版入队 | 🟠 部分 | E2 · `test/adv-msgwin.test.ts` |
| `adv-input-pump-perframe` | 输入 | ADV 每帧输入泵与「跳读中」掩码位 | 🟡 已建模未核验 | E1 · `test/input.test.ts` |
| `msgwin-object-table` | 消息窗 | 消息窗对象表与布局重算（Engine[21585+idx]） | 🟠 部分 | E2 · `test/adv-msgwin.test.ts` |
| `msgwin-cancel-key-state` | 消息窗 | 「取消消息键」三态机（Engine+122370）与 ReadTextSkip 的运行期开关 | 🟠 部分 | E2 · `test/adv-msgwin.test.ts` |
| `adv-advance-opcodes` | 消息窗 | ADV 推进指令族（0x6E / 0x72 / 0xFA / 0x1CA）—— 属**指令集**，非每帧行为 | ✅ 已核验 | E2 · `test/adv-msgwin.test.ts` |
| `msgwin-text-method-opcodes` | 消息窗 | 文本子系统方法转发指令族（约 25 条）—— 属**指令集** | 🟠 部分 | E2 · `test/adv-msgwin.test.ts` |
| `msgwin-attr-font-opcodes` | 消息窗 | 文本属性 / 描边 / 字体 / 注音指令族（0x75/0x76/0x77/0x78/0x81/0x8B/0x1A4/0x197/0x1A5/0x2BD/0x2BE/0x2DB/0x2FE/0x196 等）—— 属**指令集** | 🟠 部分 | E2 · `test/adv-msgwin.test.ts` |
| `adv-advance-route-table` | 消息窗 | 点击热点 / 路由表（Engine+0x55D8）与「推进」的真实判据 | 🟠 部分 | E2 · `test/adv-msgwin.test.ts` |
| `msgwin-config-gates` | 消息窗 | 消息/ADV 路径上的配置门与「当前走不到的分支」 | 🟠 部分 | E3 · `test/config1-chain.test.ts` |
| `msgwin-config-read-opcodes` | 消息窗 | 配置回读指令族（0xC5/0xC7/0x1B8/0x2CC/0x2E6/0x2EA/0x194）—— 属**指令集** | ✅ 已核验 | E2 · `test/config-read.test.ts` |
| `text-layout-wrap-ruby` | 消息窗 | 文本排版：逐字像素量宽 + 边界硬断 + 注音配对（sub_46BE30） | ❌ 缺失 | E0 |
| `text-reveal-pump-409400` | 帧循环 | 逐字显现泵：sub_409400 自旋 + sub_45BE20 一次一个字 + message:MessageSpeed 节拍（每字毫秒） | ✅ 已核验 | E3 · `test/adv-msgwin.test.ts` |
| `msgwin-offscreen-surface-lifecycle` | 消息窗 | 每窗一张离屏表面：0x70 重建 / 0x71 清底 / sub_45BE20 逐行贴出 | ❌ 缺失 | E0 |
| `msgwin-line-fade-window` | 消息窗 | 行淡入：DrawItem 颜色动画窗，时长 = MessageSpeed × MessageFade / 100 ms | 🟠 部分 | E2 · `test/draw-item-anim-window.test.ts` |
| `msgwin-backlog-cursor` | 消息窗 | 已读文本回看：页表 Font+3380 + 72B 回看项 + 光标 sub_459770 | ❌ 缺失 | E0 |
| `text-drawmode-fork` | 消息窗 | set:DrawMode 双路径：0 = GDI 整串 TextOutA / 1 = D3DX 逐字 GetGlyphOutline | ➖ n/a | E1 |
| `text-font-rebuild-cascade` | 消息窗 | 字体参数 → 句柄重建级联（0x75/0x197/0x1A5/0x2FE/0x2BD/0x2BE/0x2DB → sub_459F40 / sub_45A6E0） | ❌ 缺失 | E0 |
| `msgwin-window-reveal-gate-300` | 消息窗 | 每窗「逐行贴出」闸门 + 贴出完成后的延时清场循环（Engine[122466+win] bit0/bit16、Engine[122476+win]；op 0x300 = sub_426990） | ✅ 已核验 | E2 · `test/char-reveal.test.ts` |
| `msgwin-char-reveal-grid` | 消息窗 | 字格逐字显现（引擎逐字渲染的真实机制）：0x73 设字格与节拍 → 0x72 武装 → 主循环每节拍贴出第 k 格（raw 20887-20895 + sub_45A940） | ✅ 已核验 | E2 · `test/char-reveal.test.ts` |
| `gfx-texture-load-sync` | 资源 | 纹理加载的同步性：set-texture(0x1F9) 在同一指令内完成 读文件 + 解码 + 装槽 ⇒ 同帧「绑定 + 绘制」不可能错位 | ✅ 已核验 | E2 · `test/texture-frame-barrier.test.ts` |
| `drawitem-world-matrix-composition` | 渲染 | DrawItem 世界矩阵合成（pivot 夹逼 + work 缩放/旋转/平移）与 `+0x68` 用世界矩阵门 | ✅ 已核验 | E2 · `test/draw-item-scale.test.ts` |
| `gdi-direct-text-to-slot` | 消息窗 | GDI 整串直绘到纹理槽（0x204 draw-string → sub_456710） | ✅ 已核验 | E2 · `test/draw-string.test.ts` |
| `script-frame-local-pool-lifecycle` | 帧循环 | 脚本帧局部池的生命周期：每次载入重建（`sub_40ED40` 建池 + local_int 填 enc_zero） | ✅ 已核验 | E3 · `test/config1-chain.test.ts` |
| `text-style-scope-queue-time` | 消息窗 | 文本样式的**消费时机与作用域**：排版入队时把字体/颜色烘进该窗离屏表面，此后改全局样式不回溯 | ✅ 已核验 | E3 · `test/text-style-snapshot.test.ts` |
| `engine-config-registry-persistence` | 资源 | 引擎配置注册表（SYS4REG.INI）：启动装载 → 脚本读写 → 写盘 | ✅ 已核验 | E3 · `test/config-version-substr.test.ts` |
| `save-data-tables-persistence` | 资源 | SAVE.DAT：脚本 save-int/save-string 两张表的持久化（= 设置界面那些开关真正存的地方） | ✅ 已核验 | E3 · `test/save-data.test.ts` |
| `append-pack-discovery-and-activation` | 资源 | 扩展包（APPENDnn.AAI / APPENDnn.ALF）的发现、注册与激活 | ✅ 已核验 | E3 · `test/append-packs.test.ts` |
| `audio-module-topology-and-volume-routing` | 声音 | 音频三模块拓扑与音量路由（设备 / SE / Voice / Music） | ✅ 已核验 | E2 · `test/audio-engine.test.ts` |
| `voice-request-deferral-and-adv-gate` | 声音 | ADV 激活期间的语音寄存与冲刷（文本↔语音联动） | ✅ 已核验 | E2 · `test/audio-engine.test.ts` |

## 缺口明细（`absent` / `partial`）

### `scene-frame-commit`（partial）

- **能力**：Scene 逐帧提交（四路归并 + 绘制）
- **触发**：主循环帧提交门放开，或脚本执行 opcode 0x20C，或其它子系统直调
- **缺失时为什么静默**：脏标志为 0 或 `Scene+1056==0` 时内部各分支自然不成立，函数正常返回，无日志
- **引擎**：sub_4B4040, sub_4B06D0 @ raw 136742-136966
- **读的字段**：Scene+46508, Scene+46516, Scene+46512, Scene+46500, Scene+1860, Scene+46456, Scene+46676, Scene+1056
- **emulator 现状**：只实现四路归并里的两路（DrawItem + MeshEntry 黑罩）；两张 572B 节点表完全没建模 ⇒ 特效/精灵层缺失

### `scene-dirty-flag-lifecycle`（partial）

- **能力**：Scene+46508 「本帧需要重画」脏标志
- **触发**：任一矩阵/变换/显示列表被改动时置 1（117146/117214/130792/130823/130829/130836/131262/133540/133773）；帧头清 0
- **缺失时为什么静默**：标志为 0 时只是少刷一帧，`sub_40BE10` 走别的条件（D3D 设备/map/内容/Live2D），无断言
- **引擎**：sub_4B4040, sub_4B4460, sub_40BE10, sub_4AF1C0, sub_49AA30, sub_49A770, sub_49A8E0, sub_4AB950 @ raw 117129-137035
- **读的字段**：Scene+46508
- **emulator 现状**：emulator 有 sceneDirty（标脏 → present 消费后清）；引擎是 12 处置 1 / 3 处清 0 + 帧末按 (46512|46516) 回置，生命周期更复杂

### `scene-freeze-flag`（absent）

- **能力**：Scene+46512 动画强制冻结
- **触发**：`sub_407EA0`（ADV/0x400 分支）置 1，或转场类型为负值
- **缺失时为什么静默**：冻结只让插值短路到终态，代码路径完全合法，无报错
- **引擎**：sub_407EA0, sub_49AA30, sub_4AF1C0, sub_4B06D0 @ raw 12788-12801
- **读的字段**：Scene+46512, Scene+46528
- **emulator 现状**：★未建模 Scene+46512「动画强制冻结」：引擎在转场/截图等场景会冻住所有动画窗，emulator 会继续播 ⇒ 表现差异

### `scene-pending-flag-0x400-gate`（partial）

- **能力**：Scene+46516 转场/等待在途标志（0x400 卫门值）
- **触发**：转场进行中或动画窗未结束时置 1；帧头清 0，帧尾按状态回置
- **缺失时为什么静默**：标志恒为非零时只是永远不清转场表、0x400 门不开，引擎不认为这是错误
- **引擎**：sub_4B4040, sub_407E20, sub_4B06D0 @ raw 136793-136841
- **读的字段**：Scene+46516, Scene+46500, Scene+46512
- **emulator 现状**：emulator 用 scAnimationsDone()（按各窗相位）推导放行，未建模 46516 本身，也没用 Engine+369344 的"强制重绘请求"⇒ 判据比引擎粗

### `scene-flag-46528-bits`（absent）

- **能力**：Scene+46528 bit1/bit2 冻结豁免
- **触发**：bit1 非零 ⇒ 拒绝 `sub_407EA0` 置冻结；bit2 非零 ⇒ `sub_49AA30` 忽略已置的冻结
- **缺失时为什么静默**：只影响一个 if 分支的取舍，两种取值都是正常路径
- **引擎**：sub_407EA0, sub_49AA30 @ raw 12793-12793
- **读的字段**：Scene+46528
- **emulator 现状**：冻结豁免位（bit1 阻止置冻结 / bit2 忽略已置冻结）随 46512 一起未建模

### `scene-norender-mode`（partial）

- **能力**：Engine+167990 无渲染/隐藏窗口模式
- **触发**：启动参数（WinMain raw 142044 配套置 effect_flags|0x80000）或脚本经 raw 40114 读取该值；本文件内无写入点
- **缺失时为什么静默**：19 处门全是 `if (!_this[167990])`：非零时跳过「消息框前后隐藏/恢复窗口」「窗口尺寸同步」，脚本继续跑，完全无日志
- **引擎**：sub_41A1A0, sub_412290, sub_405530, sub_4065F0, sub_406650, sub_40A4C0, sub_430A20 @ raw 11120-40120
- **读的字段**：Engine+167990
- **emulator 现状**：★语义冲突待复核：emulator 把 display:ScreenMode 绑到 167990（当"显示模式"读），而引擎里它是「无渲染/隐藏窗口模式」（19 处门 + 经 raw 40114 暴露给脚本）⇒ 绑定可能错位

### `scene-render-freeze-46676`（absent）

- **能力**：Scene+46676 3D/文字渲染冻结总闸
- **触发**：外部（脚本/命令层）把该字段置非零；本文件内 105 处引用全部是读、**零写入**
- **缺失时为什么静默**：非零时 `sub_49FCD0` 整帧直接 `return 1`、相机矩阵/抖动/缩放补偿全部跳过 —— 合法路径、无报错，只是 3D 世界被冻结在最后一帧
- **引擎**：sub_49AA30, sub_49FCD0, sub_4A1F00, sub_4A2D50, sub_4A7DA0, sub_4AEEA0, sub_4AF1C0, sub_4B06D0, sub_4B4040, sub_4B4460, sub_4B4910, sub_4B4B90 @ raw 117239-137597
- **读的字段**：Scene+46676
- **emulator 现状**：★引擎里 105 读 / 0 写的"渲染冻结总闸"（含 2D 与文字路径）⇒ emulator 无对应开关，相关表现差异无从解释

### `scene-draw-total-gate-1056`（absent）

- **能力**：Scene+1056 主绘制总门
- **触发**：`sub_4B06D0` 入口；为 0 时整帧绘制直接 return
- **缺失时为什么静默**：只是一个 `if (v2) return;`，没有日志或错误码
- **引擎**：sub_4B06D0 @ raw 134814-134818
- **读的字段**：Scene+1056, Scene+46456
- **emulator 现状**：★Scene+1056 == 0 时 sub_4B06D0 第一行就 return ⇒ 整帧绘制消失。emulator 没有这个总门（总是画）

### `clock-write-clock-freeze`（partial）

- **能力**：每帧时钟写入与时钟冻结门
- **触发**：主循环每帧写 `Engine+369332`；opcode 0x20C / `sub_41A090` / `sub_41A2C0` 也写；`Engine+107438` 非零时只递增 107439
- **缺失时为什么静默**：时钟停走时动画只是静止，所有基于时间的比较都合法
- **引擎**：sub_412290, sub_41A090, sub_41A2C0, sub_41A1A0 @ raw 20750-20751
- **读的字段**：Engine+369332, Engine+369336, Engine+107438
- **emulator 现状**：emulator 有时钟写入（0x20C/0x23C → engineValues 92333/92334）+ 0x1F4 停靠锁门控；但没有"时钟冻结"概念（present 用墙钟 performance.now）

### `clock-read-meshentry-color-window`（partial）

- **能力**：MeshEntry 颜色/α 动画窗
- **触发**：MeshEntry `flags & 2`（颜色动画挂起）且 `flags & 1`（可见）
- **缺失时为什么静默**：颜色窗不活动时只做一次顶点缓冲 Unlock 回写，逐通道 lerp 全跳过
- **引擎**：sub_4AF1C0, sub_4A2050 @ raw 133459-133646
- **读的字段**：Scene+46500, Scene+46512, Scene+46508, Scene+46516
- **emulator 现状**：mesh 颜色窗实现了（CalcDiffuse 浮点式），但 ① mesh 渲染是整屏黑罩（顶点几何未建模）② 元素2 的色槽偏移（+36/+52/+56）与窗口字段归属仍需复核（sub_4AE2C0 同时写两处色槽 ⇒ 现模型的 state0/state1 映射可疑）

### `clock-read-transition-window`（absent）

- **能力**：转场窗口进度与扫描带绘制
- **触发**：过渡表 `Scene+1048` 存在记录且 `Scene+46512` 为 0
- **缺失时为什么静默**：窗口超时后把记录 `[3]` 清 0 并 `sub_49E170` 收尾，正常流程无日志
- **引擎**：sub_4B06D0 @ raw 134856-136321
- **读的字段**：Scene+46500, Scene+46512, Scene+46516
- **emulator 现状**：★转场表（Scene+1048）完全未建模 ⇒ 各类 wipe/淡入淡出过场不显示

### `render-range-clip-by-index`（absent）

- **能力**：按索引区间的绘制范围裁剪
- **触发**：绘制项 key（`v384[5]`）落在 `[Scene+1112, Scene+1112+Scene+1116)` 之外
- **缺失时为什么静默**：裁剪只是不给该项渲染，表项保留到下帧，无断言
- **引擎**：sub_4B06D0 @ raw 134872-134882
- **读的字段**：Scene+1112, Scene+1116
- **emulator 现状**：按索引区间的绘制范围裁剪未建模

### `render-merge-two-pass-reorder`（partial）

- **能力**：四路归并（DrawItem/MeshEntry/两 572B 节点）与 |0x10000 回置
- **触发**：每帧 `sub_4B06D0` 被调用；四张 map 内 key 落在时间/序窗外的项被打 `|0x10000` 留下
- **缺失时为什么静默**：回置标记只是让项保留，帧末 `Scene+46508` 归 0 时下一帧重来，无报错
- **引擎**：sub_4B06D0, sub_4B0360, sub_4AAD40, sub_40DC30, sub_4AAEC0 @ raw 136361-136718
- **读的字段**：Scene+1032, Scene+1064, Scene+1080, Scene+1096, Scene+46500
- **emulator 现状**：按 layer 排序绘制等价于归并顺序，但没有 |0x10000「绘制中」标志回置与两趟重排

### `transition-table-flush`（absent）

- **能力**：转场表帧尾收尾（sub_4A9BE0）
- **触发**：`Scene+46516 == 0` 时每帧帧尾清空 `Scene+1048`
- **缺失时为什么静默**：`46516` 恒非零时表永不清空，转场只是重复执行，无报错
- **引擎**：sub_4A9BE0, sub_4AA180 @ raw 129283-129302
- **读的字段**：Scene+1048, Scene+46516
- **emulator 现状**：★转场表帧尾收尾（sub_4A9BE0）未建模；与 scene-pending-flag 共同决定"转场是否清空"

### `audio-device-init`（partial）

- **能力**：DirectSound 设备/对象重建
- **触发**：引擎 ctor（raw 21426 → `sub_4B69B0(Engine+18664)`）；`sub_4B5C50`(138380) 惰性 `LoadLibrary("DSOUND.DLL")`
- **缺失时为什么静默**：DSOUND.DLL 缺失时 `DirectSoundCreate` 取不到，所有播放调用变成空操作，无报错
- **引擎**：sub_4B69B0, sub_4B5C50, sub_4B6940 @ raw 138380-139100
- **读的字段**：Engine+18664
- **emulator 现状**：部分实现：AudioContext 懒创建 + resume（first gesture 兜底）已落地；引擎的「设备丢失 → 重建 → 按 SE[1212+ch] 重载 10 通道」（sub_4B5090）与 DirectSound 错误重试未实现

### `movie-object-lifecycle`（absent）

- **能力**：电影对象帧内生命周期
- **触发**：`effect_flags & 0x2000` 且 `Engine+378684` 非零；播完或收到 0x10 输入时删除
- **缺失时为什么静默**：对象为空时只清 0x2000 位并跳转 `LABEL_126`，不报错
- **引擎**：sub_412290 @ raw 20896-20917
- **读的字段**：Engine+699204, Engine+378684, Engine+699208
- **emulator 现状**：影片播放未实现（0x20F 只记录）

### `script-queue-dispatch`（absent）

- **能力**：脚本派发队列出队
- **触发**：`Engine+497380 < Engine+497384`（队列有货）且 `Engine+497400==0`（未在派发中）
- **缺失时为什么静默**：队列空时整个函数体被外层 if 挡住，静默返回
- **引擎**：sub_40FB60, sub_40FC90, sub_41A000 @ raw 18954-19016
- **读的字段**：Engine+497380, Engine+497384, Engine+497376, Engine+497400, Engine+387924
- **emulator 现状**：★引擎的脚本派发队列（sub_40FB60，由帧末/unlock/0x143 驱动）未建模 ⇒ 依赖"延迟派发"的流程在 emulator 里不会发生（0x143 是 no-op）

### `live2d-slot-probe`（absent）

- **能力**：Live2D 10 槽探测（强制重画理由之一）
- **触发**：`Scene+55812..55848` 任一非零
- **缺失时为什么静默**：全为 0 时返回 0，只是少一条重画理由，无报错
- **引擎**：sub_4A1AF0, sub_40BE10 @ raw 121778-121790
- **读的字段**：Scene+55812, Scene+55848
- **emulator 现状**：Live2D 未建模（10 槽）

### `vertex-buffer-lock-scale`（absent）

- **能力**：顶点缓冲 Lock/Unlock + 视口缩放改写
- **触发**：`Scene+46676 == 0` 且脚本深度非 38/负值时才改写顶点
- **缺失时为什么静默**：Lock 成功但 vcount<=0 时循环体不执行；仅 Lock 失败才 sprintf_s + `sub_4034C0`
- **引擎**：sub_4AF1C0, sub_4A1F00, sub_4A2050 @ raw 133571-133612
- **读的字段**：Scene+46676, Scene+1860, Scene+46456
- **emulator 现状**：★顶点缓冲 Lock/Unlock + 视口缩放改写未建模 ⇒ mesh 只能画成整屏色块，顶点几何全丢

### `world-matrix-identity-refresh`（partial）

- **能力**：每帧世界/投影矩阵复位与链乘
- **触发**：每帧 `sub_4A1E90` 与逐项 `sub_4AEEA0`/`sub_4AEDD0` 调用
- **缺失时为什么静默**：矩阵数值错误不会抛异常，只是坐标不对（纯表现问题）
- **引擎**：sub_4A1E90, sub_4AEEA0, sub_49AA30 @ raw 122130-122157
- **读的字段**：Scene+1116, Scene+46600, Scene+46536, Scene+46660
- **emulator 现状**：scale/rot/trans 用 Vec3/{axis,deg} 等价建模并接入 Pixi；但没有 4×4 世界矩阵链与投影矩阵复位

### `sprite-2d-draw-layer`（absent）

- **能力**：无脚本/标题态额外 2D 层绘制
- **触发**：`Scene+46700` 非零且（脚本深度 <0 或 ==38）
- **缺失时为什么静默**：字段为 0 时该分支不执行，正常进下一步
- **引擎**：sub_49FCD0, sub_4B4040 @ raw 136832-136833
- **读的字段**：Scene+46700, Scene+46456
- **emulator 现状**：无脚本/标题态的额外 2D 层未建模

### `scene-slot-release-1000`（partial）

- **能力**：1000 个场景对象槽的逐帧老化释放
- **触发**：`Engine+675972` 非零（存在需刷新对象）
- **缺失时为什么静默**：槽为 0 时直接 `++i` 继续，没有任何错误路径
- **引擎**：sub_412290, sub_488550, sub_4A4C70 @ raw 20660-20738
- **读的字段**：Engine+675972, Engine+378688, Engine+429752, Engine+699204
- **emulator 现状**：emulator 的 drawItems/meshes 是 Map（无 1000 槽上限与逐帧老化释放）；纹理槽表按需建，未做老化

### `lazy-live2d-slot`（absent）

- **能力**：Live2D 槽（10）释放-重建
- **触发**：Live2D 模型载入路径进入 `sub_4A1860(Scene, …, slotIdx, …)`
- **缺失时为什么静默**：旧槽为空时跳过释放；`ReadFile` 失败只 return 0，无日志
- **引擎**：sub_4A1860, sub_478270 @ raw 121665-121695
- **读的字段**：Scene+55812, Scene+1860
- **emulator 现状**：Live2D 未建模

### `lazy-movie-object`（absent）

- **能力**：电影对象按显示模式创建
- **触发**：`config(setCreateObject) & 1` 且目标对象非空（显示模式变更时，非严格按需）
- **缺失时为什么静默**：条件不满足则不建，主循环 0x2000 分支只清标志位，不报错
- **引擎**：sub_414940, sub_486F70, sub_485FA0 @ raw 21786-21837
- **读的字段**：Engine+697620, Engine+378684
- **emulator 现状**：影片未实现

### `lazy-movie-dll`（absent）

- **能力**：电影解码 DLL 重载与函数指针惰性解析
- **触发**：`sub_4229D0` 被调用；`Engine+490072` 已加载则先 `FreeLibrary`
- **缺失时为什么静默**：LoadLibrary 失败时 `GetLastError` + `_CxxThrowException(Command_ShowMessage)` ⇒ **会报错**
- **引擎**：sub_4229D0, sub_422AB0 @ raw 31056-31110
- **读的字段**：Engine+490072
- **emulator 现状**：影片未实现

### `lazy-movie-texture-slot`（absent）

- **能力**：电影纹理槽（每索引）惰性创建
- **触发**：`Engine+378688+4*i` 槽为空且该槽被指定为影片纹理
- **缺失时为什么静默**：多个调用点（32245 / 32528 / 32600 / 32877）共享同型守卫；失败按空槽处理，无日志
- **引擎**：sub_489040 @ raw 31627-31630
- **读的字段**：Engine+378688
- **emulator 现状**：影片未实现

### `lazy-gdi-font-set`（absent）

- **能力**：消息窗字体句柄组的重建（主/注音两套，CreateFontIndirectA ×8 / ×4）
- **触发**：字体变更或消息窗子系统重建（`sub_40DF10` 复位区）
- **缺失时为什么静默**：字体句柄为 0 时 GDI SelectObject 静默退化；面名为空（Font+1260 首字节 0）则 sub_459F40 直接 return ⇒ 句柄全 0、文字用系统默认字体画出来，全程无错误输出
- **引擎**：sub_465390, sub_459F40, sub_45A6E0, sub_456C90 @ raw 70940-71273
- **读的字段**：Font+1084, Font+1096, Font+1100, Font+1232, Font+1292, Font+201684, Font+218584, Font+101972, Font+102032, Font+201788, Font+235068..+235104
- **emulator 现状**：缺失：字体系（面名/字号/粗体/竖排模板 → HFONT）完全未建模。改用浏览器字体后仍需保留「面名→内嵌字族」映射与 0x75/0x197/0x1A5/0x2FE/0x2BD/0x2BE/0x2DB 的参数面。

### `lazy-transition-map-node`（absent）

- **能力**：过渡表节点惰性插入（表头 eager）
- **触发**：首次写入某个过渡 key（`sub_4AA190`/`sub_4AAE10` 在 map 中找不到该 key）
- **缺失时为什么静默**：map 内分配失败会走 bad_alloc 抛出；正常路径完全静默
- **引擎**：sub_4AA190, sub_4AAE10, sub_4A95D0 @ raw 129586-129596
- **读的字段**：Scene+1048, Scene+1052
- **emulator 现状**：转场表未建模

### `lazy-572b-node-map`（absent）

- **能力**：572B 节点表（精灵/特效）惰性插入（表头 eager 130366/130384）
- **触发**：任意精灵/特效 opcode 首次触碰某个 key
- **缺失时为什么静默**：默认全 0 记录，调用方按 `*result & 1` 判定未激活
- **引擎**：sub_4AAEC0, sub_4A9D70 @ raw 129394-129427
- **读的字段**：Scene+1080, Scene+1084, Scene+1096, Scene+1100
- **emulator 现状**：★572B 节点表（精灵/特效/立绘）未建模

### `bullet-dirty-from-freeze-or-pending`（partial）

- **能力**：冻结/pending 强制延续刷帧
- **触发**：`*(_QWORD*)(Scene+46512)` 非零（冻结或 pending 任一）
- **缺失时为什么静默**：只是把脏标志置 1 让下一帧继续画，无日志
- **引擎**：sub_4B06D0 @ raw 136718-136719
- **读的字段**：Scene+46512, Scene+46516, Scene+46508
- **emulator 现状**：emulator 的 needsRender() = dirty || !animationsDone || waitFlags&0x400，方向一致；但没有 (46512|46516) 的粘滞语义

### `adv-flag-lifecycle`（partial）

- **能力**：ADV 激活位（effect_flags 0x8000000）的设置与清除
- **触发**：置位：0x6E/0x71/0x72（受 GetConfig("message:ReadTextSkip") 门控）、0x19C 条件式、0x305、sub_436380；清除：sub_411900 每帧判定、0x19B、0x88(op1=0)、0xFA、0x101、0x72、0x19C 条件式
- **缺失时为什么静默**：位被置住时主循环只是改走 ADV 分支（每帧派发 1 条指令 + 输入泵），没有断言/日志；位被清时也只是回到普通分支 —— 两种取值都是合法路径
- **引擎**：sub_41ED80, sub_41EEF0, sub_41EB20, sub_41FAB0, sub_4190E0, sub_419120, sub_411900, sub_4199B0, sub_419CC0 @ raw 24532-28977
- **读的字段**：Engine+699204, Engine+122455, Engine+122496, Engine+1415, Engine+97050, Engine+97051, Engine+122368, Engine+122370
- **emulator 现状**：已修正：`0x71` 不再无条件置位（补上 `message:ReadTextSkip` 门 + `advanceReveal` 判定），ADV 位由 `Engine.serviceAdv()`（每帧）与 0x88/0x19B/0xFA/0x101 清除。实测 TITLE 空转 598000 → 1234 步/秒。★同族的 **bit30（0x40000000，逐字模式）** 与 bit31（等待门）已建模：0x72 每次武装（游标 Engine[107704] 清零）、0x1CE/点击推进收尾，见 msgwin-char-reveal-grid。仍未建模：`sub_411900` 的 cancel-message 三态机（受 `set:CancelMessageKey` 门控，随包 INI 无该键 ⇒ 休眠）与 `sub_411BC0` 的滚轮/控件分支。

### `adv-text-reveal-progress`（partial）

- **能力**：消息文本显示进度判定（ReadTextSkip 门 + 分段表查表）
- **触发**：0x6E/0x71/0x72 每次调用；仅当 GetConfig("message:ReadTextSkip") 为真才走该分支
- **缺失时为什么静默**：查表未命中/越界统一返回 0，调用方据此认为「已显示完」并清 ADV —— 全是合法路径，无日志
- **引擎**：sub_48F000, sub_48E870, sub_48FFB0, sub_41ED80, sub_41EEF0 @ raw 109440-110481
- **读的字段**：Engine+80107, Engine+80107+285, Engine+174405(config)
- **emulator 现状**：部分：ReadTextSkip 门已实现（含 0x1CA 运行期覆盖）。仍未建模引擎真正的逐字/逐行推进泵 —— 见 text-reveal-pump-409400（sub_409400 + sub_45BE20 + message:MessageSpeed）；本条目只覆盖「是否已显示完」的判定，miss 时统一返回 0 属合法路径。

### `msgwin-text-object`（partial）

- **能力**：文本对象（Engine+85296，dword 写法 Engine[21324]）的槽模型与排版入队
- **触发**：0x71 经 sub_45EC60(Font、slot、Engine+97055) **开始一段新消息**（清该窗文本记录向量 + 复位显现游标 + 清该窗表面）；0x6E/0x196/0x7D 经 sub_46BE30/sub_46CBF0 往该窗铺排文本；0x72 只判显示态并挂起。
- **缺失时为什么静默**：文本槽是纯数据结构：写入只改字段、清图元只调容器接口；没有可渲染输出也不会报错（脚本继续跑到下一条消息）
- **引擎**：sub_45EC60, sub_46BE30, sub_46CBF0, sub_45D660, sub_456430 @ raw 74196-74282
- **读的字段**：Engine+85296(文本对象; dword 写法 Engine[21324]), Font+1044(10 窗口), Font+1228(默认窗), Font+1032/+1036/+1040, Engine+667856
- **emulator 现状**：部分：已建模文本槽内容（show-text 追加 / end-text-line 断行 / display-furigana 注音）、消息窗对象表（0x212/0x213/0x25D）与 **0x71 的清场语义**（MsgWindow.beginNewMessage；漏掉它会让上一屏文案残留并在下次 0x71 被当新消息重新逐字显现 —— 2026 实测 CONFIG 进/出设置重放与两行）。仍未建模：sub_46BE30 的逐字量宽与边界硬断、注音配对（24B 记录 +0/+20）、120B 文本记录、每窗离屏表面、D3D 路径的纹理清底。★旧条目把 Font 基址写成 Engine+21324 字节（错 4 倍，实为 Engine+85296 字节），且把 sub_45EC60 说成 0x6E/0x71/0x72 共用（实际只有 0x71 调它）。

### `msgwin-object-table`（partial）

- **能力**：消息窗对象表与布局重算（Engine[21585+idx]）
- **触发**：0x212/0x213 按索引写对象字段；0x300/0x301 写旗标/值并触发 sub_404F80 布局重算；每帧绘制由 Scene 侧消费这些对象的图元区间
- **缺失时为什么静默**：对象表槽为空时各 handler 只做 `if (obj)` 判定即返回；布局重算只是从容器里移除区间 —— 没有对象就什么都不发生，无日志无报错
- **引擎**：sub_423A30, sub_423A80, sub_426990, sub_4269F0, sub_404F80 @ raw 31742-33789
- **读的字段**：Engine+21585, Engine+122466, Engine+122476, Engine+122486, Engine+1040(绘制容器)
- **emulator 现状**：部分：对象表与三条写指令（0x212→+100、0x213→+104/+108、0x25D→+276/+280）已建模并有测试；0x301 顺带清 +132。仍未建模：`sub_404F80` 的布局重算（移除图元区间）与对象内部其它字段。

### `msgwin-cancel-key-state`（partial）

- **能力**：「取消消息键」三态机（Engine+122370）与 ReadTextSkip 的运行期开关
- **触发**：sub_411900 每帧：输入掩码 0x10（取消键按下沿）驱动 122370 在 0→1→2 之间迁移
- **缺失时为什么静默**：三态机每个取值都是合法分支；到 2 才清 ADV 并 SetConfig("message:ReadTextSkip", 0)，中间态无任何日志
- **引擎**：sub_411900 @ raw 20096-20160
- **读的字段**：Engine+122370, Engine+174802, Engine+174405(config)
- **emulator 现状**：已实现三态机本体（`Engine.serviceAdv()` 内，掩码 bit4 = 鼠标左键驱动 122370: 0→1→2，到 2 时清 ADV + 复位 ReadTextSkip）。但引擎门控在 `GetConfig("set:CancelMessageKey")`，随包 SYS4REG.INI **没有该键** ⇒ 与引擎一致地处于休眠（cfgInt 缺省 0）。

### `msgwin-text-method-opcodes`（partial）

- **能力**：文本子系统方法转发指令族（约 25 条）—— 属**指令集**
- **触发**：脚本布置消息窗时逐条调用；每条只读 N 个操作数并转发到文本对象 Engine+21324 的一个方法
- **缺失时为什么静默**：这些 handler 体只有「读操作数 → 调文本对象方法」，没有回写操作数、不改 ip；emulator 把它们当 no-op 跳过时，脚本拿到的是「已执行」的状态，控制流正常，只是消息窗永远没有内容/几何 —— 无日志无报错
- **引擎**：sub_41ED20, sub_41F250, sub_41F350, sub_41F490, sub_425EF0, sub_426200, sub_4332D0, sub_456430, sub_45D660, sub_4563A0, sub_4185F0, sub_432DD0 @ raw 28401-41818
- **读的字段**：Engine+21324, Engine+21585, Engine+166964, Engine+430600
- **emulator 现状**：部分：消息窗对象表三条（0x212/0x213/0x25D）已实现；其余约 22 条纯转发器（0x70/0x73/0x74/0x75/0x197/0x198/0x1B5/0x1BB/0x1C1/0x1C9/0x1CE/0x324…）仍是 no-op —— 它们转发到不存在的文本布局子系统，**不假装实现**。

### `msgwin-attr-font-opcodes`（partial）

- **能力**：文本属性 / 描边 / 字体 / 注音指令族（0x75/0x76/0x77/0x78/0x81/0x8B/0x1A4/0x197/0x1A5/0x2BD/0x2BE/0x2DB/0x2FE/0x196 等）—— 属**指令集**
- **触发**：脚本设置字体/文本属性时调用；0x196 display-furigana 在消息文本里插注音；0xC5 读音量配置写操作数
- **缺失时为什么静默**：多是"改模板字段 + 重建句柄"的纯属性写入：不实现则参数保持默认（白字/黑投影/24px），画面还能看，只是**失去脚本指定的观感与阅读体验**。0x1C5/0xC5 一类会回写操作数，被跳过时脚本读到旧值。
- **引擎**：sub_41F350, sub_41F390, sub_41F3F0, sub_41F450, sub_41F6C0, sub_41FBF0, sub_41FE60, sub_41FDD0, sub_433290, sub_426200, sub_426260, sub_426500, sub_4332D0, sub_41FC20, sub_455ED0 @ raw 28652-29163
- **读的字段**：Font+1360/+1364/+1368/+1372/+1380/+1384/+1388/+1392(颜色与描边), Font+1232/+1248/+1260(主字体), Font+1292/+1308/+1320(注音字体), Font+218516/+218588(字重), Font+201684/+218584(字号), Font+235108(竖排)
- **emulator 现状**：部分：0x196 display-furigana 已实现（记录注音对）。仍为 no-op 且**属 P0（阅读体验）**：0x75 字号 / 0x76 填充色 / 0x77 描边色 / 0x78 描边档位 / 0x1A4 描边偏移 / 0x8B 第三色 / 0x197 注音字号 / 0x2BD/0x2BE 加粗 / 0x1A5/0x2FE 面名。★描边四档（0 无 / 1 单向投影 / 2 1-4 强度副本 / 3 多向描边，默认 1）必须逐档复刻观感（canvas 等价实现见 app/amayui-emulator/docs/12-adv-text-rendering.md §5.3）；字体内部配置（AA/度量/缓存）按用户口径只记录字段。

### `adv-advance-route-table`（partial）

- **能力**：点击热点 / 路由表（Engine+0x55D8）与「推进」的真实判据
- **触发**：`0x090` 登记热点项（消息场景常见 `i090 0 0 500 2d0 …` 全屏热点）；`wait-for-input` 挂起后每帧 `sub_411BC0` 做命中测试/键命中
- **缺失时为什么静默**：表为空或游标 -1 时 `sub_403E70`/`sub_403D70` 都返回 -1，调用方只是「继续等下一帧」，无日志无错误码；只有表满时 `0x090` 才抛 ShowMessage
- **引擎**：sub_420640, sub_403B30, sub_403C50, sub_403D70, sub_403E70, sub_411BC0, sub_411900 @ raw 9740-29518
- **读的字段**：Engine+21976(表基址 0x55D8), Engine+29872(游标), Engine+29864(推进标志)
- **emulator 现状**：已实现：`RouteTable`（入队 `0x090`、坐标命中 `hitTest`、键命中 `pickByKey`、label 重定位 `Engine.jumpToLabel`）与等待门集成；真实脚本 SC0000 登记 6 个热点且不再硬报错。未实现：引擎 `[7466]/[959]` 的游标去重锁存（emulator 改为「本帧有推进输入」才推进，避免鼠标悬停即自动翻页）、`sub_403500` 的坐标变换、`[7361+i]` 键位绑定的写入方。

### `msgwin-config-gates`（partial）

- **能力**：消息/ADV 路径上的配置门与「当前走不到的分支」
- **触发**：各 handler 体内的 `GetConfig("…")`；随包 SYS4REG.INI 的取值决定走哪一支
- **缺失时为什么静默**：配置门是普通 if：取值为假时对应分支整段不执行，没有日志也没有错误码；更隐蔽的是**配置回读类指令被当 no-op 时脚本读到旧值**（不报错、只算错）
- **引擎**：sub_41EB20, sub_41ED80, sub_41EEF0, sub_411900, sub_411BC0, sub_409400, sub_42E540, sub_42E670, sub_4309E0, sub_431110, sub_4311B0, sub_42D2F0 @ raw 20096-40386
- **读的字段**：Engine+697620, Engine+174405, Engine+86672
- **emulator 现状**：清单与逐键分支见 `docs-new/03-engine/message-config-gates.md`。要点：(a) `message:ReadTextSkip=0` ⇒ 0x6E/0x71/0x72 不置 ADV（emulator 已按门实现）；(b) `message:MesWinAlpha=8` ⇒ 每段文本 8ms 节流（已实现）；(c) `set:CancelMesSkipOnClick`/`set:WheelKeyUp|Down`/`set:ReDrawTextOnKey`/`set:ControlDisibleCursor` 在随包 INI **缺失** ⇒ 对应分支当前走不到（三态机已实现但休眠，滚轮/重绘未建模）；(d) `message:AutoMessage*` 自动播放未建模。★纪律：读到门就照门实现；走不到的分支必须登记；配置回读类指令一律不得当 no-op。

### `text-layout-wrap-ruby`（absent）

- **能力**：文本排版：逐字像素量宽 + 边界硬断 + 注音配对（sub_46BE30）
- **触发**：0x6E show-text / 0x196 display-furigana / 0x7D 每次入队时
- **缺失时为什么静默**：排版产出的只是一串记录与源矩形；不排版不报错，只表现为「文字不出现」「位置不对」。更隐蔽的是：断行规则与引擎不一致时，行数/每行字数与脚本可观测的 0x83(当前行)、0x1C5/0x2C2(读回已显示文本)、0x2F3(行坐标) 全部对不上 —— 静默错误会从像素层渗到 VM 层。
- **引擎**：sub_46BE30, sub_45E870, sub_475CF0, sub_4572A0, sub_45D120 @ raw 83363-83997
- **读的字段**：FontVWindow+36/+40(右/下边界), FontVWindow+44/+48(24B 行记录), FontVWindow+208(120B 文本记录), Font+201684(字号), Font+1236(字宽), Font+218592/+218596(缩放)
- **emulator 现状**：缺口：逐字 GetTextExtentPoint32A 量宽、右/下边界硬断、注音配对（24B 记录 +0 种类 / +20 组 ID）与按比例缩短都未建模。★引擎的等宽网格（lfWidth = 字高/2 ⇒ 全角 1em / 半角 0.5em）使排版可退化为纯算术，不需要浏览器度量。★引擎**无**禁则、**无** 0x0A 换行处理。

### `msgwin-offscreen-surface-lifecycle`（absent）

- **能力**：每窗一张离屏表面：0x70 重建 / 0x71 清底 / sub_45BE20 逐行贴出
- **触发**：0x70 设窗几何时重建；0x71 开始时填底色；显现阶段逐行/逐字贴出
- **缺失时为什么静默**：表面生命周期错位不会报错：少重建 ⇒ 几何仍按旧尺寸（文字位置/换行全偏）；少清底 ⇒ 上一页文字叠在下面；少 ReleaseDC ⇒ 表面被 GDI 锁住、后端读不到像素（画面停留在旧内容）。
- **引擎**：sub_45D660, sub_43C8D0, sub_43B070, sub_43D870, sub_43B460, sub_43B4C0, sub_45BE20 @ raw 73132-73193
- **读的字段**：FontVWindow+20/+24(w/h), FontVWindow+12/+16(屏幕偏移), FontVWindow+4(目标表面=0), Font+1032(dd 模块), Font+1104(surface DC), Font+1400(已锁表面号)
- **emulator 现状**：缺口：emulator 无"每窗离屏表面"概念，也没有 DC 取/还配对。重写方案里这一层被替换为「纯排版模型 + canvas2D 光栅化成纹理」，因此需要等价的"窗口内容整体重画"时机（文本变化 / 显现游标变化 / 几何变化 / 清场）。

### `msgwin-line-fade-window`（partial）

- **能力**：行淡入：DrawItem 颜色动画窗，时长 = MessageSpeed × MessageFade / 100 ms
- **触发**：D3D 路径下 sub_45BE20 为每行建 DrawItem 之后
- **缺失时为什么静默**：不设色窗只会让文字"瞬现"而不是淡入 —— 无错误、无日志，只是少了动画。★引擎没有"把文字颜色朝背景插值"的代码（GDI TextOutA 无 alpha），淡入只能靠 DrawItem alpha 或离屏表面整体贴出。
- **引擎**：sub_45BE20, sub_4AD0C0, sub_4ACF60 @ raw 72338-72348
- **读的字段**：Font+1376(= message:MessageSpeed), Font+235128(= message:MessageFade), DrawItem+52/+56/+76/+100
- **emulator 现状**：部分：DrawItem 颜色动画窗（含整数截断插值、共享起点、窗末收尾）已建模并有守卫；缺的是把它接到消息窗行上（按 MessageSpeed×MessageFade/100 设时长）。

### `msgwin-backlog-cursor`（absent）

- **能力**：已读文本回看：页表 Font+3380 + 72B 回看项 + 光标 sub_459770
- **触发**：0x71/0x70 登记一页；滚轮（输入位 0x8/0x2）与 0x84 移动光标
- **缺失时为什么静默**：页表不建则回看与滚轮完全无反应；更关键的是 0x84「翻到底」时本应置 effect_flags |= 0x100000 并弹保存栈让脚本继续 —— 页表为空则这个"到达末尾"永远不发生，脚本会停在自旋里（表现为卡住，而不是报错）。
- **引擎**：sub_459770, sub_45EFA0, sub_45EBE0, sub_45EC60, sub_45D660 @ raw 70575-70627
- **读的字段**：Font+3380/+3384(8B 页表), Font+3364(72B 回看项), Font+859/+860(末项/当前光标)
- **emulator 现状**：缺口：无回看页表与光标。CONFIG1 链路上不触发，但真实剧本的滚轮回看与 0x84 依赖它。

### `text-font-rebuild-cascade`（absent）

- **能力**：字体参数 → 句柄重建级联（0x75/0x197/0x1A5/0x2FE/0x2BD/0x2BE/0x2DB → sub_459F40 / sub_45A6E0）
- **触发**：任一字号/面名/字重/度量模式指令；或子系统 Initialize
- **缺失时为什么静默**：★`sub_459F40` 入口守卫 `if (!Font+1260) return`：面名为空 ⇒ **整个重建不发生**，句柄保持 0，GDI 用系统默认字体把字画出来，全程无错误。同理 `0x2BD`（加粗）只改模板里的 lfWeight 并触发重建，不重建则"加粗"这一档完全无效。旧口径把 sub_459F40 说成"文本重排"、把 0x2BD 说成"调 sub_459F40"，均不成立（它不在派发表里）。
- **引擎**：sub_459F40, sub_45A6E0, sub_4185F0, sub_418680, sub_4328F0, sub_432DD0, sub_428990 @ raw 70940-71273
- **读的字段**：Font+1232/+1236/+1248/+1260(主模板), Font+1292/+1296/+1308/+1320(注音模板), Font+201684(主字号), Font+218584(注音字号), Font+201664(字体名白名单)
- **emulator 现状**：缺口：字号/面名/字重参数面完全没接（0x75/0x197/0x2BD/0x2BE/0x1A5/0x2FE/0x2DB 目前是 no-op）。浏览器方案下等价物 = 排版的 fontSnap（family/size/weight）+ 注音字号，并需保留「面名白名单 → 内嵌字族」映射（含剥掉竖排用的 "@" 前缀）。
