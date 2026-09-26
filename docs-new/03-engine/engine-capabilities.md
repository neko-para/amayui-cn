---
kind: generated
state: live
home: analysis/engine-capabilities.json
generated_by: scripts/build-capabilities.mjs
---

# 引擎「常态能力」台账（第二层）

> 由 `analysis/engine-capabilities.json` 生成：`node scripts/build-capabilities.mjs`。
> 这些能力**无法靠枚举 opcode 发现**：它们是引擎自己的逐帧流程与各子系统的持续行为，
> 缺失时**不会报错、只会表现不对**（例如版权页文字不淡入 ⇒ 才发现缺了逐帧颜色插值）。
> 因此单列一张可核对清单 —— **出现症状时先查这里**，避免每次从零研究。
>
> ★缺口明细只给**一句话**（`emulator.note` 裁到 200 字）：`note` 是审计轨（现状 + 逐轮沿革，136 条 ≈ 60 KB），
> 逐字铺进 md 会混进大量"当初怎么想错了"的沿革。**全文**：`capabilities.js --show <id>` 或直接读 JSON。
> `emulator` 列的判定口径见下；`E0–E4` 是证据等级（E0 未读体 / E1 已读体 / E2 合成单测 / E3 场景断言 / E4 真机对照）。

## 统计

| 状态 | 条数 | 含义 |
|---|---|---|
| `modeled-verified` | 78 | 已建模且有守卫（E2/E3） |
| `modeled-unverified` | 6 | 已建模但只有静态结论（E1）或缺少守卫 |
| `partial` | 33 | 只实现了一部分（缺口写在该条 note） |
| `absent` | 5 | 引擎有、emulator 完全没有 |
| `n/a-known` | 24 | 与本 2D 精灵 + 消息窗重写无关（必须写 why） |
| **合计** | **146** | 需要关注（非 n/a 且非已核验）= **44** |

## 按子系统

| 子系统 | 条数 | 其中 缺失/部分 |
|---|---|---|
| 3D | 17 | 1 |
| AGERC | 1 | 0 |
| Live2D | 7 | 1 |
| ScriptContext | 1 | 0 |
| 声音 | 7 | 1 |
| 存档槽 | 2 | 0 |
| 帧循环 | 19 | 5 |
| 消息窗 | 34 | 18 |
| 渲染 | 31 | 9 |
| 资源 | 17 | 3 |
| 转场 | 4 | 0 |
| 输入 | 6 | 0 |

## 全部条目

