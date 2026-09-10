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
| `modeled-verified` | 3 | 已建模且有守卫（E2/E3） |
| `modeled-unverified` | 6 | 已建模但只有静态结论（E1）或缺少守卫 |
| `partial` | 10 | 只实现了一部分（缺口写在该条 note） |
| `absent` | 22 | 引擎有、emulator 完全没有 |
| `n/a-known` | 24 | 与本 2D 精灵 + 消息窗重写无关（必须写 why） |
| **合计** | **65** | 需要关注（非 n/a 且非已核验）= **38** |

## 按子系统

| 子系统 | 条数 | 其中 缺失/部分 |
|---|---|---|
| 3D | 15 | 1 |
| Live2D | 2 | 2 |
| 声音 | 3 | 3 |
| 帧循环 | 10 | 8 |
| 消息窗 | 1 | 1 |
| 渲染 | 22 | 11 |
| 资源 | 7 | 2 |
| 转场 | 4 | 4 |
| 输入 | 1 | 0 |

## 全部条目

| id | 子系统 | 能力 | emulator | 依据 / 守卫 |
|---|---|---|---|---|
| `frame-pump-sound-channels` | 声音 | 每帧声音通道老化 | ❌ 缺失 | E0 |
| `frame-pump-input-refresh` | 输入 | 每帧输入态刷新 | 🟡 已建模未核验 | E1 · `test/input.test.ts` |
| `frame-pump-music-fade` | 声音 | 每帧 BGM 淡出推进 | ❌ 缺失 | E0 |
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
| `audio-device-init` | 声音 | DirectSound 设备/对象重建 | ❌ 缺失 | E0 |
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
| `lazy-gdi-font-set` | 消息窗 | GDI 字体句柄组释放-重建 | ❌ 缺失 | E0 |
| `lazy-script-operand-hashmap-node` | 资源 | 脚本 VM 操作数 HashMap 节点惰性分配 | 🟡 已建模未核验 | E1 · `test/xval.test.ts` |
| `lazy-transition-map-node` | 转场 | 过渡表节点惰性插入（表头 eager） | ❌ 缺失 | E0 |
| `lazy-drawitem-map-node` | 渲染 | DrawItem 表节点惰性插入（表头 eager 130312） | ✅ 已核验 | E3 · `test/draw-item-anim-window.test.ts` |
| `lazy-mesh-map-node` | 3D | MeshEntry 表节点惰性插入（表头 eager 130348） | 🟡 已建模未核验 | E1 |
| `lazy-572b-node-map` | 渲染 | 572B 节点表（精灵/特效）惰性插入（表头 eager 130366/130384） | ❌ 缺失 | E0 |
| `lazy-scene-effect-release-gap` | 3D | Scene+46492 / +46496 两张 effect 的释放缺口 | ➖ n/a | E1 |
| `bullet-dirty-from-freeze-or-pending` | 帧循环 | 冻结/pending 强制延续刷帧 | 🟠 部分 | E1 |
| `chained-3d-layer-commit` | 3D | 3D 场景层四路归并与扫描带绘制 | ➖ n/a | E1 |

## 缺口明细（`absent` / `partial`）

### `frame-pump-sound-channels`（absent）

- **能力**：每帧声音通道老化
- **触发**：主循环每轮内层必然执行（不受 effect_flags 门控）；`Engine+82876+302` 非零时才有可观察效果
- **缺失时为什么静默**：通道槽为空时循环体只做 `if (*(v5-10))` 判定即跳过，没有断言或日志
- **引擎**：sub_412290, sub_4B5230 @ raw 20643-20645
- **读的字段**：Engine+82876, Engine+369332
- **emulator 现状**：无声音子系统：每帧通道老化不做（声音整体未实现）

### `frame-pump-music-fade`（absent）

- **能力**：每帧 BGM 淡出推进
- **触发**：`Engine+698852` 非零且配置 `sound:MusicFade` 打开
- **缺失时为什么静默**：门不满足时函数体整段跳过，仅 return
- **引擎**：sub_407120, sub_412290 @ raw 12113-12140
- **读的字段**：Engine+698852, Engine+699204, Engine+490016, Engine+697620
- **emulator 现状**：无声音子系统

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

### `audio-device-init`（absent）

- **能力**：DirectSound 设备/对象重建
- **触发**：引擎 ctor（raw 21426 → `sub_4B69B0(Engine+18664)`）；`sub_4B5C50`(138380) 惰性 `LoadLibrary("DSOUND.DLL")`
- **缺失时为什么静默**：DSOUND.DLL 缺失时 `DirectSoundCreate` 取不到，所有播放调用变成空操作，无报错
- **引擎**：sub_4B69B0, sub_4B5C50, sub_4B6940 @ raw 138380-139100
- **读的字段**：Engine+18664
- **emulator 现状**：无声音子系统（当前范围外；但属"引擎有、emulator 完全没有"的明确缺口）

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

- **能力**：GDI 字体句柄组释放-重建
- **触发**：字体变更或消息窗子系统重建（`sub_40DF10` 复位区）
- **缺失时为什么静默**：旧句柄为空时跳过 `DeleteObject`；`CreateFontIndirectA` 失败返回 0，`SelectObject` 静默退化
- **引擎**：sub_465390 @ raw 71144-71187
- **读的字段**：Engine+85296, Engine+1084, Engine+1100, Engine+218624, Engine+235068
- **emulator 现状**：★消息窗文本渲染（GDI 字体 + 自绘位图）完全未建模 ⇒ 文字不显示

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
