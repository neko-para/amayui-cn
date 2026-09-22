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
| `modeled-verified` | 58 | 已建模且有守卫（E2/E3） |
| `modeled-unverified` | 7 | 已建模但只有静态结论（E1）或缺少守卫 |
| `partial` | 32 | 只实现了一部分（缺口写在该条 note） |
| `absent` | 19 | 引擎有、emulator 完全没有 |
| `n/a-known` | 23 | 与本 2D 精灵 + 消息窗重写无关（必须写 why） |
| **合计** | **139** | 需要关注（非 n/a 且非已核验）= **58** |

## 按子系统

| 子系统 | 条数 | 其中 缺失/部分 |
|---|---|---|
| 3D | 17 | 4 |
| Live2D | 7 | 1 |
| 声音 | 7 | 1 |
| 存档槽 | 2 | 0 |
| 帧循环 | 17 | 8 |
| 消息窗 | 30 | 18 |
| 渲染 | 30 | 13 |
| 资源 | 18 | 4 |
| 转场 | 4 | 2 |
| 输入 | 7 | 0 |

## 全部条目

| id | 子系统 | 能力 | emulator | 依据 / 守卫 |
|---|---|---|---|---|
| `frame-pump-sound-channels` | 声音 | 每帧声音通道老化 | ✅ 已核验 | E2 · `test/audio-engine.test.ts` |
| `frame-pump-input-refresh` | 输入 | 每帧输入态刷新 | 🟡 已建模未核验 | E1 · `test/input.test.ts` |
| `frame-pump-music-fade` | 声音 | 每帧 BGM 淡出推进 | ✅ 已核验 | E2 · `test/audio-engine.test.ts` |
| `frame-render-gate-mainloop` | 帧循环 | 主循环帧提交门控 | 🟠 部分 | E2 · `test/frame-loop.test.ts` |
| `scene-frame-commit` | 渲染 | Scene 逐帧提交（四路归并 + 绘制） | 🟠 部分 | E2 · `test/draw-item-slot-coverage.test.ts` |
| `scene-beginscene-recursion-gate` | 渲染 | BeginScene/EndScene 递归门 | ➖ n/a | E1 |
| `scene-frame-texture-gate-46672` | 3D | 帧纹理（离屏表面）指针门 | ➖ n/a | E1 |
| `scene-framebuffer-offset-compensate-46696` | 渲染 | 双缓冲显示偏移补偿开关 | ➖ n/a | E1 |
| `scene-capture-target-flag-46680` | 渲染 | Capture 目标为主/后缓冲（38 号）标记 | ➖ n/a | E1 |
| `scene-render-3d-frame-request-46700` | 3D | 请求显式渲染一帧 3D | ➖ n/a | E1 |
| `scene-3d-effect-level-writer` | 3D | 3D 效果等级的初始化决策 | 🟠 部分 | E1 |
| `scene-dirty-flag-lifecycle` | 帧循环 | Scene+46508 「本帧需要重画」脏标志 | ✅ 已核验 | E2 · `test/headless-needs-render.test.ts` |
| `scene-freeze-flag` | 帧循环 | Scene+46512 动画强制冻结 | ✅ 已核验 | E2 · `test/wait-gate-timer.test.ts` |
| `scene-pending-flag-0x400-gate` | 转场 | Scene+46516 转场/等待在途标志（0x400 卫门值） | ✅ 已核验 | E3 · `test/wait-gate-timer.test.ts` |
| `scene-flag-46528-bits` | 帧循环 | Scene+46528 bit1/bit2 冻结豁免 | ❌ 缺失 | E0 |
| `scene-norender-mode` | 渲染 | Engine+167990 无渲染/隐藏窗口模式 | 🟠 部分 | E1 · `test/engine-config.test.ts` |
| `3d-effect-level-gate` | 3D | Scene+46668 3D 特效等级 | ➖ n/a | E1 |
| `scene-render-freeze-46676` | 渲染 | Scene+46676 3D/文字渲染冻结总闸 | ❌ 缺失 | E0 |
| `engine-main-window-hwnd` | 渲染 | Engine+387924 主窗口 HWND（旧名 FileSource） | ➖ n/a | E1 |
| `filesource-script-load` | 资源 | 脚本装载把主窗口 HWND 当资源来源传入 | ➖ n/a | E1 · `test/boot.test.ts` |
| `scene-draw-total-gate-1056` | 渲染 | Scene+1056 转场记录表条数（★订正：不是主绘制总门） | ❌ 缺失 | E0 |
| `clock-write-clock-freeze` | 帧循环 | 每帧时钟写入与时钟冻结门 | 🟠 部分 | E2 · `test/frame-loop.test.ts` |
| `clock-read-drawitem-5-windows` | 渲染 | DrawItem 5 窗动画驱动（透明度 / 旋转×2 / 轴角 / UV） | ✅ 已核验 | E3 · `test/draw-item-anim-window.test.ts` |
| `clock-read-meshentry-color-window` | 渲染 | MeshEntry 颜色/α 动画窗 | ✅ 已核验 | E3 · `test/mesh-vertex-quad.test.ts` |
| `clock-read-transition-window` | 转场 | 转场窗口进度与扫描带绘制 | ✅ 已核验 | E3 · `test/transition-corpus-e3.test.ts` |
| `render-range-clip-by-index` | 渲染 | 按索引区间的绘制范围裁剪 | ❌ 缺失 | E0 |
| `render-merge-two-pass-reorder` | 渲染 | 四路归并（DrawItem/MeshEntry/两 572B 节点）与 |0x10000 回置 | 🟠 部分 | E2 · `test/draw-item-slot-coverage.test.ts` |
| `render-3d-layer-dual-commit` | 3D | 3D 层对偶逐帧提交 | ❌ 缺失 | E1 |
| `render-endscene-and-2d-stack` | 渲染 | 2D 矩阵栈 Begin/End 配对与 EndScene | ➖ n/a | E1 |
| `transition-table-flush` | 转场 | 转场表帧尾收尾（sub_4A9BE0） | ❌ 缺失 | E0 |
| `lazy-effect-200-201-release` | 3D | 2D/3D effect 槽（46480 起 5 槽）的批量释放 | ➖ n/a | E1 |
| `renderer-state-reset-each-frame` | 渲染 | 渲染态重置（sub_498B60） | ➖ n/a | E1 |
| `audio-device-init` | 声音 | DirectSound 设备/对象重建 | 🟠 部分 | E2 · `test/audio-engine.test.ts` |
| `movie-object-lifecycle` | 帧循环 | 电影对象帧内生命周期 | ❌ 缺失 | E0 |
| `scene-drawtable-flush-and-dirty` | 渲染 | 清空绘制节点并置脏（opcode 侧） | 🟡 已建模未核验 | E1 · `test/scene-report.test.ts` |
| `script-queue-dispatch` | 帧循环 | 脚本派发队列出队 | ❌ 缺失 | E0 |
| `script-frame-refresh-opcode-20c` | 帧循环 | opcode 0x20C 脚本帧刷新并提交 | ✅ 已核验 | E2 · `test/engine-config.test.ts` |
| `live2d-slot-probe` | Live2D | Live2D 10 槽探测（强制重画理由之一） | ✅ 已核验 | E3 · `test/l2d-render-pending.test.ts` |
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
| `lazy-live2d-slot` | Live2D | Live2D 实例槽表（`Scene+55812`，**10** 槽）与「槽非空先析构再建」 | ✅ 已核验 | E3 · `test/live2d-chain.test.ts` |
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
| `lazy-572b-node-map` | 渲染 | 572B 节点表（精灵/特效）惰性插入（表头 eager 130366/130384） | 🟠 部分 | E3 · `test/live2d-chain.test.ts` |
| `lazy-scene-effect-release-gap` | 3D | Scene+46492 / +46496 两张 effect 的释放缺口 | ➖ n/a | E1 |
| `bullet-dirty-from-freeze-or-pending` | 帧循环 | 冻结/pending 强制延续刷帧 | 🟠 部分 | E1 |
| `chained-3d-layer-commit` | 3D | 572B「立绘 / 变换节点」层的归并与提交（原被误标为「3D 场景层」） | ✅ 已核验 | E3 · `test/live2d-render.test.ts` |
| `adv-flag-lifecycle` | 消息窗 | ADV 激活位（effect_flags 0x8000000）的设置与清除 | 🟠 部分 | E2 · `test/adv-msgwin.test.ts` |
| `adv-perframe-dispatch` | 帧循环 | ADV 激活时的每帧处理：派发 1 条脚本指令 + 输入泵 | ✅ 已核验 | E2 · `test/adv-msgwin.test.ts` |
| `adv-text-reveal-progress` | 消息窗 | 消息文本显示进度判定（ReadTextSkip 门 + 分段表查表） | 🟠 部分 | E2 · `test/adv-msgwin.test.ts` |
| `msgwin-text-object` | 消息窗 | 文本对象（Engine+85296，dword 写法 Engine[21324]）的槽模型与排版入队 | 🟠 部分 | E2 · `test/adv-msgwin.test.ts` |
| `adv-input-pump-perframe` | 输入 | ADV 每帧输入泵与「跳读中」掩码位 | ✅ 已核验 | E2 · `test/adv-msgwin.test.ts` |
| `msgwin-object-table` | 消息窗 | 消息窗对象表与布局重算（Engine[21585+idx]） | 🟠 部分 | E2 · `test/adv-msgwin.test.ts` |
| `msgwin-cancel-key-state` | 消息窗 | 「取消消息键」三态机（Engine+122370）与 ReadTextSkip 的运行期开关 | 🟠 部分 | E2 · `test/adv-msgwin.test.ts` |
| `adv-advance-opcodes` | 消息窗 | ADV 推进指令族（0x6E / 0x72 / 0xFA / 0x1CA）—— 属**指令集**，非每帧行为 | ✅ 已核验 | E2 · `test/adv-msgwin.test.ts` |
| `msgwin-text-method-opcodes` | 消息窗 | 文本子系统方法转发指令族（约 25 条）—— 属**指令集** | 🟠 部分 | E2 · `test/adv-msgwin.test.ts` |
| `msgwin-attr-font-opcodes` | 消息窗 | 文本属性 / 描边 / 字体 / 注音指令族（0x75/0x76/0x77/0x78/0x81/0x8B/0x1A4/0x197/0x1A5/0x2BD/0x2BE/0x2DB/0x2FE/0x196 等）—— 属**指令集** | 🟠 部分 | E2 · `test/adv-msgwin.test.ts` |
| `adv-advance-route-table` | 消息窗 | 点击热点 / 路由表（Engine+0x55D8）与「推进」的真实判据 | 🟠 部分 | E3 · `test/route-dispatch.test.ts` |
| `msgwin-config-gates` | 消息窗 | 消息/ADV 路径上的配置门与「当前走不到的分支」 | 🟠 部分 | E3 · `test/config1-chain.test.ts` |
| `msgwin-config-read-opcodes` | 消息窗 | 配置回读指令族（0xC5/0xC7/0x1B8/0x2CC/0x2E6/0x2EA/0x194/0x1CB）—— 属**指令集** | ✅ 已核验 | E2 · `test/config-read.test.ts` |
| `text-layout-wrap-ruby` | 消息窗 | 文本排版：逐字像素量宽 + 边界硬断 + 注音配对（sub_46BE30） | ❌ 缺失 | E0 |
| `msgwin-offscreen-surface-lifecycle` | 消息窗 | 每窗一张离屏表面：0x70 重建 / 0x71 清底 / sub_45BE20 逐行贴出 | 🟠 部分 | E0 |
| `msgwin-line-fade-window` | 消息窗 | 行淡入：DrawItem 颜色动画窗，时长 = MessageSpeed × MessageFade / 100 ms | 🟠 部分 | E2 · `test/draw-item-anim-window.test.ts` |
| `msgwin-backlog-cursor` | 消息窗 | 已读文本回看：页表 Font+3380 + 72B 回看项 + 光标 sub_459770 | ❌ 缺失 | E0 |
| `text-drawmode-fork` | 消息窗 | set:DrawMode 双路径：0 = GDI 整串 TextOutA / 1 = D3DX 逐字 GetGlyphOutline | ➖ n/a | E1 |
| `text-font-rebuild-cascade` | 消息窗 | 字体参数 → 句柄重建级联（0x75/0x197/0x1A5/0x2FE/0x2BD/0x2BE/0x2DB → sub_459F40 / sub_45A6E0） | 🟠 部分 | E2 · `test/text-layout.test.ts` |
| `msgwin-window-reveal-gate-300` | 消息窗 | 每窗「逐行贴出」闸门 + 贴出完成后的延时清场循环（Engine[122466+win] bit0/bit16、Engine[122476+win]；op 0x300 = sub_426990） | ✅ 已核验 | E2 · `test/char-reveal.test.ts` |
| `msgwin-char-reveal-grid` | 消息窗 | 字格图标动画（0x73 = ▼「点击继续」精灵表网格）+ 文字逐字泵（sub_45BE20） | ✅ 已核验 | E2 · `test/char-reveal.test.ts` |
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
| `scene-3d-weather-effects-rain-snow-leaf` | 3D | 3D 天气/粒子效果管理器（Rain / Snow / Leaf）的创建·重建·逐帧推进·销毁 | ❌ 缺失 | E1 |
| `passive-camera-and-effect-render-state` | 帧循环 | 3D 效果的逐帧渲染状态重设（不是 opcode 设置的） | ❌ 缺失 | E1 |
| `agerc-module-interface-and-version-lock` | 资源 | AGERC.DLL 模块接口：启动时加载 + 版本锁 + 100 槽导出表 | ✅ 已核验 | E3 · `test/op-a4-a6.test.ts` |
| `text-item-record-table` | 消息窗 | 文本项记录表（Font+3364 的 72B/条 vector）：回想/历史与语音重播的账本 | ✅ 已核验 | E3 · `test/op-a2-a3.test.ts` |
| `text-redisplay-rewind` | 消息窗 | 文本重显示：`0x7B` 设本帧回退游标 + `0x199` 回退重画 | ✅ 已核验 | E3 · `test/op-a2-a3.test.ts` |
| `gfx-prim-mesh-and-render-state` | 渲染 | A4：图元变换 / 槽→槽 blit / 呈现清屏 / 转场表 / 绘制模式 / DrawItem·MeshEntry 属性 / 3D 颜色（13 条） | 🟠 部分 | E3 · `test/op-a4-a6.test.ts` |
| `single-field-timers-audio-device` | 帧循环 | A5：单行字段写 / 秒计时器 / 消息面 / 音频设备（9 条） | ✅ 已核验 | E2 · `test/op-a5.test.ts` |
| `hover-ret-reruns-gate-op` | 输入 | 悬停/点击 label 的返回点 = 门指令（ret 回到门指令重跑） | ✅ 已核验 | E3 · `test/game-start-chain.test.ts` |
| `text-reveal-pump-409400` | 帧循环 | 逐字显现泵：sub_409400 自旋 + sub_45BE20 一次一个字 + message:MessageSpeed 节拍（每字毫秒） | ✅ 已核验 | E3 · `test/adv-msgwin.test.ts` |
| `save-slot-chain` | 资源 | 存档槽链路：SAVE%2.2d.DAT（0x19E 存 / 0x1A1 读 / 0x1A0 读头 / 0x19F 短读 / 0x1AB 删 / 0x1AC 复制）与 .STH 状态块（0x1AE/0x1AF） | ✅ 已核验 | E4 · `test/save-slot-chain.test.ts` |
| `input-wheel-two-accumulators` | 输入 | 两个滚轮累加器：竖直（WM_MOUSEWHEEL）与水平（WM_MOUSEHWHEEL）各自独立、各自一次性消费 | ✅ 已核验 | E2 · `test/wheel.test.ts` |
| `text-aa-config-gate` | 消息窗 | 文本抗锯齿是一把配置门：只有 set:EnableAntiFont 为真才读 message:UseAntiFont 写 Font+1352 | 🟠 部分 | E2 · `test/text-aa.test.ts` |
| `save-slot-thumbnail-bmp` | 资源 | 存档缩略图：SAVE%2.2d.STH = 320x180 24bpp BMP（0x1AE 按 op3 纹理槽写 / 0x1AF 按 op3 纹理槽读） | ✅ 已核验 | E4 · `test/save-thumb.test.ts` |
| `bold-is-lfweight-face-mapping` | 消息窗 | 加粗 = 一次 lfWeight=700 的字体映射请求（引擎不做合成加粗，配置里也没有独立的「粗体面」键） | ✅ 已核验 | E2 · `test/font-bold-face.test.ts` |
| `text-line-pitch-font-1380` | 消息窗 | 换行步进 = 字号 + 行间距 Font+1380（i08b）—— 注音不压上一行的唯一来源 | ✅ 已核验 | E2 · `test/text-layout.test.ts` |
| `drawitem-mesh-blend-selector` | 渲染 | DrawItem+0x30 / MeshEntry[9] 的 alpha 混合选择子（0/1/2/3 一套枚举） | ✅ 已核验 | E2 · `test/blend-mode.test.ts` |
| `text-face-source-memory-vs-system` | 消息窗 | 正文面名的来源：引擎只注册一份内存字体（游戏自带的 AGE-EXTEND.TTF / 面 'AGE Extend'），message:Font 指定的正文面由**系统字体表**解析 | ➖ n/a | E1 |
| `text-white-level-on-composite` | 消息窗 | 引擎画的文字在成片上被压到 ≈0.89×白（实测；同屏美术图不受影响）—— 机制未定位 | 🟠 部分 | E4 · `test/draw-string.test.ts` |
| `text-glyph-coverage-alpha-composite` | 渲染 | 文字字形按覆盖率 α 合成（写入面：RGB 按 α 混合、A = max(A_dst, α)）——"白字"永不纯白、"往透明表面画字"偏灰 | ✅ 已核验 | E2 · `test/text-aa.test.ts` |
| `key-dispatch-default-slot` | 输入 | 0x100 空掩码时的「默认键」槽派发（下标 = SetKeyTotal） | ✅ 已核验 | E2 · `test/input.test.ts` |
| `host-cursor-warp` | 输入 | 把系统光标移到虚拟屏坐标（0x10A 的宿主侧 / SetCursorPos） | ✅ 已核验 | E3 · `test/native-host.test.ts` |
| `live2d-enabled-config-flag` | Live2D | Live2D 开关（`global a9d0`）与静态贴图回落 | 🟠 部分 | E1 |
| `l2d-node-draw-gate` | Live2D | 572 字节「立绘 / 变换节点」的出画门控（只有 L2D 槽真有模型才出画） | ✅ 已核验 | E3 · `test/live2d-render.test.ts` |
| `live2d-node-draw-advance` | Live2D | L2D 的「动作推进」与「出画」是同一次调用（没有独立的逐帧 tick） | 🟡 已建模未核验 | E3 · `test/live2d-chain.test.ts` |
| `live2d-mesh-batches` | Live2D | Live2D 出画几何：顶点/UV/索引流 + 画布居中摆放 + 归并成三角批次 | ✅ 已核验 | E3 · `test/live2d-render.test.ts` |
| `stage-stepper-0x40-gate` | 帧循环 | 阶梯动画时间表（0x40 门 + sub_408F10 调度器） | ✅ 已核验 | E3 · `test/stage-loop.test.ts` |
| `music-runtime-current-track-lifecycle` | 声音 | BGM 运行态「当前曲 id」的生命周期（起播/停/换曲/存档/读档重播） | ✅ 已核验 | E2 · `test/slot-save-resume.test.ts` |
| `load-restores-image-slots-and-scoped-pools` | 存档槽 | 读档装载：按槽表重建图像 + int 池只覆盖 0..池长 | ✅ 已核验 | E2 · `test/slot-load-resume.test.ts` |
| `load-runs-callback-before-record0` | 存档槽 | 读档时帧 0 先跑 CALLBACK_LOAD.BIN（上一个画面的收尾），它 exit 后才装记录 0 的脚本 | ✅ 已核验 | E2 · `test/slot-load-resume.test.ts` |
| `scene-teardown-on-load-point` | 渲染 | 读档装载点清空绘制项容器 + 从存档 body 还原绘制项清单（raw 19806-19832） | 🟠 部分 | E4 · `test/slot-load-resume.test.ts` |
| `drawitem-loop-anim-frame-drive` | 渲染 | 绘制项 B 族（flags bit2）周期/循环动画的逐帧求值 | 🟠 部分 | E2 · `test/draw-item-loop-anim.test.ts` |
| `text-blank-extent-mode-gate` | 消息窗 | 空白字前进量的配置门 set:BlankExtentMode | 🟠 部分 | E2 · `test/op-205-blank-extent.test.ts` |
| `scene-layer-xform-compose-20-29` | 渲染 | Scene 世界矩阵的合成与「只作用于层号 ∈ [20,30) 的项」这一级 | ✅ 已核验 | E2 · `test/op-22a-22f-scene-world.test.ts` |
| `save-load-drawitem-clear-and-restore` | 资源 | 读档装载点：清空绘制项容器 + 还原存档里的绘制项清单（Scene+1032） | ✅ 已核验 | E4 · `test/engine-slot.test.ts` |
| `live2d-node-matrix-compose` | Live2D | 572B 节点的矩阵合成（sub_4A07F0）：4 个窗求值 + 行向量组合 + 就地推进 | ✅ 已核验 | E3 · `test/l2d-node-compose.test.ts` |
| `texture-bind-async-stale-writeback` | 资源 | 纹理槽绑定的时序：引擎 set-texture 同步，宿主异步 ⇒ 陈旧载入不得覆盖脚本后来画的表面 | ✅ 已核验 | E3 · `test/texture-bind-race.test.ts` |
| `input-keyboard-to-mask-bits` | 输入 | 键盘 VK → 掩码位 0..6（每帧 GetAsyncKeyState 轮询） | ✅ 已核验 | E2 · `test/keyboard-mask.test.ts` |
| `copyright-effect` | 帧循环 | 版权页（LOGO）的 frame 效果：mesh 顶点色窗 + draw-item diffuse-alpha 窗 + timeGetTime 时钟 | ✅ 已核验 | E2 · `test/mesh-vertex-quad.test.ts` |
| `texture-absent-draw-is-dropped` | 渲染 | 槽没有纹理对象时，所有"用这个槽"的绘制/处理**整笔丢弃**（只写一行 Error.log，无替代纹理） | 🟡 已建模未核验 | E1 · `test/missing-texture-skips-item.test.ts` |