| id | 子系统 | 能力 | emulator | 依据 / 守卫 |
|---|---|---|---|---|
| `frame-pump-sound-channels` | 声音 | 每帧声音通道老化 | ✅ 已核验 | E2 · `test/audio-engine.test.ts` |
| `frame-pump-music-fade` | 声音 | 每帧 BGM 淡出推进 | ✅ 已核验 | E2 · `test/audio-engine.test.ts` |
| `frame-render-gate-mainloop` | 帧循环 | 主循环帧提交门控 | 🟠 部分 | E3 · `test/frame-render-gate.test.ts` |
| `scene-frame-commit` | 渲染 | Scene 逐帧提交（四路归并 + 绘制） | 🟠 部分 | E2 · `test/draw-item-slot-coverage.test.ts` |
| `scene-beginscene-recursion-gate` | 渲染 | BeginScene/EndScene 递归门 | ➖ n/a | E1 |
| `scene-frame-texture-gate-46672` | 3D | 帧纹理（离屏表面）指针门 | ➖ n/a | E1 |
| `scene-framebuffer-offset-compensate-46696` | 渲染 | 双缓冲显示偏移补偿开关 | ➖ n/a | E1 |
| `scene-capture-target-flag-46680` | 渲染 | Capture 目标为主/后缓冲（38 号）标记 | ➖ n/a | E1 |
| `scene-render-3d-frame-request-46700` | 3D | 请求显式渲染一帧 3D | ➖ n/a | E1 |
| `scene-3d-effect-level-writer` | 3D | 3D 效果等级的初始化决策 | ✅ 已核验 | E3 · `test/scene-3d-effect-level.test.ts` |
| `scene-dirty-flag-lifecycle` | 帧循环 | Scene+46508 「本帧需要重画」脏标志 | ✅ 已核验 | E2 · `test/headless-needs-render.test.ts` |
| `scene-freeze-flag` | 帧循环 | Scene+46512 动画强制冻结 | ✅ 已核验 | E2 · `test/wait-gate-timer.test.ts` |
| `scene-pending-flag-0x400-gate` | 转场 | Scene+46516 转场/等待在途标志（0x400 卫门值） | ✅ 已核验 | E3 · `test/wait-gate-timer.test.ts` |
| `scene-flag-46528-bits` | 帧循环 | Scene+46528 bit1/bit2 冻结豁免 | ✅ 已核验 | E2 · `test/wait-gate-timer.test.ts#i242 <h> 1` |
| `scene-norender-mode` | 渲染 | Engine+167990 = display:ScreenMode 镜像（窗口/全屏模式；非 0 时跳过一批窗口同步门） | 🟠 部分 | E1 · `test/engine-config.test.ts` |
| `3d-effect-level-gate` | 3D | Scene+46668 3D 特效等级 | ➖ n/a | E1 |
| `scene-render-freeze-46676` | 渲染 | Scene+46676 3D/文字渲染冻结总闸 | ✅ 已核验 | E3 · `test/t0167-blend-env-frozen.test.ts#BlendEnv.sceneFrozen` |
| `engine-main-window-hwnd` | 渲染 | Engine+387924 主窗口 HWND（别名 FileSource） | ➖ n/a | E1 |
| `filesource-script-load` | 资源 | 脚本装载把主窗口 HWND 当资源来源传入 | ➖ n/a | E1 · `test/boot.test.ts` |
| `scene-draw-total-gate-1056` | 渲染 | Scene+1056 转场记录表条数（不是主绘制总门） | ✅ 已核验 | E2 · `test/scene-t0154-scene-state.test.ts` |
| `clock-write-clock-freeze` | 帧循环 | 每帧时钟写入与时钟冻结门 | 🟠 部分 | E3 · `test/frame-render-gate.test.ts` |
| `clock-read-drawitem-5-windows` | 渲染 | DrawItem 5 窗动画驱动（透明度 / 旋转×2 / 轴角 / UV） | ✅ 已核验 | E3 · `test/draw-item-anim-window.test.ts` |
| `clock-read-meshentry-color-window` | 渲染 | MeshEntry 颜色/α 动画窗 | ✅ 已核验 | E3 · `test/mesh-vertex-quad.test.ts` |
| `clock-read-transition-window` | 转场 | 转场窗口进度与扫描带绘制 | ✅ 已核验 | E3 · `test/transition-corpus-e3.test.ts` |
| `render-range-clip-by-index` | 渲染 | 按索引区间的绘制范围裁剪 | ✅ 已核验 | E2 · `test/transition-render-wiring.test.ts#D3` |
| `render-merge-two-pass-reorder` | 渲染 | 四路归并（DrawItem/MeshEntry/两 572B 节点）与 |0x10000 回置 | ✅ 已核验 | E2 · `test/transition-render-wiring.test.ts#D3` |
| `render-3d-layer-dual-commit` | 3D | 脚本 i222 驱动的区间提交（sub_4B4460） | ✅ 已核验 | E3 · `test/op-222-scene-commit.test.ts` |
| `render-endscene-and-2d-stack` | 渲染 | 2D 矩阵栈 Begin/End 配对与 EndScene | ➖ n/a | E1 |
| `transition-table-flush` | 转场 | 转场表帧尾收尾（sub_4A9BE0） | ✅ 已核验 | E2 · `test/sc-transition-window.test.ts#T-0091 G2` |
| `lazy-effect-200-201-release` | 3D | 2D/3D effect 槽（46480 起 5 槽）的批量释放 | ➖ n/a | E1 |
| `renderer-state-reset-each-frame` | 渲染 | 渲染态重置（sub_498B60） | ➖ n/a | E1 |
| `audio-device-init` | 声音 | DirectSound 设备/对象重建 | 🟠 部分 | E2 · `test/t0167-audio-device-fail.test.ts#设备创建失败` |
| `movie-object-lifecycle` | 帧循环 | 电影对象帧内生命周期 | ❌ 缺失 | E0 |
| `scene-drawtable-flush-and-dirty` | 渲染 | 清空绘制节点并置脏（opcode 侧） | ✅ 已核验 | E2 · `test/l2d-clear-on-container-ops.test.ts` |
| `script-queue-dispatch` | 帧循环 | 脚本派发队列出队 | ✅ 已核验 | E3 · `test/op-1f5-dequeue.test.ts` |
| `script-frame-refresh-opcode-20c` | 帧循环 | opcode 0x20C 脚本帧刷新并提交 | ✅ 已核验 | E2 · `test/engine-config.test.ts` |
| `live2d-slot-probe` | Live2D | Live2D 10 槽探测（强制重画理由之一） | ✅ 已核验 | E3 · `test/l2d-render-pending.test.ts` |
| `vertex-buffer-lock-scale` | 渲染 | 顶点缓冲 Lock/Unlock + 视口缩放改写 | ❌ 缺失 | E0 |
| `world-matrix-identity-refresh` | 3D | 每帧世界/投影矩阵复位与链乘 | ✅ 已核验 | E2 · `test/op-22a-22f-scene-world.test.ts` |
| `sprite-2d-draw-layer` | 渲染 | 无脚本/标题态额外 2D 层绘制 | ❌ 缺失 | E0 |
| `scene-slot-release-1000` | 渲染 | 1000 个场景对象槽的逐帧老化释放 | ❌ 缺失 | E0 |
| `lazy-effect-200-201` | 3D | 惰性创建 2D/3D effect（资源 200/201） | ➖ n/a | E1 |
| `lazy-3d-effect-203` | 3D | 惰性创建 3D effect（资源 203） | ➖ n/a | E1 |
| `lazy-3d-effect-202-snow` | 3D | 惰性创建 3D effect（资源 202，雪花） | ➖ n/a | E1 |
| `lazy-sprite-recreate` | 渲染 | CSprite 释放后重建 | ➖ n/a | E1 |
| `lazy-d3d9-device-init` | 渲染 | D3D9 对象与设备的释放-重建 | ➖ n/a | E1 |
| `lazy-texture-slot` | 资源 | CTexture 槽（1000）释放-重建 | 🟡 已建模未核验 | E2 · `test/texture-lifecycle.test.ts` |
| `lazy-mesh-slot` | 3D | mesh 槽（1000）释放-重建 + 惰性分配器单例 | ➖ n/a | E1 |
| `lazy-mesh-alloc-hierarchy-singleton` | 3D | D3DX 网格加载分配器单例 | ➖ n/a | E1 |
| `lazy-live2d-slot` | Live2D | Live2D 实例槽表（`Scene+55812`，**10** 槽）与「槽非空先析构再建」 | ✅ 已核验 | E3 · `test/live2d-chain.test.ts` |
| `lazy-vram-query-32` | 资源 | 显存容量查询惰性缓存（32 位） | ➖ n/a | E1 |
| `lazy-vram-query-64` | 资源 | 显存容量查询惰性缓存（64 位 QWORD） | ➖ n/a | E1 |
| `lazy-movie-object` | 帧循环 | 电影对象按显示模式创建 | ❌ 缺失 | E0 |
| `lazy-movie-dll` | AGERC | 惰性模块加载 = AGERC 模块接口（0x14B/0x14C/0x14D；**不是**影片解码库） | ✅ 已核验 | E2 · `test/op-a4-a6.test.ts` |
| `lazy-movie-texture-slot` | 资源 | 电影纹理槽（每索引）惰性创建 | 🟠 部分 | E2 · `test/t0164-misc-batch.test.ts#★P3 0x20F：该槽纹理表为空 ⇒ 抛错` |
| `lazy-gdi-font-set` | 消息窗 | 消息窗字体句柄组的重建（主套 CreateFontIndirectA ×10 / 注音套 ×4）——含字形度量面与两张 lfEscapement=1800 竖排面 | 🟠 部分 | E2 · `test/text-font-rebuild-set.test.ts` |
| `lazy-script-operand-hashmap-node` | 资源 | 脚本 VM 操作数 HashMap 节点惰性分配 | 🟡 已建模未核验 | E1 |
| `lazy-transition-map-node` | 转场 | 过渡表节点惰性插入（表头 eager） | ✅ 已核验 | E2 · `test/sc-transition-window.test.ts` |
| `lazy-drawitem-map-node` | 渲染 | DrawItem 表节点惰性插入（表头 eager 130312） | ✅ 已核验 | E3 · `test/draw-item-anim-window.test.ts` |
| `lazy-mesh-map-node` | 3D | MeshEntry 表节点惰性插入（表头 eager 130348） | ✅ 已核验 | E2 · `test/blend-mode.test.ts#0x322 的 op2 必须落进 MeshObj.blend` |
| `lazy-572b-node-map` | 渲染 | 572B 节点表（精灵/特效）惰性插入 | 🟠 部分 | E3 · `test/live2d-chain.test.ts` |
| `lazy-scene-effect-release-gap` | 3D | Scene+46492 / +46496 两张 effect 的释放缺口 | ➖ n/a | E1 |
| `bullet-dirty-from-freeze-or-pending` | 帧循环 | 冻结/pending 强制延续刷帧 | ✅ 已核验 | E3 · `test/scene-t0154-scene-state.test.ts#没有**可冻结窗时也要置脏` |
| `chained-3d-layer-commit` | 3D | 572B「立绘 / 变换节点」层的归并与提交（原被误标为「3D 场景层」） | ✅ 已核验 | E3 · `test/live2d-render.test.ts` |
| `adv-flag-lifecycle` | 消息窗 | ADV 激活位（effect_flags 0x8000000）的设置与清除 | 🟠 部分 | E2 · `test/adv-msgwin.test.ts#0x71 在跳读/自动模式（97050≠0）下保留显示态并置 ADV` |
| `adv-perframe-dispatch` | 帧循环 | ADV 激活时的每帧处理：派发 1 条脚本指令 + 输入泵 | ✅ 已核验 | E2 · `test/adv-msgwin.test.ts#ADV 每帧服务：未显示完判定成立时清掉 ADV` |
| `adv-text-reveal-progress` | 消息窗 | 消息文本显示进度判定（ReadTextSkip 门 + 分段表查表） | 🟠 部分 | E2 · `test/t0151-msgwin-vm.test.ts#★0x6E 门序` |
| `msgwin-text-object` | 消息窗 | 文本对象（Engine+85296，dword 写法 Engine[21324]）的槽模型与排版入队 | 🟠 部分 | E2 · `test/t0151-msgwin-vm.test.ts#★0x7D` |
| `adv-input-pump-perframe` | 输入 | ADV 每帧输入泵与「跳读中」掩码位 | ✅ 已核验 | E2 · `test/adv-msgwin.test.ts#0xFA poll-msg-advance 已注册且不抛错` |
| `msgwin-object-table` | 消息窗 | 消息窗对象表与布局重算（Engine[21585+idx]） | 🟠 部分 | E2 · `test/t0151-msgwin-vm.test.ts#★0x301` |
| `msgwin-cancel-key-state` | 消息窗 | 「取消消息键」三态机（Engine+122370）与 ReadTextSkip 的运行期开关 | 🟠 部分 | E2 · `test/config-t0161.test.ts` |
| `adv-advance-opcodes` | 消息窗 | ADV 推进指令族（0x6E / 0x72 / 0xFA / 0x1CA）—— 属**指令集**，非每帧行为 | ✅ 已核验 | E2 · `test/adv-msgwin.test.ts#★0x72 wait-for-input：结束一页并置等待推进门` |
| `msgwin-text-method-opcodes` | 消息窗 | 消息窗文本方法族（0x6E show-text / 0x6F end-text-line / 0x71 message-show / 0x72 wait-for-input / 0x196 display-furigana） | 🟠 部分 | E2 · `test/adv-msgwin.test.ts#★重跑 0x72（悬停 ret 回到门指令）不得重启已显完的逐字显现` |
| `msgwin-attr-font-opcodes` | 消息窗 | 文本属性 / 描边 / 字体 / 注音指令族（0x75/0x76/0x77/0x78/0x81/0x8B/0x1A4/0x197/0x1A5/0x2BD/0x2BE/0x2DB/0x2FE/0x196 等）—— 属**指令集** | 🟠 部分 | E2 · `test/t0151-msgwin-vm.test.ts#★0x75` |
| `adv-advance-route-table` | 消息窗 | 点击热点 / 路由表（Engine+0x55D8）与「推进」的真实判据 | 🟠 部分 | E2 · `test/adv-right-click-cancel-route.test.ts` |
| `msgwin-config-gates` | 消息窗 | 消息/ADV 路径上的配置门与「当前走不到的分支」 | ✅ 已核验 | E3 · `test/config1-chain.test.ts` |
| `msgwin-config-read-opcodes` | 消息窗 | 配置回读指令族（0xC5/0xC7/0x1B8/0x2CC/0x2E6/0x2EA/0x194/0x1CB）—— 属**指令集** | ✅ 已核验 | E2 · `test/config-read.test.ts` |
| `text-layout-wrap-ruby` | 消息窗 | 文本排版：逐字像素量宽 + 边界硬断 + 注音配对（sub_46BE30） | ✅ 已核验 | E2 · `test/text-layout.test.ts` |
| `msgwin-offscreen-surface-lifecycle` | 消息窗 | 每窗一张离屏表面：0x70 重建 / 0x71 清底 / sub_45BE20 逐行贴出 | 🟠 部分 | E0 |
| `msgwin-line-fade-window` | 消息窗 | 行淡入：DrawItem 颜色动画窗，时长 = MessageSpeed × MessageFade / 100 ms | 🟠 部分 | E1 |
| `msgwin-backlog-cursor` | 消息窗 | 已读文本回看：页表 Font+3380 + 72B 回看项 + 光标 sub_459770 | 🟠 部分 | E2 · `test/msgwin-backlog-wheel.test.ts` |
| `text-drawmode-fork` | 消息窗 | set:DrawMode 双路径：0 = GDI 整串 TextOutA / 1 = D3DX 逐字 GetGlyphOutline | ➖ n/a | E1 |
| `text-font-rebuild-cascade` | 消息窗 | 字体参数 → 句柄重建级联（0x75/0x197/0x1A5/0x2FE/0x2BD/0x2BE/0x2DB → sub_459F40 / sub_45A6E0） | 🟠 部分 | E2 · `test/config1-chain.test.ts#排版结果进入渲染模型` |
| `msgwin-window-reveal-gate-300` | 消息窗 | 每窗「逐行贴出」闸门 + 贴出完成后的延时清场循环（Engine[122466+win] bit0/bit16、Engine[122476+win]；op 0x300 = sub_426990） | ✅ 已核验 | E3 · `test/char-reveal.test.ts` |
| `msgwin-char-reveal-grid` | 消息窗 | 字格图标动画（0x73 = ▼「点击继续」精灵表网格）+ 文字逐字泵（sub_45BE20） | 🟠 部分 | E2 · `test/char-reveal.test.ts` |
| `gfx-texture-load-sync` | 资源 | 纹理加载的同步性：set-texture(0x1F9) 在同一指令内完成 读文件 + 解码 + 装槽 ⇒ 同帧「绑定 + 绘制」不可能错位 | ✅ 已核验 | E2 · `test/texture-frame-barrier.test.ts` |
| `drawitem-world-matrix-composition` | 渲染 | DrawItem 世界矩阵合成（pivot 夹逼 + work 缩放/旋转/平移）与 `+0x68` 用世界矩阵门 | ✅ 已核验 | E2 · `test/draw-item-scale.test.ts` |
| `glyph-raster-direct-to-slot` | 消息窗 | 字形光栅化（GetGlyphOutline + 覆盖率 α）直绘到纹理槽（0x204 draw-string → sub_456710） | ✅ 已核验 | E2 · `test/draw-string.test.ts` |
| `script-frame-local-pool-lifecycle` | 帧循环 | 脚本帧局部池的生命周期：每次载入重建（`sub_40ED40` 建池 + local_int 填 enc_zero） | ✅ 已核验 | E3 · `test/config1-chain.test.ts` |
| `text-style-scope-queue-time` | 消息窗 | 文本样式的**消费时机与作用域**：排版入队时把字体/颜色烘进该窗离屏表面，此后改全局样式不回溯 | ✅ 已核验 | E3 · `test/text-style-snapshot.test.ts` |
| `engine-config-registry-persistence` | 资源 | 引擎配置注册表（SYS4REG.INI）：启动装载 → 脚本读写 → 写盘 | ✅ 已核验 | E3 · `test/config-version-substr.test.ts` |
| `save-data-tables-persistence` | 资源 | SAVE.DAT：脚本 save-int/save-string 两张表的持久化（= 设置界面那些开关真正存的地方） | ✅ 已核验 | E3 · `test/save-data.test.ts` |
| `append-pack-discovery-and-activation` | 资源 | 扩展包（APPENDnn.AAI / APPENDnn.ALF）的发现、注册与激活 | ✅ 已核验 | E3 · `test/append-packs.test.ts` |
| `audio-module-topology-and-volume-routing` | 声音 | 音频三模块拓扑与音量路由（设备 / SE / Voice / Music） | ✅ 已核验 | E2 · `test/audio-engine.test.ts` |
| `voice-request-deferral-and-adv-gate` | 声音 | ADV 激活期间的语音寄存与冲刷（文本↔语音联动） | ✅ 已核验 | E2 · `test/audio-engine.test.ts` |
| `music-number-table-lifecycle` | 声音 | BGM 曲号表（PCM 扁平表 + 分组表）的装载、增长与解析 | ✅ 已核验 | E3 · `test/music-table.test.ts` |
| `gallery-unlock-file-used-flags` | 资源 | 回想/鉴赏的解锁标志（FileDB「已使用文件」表）与收集度 | 🟠 部分 | E4 · `test/gallery-bgm-list.test.ts` |
| `texture-bind-synchronous-then-query` | 资源 | set-texture 是同步装载 ⇒ 同帧「绑定 → 查尺寸/查 imgid → 画」必然一致 | 🟠 部分 | E2 · `test/texture-frame-barrier.test.ts` |
| `mesh-vertex-quad-and-per-vertex-color` | 3D | Mesh 是「按 create-mesh 参数生成的顶点四边形 + 逐顶点 diffuse」，不是全屏黑覆盖层 | ✅ 已核验 | E3 · `test/mesh-vertex-quad.test.ts` |
| `scene-3d-weather-effects-rain-snow-leaf` | 3D | 3D 天气/粒子效果管理器（Rain / Snow / Leaf）的创建·重建·逐帧推进·销毁 | 🟠 部分 | E3 · `test/scene-3d-weather.test.ts#推进 N 次后粒子状态` |
| `passive-camera-and-effect-render-state` | 帧循环 | 3D 效果的逐帧渲染状态重设（不是 opcode 设置的） | ✅ 已核验 | E3 · `test/scene-3d-weather.test.ts` |
| `agerc-module-interface-and-version-lock` | 资源 | AGERC.DLL 模块接口：启动时加载 + 版本锁 + 100 槽导出表 | ✅ 已核验 | E3 · `test/op-a4-a6.test.ts` |
| `text-item-record-table` | 消息窗 | 文本项记录表（Font+3364 的 72B/条 vector）：回想/历史与语音重播的账本 | ✅ 已核验 | E3 · `test/op-a2-a3.test.ts` |
| `text-redisplay-rewind` | 消息窗 | 文本重显示：`0x7B` 设本帧回退游标 + `0x199` 回退重画 | ✅ 已核验 | E3 · `test/op-a2-a3.test.ts` |
| `gfx-prim-mesh-and-render-state` | 渲染 | A4：图元变换 / 槽→槽 blit / 呈现清屏 / 转场表 / 绘制模式 / DrawItem·MeshEntry 属性 / 3D 颜色（13 条） | 🟠 部分 | E3 · `test/gfx-prim-mesh-consumers.test.ts` |
| `single-field-timers-audio-device` | 帧循环 | A5：单行字段写 / 秒计时器 / 消息面 / 音频设备（9 条） | ✅ 已核验 | E2 · `test/op-a5.test.ts` |
| `hover-ret-reruns-gate-op` | 输入 | 悬停/点击 label 的返回点 = 门指令（ret 回到门指令重跑） | ✅ 已核验 | E3 · `test/game-start-chain.test.ts` |
| `text-reveal-pump-409400` | 帧循环 | 逐字显现泵：sub_409400 自旋 + sub_45BE20 一次一个字 + message:MessageSpeed 节拍（每字毫秒） | ✅ 已核验 | E3 · `test/adv-msgwin.test.ts#★逐字显现速度定律：MessageSpeed = **每字**毫秒` |
| `save-slot-chain` | 资源 | 存档槽链路：SAVE%2.2d.DAT（0x19E 存 / 0x1A1 读 / 0x1A0 读头 / 0x19F 短读 / 0x1AB 删 / 0x1AC 复制）与 .STH 状态块（0x1AE/0x1AF） | ✅ 已核验 | E4 · `test/save-slot-chain.test.ts` |
| `input-wheel-two-accumulators` | 输入 | 两个滚轮累加器：竖直（WM_MOUSEWHEEL）与水平（WM_MOUSEHWHEEL）各自独立、各自一次性消费 | ✅ 已核验 | E3 · `test/wheel-as-key.test.ts` |
| `text-aa-config-gate` | 消息窗 | 文本抗锯齿是一把配置门：只有 set:EnableAntiFont 为真才读 message:UseAntiFont 写 Font+1352 | 🟠 部分 | E2 · `test/text-aa.test.ts` |
| `save-slot-thumbnail-bmp` | 资源 | 存档缩略图：SAVE%2.2d.STH = 320x180 24bpp BMP（0x1AE 按 op3 纹理槽写 / 0x1AF 按 op3 纹理槽读） | ✅ 已核验 | E4 · `test/save-thumb.test.ts` |
| `bold-is-lfweight-face-mapping` | 消息窗 | 加粗 = 一次 lfWeight=700 的字体映射请求（引擎不做合成加粗，配置里也没有独立的「粗体面」键） | ✅ 已核验 | E2 · `test/font-bold-face.test.ts` |
| `text-line-pitch-font-1380` | 消息窗 | 换行步进 = 字号 + 行间距 Font+1380（i08b）—— 注音不压上一行的唯一来源 | ✅ 已核验 | E2 · `test/text-layout.test.ts` |
| `drawitem-mesh-blend-selector` | 渲染 | DrawItem+0x30 / MeshEntry[9] 的 alpha 混合选择子（0/1/2/3 一套枚举） | ✅ 已核验 | E2 · `test/blend-mode.test.ts` |
| `text-face-source-memory-vs-system` | 消息窗 | 正文面名的来源：引擎只注册一份内存字体（游戏自带的 AGE-EXTEND.TTF / 面 'AGE Extend'），message:Font 指定的正文面由**系统字体表**解析 | ➖ n/a | E1 |
| `text-white-level-on-composite` | 消息窗 | 引擎画的文字在成片上被压到 ≈0.89×白（实测；同屏美术图不受影响）—— 机制未定位 | ✅ 已核验 | E4 · `test/text-aa.test.ts` |
| `text-glyph-coverage-alpha-composite` | 渲染 | 文字字形按覆盖率 α 合成（写入面：RGB 按 α 混合、A = max(A_dst, α)）——"白字"永不纯白、"往透明表面画字"偏灰 | ✅ 已核验 | E2 · `test/text-aa.test.ts` |
| `key-dispatch-default-slot` | 输入 | 0x100 空掩码时的「默认键」槽派发（下标 = SetKeyTotal） | ✅ 已核验 | E2 · `test/input.test.ts` |
| `host-cursor-warp` | 输入 | 把系统光标移到虚拟屏坐标（0x10A 的宿主侧 / SetCursorPos） | ✅ 已核验 | E3 · `test/native-host.test.ts` |
| `live2d-enabled-config-flag` | Live2D | Live2D 开关（`global a9d0`）与静态贴图回落 | 🟠 部分 | E3 · `test/live2d-enabled-flag.test.ts` |
| `l2d-node-draw-gate` | Live2D | 572 字节「立绘 / 变换节点」的出画门控（只有 L2D 槽真有模型才出画） | ✅ 已核验 | E3 · `test/live2d-render.test.ts` |
| `live2d-node-draw-advance` | Live2D | L2D 的「动作推进」与「出画」是同一次调用（没有独立的逐帧 tick） | 🟡 已建模未核验 | E3 · `test/live2d-blink.test.ts` |
| `live2d-mesh-batches` | Live2D | Live2D 出画几何：顶点/UV/索引流 + 画布居中摆放 + 归并成三角批次 | ✅ 已核验 | E3 · `test/live2d-render.test.ts` |
| `stage-stepper-0x40-gate` | 帧循环 | 阶梯动画时间表（0x40 门 + sub_408F10 调度器） | ✅ 已核验 | E3 · `test/stage-loop.test.ts` |
| `music-runtime-current-track-lifecycle` | 声音 | BGM 运行态「当前曲 id」的生命周期（起播/停/换曲/存档/读档重播） | ✅ 已核验 | E2 · `test/slot-save-resume.test.ts` |
| `load-restores-image-slots-and-scoped-pools` | 存档槽 | 读档装载：按槽表重建图像 + int 池只覆盖 0..池长 | ✅ 已核验 | E2 · `test/slot-load-resume.test.ts` |
| `load-runs-callback-before-record0` | 存档槽 | 读档时帧 0 先跑 CALLBACK_LOAD.BIN（上一个画面的收尾），它 exit 后才装记录 0 的脚本 | ✅ 已核验 | E2 · `test/slot-load-resume.test.ts` |
| `scene-teardown-on-load-point` | 渲染 | 读档装载点清空绘制项容器 + 从存档 body 还原绘制项清单（raw 19806-19832） | ✅ 已核验 | E3 · `test/slot-load-screen.test.ts` |
| `drawitem-loop-anim-frame-drive` | 渲染 | 绘制项 B 族（flags bit2）周期/循环动画的逐帧求值 | 🟠 部分 | E2 · `test/draw-item-loop-anim.test.ts` |
| `text-blank-extent-mode-gate` | 消息窗 | 空白字前进量的配置门 set:BlankExtentMode | 🟠 部分 | E2 · `test/op-205-blank-extent.test.ts` |
| `scene-layer-xform-compose-20-29` | 渲染 | Scene 世界矩阵的合成与「只作用于层号 ∈ [20,30) 的项」这一级 | ✅ 已核验 | E3 · `test/op-22a-22f-scene-world.test.ts` |
| `save-load-drawitem-clear-and-restore` | 资源 | 读档装载点：清空绘制项容器 + 还原存档里的绘制项清单（Scene+1032） | ✅ 已核验 | E4 · `test/engine-slot.test.ts` |
| `live2d-node-matrix-compose` | Live2D | 572B 节点的矩阵合成（sub_4A07F0）：4 个窗求值 + 行向量组合 + 就地推进 | ✅ 已核验 | E3 · `test/l2d-node-compose.test.ts` |
| `texture-bind-async-stale-writeback` | 资源 | 纹理槽绑定的时序：引擎 set-texture 同步，宿主异步 ⇒ 陈旧载入不得覆盖脚本后来画的表面 | ✅ 已核验 | E3 · `test/texture-bind-race.test.ts` |
| `input-keyboard-to-mask-bits` | 输入 | 键盘 VK → 掩码位 0..6（每帧 GetAsyncKeyState 轮询） | ✅ 已核验 | E2 · `test/keyboard-mask.test.ts` |
| `copyright-effect` | 帧循环 | 版权页（LOGO）的 frame 效果：mesh 顶点色窗 + draw-item diffuse-alpha 窗 + timeGetTime 时钟 | ✅ 已核验 | E2 · `test/mesh-vertex-quad.test.ts` |
| `texture-absent-draw-is-dropped` | 渲染 | 槽没有纹理对象时，所有"用这个槽"的绘制/处理**整笔丢弃**（只写一行 Error.log，无替代纹理） | 🟡 已建模未核验 | E1 · `test/missing-texture-skips-item.test.ts` |
| `msgwin-coexist-auto-message` | 消息窗 | 共存自动翻页（0x1B7 置位 → 0x72 尾段武装计时器 → 等待泵 LABEL_44 到期自动推进） | 🟠 部分 | E2 · `test/adv-msgwin.test.ts` |
| `msgwin-vertical-rect-pad` | 消息窗 | 竖排文本的字形补白：目标矩形与采样原点**同步**位移（0x260 的四个值） | ➖ n/a | E1 · `test/adv-msgwin.test.ts` |
| `backlog-drawn-row-recording` | 消息窗 | 已画文本行的记账（`sub_45F090`：每画一段正文就往 Font+3364 补一条**带串**的 72B 记录）与它的消费端 `0x1D1` | 🟠 部分 | E3 · `test/recall-page-0x1d1.test.ts#记录切片` |
| `queue-int-family-reset-on-exit-script` | 帧循环 | exit-script 的整体复位把 Queue_int / Stack_int 两族容器逐个**重建为空容器** | ✅ 已核验 | E2 · `test/t0156-control-frame.test.ts#整体复位重建 Queue_int 族` |
| `script-request-queue-drain-dispatch` | 帧循环 | 脚本请求队列只在三处被放行（0x1F5 停靠结束 / 0x7C 列表收尾 / 0x2 的 -10 恢复臂） | 🟠 部分 | E2 · `test/op-1f5-dequeue.test.ts#停靠期间入队的请求在清停靠标志那一刻被派发` |
| `script-global-int-pool-from-sys4ini` | ScriptContext | 脚本全局 int 池（boot 时从 SYS4INI.BIN 的池块装载） | 🟡 已建模未核验 | E3 · `test/t0107-infoen-real-id.test.ts` |
| `present-without-backbuffer-clear` | 渲染 | 逐帧 present **不清后缓冲**（两处整屏 ClearTarget 都被恒 0 的 `Scene+46460` 位守卫） | 🟠 部分 | E3 · `test/frame-hold-cover.test.ts` |
| `adv-text-color-state-carryover` | 消息窗 | ADV 正文颜色/描边的状态归属：复位点只有「场景入口块」，读档既不还原也不复位 | 🟡 已建模未核验 | E1 |

## 缺口明细（`absent` / `partial`）

### `frame-render-gate-mainloop`（partial）

- **能力**：主循环帧提交门控
- **触发**：`Engine+667856==1` 且（`Engine+667860`≠0 或 effect_flags&0x2400）且 effect_flags&0x1000000==0 且 !v93 且(Scene 有脏或对象命中)
- **缺失时为什么静默**：门不满足时整条 `sub_4B4040` 调用被跳过，画面保持上一帧且无任何诊断输出
- **引擎**：sub_412290, sub_40BE10 @ raw 20740-20760
- **读的字段**：Engine+667856, Engine+667860, Engine+699204, Engine+369332, Scene+46508
- **emulator 现状**：2026-09 T-0167（审计 §4.2 #3/#6/#7）已把引擎门逐项落地为纯函数 `frameRenderGate(e, suspended)`（src/frame/loop.ts；逐字复刻 raw 20740-20761）：① `Engine+667856==1`（`set:DrawMode`）② `Engine+675968`（宿主 `renderSuspended()` 缝；写点 …

### `scene-frame-commit`（partial）

- **能力**：Scene 逐帧提交（四路归并 + 绘制）
- **触发**：主循环帧提交门放开，或脚本执行 opcode 0x20C，或其它子系统直调
- **缺失时为什么静默**：脏标志为 0 或 `Scene+1056==0` 时内部各分支自然不成立，函数正常返回，无日志
- **引擎**：sub_4B4040, sub_4B06D0, sub_41A1A0 @ raw 134417-136966
- **读的字段**：Scene+46508, Scene+46516, Scene+46512, Scene+46500, Scene+1860, Scene+46456, Scene+46676, Scene+1056
- **emulator 现状**：声明已按审计收窄（2026-09-21，收口 T-0075 审计的 no-evidence）：本条的 `guard`（`test/draw-item-slot-coverage.test.ts`）只断言「`draw-texture` 绘制项按槽绑定（比例 ≥0.95、存在 tex≠layer 项）」，不覆盖"四路归并"这条声明（`renderer/pixi/presenter.ts:208-210…

### `scene-norender-mode`（partial）

- **能力**：Engine+167990 = display:ScreenMode 镜像（窗口/全屏模式；非 0 时跳过一批窗口同步门）
- **触发**：启动参数（WinMain raw 142044 配套置 effect_flags|0x80000）或脚本经 raw 40114 读取该值；本文件内无写入点
- **缺失时为什么静默**：19 处门全是 `if (!_this[167990])`：非零时跳过「消息框前后隐藏/恢复窗口」「窗口尺寸同步」，脚本继续跑，完全无日志
- **引擎**：sub_405530, sub_4065F0, sub_406650, sub_40A4C0, sub_425DB0, sub_425E20, sub_42EE10, sub_42FBC0, sub_430A20, sub_431BA0, sub_431CF0, sub_432000, sub_433AB0, sub_4B92F0 @ raw 11132-141165
- **读的字段**：Engine+167990
- **emulator 现状**：`Engine+167990` = `display:ScreenMode` 的镜像：唯一写入点 raw 11980（`GetConfig("display:ScreenMode") != 0`），并有 19 处 `!Engine[167990]` 门控窗口/全屏相关操作（raw 14778、21498-21860），21643 还有 `671960 != 0 ? 0 : 2` 的全屏档；emul…

### `clock-write-clock-freeze`（partial）

- **能力**：每帧时钟写入与时钟冻结门
- **触发**：主循环每帧写 `Engine+369332`；opcode 0x20C / `sub_41A090` / `sub_41A2C0` 也写；`Engine+107438` 非零时只递增 107439
- **缺失时为什么静默**：时钟停走时动画只是静止，所有基于时间的比较都合法
- **引擎**：sub_412290, sub_41A090, sub_41A2C0, sub_41A1A0 @ raw 20750-20751
- **读的字段**：Engine+369332, Engine+369336, Engine+107438
- **emulator 现状**：主循环那条时钟写已落地 —— `frameRenderGate()`（src/frame/loop.ts）在门成立时执行 `ENGINE_FIELD.clockPrev ← clock; clock ← nowMs`（raw 20750-20751 逐字），守卫 test/frame-render-gate.test.ts 第 ⑤/⑥/⑦ 例（DrawMode=1+667860 才写；默认 Dra…

### `audio-device-init`（partial）

- **能力**：DirectSound 设备/对象重建
- **触发**：引擎初始化：`sub_406CE0`（raw 12011-12038，按 `set:Sound` / `Sound:UseDirect` 决定要不要 DirectSound）→ `sub_4B5C50`（raw 138380 惰性 `LoadLibrary("DSOUND.DLL")`）→ `sub_4B5CF0`（raw 138415 `DirectSoundCreate`）→ `sub_4B6A60`（raw 139123 SoundBuffer 构造）；★`sub_4B69B0`（raw 139092）是 **Sound 析构**（置 `Sound___vftable_` + 15 次 `DeleteCriticalSection`），入口 = Engine 析构 `sub_413970`（raw 21426）与 deleting-dtor `sub_4B6A30`；`sub_4B6940`（raw 139063）是 set-volume（写 `设备[375+ch]` 并钳 ±10000）
- **缺失时为什么静默**：DSOUND.DLL 缺失时 `DirectSoundCreate` 取不到，所有播放调用变成空操作，无报错
- **引擎**：sub_406CE0, sub_4B5C50, sub_4B5CF0, sub_4B6A60, sub_4B6940, sub_4B69B0 @ raw 12011-139110
- **读的字段**：Engine+18664
- **emulator 现状**：已实现：① WebAudio 宿主（`AudioContext` 懒创建 + resume + 首次手势兜底）；② ★设备创建失败档（审计 §4.2 #35 的 `missing-behavior`）：`#ensureCtx` 接住建 `AudioContext` 的异常 ⇒ 置 `deviceFailed`/`deviceError`（`info()` 可查）、留引擎同文的失败串（raw 138…