## 缺口明细（`absent` / `partial`）

### `frame-render-gate-mainloop`（partial）

- **能力**：主循环帧提交门控
- **触发**：`Engine+667856==1` 且（`Engine+667860`≠0 或 effect_flags&0x2400）且 effect_flags&0x1000000==0 且 !v93 且(Scene 有脏或对象命中)
- **缺失时为什么静默**：门不满足时整条 `sub_4B4040` 调用被跳过，画面保持上一帧且无任何诊断输出
- **引擎**：sub_412290, sub_40BE10 @ raw 20740-20760
- **读的字段**：Engine+667856, Engine+667860, Engine+699204, Engine+369332, Scene+46508
- **emulator 现状**：『帧』现在由唯一驱动 runFrameLoop 定义（门 → 批 → 帧末 present），产品路径（session.ts）与全部 headless 入口都经它 ⇒ 不再是『PixiBackend.present 由渲染循环调用』那种结构。emulator 的等价门 = gates 四档（anim/sleep/stage/advance）+ present:needsRender（判据 scen…

### `scene-frame-commit`（partial）

- **能力**：Scene 逐帧提交（四路归并 + 绘制）
- **触发**：主循环帧提交门放开，或脚本执行 opcode 0x20C，或其它子系统直调
- **缺失时为什么静默**：脏标志为 0 或 `Scene+1056==0` 时内部各分支自然不成立，函数正常返回，无日志
- **引擎**：sub_4B4040, sub_4B06D0, sub_41A1A0 @ raw 134417-136966
- **读的字段**：Scene+46508, Scene+46516, Scene+46512, Scene+46500, Scene+1860, Scene+46456, Scene+46676, Scene+1056
- **emulator 现状**：声明已按审计收窄（2026-09-21，收口 T-0075 审计的 no-evidence）：本条的 `guard`（`test/draw-item-slot-coverage.test.ts`）只断言「`draw-texture` 绘制项按槽绑定（比例 ≥0.95、存在 tex≠layer 项）」，不覆盖"四路归并"这条声明；原 note 里的「MeshEntry 黑罩」是已作废的旧近似（`re…

### `scene-3d-effect-level-writer`（partial）

- **能力**：3D 效果等级的初始化决策
- **触发**：`sub_4A6EE0` 被调用（Engine 初始化 raw 11941 传 Scene）
- **缺失时为什么静默**：按 D3D 版本能力（0xFFFF0100/0xFFFF0200）自动落 0/1/2 档；档位低只是少画特效，无报错
- **引擎**：sub_4A6EE0 @ raw 126552-126561
- **读的字段**：Scene+46668, Scene+42456, Scene+1860
- **emulator 现状**：Scene+46668 不只是 3D 档（写端 raw 126552-126561），它是 2D 绘制循环 sub_4B06D0 的分支门（raw 136517/136024/135518 的 <2、136199 的 >=1）；emulator 完全未建模（绘制侧等价恒 0，presenter.ts:157 只实现 bit0 门）。

### `scene-flag-46528-bits`（absent）

- **能力**：Scene+46528 bit1/bit2 冻结豁免
- **触发**：bit1 非零 ⇒ 拒绝 sub_407EA0 置冻结（raw 12793）；bit2（=0 时）⇒ sub_49AA30 不提前收尾动画窗（raw 117440-117449，进入门 = MeshEntry flags&2 且 flags&1）
- **缺失时为什么静默**：两个函数各读一位 bit，读错极性只会让动画窗「提前收尾」或「不冻结」，没有断言/日志；进入门（flags&2 且 flags&1）漏掉时该分支完全不进。
- **引擎**：sub_407EA0, sub_49AA30 @ raw 117430-117449
- **读的字段**：Scene+46528
- **emulator 现状**：冻结豁免位（bit1 阻止置冻结 / bit2 忽略已置冻结）随 46512 一起未建模

### `scene-norender-mode`（partial）

- **能力**：Engine+167990 无渲染/隐藏窗口模式
- **触发**：启动参数（WinMain raw 142044 配套置 effect_flags|0x80000）或脚本经 raw 40114 读取该值；本文件内无写入点
- **缺失时为什么静默**：19 处门全是 `if (!_this[167990])`：非零时跳过「消息框前后隐藏/恢复窗口」「窗口尺寸同步」，脚本继续跑，完全无日志
- **引擎**：sub_41A1A0, sub_412290, sub_405530, sub_4065F0, sub_406650, sub_40A4C0, sub_430A20 @ raw 11120-40120
- **读的字段**：Engine+167990
- **emulator 现状**：语义冲突待复核：emulator 把 display:ScreenMode 绑到 167990（当"显示模式"读），而引擎里它是「无渲染/隐藏窗口模式」（19 处门 + 经 raw 40114 暴露给脚本）⇒ 绑定可能错位

### `scene-render-freeze-46676`（absent）

- **能力**：Scene+46676 3D/文字渲染冻结总闸
- **触发**：外部（脚本/命令层）把该字段置非零；本文件内 105 处引用全部是读、**零写入**
- **缺失时为什么静默**：非零时 `sub_49FCD0` 整帧直接 `return 1`、相机矩阵/抖动/缩放补偿全部跳过 —— 合法路径、无报错，只是 3D 世界被冻结在最后一帧
- **引擎**：sub_49AA30, sub_49FCD0, sub_4A1F00, sub_4A2D50, sub_4A7DA0, sub_4AEEA0, sub_4AF1C0, sub_4B06D0, sub_4B4040, sub_4B4460, sub_4B4910, sub_4B4B90 @ raw 117239-137597
- **读的字段**：Scene+46676
- **emulator 现状**：引擎里 105 读 / 0 写的"渲染冻结总闸"（含 2D 与文字路径）⇒ emulator 无对应开关，相关表现差异无从解释

### `scene-draw-total-gate-1056`（absent）

- **能力**：Scene+1056 转场记录表条数（★订正：不是主绘制总门）
- **触发**：sub_4B06D0 入口：Scene+1056 == 0 ⇒ 直接 return（该函数是**转场遍**）
- **缺失时为什么静默**：只是一个 if 判断就 return —— 没有日志或错误码；但后果被轮 7 订正为「转场遍空转」而不是「整帧绘制消失」
- **引擎**：sub_4B06D0 @ raw 134814-134818
- **读的字段**：Scene+1056, Scene+46456
- **emulator 现状**：轮 7 以体订正（tickets/T-0091 第③项规格）：Scene+1056 是 Scene+1048 转场记录表的条数（sub_4A9BE0(Scene+1048) 收尾把它置 0，raw 129300），而 sub_4B06D0 开头 if (*(_DWORD*)(_this+1056)==0) return（raw 134814-134818）⇒ sub_4B06D0 只是转场遍（无记…

### `clock-write-clock-freeze`（partial）

- **能力**：每帧时钟写入与时钟冻结门
- **触发**：主循环每帧写 `Engine+369332`；opcode 0x20C / `sub_41A090` / `sub_41A2C0` 也写；`Engine+107438` 非零时只递增 107439
- **缺失时为什么静默**：时钟停走时动画只是静止，所有基于时间的比较都合法
- **引擎**：sub_412290, sub_41A090, sub_41A2C0, sub_41A1A0 @ raw 20750-20751
- **读的字段**：Engine+369332, Engine+369336, Engine+107438
- **emulator 现状**：时钟已是单一时间域 —— 驱动每帧读 host.now() 写进 Engine.nowMs，宿主（pixi）经 advanceModel(nowMs) 接收，不再自己算 performance.now()-wallStart（旧 note 里的『present 用墙钟』已过期）。守卫 test/frame-loop.test.ts（每帧时钟前进/冻结档）+ test/frame-digest.te…

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
- **emulator 现状**：四路归并里的 Live2D 那一路（Scene+1096 的 572B 立绘节点）已接：节点 key（= 0x344 的 op1）与 DrawItem 的 handle、MeshEntry 的 handle 同键比较、取小先画，等键次序 item→text→mesh→节点（raw 135586-135614）；TITLE 的静态立绘 draw-texture 14 与 L2D 支的 i344 14…

### `render-3d-layer-dual-commit`（absent）

- **能力**：3D 层对偶逐帧提交
- **触发**：其它子系统直接调用（本文件未见主循环调用点）
- **缺失时为什么静默**：与 `sub_4B4040` 同型的静默门控（脏标志/递归门），门不满足即正常返回
- **引擎**：sub_4B4460 @ raw 136969-137427
- **读的字段**：Scene+46508, Scene+46516, Scene+46512, Scene+1860, Scene+46456
- **emulator 现状**：该对象 sub_4B4460 就是 opcode 0x222（handler sub_423EC0，dispatch 表 678180）的体；emulator 三张表都没有 0x222 ⇒ 语料 i222 10 处（SETPOLYGON/INFOxx）命中即 NotImplementedOp。原先标 n/a-known 掩盖了缺口；待补实现（T-0076）。

### `transition-table-flush`（absent）

- **能力**：转场表帧尾收尾（sub_4A9BE0）
- **触发**：`Scene+46516 == 0` 时每帧帧尾清空 `Scene+1048`
- **缺失时为什么静默**：`46516` 恒非零时表永不清空，转场只是重复执行，无报错
- **引擎**：sub_4A9BE0, sub_4AA180 @ raw 129283-129302
- **读的字段**：Scene+1048, Scene+46516
- **emulator 现状**：转场表帧尾收尾（sub_4A9BE0）未建模；与 scene-pending-flag 共同决定"转场是否清空"

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
- **emulator 现状**：引擎的脚本派发队列（sub_40FB60，由帧末/unlock/0x143 驱动）未建模 ⇒ 依赖"延迟派发"的流程在 emulator 里不会发生（0x143 是 no-op）

### `vertex-buffer-lock-scale`（absent）

- **能力**：顶点缓冲 Lock/Unlock + 视口缩放改写
- **触发**：`Scene+46676 == 0` 且脚本深度非 38/负值时才改写顶点
- **缺失时为什么静默**：Lock 成功但 vcount<=0 时循环体不执行；仅 Lock 失败才 sprintf_s + `sub_4034C0`
- **引擎**：sub_4AF1C0, sub_4A1F00, sub_4A2050 @ raw 133571-133612
- **读的字段**：Scene+46676, Scene+1860, Scene+46456
- **emulator 现状**：顶点缓冲 Lock/Unlock + 视口缩放改写未建模 ⇒ mesh 曾只能画成整屏色块（2026-09 已按真实四边形绘制），顶点几何曾全丢（2026-09 已建模） ★2026-09 订正：mesh 的顶点几何与逐顶点色已建模（见 `mesh-vertex-quad-and-per-vertex-color`，modeled-verified/E3，守卫 `test/mesh-vertex-…

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