### `movie-object-lifecycle`（absent）

- **能力**：电影对象帧内生命周期
- **触发**：`effect_flags & 0x2000` 且 `Engine+378684` 非零；播完或收到 0x10 输入时删除
- **缺失时为什么静默**：对象为空时只清 0x2000 位并跳转 `LABEL_126`，不报错
- **引擎**：sub_412290 @ raw 20896-20917
- **读的字段**：Engine+699204, Engine+378684, Engine+699208
- **emulator 现状**：影片播放未实现（0x20F 只记录）

### `vertex-buffer-lock-scale`（absent）

- **能力**：顶点缓冲 Lock/Unlock + 视口缩放改写
- **触发**：`Scene+46676 == 0` 且脚本深度非 38/负值时才改写顶点
- **缺失时为什么静默**：Lock 成功但 vcount<=0 时循环体不执行；仅 Lock 失败才 sprintf_s + `sub_4034C0`
- **引擎**：sub_4AF1C0, sub_4A1F00, sub_4A2050 @ raw 133571-133612
- **读的字段**：Scene+46676, Scene+1860, Scene+46456
- **emulator 现状**：mesh 的顶点几何与逐顶点色已建模（见 `mesh-vertex-quad-and-per-vertex-color`，modeled-verified/E3，守卫 `test/mesh-vertex-quad.test.ts`；`0x320` 的 op2..op8 是数组基址）。本条残余的缺口与 mesh 四边形无关。

### `sprite-2d-draw-layer`（absent）

- **能力**：无脚本/标题态额外 2D 层绘制
- **触发**：`Scene+46700` 非零且（脚本深度 <0 或 ==38）
- **缺失时为什么静默**：字段为 0 时该分支不执行，正常进下一步
- **引擎**：sub_49FCD0, sub_4B4040 @ raw 136832-136833
- **读的字段**：Scene+46700, Scene+46456
- **emulator 现状**：无脚本/标题态的额外 2D 层未建模

### `scene-slot-release-1000`（absent）

- **能力**：1000 个场景对象槽的逐帧老化释放
- **触发**：`Engine+675972` 非零（存在需刷新对象）
- **缺失时为什么静默**：槽为 0 时直接 `++i` 继续，没有任何错误路径
- **引擎**：sub_412290, sub_488550, sub_4A4C70 @ raw 20660-20738
- **读的字段**：Engine+675972, Engine+378688, Engine+429752, Engine+699204
- **emulator 现状**：emulator 的 drawItems/meshes 是 Map（无 1000 槽上限与逐帧老化释放）；纹理槽表按需建，未做老化

### `lazy-movie-object`（absent）

- **能力**：电影对象按显示模式创建
- **触发**：`config(setCreateObject) & 1` 且目标对象非空（显示模式变更时，非严格按需）
- **缺失时为什么静默**：条件不满足则不建，主循环 0x2000 分支只清标志位，不报错
- **引擎**：sub_414940, sub_486F70, sub_485FA0 @ raw 21786-21837
- **读的字段**：Engine+697620, Engine+378684
- **emulator 现状**：影片未实现

### `lazy-movie-texture-slot`（partial）

- **能力**：电影纹理槽（每索引）惰性创建
- **触发**：`Engine+378688+4*i` 槽为空且该槽被指定为影片纹理
- **缺失时为什么静默**：多个调用点（32245 / 32528 / 32600 / 32877）共享同型守卫；失败按空槽处理，无日志
- **引擎**：sub_489040, sub_4237B0, sub_4246B0, sub_488DC0, sub_489230, sub_41A300 @ raw 31627-31630
- **读的字段**：Engine+378688, Engine+365288
- **emulator 现状**：2026-09 `T-0164` 已落地对象表那一半（本条原写「emulator 没有可绑的对象 / 本票文件范围外」，已被它推翻）：`Engine+4*slot+378688` 的等价物 = 两个宿主的 per-slot 对象表 —— `src/renderer/pixi/textureCache.ts` 的 `#slotNodes`（`noteSlotNode` 只在槽空时建、已有即复用并返回…

### `lazy-gdi-font-set`（partial）