### `lazy-572b-node-map`（partial）

- **能力**：572B 节点表（精灵/特效）惰性插入（表头 eager 130366/130384）
- **触发**：任意 572B 节点 opcode 首次触碰某个 key（`sub_4AAEC0` 取/建记录 + `sub_4A9D70`）
- **缺失时为什么静默**：默认全 0 记录，调用方按 `*result & 1` 判定未激活
- **引擎**：sub_4AAEC0, sub_4A9D70 @ raw 129394-129427
- **读的字段**：Scene+1080, Scene+1084, Scene+1096, Scene+1100
- **emulator 现状**：立绘那一半已建模：`Scene+1096` 的 572B 立绘节点表 = `Engine.l2dNodes`（`src/vm/engine.ts`），节点模型在 `src/live2d/runtime.ts`（`l2dCreateNode` = `0x344` 的 op1=key/op2=槽），出画门 `l2dNodeDrawable`；守卫用真实 TITLE 资产（`test/live2d-ch…

### `bullet-dirty-from-freeze-or-pending`（partial）

- **能力**：冻结/pending 强制延续刷帧
- **触发**：`*(_QWORD*)(Scene+46512)` 非零（冻结或 pending 任一）
- **缺失时为什么静默**：只是把脏标志置 1 让下一帧继续画，无日志
- **引擎**：sub_4B06D0 @ raw 136718-136719
- **读的字段**：Scene+46512, Scene+46516, Scene+46508
- **emulator 现状**：emulator 的 needsRender() = sceneNeedsRender（脏 || 还有窗在跑；后者 = scAnimationsPending 扫 mesh 全窗 + draw item 5 窗）；旧 note 里的 waitFlags&0x400 一项已随 waitFlags 镜像一起删除（门状态的真源是 Engine.waitFlags，『门等待期间持续合成』由帧驱动负责）。★…

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
- **emulator 现状**：部分：ReadTextSkip 门已实现（含 0x1CA 运行期覆盖）。仍未建模引擎真正的逐字/逐行推进泵 —— 见 text-reveal-pump-409400（sub_409400 + sub_45BE20 + message:MessageSpeed）；本条目只覆盖「是否已显示完」的判定，miss 时统一返回 0 属合法路径。

### `msgwin-text-object`（partial）

- **能力**：文本对象（Engine+85296，dword 写法 Engine[21324]）的槽模型与排版入队
- **触发**：0x71 经 sub_45EC60(Font、slot、Engine+97055) **开始一段新消息**（清该窗文本记录向量 + 复位显现游标 + 清该窗表面）；0x6E/0x196/0x7D 经 sub_46BE30/sub_46CBF0 往该窗铺排文本；0x72 只判显示态并挂起。
- **缺失时为什么静默**：文本槽是纯数据结构：写入只改字段、清图元只调容器接口；没有可渲染输出也不会报错（脚本继续跑到下一条消息）
- **引擎**：sub_45EC60, sub_46BE30, sub_46CBF0, sub_45D660, sub_456430 @ raw 74196-74282
- **读的字段**：Engine+85296(文本对象; dword 写法 Engine[21324]), Font+1044(10 窗口), Font+1228(默认窗), Font+1032/+1036/+1040, Engine+667856
- **emulator 现状**：部分：已建模文本槽内容（show-text 追加 / end-text-line 断行 / display-furigana 注音）、消息窗对象表（0x212/0x213/0x25D）与 0x71 的清场语义（MsgWindow.beginNewMessage；漏掉它会让上一屏文案残留并在下次 0x71 被当新消息重新逐字显现 —— 2026 实测 CONFIG 进/出设置重放与两行）。仍未建模：…

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
- **emulator 现状**：已实现三态机本体（`Engine.serviceAdv()` 内，掩码 bit4 = 鼠标左键驱动 122370: 0→1→2，到 2 时清 ADV + 复位 ReadTextSkip）。但引擎门控在 `GetConfig("set:CancelMessageKey")`，随包 SYS4REG.INI 没有该键 ⇒ 与引擎一致地处于休眠（cfgInt 缺省 0）。

### `msgwin-text-method-opcodes`（partial）

- **能力**：文本子系统方法转发指令族（约 25 条）—— 属**指令集**
- **触发**：脚本布置消息窗时逐条调用；每条只读 N 个操作数并转发到文本对象 Engine+21324 的一个方法
- **缺失时为什么静默**：这些 handler 体只有「读操作数 → 调文本对象方法」，没有回写操作数、不改 ip；emulator 把它们当 no-op 跳过时，脚本拿到的是「已执行」的状态，控制流正常，只是消息窗永远没有内容/几何 —— 无日志无报错
- **引擎**：sub_41ED20, sub_41F250, sub_41F350, sub_41F490, sub_425EF0, sub_426200, sub_4332D0, sub_456430, sub_45D660, sub_4563A0, sub_4185F0, sub_432DD0 @ raw 28401-41818
- **读的字段**：Engine+21324, Engine+21585, Engine+166964, Engine+430600
- **emulator 现状**：部分：消息窗对象表三条（0x212/0x213/0x25D）已实现；其余约 22 条纯转发器（0x70/0x73/0x74/0x75/0x197/0x198/0x1B5/0x1BB/0x1C1/0x1C9/0x1CE/0x324…）仍是 no-op —— 它们转发到不存在的文本布局子系统，不假装实现。

### `msgwin-attr-font-opcodes`（partial）

- **能力**：文本属性 / 描边 / 字体 / 注音指令族（0x75/0x76/0x77/0x78/0x81/0x8B/0x1A4/0x197/0x1A5/0x2BD/0x2BE/0x2DB/0x2FE/0x196 等）—— 属**指令集**
- **触发**：脚本设置字体/文本属性时调用；0x196 display-furigana 在消息文本里插注音；0xC5 读音量配置写操作数
- **缺失时为什么静默**：多是"改模板字段 + 重建句柄"的纯属性写入：不实现则参数保持默认（白字/黑投影/24px），画面还能看，只是**失去脚本指定的观感与阅读体验**。0x1C5/0xC5 一类会回写操作数，被跳过时脚本读到旧值。
- **引擎**：sub_41F350, sub_41F390, sub_41F3F0, sub_41F450, sub_41F6C0, sub_41FBF0, sub_41FE60, sub_41FDD0, sub_433290, sub_426200, sub_426260, sub_426500, sub_4332D0, sub_41FC20, sub_455ED0 @ raw 28652-29163
- **读的字段**：Font+1360/+1364/+1368/+1372/+1380/+1384/+1388/+1392(颜色与描边), Font+1232/+1248/+1260(主字体), Font+1292/+1308/+1320(注音字体), Font+218516/+218588(字重), Font+201684/+218584(字号), Font+235108(竖排)
- **emulator 现状**：部分：0x196 display-furigana 已实现（记录注音对）。仍为 no-op 且属 P0（阅读体验）：0x75 字号 / 0x76 填充色 / 0x77 描边色 / 0x78 描边档位 / 0x1A4 描边偏移 / 0x8B 第三色 / 0x197 注音字号 / 0x2BD/0x2BE 加粗 / 0x1A5/0x2FE 面名。★描边四档（0 无 / 1 单向投影 / 2 1-4 强度…

### `adv-advance-route-table`（partial）

- **能力**：点击热点 / 路由表（Engine+0x55D8）与「推进」的真实判据
- **触发**：`0x090` 登记热点项（消息场景常见 `i090 0 0 500 2d0 …` 全屏热点）；`wait-for-input` 挂起后每帧 `sub_411BC0` 做命中测试/键命中
- **缺失时为什么静默**：表为空或游标 -1 时 `sub_403E70`/`sub_403D70` 都返回 -1，调用方只是「继续等下一帧」，无日志无错误码；只有表满时 `0x090` 才抛 ShowMessage
- **引擎**：sub_420640, sub_403B30, sub_403C50, sub_403D70, sub_403E70, sub_411BC0, sub_411900 @ raw 9740-29518
- **读的字段**：Engine+21976(表基址 0x55D8), Engine+29872(游标), Engine+29864(推进标志)
- **emulator 现状**：已按 .tmp/mouse-dispatch-spec.md 忠实重做（2026-09）： ① 点击/键命中一律走 labelC（[459+i]：sub_403D70 raw 9862 / sub_404E00 raw 10675 / 主循环 raw 20182）；旧实现取 labelA 是错的。 ② 悬停 label 是带返回点的子程序：sub_405360(Engine, -3)（raw 11…

### `msgwin-config-gates`（partial）

- **能力**：消息/ADV 路径上的配置门与「当前走不到的分支」
- **触发**：各 handler 体内的 `GetConfig("…")`；随包 SYS4REG.INI 的取值决定走哪一支
- **缺失时为什么静默**：配置门是普通 if：取值为假时对应分支整段不执行，没有日志也没有错误码；更隐蔽的是**配置回读类指令被当 no-op 时脚本读到旧值**（不报错、只算错）
- **引擎**：sub_41EB20, sub_41ED80, sub_41EEF0, sub_411900, sub_411BC0, sub_409400, sub_42E540, sub_42E670, sub_4309E0, sub_431110, sub_4311B0, sub_42D2F0 @ raw 20096-40386
- **读的字段**：Engine+697620, Engine+174405, Engine+86672
- **emulator 现状**：清单与逐键分支见 `docs-new/03-engine/message-config-gates.md`。要点：(a) `message:ReadTextSkip=0` ⇒ 0x6E/0x71/0x72 不置 ADV（emulator 已按门实现）；(b) `message:MesWinAlpha=8` ⇒ 每段文本 8ms 节流（已实现）；(c) `set:CancelMesSkipOnCli…