- **能力**：消息窗字体句柄组的重建（主套 CreateFontIndirectA ×10 / 注音套 ×4）——含字形度量面与两张 lfEscapement=1800 竖排面
- **触发**：字体变更或消息窗子系统重建（`sub_40DF10` 复位区）
- **缺失时为什么静默**：字体句柄为 0 时 GDI SelectObject 静默退化；面名为空（Font+1260 首字节 0）则 sub_459F40 直接 return ⇒ 句柄全 0、文字用系统默认字体画出来，全程无错误输出
- **引擎**：sub_465390, sub_459F40, sub_45A6E0, sub_456C90, sub_456DF0, sub_459A20, sub_459C50, sub_4745A0 @ raw 70940-71273
- **读的字段**：Font+1084, Font+1096, Font+1100, Font+101852, Font+101856, Font+101860, Font+1168, Font+1232, Font+1292, Font+101972, Font+102032, Font+1408, Font+1412, Font+1416, Font+102092, Font+102096, Font+102100, Font+201680, Font+201684, Font+201784, Font+218508, Font+218512, Font+218584, Font+218592, Font+218596, Font+235068..+235104
- **emulator 现状**：T-0151 处置（审计 P2 missing-behavior）：参数面（面名映射 resolveFace / 字号 0x75·0x197 / 字重 0x2BD·0x2BE / 竖排 0x261 / msgwin.font + textLayer.ensureFont）已建模；本轮把句柄组与度量缓冲也落成可核对的数据与纯算术：① `src/text/fontSet.ts` 的 `GDI_FACE…

### `lazy-572b-node-map`（partial）

- **能力**：572B 节点表（精灵/特效）惰性插入
- **触发**：任意 572B 节点 opcode 首次触碰某个 key（`sub_4AAEC0` 取/建记录 + `sub_4A9D70`）
- **缺失时为什么静默**：默认全 0 记录，调用方按 `*result & 1` 判定未激活
- **引擎**：sub_4AAEC0, sub_4A9D70 @ raw 129394-129427
- **读的字段**：Scene+1080(表头)/+1084(哨兵)/+1088(计数), Scene+1096/+1100/+1104, Scene+46508(L2D 立绘节点写者置脏锁存)
- **emulator 现状**：立绘那一半已建模：`Scene+1096` 的 572B 立绘节点表 = `Engine.l2dNodes`（`src/vm/engine.ts`），节点模型在 `src/live2d/runtime.ts`（`l2dCreateNode` = `0x344` 的 op1=key/op2=槽），出画门 `l2dNodeDrawable`；守卫用真实 TITLE 资产（`test/live2d-ch…

### `adv-flag-lifecycle`（partial）

- **能力**：ADV 激活位（effect_flags 0x8000000）的设置与清除
- **触发**：置位：0x6E/0x71/0x72（受 GetConfig("message:ReadTextSkip") 门控）、0x19C 条件式、0x305、sub_436380；清除：sub_411900 每帧判定、0x19B、0x88(op1=0)、0xFA、0x101、0x72、0x19C 条件式
- **缺失时为什么静默**：位被置住时主循环只是改走 ADV 分支（每帧派发 1 条指令 + 输入泵），没有断言/日志；位被清时也只是回到普通分支 —— 两种取值都是合法路径
- **引擎**：sub_41ED80, sub_41EEF0, sub_41EB20, sub_41FAB0, sub_4190E0, sub_419120, sub_411900, sub_4199B0, sub_419CC0 @ raw 24532-28977
- **读的字段**：Engine+699204, Engine+122455, Engine+122496, Engine+1415, Engine+97050, Engine+97051, Engine+122368, Engine+122370
- **emulator 现状**：已修正：`0x71` 不再无条件置位（补上 `message:ReadTextSkip` 门 + `advanceReveal` 判定），ADV 位由 `Engine.serviceAdv()`（每帧）与 0x88/0x19B/0xFA/0x101 清除。实测 TITLE 空转 598000 → 1234 步/秒。★同族的 bit30（0x40000000，逐字模式） 与 bit31（等待门）已建…

### `adv-text-reveal-progress`（partial）

- **能力**：消息文本显示进度判定（ReadTextSkip 门 + 分段表查表）
- **触发**：0x6E/0x71/0x72 每次调用；仅当 GetConfig("message:ReadTextSkip") 为真才走该分支
- **缺失时为什么静默**：查表未命中/越界统一返回 0，调用方据此认为「已显示完」并清 ADV —— 全是合法路径，无日志
- **引擎**：sub_48F000, sub_48E870, sub_48FFB0, sub_41ED80, sub_41EEF0 @ raw 109440-110481
- **读的字段**：Engine+80107, Engine+80107+285, Engine+174405(config)
- **emulator 现状**：泵已实现：src/vm/msgwin.ts 的 tickRevealWin/tickReveal 与 src/vm/engine.ts 的 serviceTextReveal（+ #publishReveal），守卫 test/adv-reveal-under-throttle.test.ts。『显示完了吗』按体分两支读（raw 28339-28343 门关闭支 / raw 28345-28359…

### `msgwin-text-object`（partial）