### `text-layout-wrap-ruby`（absent）

- **能力**：文本排版：逐字像素量宽 + 边界硬断 + 注音配对（sub_46BE30）
- **触发**：0x6E show-text / 0x196 display-furigana / 0x7D 每次入队时
- **缺失时为什么静默**：排版产出的只是一串记录与源矩形；不排版不报错，只表现为「文字不出现」「位置不对」。更隐蔽的是：断行规则与引擎不一致时，行数/每行字数与脚本可观测的 0x83(当前行)、0x1C5/0x2C2(读回已显示文本)、0x2F3(行坐标) 全部对不上 —— 静默错误会从像素层渗到 VM 层。
- **引擎**：sub_46BE30, sub_45E870, sub_475CF0, sub_4572A0, sub_45D120 @ raw 83363-83997
- **读的字段**：FontVWindow+36/+40(右/下边界), FontVWindow+44/+48(24B 行记录), FontVWindow+208(120B 文本记录), Font+201684(字号), Font+1236(字宽), Font+218592/+218596(缩放)
- **emulator 现状**：缺口：逐字 GetTextExtentPoint32A 量宽、右/下边界硬断、注音配对（24B 记录 +0 种类 / +20 组 ID）与按比例缩短都未建模。★引擎的等宽网格（lfWidth = 字高/2 ⇒ 全角 1em / 半角 0.5em）使排版可退化为纯算术，不需要浏览器度量。★引擎无禁则、无 0x0A 换行处理。

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
- **emulator 现状**：部分：DrawItem 颜色动画窗（含整数截断插值、共享起点、窗末收尾）已建模并有守卫；缺的是把它接到消息窗行上（按 MessageSpeed×MessageFade/100 设时长）。