- **能力**：文本对象（Engine+85296，dword 写法 Engine[21324]）的槽模型与排版入队
- **触发**：0x71 经 sub_45EC60(Font、slot、Engine+97055) **开始一段新消息**（清该窗文本记录向量 + 复位显现游标 + 清该窗表面）；0x6E/0x196/0x7D 经 sub_46BE30/sub_46CBF0 往该窗铺排文本；0x72 只判显示态并挂起。
- **缺失时为什么静默**：文本槽是纯数据结构：写入只改字段、清图元只调容器接口；没有可渲染输出也不会报错（脚本继续跑到下一条消息）
- **引擎**：sub_45EC60, sub_46BE30, sub_46CBF0, sub_45D660, sub_456430 @ raw 74196-74282
- **读的字段**：Font+218584, Font+201684, Font+3364, Font+1360, Font+1364
- **emulator 现状**：`0x7D`（十六进制串入队，sub_41F580 raw 28736-28765）与 0x6E 逐句同形（argc 2；op1 = 窗、op2 = 串，读串用 sub_41A780 而非 sub_41B640；门 = !MessageSpeed || ADV ⇒ sub_46CBF0；否则 sub_46BE30 + 0x20000000 + sub_453A60(Engine+430572, M…

### `msgwin-object-table`（partial）

- **能力**：消息窗对象表与布局重算（Engine[21585+idx]）
- **触发**：0x212/0x213 按索引写对象字段；0x300（sub_426990 raw 33757-33765）写旗标/值（体里**没有** sub_404F80 调用）；0x301（raw 33764）清该窗绘制项与 +132 并触发 sub_404F80 的布局重算（raw 10741-10763）；每帧绘制由 Scene 侧消费这些对象的图元区间
- **缺失时为什么静默**：对象表槽为空时各 handler 只做 `if (obj)` 判定即返回；布局重算只是从容器里移除区间 —— 没有对象就什么都不发生，无日志无报错
- **引擎**：sub_423A30, sub_423A80, sub_426990, sub_4269F0, sub_404F80 @ raw 31742-33789
- **读的字段**：Engine+21585, Engine+122466, Engine+122476, Engine+122486, Engine+1040(绘制容器)
- **emulator 现状**：0x301 的 handler（src/vm/handlers/msgwin.ts 的 op_msgwin_slot_clear）照抄 sub_404F80（raw 10741-10763）：清 `Engine[v+122486]`（raw 33763）、清对象 `+132`（raw 10752）、msgWinClear 删绘制项（raw 10753-10760）、闸门开着时重新武装显现；另有默认…

### `msgwin-cancel-key-state`（partial）

- **能力**：「取消消息键」三态机（Engine+122370）与 ReadTextSkip 的运行期开关
- **触发**：sub_411900 每帧：输入掩码 0x10（取消键按下沿）驱动 122370 在 0→1→2 之间迁移
- **缺失时为什么静默**：三态机每个取值都是合法分支；到 2 才清 ADV 并 SetConfig("message:ReadTextSkip", 0)，中间态无任何日志
- **引擎**：sub_411900 @ raw 20096-20160
- **读的字段**：Engine+122370, Engine+174802, Engine+174405(config)
- **emulator 现状**：`T-0161` 读体确证门控键名 = `set:CancelMesSkipOnClick`（raw 4346）：它既在引擎内建注册表（缺省 0）也在本工程的证据 INI 里（= 0）⇒ 本条在 emulator 侧「休眠」的原因是值（0），不是键缺失。三态机的迁移次序（raw 20119-20141）：遮罩位为 0 的那一帧走 `0→1`（else 分支），按下只驱动 `1→2`，`2→0` 那…

### `msgwin-text-method-opcodes`（partial）

- **能力**：消息窗文本方法族（0x6E show-text / 0x6F end-text-line / 0x71 message-show / 0x72 wait-for-input / 0x196 display-furigana）
- **触发**：脚本布置消息窗时逐条调用；每条只读 N 个操作数并转发到文本对象 Engine+21324 的一个方法
- **缺失时为什么静默**：这些 handler 体只有「读操作数 → 调文本对象方法」，没有回写操作数、不改 ip；emulator 把它们当 no-op 跳过时，脚本拿到的是「已执行」的状态，控制流正常，只是消息窗永远没有内容/几何 —— 无日志无报错
- **引擎**：sub_41ED20, sub_41F250, sub_41F350, sub_41F490, sub_425EF0, sub_426200, sub_4332D0, sub_456430, sub_45D660, sub_4563A0, sub_4185F0, sub_432DD0 @ raw 28401-41818
- **读的字段**：Engine+21324, Engine+21585, Engine+166964, Engine+430600
- **emulator 现状**：本族 = 5 条（0x6E show-text / 0x6F end-text-line / 0x71 message-show / 0x72 wait-for-input / 0x196 display-furigana），全部是「取操作数 → 转发给文本对象」的转发器。★三条不属本族的独立指令：`0x1BB`（sub_420000 raw 29223-29242）= SetTB 记账门 —— …

### `msgwin-attr-font-opcodes`（partial）

- **能力**：文本属性 / 描边 / 字体 / 注音指令族（0x75/0x76/0x77/0x78/0x81/0x8B/0x1A4/0x197/0x1A5/0x2BD/0x2BE/0x2DB/0x2FE/0x196 等）—— 属**指令集**
- **触发**：脚本设置字体/文本属性时调用；0x196 display-furigana 在消息文本里插注音；0xC5 读音量配置写操作数
- **缺失时为什么静默**：多是"改模板字段 + 重建句柄"的纯属性写入：不实现则参数保持默认（白字/黑投影/24px），画面还能看，只是**失去脚本指定的观感与阅读体验**。0x1C5/0xC5 一类会回写操作数，被跳过时脚本读到旧值。
- **引擎**：sub_41F350, sub_41F390, sub_41F3F0, sub_41F450, sub_41F6C0, sub_41FBF0, sub_41FE60, sub_41FDD0, sub_433290, sub_426200, sub_426260, sub_426500, sub_4332D0, sub_41FC20, sub_455ED0 @ raw 28652-29163
- **读的字段**：Font+1360/+1364/+1368/+1372/+1380/+1384/+1388/+1392(颜色与描边), Font+1232/+1248/+1260(主字体), Font+1292/+1308/+1320(注音字体), Font+218516/+218588(字重), Font+201684/+218584(字号), Font+235108(竖排)
- **emulator 现状**：引擎每次写颜色/档位/字号后立即 sub_459F40 重建 GDI 句柄与度量（0x75 raw 24081 / 0x197 raw 24153 / 0x2BD raw 33401 / 0x2BE raw 33421 / 0x1A5 raw 41403 / 0x2FE raw 41631）。emulator 没有 GDI 句柄层 ⇒ 那一半不复制（归 lazy-gdi-font-set 的 GD…

### `adv-advance-route-table`（partial）

- **能力**：点击热点 / 路由表（Engine+0x55D8）与「推进」的真实判据
- **触发**：`0x090` 登记热点项（消息场景常见 `i090 0 0 500 2d0 …` 全屏热点）；`wait-for-input` 挂起后每帧 `sub_411BC0` 做命中测试/键命中
- **缺失时为什么静默**：表为空或游标 -1 时 `sub_403E70`/`sub_403D70` 都返回 -1，调用方只是「继续等下一帧」，无日志无错误码；只有表满时 `0x090` 才抛 ShowMessage
- **引擎**：sub_420640, sub_403B30, sub_403C50, sub_403D70, sub_403E70, sub_411BC0, sub_411900 @ raw 9740-29518
- **读的字段**：Engine+21976(表基址 0x55D8), Engine+51848(游标 panelA[7468]), Engine+51840(推进标志 panelA[7466])
- **emulator 现状**：右键「取消/跳读」路由已接线。引擎 sub_411BC0 raw 20365-20374：`v6 = frames[cur]`；`*v2 = 0`（消费输入）；`Engine[489488 + 4*v6] == -1` ⇒ 直接 return，什么都不做；否则 `489808 = effect_flags | 0x6000000`、`effect_flags = 0`（清整个）、`489812 =…

### `msgwin-offscreen-surface-lifecycle`（partial）

- **能力**：每窗一张离屏表面：0x70 重建 / 0x71 清底 / sub_45BE20 逐行贴出
- **触发**：0x70 设窗几何时重建；0x71 开始时填底色；显现阶段逐行/逐字贴出
- **缺失时为什么静默**：表面生命周期错位不会报错：少重建 ⇒ 几何仍按旧尺寸（文字位置/换行全偏）；少清底 ⇒ 上一页文字叠在下面；少 ReleaseDC ⇒ 表面被 GDI 锁住、后端读不到像素（画面停留在旧内容）。
- **引擎**：sub_45D660, sub_43C8D0, sub_43B070, sub_43B460, sub_43B4C0, sub_455DB0, sub_45BE20 @ raw 73132-73193
- **读的字段**：FontVWindow+20/+24(w/h), FontVWindow+12/+16(屏幕偏移), FontVWindow+4(目标表面=0), Font+1032(dd 模块), Font+1104(surface DC), Font+1400(已锁表面号), Font+1352(AA 门；=0 时走 GDI 直画表面), dd+1540(像素格式掩码/移位), dd+8056(显示 bpp)
- **emulator 现状**：缺口：emulator 无"每窗离屏表面"概念，也没有 DC 取/还配对；重写方案里这一层被替换为「纯排版模型 + canvas2D 光栅化成纹理」。★2026-09 已读到的部分（T-0042 第 8 轮延伸，均为 raw 反编译确证）：① `sub_455DB0`（raw 67944-67964）—— AA 门（`Font+1352`）为 0 时，文字由 GDI 直接画进该窗表面的 DC（`s…

### `msgwin-line-fade-window`（partial）

- **能力**：行淡入：DrawItem 颜色动画窗，时长 = MessageSpeed × MessageFade / 100 ms
- **触发**：D3D 路径下 sub_45BE20 为每行建 DrawItem 之后
- **缺失时为什么静默**：不设色窗只会让文字"瞬现"而不是淡入 —— 无错误、无日志，只是少了动画。★引擎没有"把文字颜色朝背景插值"的代码（GDI TextOutA 无 alpha），淡入只能靠 DrawItem alpha 或离屏表面整体贴出。
- **引擎**：sub_45BE20, sub_4AD0C0, sub_4ACF60 @ raw 72338-72348
- **读的字段**：Font+1376(= message:MessageSpeed), Font+235128(= message:MessageFade), DrawItem+52/+56/+76/+100
- **emulator 现状**：已建模：DrawItem 颜色动画窗本体（整数截断插值、共享起点、窗末收尾）。未建模（`T-0161` 读体确证）：消息窗每行的淡入色窗从未被建立 —— 引擎在排版落点（`sub_45BE20` 为每行建 DrawItem 之后）raw 72336-72348：`if (*(int*)(_this+1376) > 0 && *(int*)(_this+235128) > 0) { sub_4ACF…

### `msgwin-backlog-cursor`（partial）

- **能力**：已读文本回看：页表 Font+3380 + 72B 回看项 + 光标 sub_459770
- **触发**：0x71/0x70 登记一页；滚轮（输入位 0x8/0x2）与 0x84 移动光标
- **缺失时为什么静默**：页表不建则回看与滚轮完全无反应；更关键的是 0x84「翻到底」时本应置 effect_flags |= 0x100000 并弹保存栈让脚本继续 —— 页表为空则这个"到达末尾"永远不发生，脚本会停在自旋里（表现为卡住，而不是报错）。
- **引擎**：sub_459770, sub_45EFA0, sub_45EBE0, sub_45EC60, sub_45D660 @ raw 70575-70627
- **读的字段**：Font+3380/+3384(8B 页表), Font+3364(72B 回看项), Font+859/+860(末项/当前光标)
- **emulator 现状**：2026-09（T-0167 的 P1 §4.2 #14 的 missing-consumer）：moveCursor 的消费者已接上。引擎 sub_411BC0 raw 20341-20363（整块被 effect_flags & 0x40000000 门控 —— 那是 CHAR_REVEAL_ACTIVE）：`v7 = Conf(set:WheelKeyUp)` 当掩码位号查本帧输入掩码；命中…

### `text-font-rebuild-cascade`（partial）

- **能力**：字体参数 → 句柄重建级联（0x75/0x197/0x1A5/0x2FE/0x2BD/0x2BE/0x2DB → sub_459F40 / sub_45A6E0）
- **触发**：任一字号/面名/字重/度量模式指令；或子系统 Initialize
- **缺失时为什么静默**：★`sub_459F40` 入口守卫 `if (!Font+1260) return`：面名为空 ⇒ **整个重建不发生**，句柄保持 0，GDI 用系统默认字体把字画出来，全程无错误。同理 `0x2BD`（加粗）只改模板里的 lfWeight 并触发重建，不重建则"加粗"这一档完全无效。`sub_459F40` 不是"文本重排"、`0x2BD` 也不是"调 `sub_459F40`"（它不在派发表里）。
- **引擎**：sub_459F40, sub_45A6E0, sub_4185F0, sub_418680, sub_4328F0, sub_432DD0, sub_428990 @ raw 70940-71273
- **读的字段**：Font+1232/+1236/+1248/+1260(主模板), Font+1292/+1296/+1308/+1320(注音模板), Font+201684(主字号), Font+218584(注音字号), Font+201664(字体名白名单)
- **emulator 现状**：7 条参数面（0x75/0x197/0x1A5/0x2BD/0x2BE/0x2FE/0x2DB）与面名映射/竖排都已落地并接线。★T-0151（P2 stale-ledger）换掉了两个指错的锚点。当前锚点一律用标识符（行号刻意不写 —— 它们随每次重构漂，实测已漂过一轮，见 journal）：op 体 `op_set_main_size`(0x75) / `op_set_ruby_size`(0…

### `msgwin-char-reveal-grid`（partial）

- **能力**：字格图标动画（0x73 = ▼「点击继续」精灵表网格）+ 文字逐字泵（sub_45BE20）
- **触发**：脚本 i073（字格+节拍，全库 27 处：NOVEL/SN0000/SYSTEM4）→ 每次 0x72 wait-for-input 武装（置 bit30、游标清零、重启节拍）→ 帧循环按 Engine+430600 计时器每步贴一格 → 点击推进或 0x1CE 0 收尾
- **缺失时为什么静默**：整条链是纯数据 + 计时器：0x73 只在窗对象里写 40 字节字格、0x72 只置两个位与一个整数、主循环只是按节拍多贴一格。缺任何一环都不会报错、脚本也读不到差别，只表现为「文字不逐字出现（一次性全出）」「字数停在第一节拍」「字格门未开时每帧空转调用什么也不做」—— 全是合法路径。
- **引擎**：sub_41F250, sub_456430, sub_453AD0, sub_453AF0, sub_453A90, sub_45A940, sub_41EEF0, sub_420280, sub_423620, sub_41A420, sub_41B1C0, sub_45AD30, sub_45BE20 @ raw 20887-20895
- **读的字段**：Engine+699204(bit30 = 逐字模式), Engine+107704(逐字游标 k), Engine+107705(模数 = 字格数 win+92), Engine+107706(0x1CE op1 副本), Engine+430600(逐字节拍计时器), Engine+122371(当前消息窗), FontVWindow+60..+99(0x73 写的字格块), FontVWindow+296/+132(0x304/0x305 行游标), FontVWindow+104/+108/+276/+280(绘制项区间)
- **emulator 现状**：已实现：0x73 写真格（gate/cells/tickMs/srcSurface/originX/originY/cellW/cellH）+ 0x1CE 开关（v≠0 置位与游标归零、v=0 收尾）+ 0x72 武装（Engine[107704]/[107705] 与 bit30）+ 点击推进先收尾 + 0x20A 重画不动游标 + 0x304/0x305 文本块括号。★0x73 不是"文字逐字…

### `gallery-unlock-file-used-flags`（partial）

- **能力**：回想/鉴赏的解锁标志（FileDB「已使用文件」表）与收集度
- **触发**：打点：**任何按统一 id 打开文件的时刻**（`sub_4559C0` → `sub_454960`）—— 载图（`0x1F9` set-texture）、放 BGM（`sub_48DB80` 曲号解析里就打开了文件）、装载脚本（call-script / `i143` 派发）都算。查询：`0x19D`（`sub_42D8E0` → `sub_4181F0`）；消费：进入回想（TITLE「回想」→ `ROOM.BIN` 里 `call-script 524c SETMEMOIR`）时逐条问 CG 表 / 场景表 / BGM 表，把已收集的下标写进 `122731`（BGM）/`10e3af`（CG），并算 `回収数`/`回収率`（`12272f`/`12272e`、`10e3ad`/`10e3ac`）。
- **缺失时为什么静默**：★缺了**不报错、只表现不对**：`sub_4181F0` 对"表不存在/哈希不符"一律返回 0（= 「没收集」），`0x19D` 于是把 op1 写 0 —— 于是 `SETMEMOIR` 把每一项都当未收集 ⇒ 回想界面四个按钮全 `回収数 0 / 回収率 0%`、**BGM 鉴赏列表整片 UNKNOWN/空白**。而引擎/脚本都不会为此打任何日志或异常（2026-09 用户实测：进 BGM 鉴赏只看到空列表）。反向静默：进度只存在 `$$SAVE.DAT` 里，不读它就"每次启动都从零开始攒"，而画面上看不出任何异常。
- **引擎**：sub_4559C0, sub_454960, sub_404A70, sub_4181F0, sub_42D8E0, sub_40AAE0, sub_404B20 @ raw 23838-23856
- **读的字段**：FileDB+1052（本体「已使用」表）/ +14404+4*包号（扩展包表）, FileDB+13368 / +15432+4*包号（防篡改副本，密钥由 ctor 的 srand 抽签）, global 12265c[1..64]（BGM 统一文件 id，MUINIT 填）, global 1226c0[1..64]（BGM 曲号）+ global-string 3629[1..64]（曲名）, global 122731[1..n]（已收集的 BGM 下标）/ 12272f（数量）/ 12272e（收集率）, global 10e3af / 10e3ad / 10e3ac（CG 收集表与收集率）、122271 / 12251c / 122519（场景回想）, $$SAVE.DAT（整表的持久化载体；装载 sub_40AAE0，头 sub_404B20）
- **emulator 现状**：实现（2026-09）：`Engine.usedFileIds`（键 = 完整统一 id，天然分"包"）+ `markFileUsed()`，打点三处 —— ① `0x1F9` set-texture（载图，= CG/场景收集）；② `play-bgm` 的曲号解析命中（= BGM 收集，引擎在 `sub_48DB80` 里就打开了文件）；③ 脚本装载（call-script / `i143`，与…

### `texture-bind-synchronous-then-query`（partial）

- **能力**：set-texture 是同步装载 ⇒ 同帧「绑定 → 查尺寸/查 imgid → 画」必然一致
- **触发**：脚本执行 `0x1F9 set-texture`（`sub_422CB0` → `sub_4559C0`）时：引擎**当场**打开并解码图像文件（`sub_454960` 还会登记 FileDB 的「已使用文件」表），返回时该槽的 CTexture 已就绪
- **缺失时为什么静默**：宿主把装载做成异步（IPC 取图 + 光栅化）后，紧随其后读尺寸的 `0x208` 会落进「尚未载入」分支返回 0×0，脚本把它当真实宽高写进绘制项的**源矩形** ⇒ 图元宽度/高度为 0，**永远画不出来**，而引擎/VM/日志全都不报错（2026-09 实测：`SN0000` 序章开场的 `BG050ABL` 背景图元 src = 0×0，整屏黑）
- **引擎**：sub_422CB0, sub_4559C0, sub_49ED60, sub_4ADC20 @ raw 39866-39900
- **读的字段**：Scene[5*slot+466] = imgid, CTexture+1040/+1044 宽高, DrawItem+4 纹理槽号
- **emulator 现状**：两道屏障：① `renderer/app/session.ts:370` 的 `#present()` 前 `await this.#native.texturesIdle()`（既有，防「文本先出现、背景晚几帧」）—— 这半边有守卫（`test/texture-frame-barrier.test.ts` 覆盖 `TextureCache.waitIdle` / `PixiBackend.tex…

### `scene-3d-weather-effects-rain-snow-leaf`（partial）

- **能力**：3D 天气/粒子效果管理器（Rain / Snow / Leaf）的创建·重建·逐帧推进·销毁
- **触发**：Scene 初始化 `sub_4A6EE0` 里建管理器；脚本用 `0x327`(Rain) / `0x326`(Snow) / `0x328`(Leaf) 懒建或重建单个效果；`0x325` 写管理器的两个字段；`0x324` 一次性销毁全部；帧循环每帧推进
- **缺失时为什么静默**：管理器与三个效果对象都不在脚本可见状态里：漏掉它**不报错、不改控制流**，只是**雨/雪/落叶完全不出现或永远不更新**（`0x324`/`0x325`/`0x326` 当 no-op 时），而 `0x327`/`0x328` 因为**没有注册 handler** 会以 `NotImplementedOp` 的形式暴露 —— 两条路都不指向"真正的缺陷是缺了整个子系统"
- **引擎**：sub_4A6EE0, sub_4530B0, sub_453280, sub_453330, sub_453410, sub_453150, sub_4531B0, sub_4535F0, sub_453540 @ raw 126522-126570
- **读的字段**：Engine+0x5B320（= Scene+50704）3D 效果管理器指针, Manager[258] Rain / [259] Snow / [260] Leaf, Manager[262..309] 三组 16-dword 参数块 / [310]/[311] / [312] 清空标记, Scene+46668 3D 特效等级门槛 / Scene+46496 共享 ID3DXEffect(资源 202), Scene+4*mesh+50708 网格层级槽表
- **emulator 现状**：引擎：管理器 `Scene+50704`（`operator new(0x4F4)`，`sub_4530B0` raw 65345-65363；创建点 `sub_4A6EE0` raw 126541-126545），三效果槽 `[258]` Rain / `[259]` Snow / `[260]` Leaf、三组 16-dword 参数块、销毁阈值 `[+0x4D8]`/`[+0x4DC]`（`…

### `gfx-prim-mesh-and-render-state`（partial）

- **能力**：A4：图元变换 / 槽→槽 blit / 呈现清屏 / 转场表 / 绘制模式 / DrawItem·MeshEntry 属性 / 3D 颜色（13 条）
- **触发**：0x238 = 装载 0x400 等待门的等待计时器（起点清零 / 时长 op1 ms；raw 32303-32312），读者 sub_407E20（raw 12761-12786）与主循环（raw 21109）；★trigger 的「画布尺寸对」**没有依据**（不成立）。
- **缺失时为什么静默**：★这一族**从不回写脚本操作数、也不改控制流** ⇒ 从 VM 视角完全不可观测：漏掉它们**不会报错**，只表现为「画面与真机不一致」（变换/裁剪/blit/清屏/槽标志/网格属性失真）。正因如此它们长期被当作「无依据的 no-op」（`ENGINE_INTERNAL_OPS` 与 `STUB_NATIVE_OPS`），缺口在纯脚本链路里永远看不到 —— 属闸门 B（能力缺口）那一类。
- **引擎**：sub_422F80, sub_423060, sub_423480, sub_41A200, sub_41A290, sub_423FE0, sub_4248C0, sub_4251A0, sub_425C30, sub_425D20, sub_426BD0, sub_426F80, sub_427040, sub_4AC470, sub_4AC660, sub_4A3980, sub_498B60, sub_4AA180, sub_49A690, sub_49A6C0, sub_49A6F0, sub_4AD9A0, sub_4ACD10, sub_4AE280, sub_4A0750, sub_499DF0 @ raw 25277-34448
- **读的字段**：DrawItem 变换字段（`+104`、`+132..+164`）, Scene 纹理槽表（槽→槽 blit）, Scene+1048（转场容器）, Scene[278]/[279] 与 Scene[286..288]（绘制模式）, Engine[92338]/[92339]（`0x238` 装载 / `0x243` 复位的**等待计时器**起点+时长；读者 `sub_407E20` raw 12762-12786 与主循环 raw 21109 —— 不是「画布尺寸对」）, Engine[92340]（`0x24E` 写、`0x243` 读 bit1 做门；raw 32965 / 26016-26031）, DrawItem `+720`（与相邻对象 `+504`）, Scene+1872/+1876 与其镜像 Scene+21872/+21876（`0x258` 写的四格；★镜像表在 emulator 侧缺失）, Scene+1064（网格属性表）, Scene[op1 + 12677]（3D 模型槽）
- **emulator 现状**：审计 §4.2 #8：`0x1FC`/`0x1FE`（图元变换）、`0x321`（网格属性）、`0x32D`（3D 颜色）写进 render4 后没有渲染消费者。本轮四条都接上真消费者（`src/renderer/pixi/presenter.ts` 的 `drawMesh`）：`0x1FC` ⇒ `resetItemTransform`（三块 work/target 复位成单位；不碰 `+0x6…

### `text-aa-config-gate`（partial）

- **能力**：文本抗锯齿是一把配置门：只有 set:EnableAntiFont 为真才读 message:UseAntiFont 写 Font+1352
- **触发**：启动读配置（raw 23649-23656）：if GetConfig(set:EnableAntiFont) 为真才 GetConfig(message:UseAntiFont) 并 sub_4155B0(Font, v)（raw 22409-22422：写 Font+1352 = Engine[21662]、重建字体、清字形缓存）。Font+1352 == 0 走 GDI/dd 的 TextOutA 整串锯齿字形；非 0 走软件 AA 字形（Font+3524/+3528 的 1/4 强度位图）
- **缺失时为什么静默**：这条门缺失或照抄错时的症状只有字看着不对，不报错、不影响脚本状态：把 message:UseAntiFont 当开关直接用（跳过 set:EnableAntiFont 门）则本机 base INI 连 [set] 段都没有而 message:UseAntiFont=1，会误判成引擎开 AA，于是宿主用 canvas 抗锯齿（灰边）画字，字形发胖、白色边缘发亮，与真机对照就是字比引擎粗。反向（明明开着却按锯齿渲染）会让文字显得毛糙。另两个看起来相关的键是死写、不该照抄：message:AntiFontLevel（raw 23653 写 Engine+303796，全库无读者）与 set:Menu_UseAntiFont（只被配置表读写、渲染侧无读者）。
- **引擎**：sub_4155B0, sub_459F40, sub_474BD0, sub_474F60, sub_4757F0 @ raw 22409-22422
- **读的字段**：Font+1352（AA 开关；= Engine[21662]）, 配置 set:EnableAntiFont / message:UseAntiFont
- **emulator 现状**：前半（两键门 + 阈值机具）为真。字段 21662（aaEnabled）是产品路径无读者：定义在 src/vm/engineFieldIds.ts 的 `aaEnabled: 21662`，写入点在 src/engineConfig.ts（另有注释/测试多处）；src/vm/handlers/msgwin.ts 的 globalTextStyle() 有意固定 `antiAlias: true`（…

### `live2d-enabled-config-flag`（partial）

- **能力**：Live2D 开关（`global a9d0`）与静态贴图回落
- **触发**：TITLE / BTL / INFOEN 在进 L2D 段之前用 `jcc (global-int a9d0)` 判：**== 0 走 Live2D，!= 0 走静态贴图**（TITLE 的回落 = `set-texture 5273 5`，即 740×700 的 SO004A）。脚本侧证据：src/TITLE.txt:526-530 / src/BTL.txt:1609-1616 / src/INFOEN.txt:711；该项由 CONFIG1 写（src/CONFIG1.txt:1483,1741）、LOADCONFIG 读、INITCONFIG0 默认 **0**（= 默认开）。★**开关本身只在脚本层**：`a9d0`/`f8c46`/`f8c47` 是**脚本 global 槽号**，整个反编译产物里 **0 命中**（没有引擎读点）⇒ 引擎侧能引的只有"被它门控的那条 L2D 装载支"的入口。
- **缺失时为什么静默**：**开关关掉 / 不执行装载指令**才是静默的（走静态贴图，画面照样有）；**装载指令执行了却失败不是静默** —— `sub_427BA0` raw 34488-34491（handler=0x341）与 `sub_428200` raw 34728-34731（handler=0x34E）都在取不到/解析失败时组「L2Dモデルファイル/モーションファイル %s の読み込みに失敗しました」并 `_CxxThrowException(Command_ShowMessage_Exception)`（粘文本 + 横幅 + 停止）。那半边由 `test/live2d-t0160.test.ts` 的两条抛错守卫钉住（「0x341：.MOC 取不到/解析失败 ⇒ 抛 ShowMessageError」「0x34E：.MTN 失败 ⇒ 抛错」）。
- **引擎**：sub_427BA0 @ raw 34460-34495
- **读的字段**：脚本 global a9d0(Live2D 关标志；脚本层开关，非引擎字段), 脚本 global f8c46(要装的 MOC 文件 id), 脚本 global f8c47(L2D 槽号)
- **emulator 现状**：L2D 支已能装载并有场景级证据（2026-09，`tickets/T-0054` M2/M3）：`i341/i345/i34E` 从桩转真实现（`handlers/live2d.ts` 的 LIVE2D_NATIVE_OPS，宿主按统一文件 id 读 `.MOC`/PNG/`.MTN`），真 TITLE 资产的装载/纹理绑定/动作入队/节点出画都有 E3 守卫（test/live2d-chain…

### `drawitem-loop-anim-frame-drive`（partial）

- **能力**：绘制项 B 族（flags bit2）周期/循环动画的逐帧求值
- **触发**：每帧合成时：渲染器 sub_4AEEA0 读该项 flags 的 bit2（raw 133390，等于 0 就整层跳过），命中则调 sub_49BCC0（raw 117944-118365）按帧时钟 Scene+46500（= 0xB5A4，代码里作 v5[11625]）求值五个通道
- **缺失时为什么静默**：这两个函数都不写 VM、不抛异常、没有日志：bit2 没被求值时该项动画停在起点（看起来就是「不做动画」），而且 raw 133395 那条「命中 bit2 就把 Scene+46532 置 1」不会发生 ⇒ 依赖世界矩阵的项（旋转）完全不转。逐字对齐时**不报错、只表现不对**
- **引擎**：sub_4AEEA0, sub_49BCC0, sub_49E700 @ raw 117944-118365
- **读的字段**：DrawItem+0x00 flags（bit2）, DrawItem+0x20C/+0x210/+0x214/+0x218（四窗起点锁存槽）, DrawItem+0x220/+0x224/+0x228/+0x22C（时长或周期）, DrawItem+0x230/+0x238/+0x23C（flipbook 周期/总格数/每行列数）, DrawItem+0x240（颜色目标）, DrawItem+0x244..+0x24C（旋转轴）, DrawItem+0x250/+0x290（缩放/平移矩阵）, Scene+46500 帧时钟, Scene+46532 世界矩阵有效位
- **emulator 现状**：bit2 = 本绘制项已挂 B 族周期/循环动画层（语义规格见 docs-new/99-records/2026-09-b3/b3-bit2-model-spec-2026-09.md）。写入端 0x230..0x235 六条 + 消费端五通道求值（drawitem/eval.ts）+ 世界矩阵有效位（Item.useWorld 经 itemUsesWorld 进 presenter）都已实现；K…

### `text-blank-extent-mode-gate`（partial）

- **能力**：空白字前进量的配置门 set:BlankExtentMode
- **触发**：排版或绘制文本时每遇一个**空白字**（0x20 半角空格 / 0x8140 全角空格 / 控制字节；绘制期还含 GetGlyphOutline 返回 -1 的无轮廓字）：配置 set:BlankExtentMode 等于 1 ⇒ 用 sub_404EE0（raw 10716-10739）对该字的 SJIS 字节逐字 GetTextExtentPoint32A 量宽当前进量（全角取度量的高、半角取宽）；不等于 1 ⇒ 用字号网格（raw 87269-87280 的 font_size / (全角?1:2)）；0x205 那一支另由 sub_4072F0（raw 12221-12236）先取 font_metrics_mode ? 字号 : -lfHeight 再被量宽覆盖。消费点 20 余处（raw 85126/85366/85638/85812/86567/87269/87689/87908/88054/88875/89074/89571/89760/90032/90228 …）
- **缺失时为什么静默**：这个开关只改一个数值（空白字前进多少）：emulator 现在恒定用字号当格宽 ⇒ mode 等于 1 时每一行的落点、换行位置、以及 0x205 回写的 op2（x 加前进量）都会逐字偏移，但不报错、无日志；随包默认值是 0（tickets/T-0031/evidence/generated-SYS4REG.ini 的 BlankExtentMode=0）⇒ 默认配置下两种算法一致，只有玩家把 INI 改成 1 才显形，属潜伏缺口
- **引擎**：sub_404EE0, sub_4072F0 @ raw 10716-10739
- **读的字段**：配置 set:BlankExtentMode, Engine+71744, Engine+71745, Engine+21632
- **emulator 现状**：门已接线（src/text/layout.ts 的 BlankExtent/blankAdvance/numberCellExtent + handlers/msgwin.ts 的 emitWin 逐次读 set:BlankExtentMode）：mode === 1 时空白字改走 BlankExtent.measure（引擎 sub_404EE0 的等价物）且 0x205 的 cy 按 raw …

### `msgwin-coexist-auto-message`（partial）

- **能力**：共存自动翻页（0x1B7 置位 → 0x72 尾段武装计时器 → 等待泵 LABEL_44 到期自动推进）
- **触发**：`Engine[97052] != 0`（`0x1B7` 写 `1`；引擎侧由 AGERC 系统命令 40037「进设置画面」触发 `sub_4090F0`）
- **缺失时为什么静默**：没接时 `i1b7 1` 之后没有任何可观察后果（ADV 页不会自己往下走），而 `i1b6` 读回值照旧 ⇒ 不报错、只行为不对
- **引擎**：sub_4090F0, sub_411BC0, sub_453A60, sub_453AF0, sub_453BC0, sub_453BD0 @ raw 13699-13707
- **读的字段**：Engine+97052, Engine+97053, Engine+122464, Engine+122371, Engine+122454, Engine+122501, Engine+430180
- **emulator 现状**：2026-09 T-0151/T-0167（审计 §4.2 #16 与 §4.1 的 `0x1b6`/`0x1b7` P1）：读端 + 行为端都已落地。读端 = `handlers/msgwin.ts` 的 `armCoexistAutoMessage`（0x72 尾段 raw 28556-28586 逐字：`v7 = _this[97052]==0; _this[97053]=0; if (!v…

### `backlog-drawn-row-recording`（partial）

- **能力**：已画文本行的记账（`sub_45F090`：每画一段正文就往 Font+3364 补一条**带串**的 72B 记录）与它的消费端 `0x1D1`
- **触发**：每次文本绘制各走一次：`0x6E show-text` / `0x196 display-furigana` → `sub_46BE30`（raw 83364-83999）→ `sub_461A10`（raw 76214，GDI）或 `sub_465A20`（raw 79062，D3D）→ **`sub_45F090`**（raw 74360-74400；`+44` 就是这段正文串，raw 74395）。换行另由 `sub_4691D0`（raw 81530-81553）补一条 `flags | 8` 的**空串**记录（它把 `a3 | 8` 连同 `unk_51F030` 交给 `sub_4691A0`）。★**不受 `Engine[97055]` 门控** —— 体 raw 74360-74400 里一次都没出现它，与同族的 `sub_45EFA0`（`0x1D2`）/`sub_45EEA0`（语音）不同。消费端 = `0x1D1`（`sub_4675A0` raw 80664-81014）按 `0x1D0` 给出的起点重画这一段。
- **缺失时为什么静默**：★缺失时**不报错、只表现不对**：记录表里仍然有 `0x1D2` 的标记记录，所以 `0x1D0`（页索引）/`0x1D3`（按 key 查文本项）照常返回合法的页号与字段，脚本与 VM 都不报错 —— 但 `0x1D1` 要重画的『正文行』一条都没有 ⇒ **回想画面只有框、没有字**（`src/HISTORY.txt` 自己用 `draw-texture`/`i217`/`i1fd` 画框、条纹、页码，正文完全依赖这一段记录）。这正是 `T-0168` 探针看到的「进了 HISTORY.BIN 但画面不出现」在 `0x1D1` 之后的第二层原因（第一层是 `0x1D1` 命中即 `NotImplementedOp` 硬停）。
- **引擎**：sub_45F090, sub_4691A0, sub_4691D0, sub_46BE30, sub_46CBF0, sub_4675A0, sub_420310 @ raw 74360-81553
- **读的字段**：Font+3364/+3368（72B 记录 vector begin/end；push 由 sub_45E7E0 完成）, Font[340]/[341]/[342] = Font+1360/+1364/+1368（记录的 +20/+24/+28 ← 填充色/描边色/第三格，raw 74386-74394）, Font[win+849]（该窗「下一条是组首」标记；本 push 消费它并写进记录 flags bit0，raw 74375-74379）
- **emulator 现状**：`tickets/T-0170` 落地。已建模：`TextItemRecord.text`（引擎 `+44` 的 `std::string`）、`ITEM_ROW_TEXT`（`flags & 4`，带串的已画行）与 `ITEM_ROW_LINE`（`flags & 8`，换行）两个位、`TextItemTable.pushRenderedRow/pushLineFeed`（消费组首标记、写 `+…

### `script-request-queue-drain-dispatch`（partial）

- **能力**：脚本请求队列只在三处被放行（0x1F5 停靠结束 / 0x7C 列表收尾 / 0x2 的 -10 恢复臂）
- **触发**：① 0x1F5 帧倒计时计到 0、停靠标志（`Engine+429752`）原值非 0、且未在派发中（`Engine+497400 == 0`）⇒ 清标志并 `sub_40FB60`（raw 25224-25230）；② 0x7C 末尾 `Engine+387940` 置位时清 0，并在队列恰剩 1 项时派发（raw 25816-25822；★门恒假）；③ 0x2 exit 的 -10 恢复臂：`Engine+497380 < Engine+497384` 即派发（raw 25669-25672）
- **缺失时为什么静默**：请求（0x143 早已入队）没被放行不会报错 —— 它只是**攒着**，画面停在上一状态：表现为「点了没反应 / 菜单不弹 / 剧情不继续」，而不是异常。这三处是引擎里仅有的放行点，缺任一处都会让某条交互路径永久卡住。
- **引擎**：sub_41A0E0, sub_41AB80, sub_41A820, sub_40FB60 @ raw 25224-25822
- **读的字段**：Engine+429752, Engine+497400, Engine+497380, Engine+497384, Engine+387940
- **emulator 现状**：第 1 点已接线：`op_frame_countdown` 在停靠标志原值非 0、未在派发中时清标志并 `dispatchNextRequest`（handlers/frame.ts，raw 25224-25230），守卫 test/op-1f5-dequeue.test.ts；第 3 点（0x2 的 -10 臂）由同一 `dispatchNextRequest` 的恢复路径承接。第 2 点不接线…

### `present-without-backbuffer-clear`（partial）

- **能力**：逐帧 present **不清后缓冲**（两处整屏 ClearTarget 都被恒 0 的 `Scene+46460` 位守卫）
- **触发**：每帧 present 入口 `sub_4B4040`（raw 136785：`(Scene+46460 & 1) != 0` 才 `sub_498B60`）与帧头一族 `sub_4AAF90`（raw 137026：`(Scene+46460 & 2) == 0` 才清）；该字段的**唯一写点**是 raw 130425 的 `Scene+46460 = 0`（在 `sub_4AAF90` 内）⇒ 两位恒 0、这两处整屏清屏在正常游戏过程中**从不发生**。其余 `sub_498B60` 调用点都先 `sub_4A50C0(层)` 切到**离屏 scratch 层**（转场 36/37 与类别 3 的目标层：raw 134926/134938/135825/136021/136175/136514），或落在 `sub_4B4910` 的条件分支（raw 137342）
- **缺失时为什么静默**：★引擎的 present **不清后缓冲**（`IDirect3DDevice9::Clear` 只在两处被恒 0 的位守卫挡住，其余都清离屏层）⇒ 撤掉的绘制项/幕在屏上**留到被新内容覆盖为止**：撤幕那一帧屏上留的是上一帧。宿主若改成「每批指令后整帧重合成」，就会把引擎**从未呈现**过的中间态如实画出来（幕已撤、旧场景还在、新一屏未建）—— 不报错、无日志，只表现为「闪一帧旧画面」（`T-0067` 的存档页、`T-0182` 的 TITLE→GAMESTART→SN0000）
- **引擎**：sub_4B4040, sub_4AAF90, sub_498B60, sub_4B06D0, sub_4B4910 @ raw 130286-137342
- **读的字段**：Scene+46460
- **emulator 现状**：emulator 侧补偿 = 撤幕留帧（`pixiBackend.#holdFrameAfterCurtainDrop`：撤掉一块「此刻真的盖着屏幕」的幕 ⇒ 最多跳过 `HOLD_MAX_FRAMES=60` 次 present，直到新内容可见；解除点 = 新可见幕 / 铺满一屏的 `draw-texture` / `CopyScene`，`0x1F6 clearDrawContainer` 只…