### `msgwin-backlog-cursor`（absent）

- **能力**：已读文本回看：页表 Font+3380 + 72B 回看项 + 光标 sub_459770
- **触发**：0x71/0x70 登记一页；滚轮（输入位 0x8/0x2）与 0x84 移动光标
- **缺失时为什么静默**：页表不建则回看与滚轮完全无反应；更关键的是 0x84「翻到底」时本应置 effect_flags |= 0x100000 并弹保存栈让脚本继续 —— 页表为空则这个"到达末尾"永远不发生，脚本会停在自旋里（表现为卡住，而不是报错）。
- **引擎**：sub_459770, sub_45EFA0, sub_45EBE0, sub_45EC60, sub_45D660 @ raw 70575-70627
- **读的字段**：Font+3380/+3384(8B 页表), Font+3364(72B 回看项), Font+859/+860(末项/当前光标)
- **emulator 现状**：缺口：无回看页表与光标。CONFIG1 链路上不触发，但真实剧本的滚轮回看与 0x84 依赖它。

### `text-font-rebuild-cascade`（partial）

- **能力**：字体参数 → 句柄重建级联（0x75/0x197/0x1A5/0x2FE/0x2BD/0x2BE/0x2DB → sub_459F40 / sub_45A6E0）
- **触发**：任一字号/面名/字重/度量模式指令；或子系统 Initialize
- **缺失时为什么静默**：★`sub_459F40` 入口守卫 `if (!Font+1260) return`：面名为空 ⇒ **整个重建不发生**，句柄保持 0，GDI 用系统默认字体把字画出来，全程无错误。同理 `0x2BD`（加粗）只改模板里的 lfWeight 并触发重建，不重建则"加粗"这一档完全无效。旧口径把 sub_459F40 说成"文本重排"、把 0x2BD 说成"调 sub_459F40"，均不成立（它不在派发表里）。
- **引擎**：sub_459F40, sub_45A6E0, sub_4185F0, sub_418680, sub_4328F0, sub_432DD0, sub_428990 @ raw 70940-71273
- **读的字段**：Font+1232/+1236/+1248/+1260(主模板), Font+1292/+1296/+1308/+1320(注音模板), Font+201684(主字号), Font+218584(注音字号), Font+201664(字体名白名单)
- **emulator 现状**：7 条参数面（0x75/0x197/0x1A5/0x2BD/0x2BE/0x2FE/0x2DB）与面名映射/竖排都已落地并接线（msgwin.ts:1146-1189 的 op 体、engine-fields.ts:117/300/302、text/fontSet.ts:102-232），守卫 test/text-layout.test.ts:248-264 / font-bold-face.te…

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
- **emulator 现状**：两道屏障：① `renderer/app/session.ts` 的 `#present()` 前 `texturesIdle()`（既有，防「文本先出现、背景晚几帧」）；② `0x1F9` 之后立刻 `await texturesIdle()`（2026-09 新增，`#awaitTextureBound`）—— 后者才修得掉 `0x208` 读到 0×0。`texture-frame-barr…

### `scene-3d-weather-effects-rain-snow-leaf`（absent）

- **能力**：3D 天气/粒子效果管理器（Rain / Snow / Leaf）的创建·重建·逐帧推进·销毁
- **触发**：Scene 初始化 `sub_4A6EE0` 里建管理器；脚本用 `0x327`(Rain) / `0x326`(Snow) / `0x328`(Leaf) 懒建或重建单个效果；`0x325` 写管理器的两个字段；`0x324` 一次性销毁全部；帧循环每帧推进
- **缺失时为什么静默**：管理器与三个效果对象都不在脚本可见状态里：漏掉它**不报错、不改控制流**，只是**雨/雪/落叶完全不出现或永远不更新**（`0x324`/`0x325`/`0x326` 当 no-op 时），而 `0x327`/`0x328` 因为**没有注册 handler** 会以 `NotImplementedOp` 的形式暴露 —— 两条路都不指向"真正的缺陷是缺了整个子系统"
- **引擎**：sub_4A6EE0, sub_4530B0, sub_453280, sub_453330, sub_453410, sub_453150, sub_4535F0, sub_453540 @ raw 126522-126570
- **读的字段**：Engine+0x5B320（= Scene+50704）3D 效果管理器指针, Manager[258] Rain / [259] Snow / [260] Leaf, Manager[262..309] 三组 16-dword 参数块 / [310]/[311] / [312] 清空标记, Scene+46668 3D 特效等级门槛 / Scene+46496 共享 ID3DXEffect(资源 202), Scene+4*mesh+50708 网格层级槽表
- **emulator 现状**：emulator 完全没有 3D 粒子效果子系统：`0x324`/`0x325`/`0x326` 是 `ENGINE_INTERNAL_OPS` 的纯 no-op，`0x327`/`0x328` 根本没注册（命中即硬报错）。逐条语义见 live 表格 `docs-new/03-engine/opcode-table.md` 的 0x324-0x328 行（`opcode-table.md` 是生成…

### `passive-camera-and-effect-render-state`（absent）

- **能力**：3D 效果的逐帧渲染状态重设（不是 opcode 设置的）
- **触发**：帧循环每帧：`sub_4535F0(管理器, -1)` 下发 SetRenderState(7/14/27/…) 并按管理器 `[315]` 分支，再 `sub_453540(管理器)` 按 `timeGetTime()` 步进粒子
- **缺失时为什么静默**：这两个调用在**帧循环**里，不在任何 opcode 上：缺失时粒子不会动、渲染状态不重置 ⇒ 画面错但不报错。★这条正是"第二层能力面"的典型 —— 把所有 opcode 都实现对了它仍然会缺
- **引擎**：sub_4535F0, sub_453540 @ raw 136828-136829
- **读的字段**：Manager[261] 设备, Manager[313]/[314] 时间基准, Manager[315] 渲染模式
- **emulator 现状**：emulator 的 PixiBackend 每帧 present 时不重设 D3D 级渲染状态（本来就无 D3D），但"粒子按墙钟时间步进"这一行为需要随 3D 效果子系统一起建模

### `gfx-prim-mesh-and-render-state`（partial）

- **能力**：A4：图元变换 / 槽→槽 blit / 呈现清屏 / 转场表 / 绘制模式 / DrawItem·MeshEntry 属性 / 3D 颜色（13 条）
- **触发**：0x238 = 装载 0x400 等待门的等待计时器（起点清零 / 时长 op1 ms；raw 32303-32312），读者 sub_407E20（raw 12761-12786）与主循环（raw 21109）；★审计 P1 订正：原 trigger 写的「画布尺寸对」没有依据。
- **缺失时为什么静默**：★这一族**从不回写脚本操作数、也不改控制流** ⇒ 从 VM 视角完全不可观测：漏掉它们**不会报错**，只表现为「画面与真机不一致」（变换/裁剪/blit/清屏/槽标志/网格属性失真）。正因如此它们长期被当作「无依据的 no-op」（`ENGINE_INTERNAL_OPS` 与 `STUB_NATIVE_OPS`），缺口在纯脚本链路里永远看不到 —— 属闸门 B（能力缺口）那一类。
- **引擎**：sub_422F80, sub_423060, sub_423480, sub_41A200, sub_41A290, sub_423FE0, sub_4248C0, sub_4251A0, sub_425C30, sub_425D20, sub_426BD0, sub_426F80, sub_427040, sub_4AC470, sub_4AC660, sub_4A3980, sub_498B60, sub_4AA180, sub_49A690, sub_49A6C0, sub_49A6F0, sub_4AD9A0, sub_4ACD10, sub_4AE280, sub_4A0750, sub_499DF0 @ raw 31303-31345
- **读的字段**：DrawItem 变换字段（`+104`、`+132..+164`）, Scene 纹理槽表（槽→槽 blit）, Scene+1048（转场容器）, Scene[278]/[279] 与 Scene[286..288]（绘制模式）, Engine[92338]/[92339]（画布尺寸对）, DrawItem `+720`（与相邻对象 `+504`）, Scene+1872/+21872 的两张纹理槽标志镜像表, Scene+1064（网格属性表）, Scene[op1 + 12677]（3D 模型槽）
- **emulator 现状**：除 0x207（槽→槽 blit）已由 TextureCache.blitSlotToSlot 真转送像素外，其余按宿主缝记录；原 note 的「11 条只记录」不成立。

### `text-aa-config-gate`（partial）

- **能力**：文本抗锯齿是一把配置门：只有 set:EnableAntiFont 为真才读 message:UseAntiFont 写 Font+1352
- **触发**：启动读配置（raw 23649-23656）：if GetConfig(set:EnableAntiFont) 为真才 GetConfig(message:UseAntiFont) 并 sub_4155B0(Font, v)（raw 22409-22422：写 Font+1352 = Engine[21662]、重建字体、清字形缓存）。Font+1352 == 0 走 GDI/dd 的 TextOutA 整串锯齿字形；非 0 走软件 AA 字形（Font+3524/+3528 的 1/4 强度位图）
- **缺失时为什么静默**：这条门缺失或照抄错时的症状只有字看着不对，不报错、不影响脚本状态：把 message:UseAntiFont 当开关直接用（跳过 set:EnableAntiFont 门）则本机 base INI 连 [set] 段都没有而 message:UseAntiFont=1，会误判成引擎开 AA，于是宿主用 canvas 抗锯齿（灰边）画字，字形发胖、白色边缘发亮，与真机对照就是字比引擎粗。反向（明明开着却按锯齿渲染）会让文字显得毛糙。另两个看起来相关的键是死写、不该照抄：message:AntiFontLevel（raw 23653 写 Engine+303796，全库无读者）与 set:Menu_UseAntiFont（只被配置表读写、渲染侧无读者）。
- **引擎**：sub_4155B0, sub_459F40, sub_474BD0, sub_474F60, sub_4757F0 @ raw 22409-22422
- **读的字段**：Font+1352（AA 开关；= Engine[21662]）, 配置 set:EnableAntiFont / message:UseAntiFont
- **emulator 现状**：前半（两键门 + 阈值机具）为真；后半为假：字段 21662（aaEnabled）在渲染侧没有消费者（全库唯一出现点就是它的定义），msgwin.ts:146 直接写死 antiAlias: true ⇒ AA-off 的 drawAliasedLayer 分支在产品路径不可达（test/text-aa.test.ts:54-65 反而断言了「不跟随字段」）。审计 audit-2026-09-ca…

### `text-white-level-on-composite`（partial）

- **能力**：引擎画的文字在成片上被压到 ≈0.89×白（实测；同屏美术图不受影响）—— 机制未定位
- **触发**：所有由引擎自己绘制的文字（ADV 正文、设置界行标签、字体样例预览、直绘串）；同一屏的美术图（按钮面、局部化 UI 图、ON/OFF 图）**不受影响**。取色链读到绘制之前：绘制用的是 Font+1360（= 脚本全局 f807b，序章为 0xFFFFFF，raw 79666 行路径 / raw 79259-79273 ADV 路径都是逐字传该字段）⇒ 这一档发生在 GDI 画完之后的合成里，不在颜色链上。
- **缺失时为什么静默**：★缺失时完全静默：宿主把文字画成 255 纯白，而引擎成片是 ≈226-232 ⇒ 观感上「文字更白更粗」（正是 T-0035/T-0042 用户实测的症状），没有任何报错或日志；只有把**同屏截图逐区域比对**才看得出来 —— 且很容易误判成字重/字体问题（T-0035 前几轮就误判过）。
- **引擎**：sub_455ED0, sub_43C8D0, sub_45E870 @ raw 68011-68129
- **读的字段**：Font+1360(填充色), Font+1364(描边色)
- **emulator 现状**：实测（T-0042）：引擎 vs emulator 同屏（OPTION 系统设定）逐区域比对 —— 引擎画的文字核心恒 226-232，其中字体样例预览横跨「亮天空→暗照片」（背景 7→49）时核心只动 0.3 ⇒ 是常数压暗，不是与场景的 alpha 混合、也不是重采样；而美术图（米白按钮面 (254,243,229) 在两边是 9542 vs 9553 px、纯白高光 374/374）逐像素一…

### `live2d-enabled-config-flag`（partial）

- **能力**：Live2D 开关（`global a9d0`）与静态贴图回落
- **触发**：TITLE / BTL / INFOEN 在进 L2D 段之前用 `jcc (global-int a9d0)` 判：**== 0 走 Live2D，!= 0 走静态贴图**（TITLE 的回落 = `set-texture 5273 5`，即 740×700 的 SO004A）。脚本侧证据：src/TITLE.txt:526-530 / src/BTL.txt:1609-1616 / src/INFOEN.txt:711；该项由 CONFIG1 写（src/CONFIG1.txt:1483,1741）、LOADCONFIG 读、INITCONFIG0 默认 **0**（= 默认开）。★**开关本身只在脚本层**：`a9d0`/`f8c46`/`f8c47` 是**脚本 global 槽号**，整个反编译产物里 **0 命中**（没有引擎读点）⇒ 引擎侧能引的只有"被它门控的那条 L2D 装载支"的入口。
- **缺失时为什么静默**：开关只在脚本层判：关掉后走静态贴图，画面照样有、只是人物不动；引擎侧没有 L2D 初始化断言 ⇒ 缺 L2D 时不会被当成故障。★**订正（2026-09-21，收口 T-0075 审计的 no-evidence）**：原 `engine.fns=[sub_4209B0]`/`raw=29615-29639` 是**错的** —— `sub_4209B0` 是派发表项 676636 的 handler，即 opcode `(676636-675996)/4 = 0xA0`（jcc 条件跳转），体内只 `sub_41BF50` 取值/改 ip。现改为引**被门控的 L2D 装载入口**：0x341 → `sub_427BA0`（派发表 raw 23249 `*(_DWORD *)(_this + 679328) = sub_427BA0;`，`(679328-675996)/4 = 0x341`），体 raw **34460-34495**（读文件 id/槽号 → 建模型实例）。
- **引擎**：sub_427BA0 @ raw 34460-34495
- **读的字段**：脚本 global a9d0(Live2D 关标志；脚本层开关，非引擎字段), 脚本 global f8c46(要装的 MOC 文件 id), 脚本 global f8c47(L2D 槽号)
- **emulator 现状**：L2D 支已能装载并有场景级证据（2026-09，`tickets/T-0054` M2/M3）：`i341/i345/i34E` 从桩转真实现（`handlers/live2d.ts` 的 LIVE2D_NATIVE_OPS，宿主按统一文件 id 读 `.MOC`/PNG/`.MTN`），真 TITLE 资产的装载/纹理绑定/动作入队/节点出画都有 E3 守卫（test/live2d-chain…

### `scene-teardown-on-load-point`（partial）

- **能力**：读档装载点清空绘制项容器 + 从存档 body 还原绘制项清单（raw 19806-19832）
- **触发**：每次真槽读档（sub_410160 装完槽表之后）
- **缺失时为什么静默**：★★不报错、只让画面完全不对，而且方向与直觉相反：不清+不还原时，上一屏（TITLE/菜单）的绘制项留在容器里，而装载段紧接着按存档重绑槽表（`records[4].flag==1 ⇒ 槽 4 ← 0xB37 = BG050ABL`）⇒ 残留项当场改画成存档那张图：TITLE 的 6 个引用槽 4 的项按各自的源矩形去采样 2048×1152 的 BG050ABL ⇒ 5 块 156×156 菜单板在 (1102,294)/(992,402)/(869,485)/(729,543)/(1107,554) 排成「天空碎片阶梯」，0x64 那条的源 y=1161 已越过图高 1152（灰块）。引擎读档后画面上是**存档那一屏的绘制项**（含 SN0000 背景项 handle 0x18A88、slot 4、src (0,0,2048,1152) @ dst (0,0)；键 101000 ≫ TITLE 的 0x135 ⇒ 天然盖住一切）。
- **引擎**：sub_410160, sub_49A300, sub_40C910, sub_40C310, sub_40BB60 @ raw 19806-19832
- **读的字段**：Engine+323864 = Scene+0x408（绘制项容器：+0 计数 / +4 树根 / +8 size）, Engine+323872 = Scene+0x410（容器元素数）, file body 末段 {u32 740、u32 count、(u32 handle + 740 B DrawItem 记录) × count}
- **emulator 现状**：本条的原始实现是对的 —— 装载点调 clearDrawContainer() + clearMeshSlots() 并有 E4（读档后只剩 ADV 场景）。随后 (B) 步以「sub_410160 的 27 个被调函数里没有清容器」为由删掉了这一刀、换成 Item.ownerFrame + dropFrameItems ⇒ 残留回归（用户报的阶梯）。源码证明 (B) 的前提错：清容器是 sub_…

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
