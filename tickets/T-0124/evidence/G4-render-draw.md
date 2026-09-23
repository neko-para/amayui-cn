# G4 组（渲染 / 绘制项 / 图元 / 转场 opcode / 命中测试）25 文件只读审计

- 范围：`app/amayui-emulator/test/` 下 25 个文件（清单见 §1），**逐文件、逐断言体**读过（25/25 全文，不是只看 `it()` 标题）。
- 只读纪律：未修改任何文件（本报告外零写入）；**未跑** `npm test` / `npm run verify` / `npm run shot`（按要求让出 CPU 与 Electron）。所有 `cost` 判断是**结构性**判断（读代码得出），不是实测耗时。
- 交叉核对过的对象：`test/harness.ts`、被测量的 `src/renderer/**`（`headlessScene.ts`/`pixi/presenter.ts`/`scene/ops.ts`/`scene/transition.ts`/`scene/blend.ts`/`scene/state.ts`/`drawitem/*`/`text/layout.ts`/`vm/handlers/region-hittest.ts`/`arch/windowPlacement.ts`/`arch/agfSize.ts`）、引擎 raw 抽查（`engine/天结_unpacked.exe_utf8.c`，184091 行 / 5.0 MB）、票据 T-0002/0008/0017/0021/0024/0025/0040/0049/0050/0051/0062/0076/0083/0084/0085/0087/0091/0093/0102/0114、`analysis/opcode-gaps.json`、`tools/dbg.cjs` + `src/vm/debugQuery.ts` + `src/vm/debugBreak.ts` 的命令面。
- 一次**实测**（唯一一次执行，纯 Node 语义探针，不触碰仓库）：

  ```
  node --input-type=module -e 'import {test} from "node:test"; … assert.rejects(Promise.resolve(...)) /* 未 await */'
  → ✔ pass 1  fail 0
    ℹ generated asynchronous activity after the test ended … would have caused the test to fail,
      but instead triggered an unhandledRejection event
  ```
  即：**未 `await` 的 `assert.rejects` 在断言本该失败时仍然报绿**。这直接决定 §2 的第 1 条（`overlay.test.ts:121`）。

判定口径（照任务定义）：价值 = **实现改坏时它会不会红，且红的理由正确**。注释质量、覆盖率数字、note 字数一律不计价值（§2 里恰好有三个反例）。

---

## 1. 25 文件判定总表

cost 列：`语料` = 跑真资源/真脚本；`skip` = 含 `t.skip` 分支；`慢` = 结构性判断的重活（真语料整条 boot / E3 链）。

| # | 文件 | 类别 | oracle | 强度 | cost | Verdict | 一句话理由 + 证据 |
|---|---|---|---|---|---|---|---|
| 1 | `draw-item-anim-window.test.ts` | core | 独立（raw + 手算） | 强 | — | keep | 五窗状态机 + 整数插值的**可证伪**断言：`:142-167` 断言中点 `127` 而非 128（'证明是截断'）、`:169-179` 断言 `+0x34` 共享起点重置后仍 1.5/1.9。改坏插值/收尾必红。 |
| 2 | `draw-item-loop-anim.test.ts` | core | 独立（raw + 手算） | 强 | — | keep + `merge`（`:156-176` ← `draw-item-anim-window:109-127`） | B 层最强断言是**开关对称**：`:87-109` `0x235` 后 `moved.y≠0`、紧跟 `0x230` 后同 clock `y==0` 且 5 个周期清零；`:115-132` 三角波 `4.8/10/5.2/0` 手算。`:157` 自认与 #1 同值（重复见 §3）。 |
| 3 | `draw-item-scale.test.ts` | core | 独立（raw 常量 + 手算） | 中-强 | — | keep | 钉住 `dbl_5201F0 = 100.0`：`:111` `[[121911, 1, 209, 1]]`（20900/100=209，'÷100，不是 ÷256'）；`:156-174` useWorld 门逐条（`0x1FD`/`0x21E`/`0x21F`/`0x220`）——写反 ⇒ 上/下盖被挪走必红。 |
| 4 | `draw-item-slot-coverage.test.ts` | ratchet（真语料） | 部分独立（真语料不变量；阈值/假件自造） | 中偏弱 | **语料 ＋ 慢** | upgrade | 真语料 + 统计不变量有价值，但 `:63-75` **没有到达 TITLE 的里程碑断言**（只 `while (steps < MAX)` + `items.size > 0`），`:45-48` 自造 `SlotRecorder` 的 `detachTexture` 只删项不清 `slotBound` ⇒ 比率单调偏乐观；`:82` 诊断串把同一字段印两遍 `handle=${it.tex} slot=${it.tex}`。改法见 §6.3。 |
| 5 | `blend-mode.test.ts` | core | 独立（raw）+ 产品 walker | 强（含一处自证） | — | keep | 三件事都是引擎行为：`:31-48` 值 2 门控（`mode 2` 不算）、`:68-83` 继承、`:85-99` mesh 后留 `(ONE,ZERO)`；`:114-142` 默认档 = 逐项从 sprite 默认重开（raw 123087-123088）并**保留泄漏档作对照**（`['add','add','normal','none']`）、`:167-223` 端到端真 handler。 |
| 6 | `layer-direction.test.ts` | ratchet / tool | 独立（设计纪律） | 中 | — | keep-ratchet | 静态依赖方向守卫，`src/arch|electron` 反向 import `vm/` 必红（`:87-94`）、`:96-99` save 叶子层、`:101-109` 旧路径。缺点：`:47-57` 只剥 `//` 注释（块注释里出现 `from './vm/x.js'` 会假阳）；`ALLOW` 为空。 |
| 7 | `mesh-vertex-quad.test.ts` | core | 独立（手算 + **E3 真语料**） | 强 | **语料 ＋ 慢** | keep | `:132-173` 走 `runGameStartChain` 真链：断言 `firstTextReached`、`0x19258.state0='#ff000000'→state1='#00000000'`、`0x19640.state1='#80000000'`、且没有"终态不透明黑"的满屏幕布（`:170-173`）——正是"整屏黑、日志空白"那类缺陷的形状。 |
| 8 | `missing-texture-skips-item.test.ts` | ratchet（**源文本**） | 独立（引擎字面串），但被测半边是源正则 | 弱 | （读 5MB C ×2） | **upgrade** | 引擎半边是合法锚点（`:39` `'関数：DrawTexture エラー：描画元テクスチャが作成されていません．'`）；但 emulator 半边只做**源文本匹配**：`:68` `/#placeholder\s*\(\s*it\s*:\s*Item\s*\)/`、`:72` 查日志串不存在、`:83` 竟**要求注释里含 `raw 122952|DrawTexture 报错`**。反例见 §2.2。 |
| 9 | `anim-window-done.test.ts` | core + ratchet | 独立（手算时钟 + 语料锚点 + 源棘轮） | 强 | — | keep | 两条正确范围（合成 vs 池挂起位）分开断言（`:46-94` vs `:100-114`）；`:120-129` 把 T-0024 的证据钉在 `src/SN0000.txt` 的 5 行相邻指令上（`i220 … 0 13880` / `i242 … 1` / `i238 64` / `wait`）——脚本漂移必红。`:156-182`/`:192-204` 是源码棘轮（见 §2.5 的取舍）。 |
| 10 | `window-edge.test.ts` | core（几何）/tool | 独立（需求手算） | 中 | — | keep | 纯几何可核对：`:18` `y = workArea.y+height−TITLEBAR_PX`、`:41` `keep=min(32,h)` 的矮窗分支、`:44-56` 档位解析（未知值 → `bottom`）。`:19` 与 `:18` 冗余（同一事实的弱化重述）。 |
| 11 | `agf-size.test.ts` | core | 独立（第二实现 + 真文件冻结尺寸） | 中-强 | **语料** + `skip`×3 | keep | `:40-69` 在真 AGF 上逐值对照 `scripts/agf/format.js`（`:23` 跨目录 import）；但该 oracle 是**同源移植副本**（文件头自认）⇒ 只防漂移不防"两边一起错"；`:98-110` 与 `:128`/`:130` 的冻结尺寸 `{w:2048,h:1152}` / `{w:1664,h:1536}` 才补上了独立性。本机 `install/SYS4INI.BIN` 存在 ⇒ 用例 1/3 会真跑（非 skip）。 |
| 12 | `overlay.test.ts` | core | 独立（字节级真值） | 强 | 临时目录 + `skip`×2 | keep（**必须修 1 行**） | 核心判据是"**base 一个字节都没变**"（`:72-76`、`:139`），这是不依赖被测实现的自证；`:127-152` overlay→base 读、只写 overlay。★`:121` `assert.rejects(store.write('x.txt','y'), /拒绝写/)` **未 await** ⇒ 永不红（§2.1 已实测证明）。 |
| 13 | `op-032-stretch-texture.test.ts` | core | 独立（raw + 手算） | 强 | — | keep | 夹取公式 5 例含 `(int)` 截断（`:46-49` `src:[0,0,996,576]`）与退化 `null`（`:57-59`）；`:92-111` 用与语料逐字同形的 `i032 2 e 0 0 500 2d0 0 0 140 b4` 断言 `blits` 精确值。 |
| 14 | `op-203-draw-color-alpha.test.ts` | core | 独立（raw + 手算） | 强 | — | keep | 四条边界全部对着 raw 写序：`:60-64` α>255 夹 255、`:66-70` α<0 取当前 `>>24`、`:72-74` color<0 取当前 RGB、`:80-83` 项不存在 `0xffffffff`；`:89-103` 再用共享模型走一遍"回退读的是当前值"。`:106-119` 的 Proxy 探针只证明"读了 4 格"，判别力弱但无害。 |
| 15 | `op-205-blank-extent.test.ts` | core | 独立（冻结字面量 + raw） | 强 | — | keep（删 1 行） | `:64-99` mode 0 的**冻结**换行与逐字落点（`['あ　い','　う　','え']`、`[[0,30,60],…]`）、`:113-145` mode 1 给度量后换成 `['あ　','い　','う　','え']` ⇒ 可分辨；`:150-164` 缺口必须显式回退并置 `blankExtentFallback`（不许静默编数）；`:211-220` 接线（INI→注册表默认 0→排版）。`:75` 是恒真断言（§2.3）。 |
| 16 | `op-20b-fill-texture.test.ts` | core | 独立（raw 公式 + 手算） | 中-强 | — | keep（修标题） | `:78-89` 钉住 op4/op5 = **宽高**、`0xFFRRGGBB`、α 夹 255 三个易错点。★`:101` 测试标题写"Pixi 侧忽略"，断言体只碰 headless 与 `scCreateTextureReset`——**标题承诺的覆盖面不存在**（§2.4）。 |
| 17 | `op-214-swap-items.test.ts` | core | 独立（raw + 手算） | 强 | — | keep | `:50-51` **对象身份不变**（渲染侧缓存不必失效）、`:64-67` 键/层序不动 ⇒ 绘制次序不变、`:70-79` 缺键/同键/双缺三种语义，`:112-137` 端到端经真 handler 读出互换后的槽。 |
| 18 | `op-223-transition-fade.test.ts` | core | 独立（raw 写序） | 强 | — | keep | `:107-111` 九格精确序列（含 `[2]/[3]←op7/op8`、`[6]/[7]←op5/op4` 的交叉）、`:114-118` 长度 24 与 `[9..23]` 默认值、`:127-131` `Engine.itemRegions === undefined`（死容器不许留影子账本）。 |
| 19 | `op-020c-render-target-capture.test.ts` | core | 独立（引擎链 + 需求）+ 受控半装配假件 | 中-强 | — | keep | `:83-100` 断言"当场合成 1 次 + **屏幕矩形** + `resolution:1` + 写 op1 那个槽"；`:102-111` 未设目标时三不做；`:169-200` **时序陷阱**（monkey-patch `frameTick` 观测 `renderTargetSlot===2`，并断言脚本随后切回 −1）——这是"不能挪到 present"的直接证据。像素仍属 E4。 |
| 20 | `op-147-2f2-region-hittest.test.ts` | core | 独立（wine GDI + raw） | 强 | — | keep | 教科书级可证伪：`:133-147` 绕两周方形必须命中 ⇒ 证明是 **WINDING** 不是奇偶（写成奇偶这条会红）；`:149-158` 左/上含右/下不含；`:170-178` 源数组**只读**（推翻筛体"顺带写回"）；`:180-192` 未写过的格读 0 而不是 `dec(key,0)` 垃圾；`:194-240` 椭圆逐行跨度与退化分支。 |
| 21 | `op-12e-hover-hittest.test.ts` | core | 独立（raw 展开 + 手算） | 强 | — | keep | 四项判据逐条：`:85-102` 首项 `= op1+1`（语料 op1 多为 1 ⇒ 真分支）、`:104-123` 两道边界门、`:143-161` x/y 平面按记录下标 `j` 而非 `4j`（旧实现会误命中并返回 1 —— 自带判别力说明）、`:163-183` margin 符号方向、`:185-213` 基址相同跳过该记录、`:215-230` 未写过 margin 按 `enc_zero` 读 0。 |
| 22 | `op-22a-22f-scene-world.test.ts` | core | 独立（raw + 手算） | 强 | — | keep | 核心是**叠加序棘轮**：`:141-153` 断言 Scene 平移是屏幕空间加法 `(300·3+10, 300·3+20)=(310,320)`（`work←work·sceneWorld` 写反会得 `(330,360)`）；`:132-139` 层区间 `[20,30)`；`:192-199` 无锚 ⇒ 逐字节不变；`:210-217` 置脏。 |
| 23 | `op-22a-22f-scene-xform.test.ts` | ratchet（体账/台账） | 独立（**真源文本**）；对 emulator 无判别力（除 1 条） | 弱-中 | （读 5MB C ×1） | keep-ratchet（**瘦身**） | 体账（`:84-180` 大括号配平后数 `sub_41C300`/`dbl_5201F0` 次数、`j_D3DXMatrixTranslation`）改坏 emulator 时**不会红**，只在反编译文件变时红；有牙齿的只有 `:213-220`（`disposition==='implemented'` ⟺ `OPS.has`）。`:206-209` 与 `:253-263` 是**对 note prose 的断言**（§2.6）。 |
| 24 | `op-24f-250-251-transitions.test.ts` | core | 独立（raw 逐格） | 强 | — | keep + `merge`（`:195-210`/`:212-226` → `sc-transition-window`） | `:70-84` 0x24F 差分集（非默认格）逐格；`:93-126` **两条错误路径方向相反**分别断言（条宽<1 ⇒ 夹 1 后照写、类型>0xB/负数按 unsigned ⇒ 一格不写）——这是最容易抄反的一处；`:128-172` 0x250/0x251 整条 24 格 `deepEqual`。重复的两条见 §3.1。 |
| 25 | `sc-transition-window.test.ts` | core | 独立（raw）+ **测试注入探针** | 中-强 | — | keep（3 处瘦身） | 强：`:167-185` freeze 当帧到期（带"不冻结仍在途"对照）、`:204-219` 运行期绝不回写 `transitions`、`:79-91` 到期即死记录 + 清表。★弱/自证：`:142` 的 46516 门**由测试自己注入**（`:156-164` 自证不注入就会按旧口径清表 ⇒ 本文件不守宿主接线）、`:276-305` 只用不等式"快照与纯函数同源"、`:340-341` 断言实现自己的 `approximate:true` 标志。 |

**分布**：core 19 / ratchet 5 / tool(并入 ratchet) 1 / scaffold **0** / unknown 0。`drop` **0** 个——本组没有整文件级别的无价值项；问题集中在**个别断言**与**源文本冒充行为守卫**（§2）。
Verdict 汇总：keep 19、keep-ratchet 2（#6/#23）、upgrade 1（#8）、keep+定点修 3（#4/#12/#16，其中 #4 计入 upgrade 更准确 ⇒ 实际 upgrade 2）。

---

## 2. "无意义 / 可疑"清单（带反例实验）

> 下面的反例都是"把 X 改成 Y，这个断言还会绿吗"。所列条目**全部逐条读过断言体**（含被 `it()` 标题掩盖的那些）。

### 2.1 `overlay.test.ts:121` —— 未 `await` 的 `assert.rejects`：**在任何实现下都绿**（类别 1/3 混合：确定性失效）

```ts
// :117-125
const store = new OverlayDir({ baseDir: dir, overlayDir: dir });
assert.rejects(store.write('x.txt', 'y'), /拒绝写/);   // ← 无 await / return
```

- 反例实验：让 `OverlayDir` 在 `baseDir === overlayDir` 时**照写**（即删掉这条保护）。`store.write` 变成 resolve ⇒ 未 await 的 `assert.rejects` 产生一个 rejected promise，被 node:test 记为 **unhandledRejection 事件**：`✔ pass 1  fail 0`（本报告开头那次探针就是同一形态的实测输出）。**这条守卫永远不会红**。
- 全仓扫描：`grep -rn '^\s*assert\.rejects' test/*.ts | grep -v 'await\|return'` = **仅此 1 处** ⇒ 一行修复即可清零该类缺陷。
- 同类但写法正确的对照：`:110-111` 都写了 `await`（`/越出/`）。

### 2.2 `missing-texture-skips-item.test.ts:64-85` —— 用**源文本正则**冒充行为守卫（类别 5→"测脚手"的变体 + 类别 1）

```ts
:68  !/#placeholder\s*\(\s*it\s*:\s*Item\s*\)/.test(src)   // 断言"某个方法签名不存在"
:72  !/未绑定\s*→\s*占位块|→ 占位块/.test(src)              // 断言"某句日志文案不存在"
:83  /raw 122952|DrawTexture 报错/.test(branch![1]!)        // ← 断言**注释里必须写某个串**
```

- 反例实验 A（引入同一 bug、换名字即绿）：在 `presenter.ts` 加回白占位，但方法写成 `#placeholder(it: Item, tex: Texture)` 或干脆内联 `new Sprite(Texture.WHITE)`。`#placeholder(it: Item)` 的签名正则不匹配 ⇒ **`T-0102` 那整类"白底"症状回来了而这条守卫是绿的**。
- 反例实验 B（零语义改动即红）：删掉/改写 `:452-462` 那段注释 -> 只保留 `return null`。`:83` 变红，而行为完全没变。**这正是任务禁止的"把注释写得好当价值证据"**。
- 反例实验 C：把 `const { tex, imgid } = this.textures.resolve(it);`（`:76` 的定位串）重构为 `const r = this.textures.resolve(it);` ⇒ 找不到锚点直接红。
- 正确写法已存在且**一墙之隔**：`itemSprite` 是 `presenter.ts:403` 的 **public 方法**返回 `Sprite | null`，`transition-render-wiring.test.ts:185-191` 已示范在 Node 里 `new ScenePresenter(root, new TextureCache(()=>{}), Texture.WHITE, ()=>{}, VIEW_W, VIEW_H)`。⇒ 可以写成 `assert.equal(presenter.itemSprite(scene, item, 0, 'normal'), null)` + `assert.equal(root.children.length, 0)`，无论占位块叫什么名字都会红。

### 2.3 `op-205-blank-extent.test.ts:75` —— 恒真断言（类别 1 同义反复）

```ts
:75  assert.equal(advance(ch, 30, M1).valueOf(), advance(ch, 30, M1), '自反（防 NaN）');
```

- 被断言函数 `advance()`（`src/text/layout.ts:370-372`）返回**数字原始值**，`(x).valueOf() === x` 恒成立。
- 反例实验：唯一能让它红的是"`advance` 在 mode 1 下返回 `NaN`"，而循环里的 `'　'`/`' '` 两个空白字已被 `:115-116` 的 `{value:44}/{value:6}` 精确断言覆盖 ⇒ 实际判别力 ≈ 0。删掉这一行不损失任何覆盖。

### 2.4 `op-20b-fill-texture.test.ts:101` —— 标题承诺 Pixi 侧，断言体只碰 headless（类别：覆盖面虚报）

```ts
test('0x20B：槽没有 create-texture 表面时 Pixi 侧忽略（引擎打 FillTexture 错误串）；headless 仍记录', …)
  :104  assert.ok(native.scene.slotFills.has(0x2e), …)          // headless
  :108  assert.equal(native.scene.slotFills.has(0x2e), false)   // 共享模型 reset
```

- 反例实验：把 Pixi 侧改成"没有表面就涂白"（真实的"多画一块"缺陷）⇒ **仍然绿**。标题里的 Pixi 半边由 `HeadlessScene` 的记账顶替了。要么改标题，要么真断言 Pixi 侧（同 §2.2 的做法）。

### 2.5 `anim-window-done.test.ts:156-182` / `:192-204` —— 源码正则棘轮（类别 5 边缘；**保留但须知道它为什么能红**）

```ts
:161  /this\.waitFlags/.test(code) === false
:166  /waitFlags\s*(?:\|=|&=|\^=|\+=|-=)/.test(code) === false
:178  /^\s*(?:private|public|protected|readonly|\s)*waitFlags\s*[:=]/m.test(code) === false
:195  /pickHoverLabel/.test(engineSrc) === false
```

- 这些**确实有牙齿**（把 `waitFlags` 镜像写回去会红），且 `:151-154` 已剥注释以避免误判历史注释——比 §2.2 的写法成熟。
- 但反例实验暴露边界：把镜像改名成 `this.gateFlags`（同一 bug、换名字）⇒ 4 条全绿；把 `Engine.pickHoverLabel` 改名为 `hoverPick()` 又加回"只被测试调用"的门面 ⇒ `:195` 绿。**它们守的是"那个名字"，不是"那个不变量"。** 结论：留作 ratchet 可以，别把它当行为守卫写进票据 acceptance（T-0008/T-0014 的 acceptance 里这两条是主要判据 —— 建议补一条行为判据：门关掉后 `needsRender()` 转假已有 `:137-145`，够用）。

### 2.6 `op-22a-22f-scene-xform.test.ts:206-209`/`:253-263` —— 把**台账 prose** 当判据（类别 2 镜像 + 任务明令禁止的"注释质量"）

```ts
:206-208  assert.ok((e.note ?? '').length >= 80, `…的 note 必须写清体内行为 / 处置 / 消费者链（当前 ${…} 字）`)
:209      assert.match(e.note, /扩展点|消费者/)
:253-263  assert.match(note(0x1c4), /语音/); assert.match(note(0x22f), /Translation/); …
```

- 反例实验 A：把任一条 note 从 120 字删到 79 字（emulator 一行没动）⇒ **红**。字数不是不变量。
- 反例实验 B：把 note 里 `Translation` 改成同义中文描述（信息量不变）⇒ `:256` 红。
- 有牙齿的只有 `:213-220`（`disposition === 'implemented'` ⟺ `OPS.has(op)`，谎报会被抓）与 `:222-234`（`deferred` 不得进三张表）。建议：**留后两组，删 prose 组**（或把它降级为 `t.diagnostic`，不参与 pass/fail）。

### 2.7 `sc-transition-window.test.ts` 的三处（类别 2/5）

```ts
:142  const r = scTransitionTick(s, 100, false, () => scPoolPending(s, 100));   // ← 门由**测试**注入
:156-164  '旧口径（不注入池挂起探针）在同一帧清表 ⇒ 上面那条断言不是"恰好为真"'
```

- 反例实验 A：把生产接线改回默认（`headlessScene.ts:790` / `pixiBackend.ts:1371` 的 `() => this.poolPending()` 去掉）⇒ 本文件**全绿**（它自己注入了正确探针），只有 `transition-render-wiring.test.ts:139/144/148` 的**源正则**会红。即：这个"最像守卫"的文件守的是 `transition.ts` 的**探针契约**，不是宿主接线。
- 反例实验 B（`:276-305`）：让 `scSnapshot` 用另一套（错的）条带 walker，而 `scTransitionBands` 不动 ⇒ 只断言 `p.bands > 0` / `p.oldBands < p.bands` / `p.off != 0` 的这条**大概率仍绿**。要真守"同源"，应直接 `assert.deepEqual(p.bands, scTransitionBands(...).length)`。
- 反例实验 C（`:340-341`）：`assert.equal(plan!.approximate, true)` 断言的是实现自己的"我承认这是近似"标志（T-0091 未决项①）。把近似改成精确复刻时这条会红——**红得无意义**。另 `:332-333` `assert.equal(plan!.zoom, true)` 连写两遍（复制粘贴残留）。

### 2.8 `draw-item-slot-coverage.test.ts:63-92`（类别 3/5：无里程碑 + 自造宿主的语义未受检）

```ts
:82  else if (sample.length < 8) sample.push(`handle=${it.tex} slot=${it.tex} layer=${it.layer}`);  // 同一字段印两遍
:45-48  detachTexture(handle, count) { … this.items.delete(…) }   // 只删项；this.slotBound 从不收缩
:77  assert.ok(rec.items.size > 0, …)                              // 唯一的下限
```

- 反例实验 A（样本塌缩后仍绿）：把 `MAX` 改成 500（或让某条早期指令走 `NotImplementedOp` 被 `:72-75` 吞掉）⇒ 只要"已建立的少数绘制项"里 ≥95% 的 tex 曾被抓过，照样绿。测试名承诺的"跑到 TITLE"**没有任何断言**。
- 反例实验 B（假件语义掩盖 bug）：假设真宿主在 `detach` 时应把槽也标记为失效。`SlotRecorder` 不会 ⇒ 分母里的项越"陈旧"，比率越好看。这个统计不变量的**独立依据只有"真语料"**，宿主语义那一半在自己手里。
- 反例实验 C：把 `op1/op2` 真的写反，只要 `layer` 值恰好落在曾被 `bindTexture` 过的槽号集合里（小整数很容易撞）⇒ 可能仍 ≥95%。`:91-92` 的 `mixed > 0` 是这条的唯一补丁，但它只要求"存在一项 tex≠layer"，几乎必然成立。

### 2.9 其余"弱但不必删"（记录在案）

| 位置 | 现象 | 反例实验 |
|---|---|---|
| `op-203:106-119` | Proxy 探针只证明"读了 args 0..3"，不证明读对了位置 | 把 α/color 互换（`:60-83` 会红，这条不会）⇒ 仍绿；建议保留（廉价 argc 护栏）但不计入 acceptance |
| `window-edge:19` | `p.y > WA.height - 64` 是 `:18` 的弱化重述 | 把 `TITLEBAR_PX` 改成 48 ⇒ `:18` 红、`:19` 也红（冗余但无害） |
| `op-147:242-250` | 直接调内核的 4 条断言与 `:160-168` 重复 | 保留（廉价） |
| `draw-item-loop-anim:266` | `assert.doesNotThrow(() => assertFlags('drawitem', H, it.flags))` 与 `:320-326` 的三表排他性都属于"配置棘轮" | 改名/放宽白名单时红，合理 |
| `agf-size:40-69` | oracle 是"移植副本"（`:23` + 文件头自认） | 两边同时改错 ⇒ 绿；靠 `:128/:130` 的冻结尺寸兜底 |

---

## 3. 重复覆盖矩阵

### 3.1 组内重复（建议去重对象）

| 不变量 | 位置 A | 位置 B（重复） | 处理建议 |
|---|---|---|---|
| A 层 flipbook 源矩形（t=0.5 ⇒ row1col0、末帧保持） | `draw-item-anim-window.test.ts:109-127` | `draw-item-loop-anim.test.ts:156-176`（`:157` 自认"与 draw-item-anim-window.test.ts 的既有断言同值"） | **删 A**：B 的 §4 还叠加了 B 层（两层共用 `+568/+572`），信息量严格更大 |
| 颜色窗整数插值（截断 127 而非 128） | `draw-item-anim-window.test.ts:129-167` | `draw-item-loop-anim.test.ts:182-199`（B 层往复，值 `0x7f7f7f7f`） | 保留二者（一层是窗、一层是周期），但把 A 的"截断 127"断言留一处即可 |
| `applyScaleAnim` 的 useWorld 置位 | `draw-item-scale.test.ts:167-168` | `draw-item-loop-anim.test.ts:206-217`（缩放往复） | 不重复（一个是 A 窗、一个是 B 循环）——**保留** |
| 转场表清空 + `transitionClears` 计数 | `op-24f-250-251-transitions.test.ts:195-210` | `sc-transition-window.test.ts:221-234` | 合并：留 `sc-transition-window`（它额外断言"运行期表一起清 + 同 id 重新锁存"），`op-24f` 只留写端 |
| 快照里的 `render4.transitions` 与源表相等 | `op-24f:212-226` | `sc-transition-window.test.ts:249-253` | 合并到 `sc-transition-window`（它同时断言 `transitionProgress` 是独立字段） |
| `scTransitionDefaultRecord()` 默认值（24 格 / `[4]=-1` / `[9..12]=0`） | `op-223:114-124` | `op-24f:33-37`（`rec()` 辅助）、`sc-transition-window:34-66`、`transition-corpus-e3`、`transition-render-wiring:52+` | 7 个文件引用它。**不重复**（都是各自的底座），但建议把"默认记录 24 格 + `[4]=-1`"的断言**只留一处**（现分散在 `op-223:114/121-123` 与 `op-24f:33`） |
| 四条 Scene 变换"在 OPS 里" | `op-22a-22f-scene-world.test.ts:76-80` | `op-22a-22f-scene-xform.test.ts:213-220` | **删 A**（B 更强：台账 ⟺ 运行时一致） |
| `scPoolPending` / `scAnimationsPending` 语义 | `anim-window-done.test.ts:100-114` | `draw-item-loop-anim.test.ts:241-256`、`wait-gate-timer.test.ts:194-224`、`headless-needs-render.test.ts:57-72`、`sc-transition-window.test.ts:187-202` | 5 个文件各有侧重（`+720` bit0 排除 / bit2 不进等待门 / 计时器门 / 脏位 / 转场第三项）；**保留**，但 §6.3 建议在 `anim-window-done` 的注释里加一张"谁守哪一半"的表防止继续摊薄 |
| `0x223` 写端 → 记录 | `op-223-transition-fade.test.ts`（全文件） | `transition-render-wiring.test.ts:52-70` | 后者只保留"→ tick → 快照"的整合断言，不必再断言九格（应改指向 `op-223`） |

### 3.2 与全仓其它测试的重复

| 不变量 | 本组 | 全仓其它 | 说明 |
|---|---|---|---|
| 转场窗推进 | `sc-transition-window.test.ts` | `transition-corpus-e3.test.ts`（E3 真语料 SC0010）、`transition-render-wiring.test.ts`（真 handler + Pixi） | **互补，不算重复**：E2 语义 / E3 语料 / 集成三件套，是本组组织得最好的一族 |
| 条带几何 | —（`sc-transition-geometry.test.ts` 不在本组） | 同左 | 注意：任务提到的"高风险 `sc-transition-geometry`"**不在本 25 文件清单里**，但它才是类别 2 几何的主力；本组 `sc-transition-window.test.ts:276-305` 与它相邻（一个弱不等式、一个强不变量），建议把快照那条删掉指向 geometry |
| `0x147/0x2f2` | `op-147-2f2-region-hittest.test.ts` | `opcode-gaps.test.ts`（注册/台账） | 互补 |
| `0x12E` 悬停 | `op-12e-hover-hittest.test.ts` | `harness.ts:77-81` 的 `pickHoverLabel` 门面 + 15 条悬停断言（T-0014） | 互补：本组守**几何**，门面那批守**门控与路由状态机** |
| AGF 尺寸 | `agf-size.test.ts` | 无 | 唯一 |
| 依赖分层 | `layer-direction.test.ts` | `docs-new/04-app/emulator-refactor-plan.md`（A1） | 唯一 |
| `window-edge` | `window-edge.test.ts` | 无（`electron/windows.ts` 不被测） | 唯一；Electron 侧装配无守卫 |

### 3.3 `op-22a-22f-*` 两个文件的判定（任务点名）

**不重复，是"行为 / 体账"分工，但有 2 处实打实的重叠。**
- `scene-world` = 行为守卫（写端口径 + 层区间 + 叠加序 + 置脏 + 快照文本），oracle = raw + 手算，改坏 emulator 会红。
- `scene-xform` = **体账 + 台账棘轮**（大括号配平取体、数符号、断言 `disposition` 与 `OPS` 一致），改坏 emulator **不会**红——它守的是"别再照筛体旧说法抄一遍"（文件头自陈，T-0076 的动机）。
- 重叠 ①：`scene-world:76-80` vs `scene-xform:213-220`（同一"四条在 OPS 里"）。
- 重叠 ②：`scene-xform:84-142` 的"操作数走 float 池 / 不除 / ÷100"与 `scene-world:82-126` 是**同一批事实**的两种观测（一个看 C 文本、一个看运行时）。建议：**留 `scene-world` 的运行时观测为唯一判据**，`scene-xform` 只保留"体账"（raw 锚点 + 台账 disposition）并删掉 prose 组（§2.6）。

---

## 4. 假件边界审计（FakeRenderer / RecordingBackend 类）

本组**没有** `FakeRenderer`/`RecordingBackend` 这种"整体替身"；风险分布在 9 处**局部宿主假件**与 1 处**半装配真件**。逐个判"它是不是引擎语义的忠实替身、替身自身有无独立依据"：

| 假件 | 位置 | 替身性质 | 自身依据 | 判定 |
|---|---|---|---|---|
| `SlotRecorder` | `draw-item-slot-coverage.test.ts:30-52` | 自造最小 `NativeBridge`（不渲染、只记账） | 接口签名与产品一致（`setTexture(args)` 的 `[imgid, slot]` 与 `headlessScene.ts:234-236` 逐字同形，已核对） | **边界**：只替换了"记账"这一件事，但 `detachTexture`/`clearDrawContainer` 的语义是测试自己定的（`:45-51`），用于统计时**可能偏乐观**（§2.8）。建议换成 `HeadlessScene`（真产品宿主，`src/renderer/headlessScene.ts`） |
| `ColorRecorder extends StubNative` | `op-203:29-42` | 覆写 2 个宿主缝（`getDrawItemColor` / `setDrawColorAlpha`） | 缝的语义 = 引擎 `sub_4ADD60` / 写 `DrawItem+0x60`；且 `:89-103` 有**同一批断言的 headless 真模型版** | **忠实**（双轨验证），keep |
| `RecordingNative extends StubNative` | `draw-item-loop-anim:333-346` | 只记 `setDrawItemLoop` 请求 / `clearDrawItemAnimStarts` 掩码 | 请求对象的每个字段都在**模型侧**被独立断言（`:87-235`）⇒ 假件只是搬运 | **忠实**，keep。`clearDrawItemAnimStarts` 返回 0 会让 `:428` 的掩码断言仍成立（掩码恒 2 来自引擎立即数，不依赖返回值） |
| `mkEngine([])`（harness） | `harness.ts:48-64` | 合成脚本 + `StubNative` | 与 17 处 `mk()` 变体并存（T-0020）——**已知技术债** | keep（本组 `op-147`/`op-12e` 用它只是为了"装一条指令"，不涉及宿主语义） |
| `mkBackend`（半装配真 `PixiBackend`） | `op-020c:53-81` | 真实例，只把 `app.screen`/`extract.canvas`/`stage`/`present()`/`textures` 换成字面量 | 断言对象是 `frameTick` 自己的**调用参数**（`:89-99`），字面量按需满足接口 | **可接受**（受控、可证伪：改传 local bounds 必红）。但 `b.textures = {captureCanvasIntoSlot}` 是**整体替换**该字段 ⇒ 若将来 `frameTick` 在该路径还要用 `textures` 的其他方法会崩（崩得响亮，可接受）。像素级内容明确留给 E4（`:22-23` 自陈） |
| `recorder()`（3 个方法的 NativeBridge） | `draw-item-scale:77-90` | 只留 `log/setScale/setScaleAnim` | 断言 = 手算 ÷100 | **忠实**；副作用是"调了别的方法就 TypeError"，反而是好的失败模式 |
| `env()`（`BlendEnv`） | `blend-mode:26-29` | **纯函数参数对象**，不是宿主替身 | 无独立依据需求（纯函数） | keep |
| `bodyAt/bodyOf`（C 文本取体器） | `op-22a-22f-scene-xform:46-78` | 大括号配平的文本提取器 | 有 `headerLineOf` 按地址精确定位（`:70-74`），并用 `assert.ok(i>=0)` 防静默 | 不是运行期替身；作为**文本 oracle** 可接受（但它断言的不是 emulator —— §2.6、§5） |
| `fullScreenMesh()` | `mesh-vertex-quad:28-44` | 手写 `MeshObj` | 几何/基色与语料同形，且**另有 E3 真语料断言**（`:132-173`） | 忠实（双轨） |
| `makePair` / tempdir | `overlay:36-59` | 真文件系统 | 真值 = 字节 | 忠实 |
| `STUB` 量宽度量 | `op-205:45-50` | **故意**与网格不同（44/6 vs 30/15）以制造可分辨性 | keep（设计得当） | — |

**结论**：本组**没有**"只测脚手"的文件；最接近的一处是 §2.8 的 `SlotRecorder`（统计口径受自造语义影响）与 §2.2 的源文本半边（根本不测运行期）。

---

## 5. 可被新调试能力替代 / 增强的测试

### 5.1 探针型 vs 守卫型

`dbg` 的命令面（`src/vm/debugQuery.ts:95-224`）只有 `global / local / frame / flocal / slot / run`，断点有 `step` 与 `event`（含 `global-int-write`、`slot-bind`）。**没有 scene / drawItems / transitions 的查询命令** ⇒ 它能替代的只是"运行期槽/全局/纹理绑定"的现场取证，替代不了模型级断言。

| 归类 | 条目 | 理由 |
|---|---|---|
| **探针型**（`dbg` 一次现场查询即可，不必留回归） | `op-22a-22f-scene-xform:84-180` 的体账（"哪条读 float 池/除以 100"）；`op-203:106-119` 的"读了 4 格"；各文件开头"某某已在 OPS 表里"的**一次性确证**（可保留但应集中成一张注册表棘轮） | 用 `node tools/dbg.cjs 'b event global-int-write idx == …'` + `node tools/dbg.cjs 'slot …'` 在真语料上一次就能看出操作数从哪个池来；这些是"事实登记"，不是回归条件 |
| **守卫型**（必须留） | `op-147`/`op-12e` 的几何判据；`op-223`/`op-24f` 的逐格记录；`op-214` 的交换语义；`op-032` 的夹取；`draw-item-*` 的窗状态机；`anim-window-done` 的两条判据；`mesh-vertex-quad` 的 E3 端点色；`overlay` 的字节不变式；`window-edge` 的几何；`agf-size` 的尺寸 | 全是"实现改坏 ⇒ 语义错但不报错"的不变量，必须留回归 |
| **灰色**（真语料 + 统计） | `draw-item-slot-coverage.test.ts` | 它是探针的**批量化**（跑 20 万步统计一次）。`dbg` 能在真机上人肉看一眼，但 CI 里没有人 ⇒ 保留，前提是补里程碑与样本下限（§6.3） |

### 5.2 `npm run shot` + `dbg` 能否把"断言渲染调用序列"升级为 E3/E4？

**能，但只能给少数几条，且不该用"金图像比对"。** 分三档说明：

1. **纯像素真值（适合 shot / .STH）—— 低脆弱**
   - `op-020c-render-target-capture`：T-0062 的 E4 判据本来就是"`.STH` 解出的 320×180 BMP 不是全黑、内容与当时画面一致"。做法：`npm run record`（或 `dbg` 远程 `click` 走到 SAVE 界面）→ 存档 → 直接**解码 `.STH`** 断言 `w===320 && h===180` 且"非单色"（方差 > 阈值）+ 抽样与同刻 `dbg shot` 的缩略图相关性。这是**不变式**而非金图像 ⇒ 稳定。
   - `missing-texture-skips-item`：真要 E4 就是"SC 场景里 ADV 背景不是白块"。用 `dbg move/click` 走到 T-0102 现场 + `shot`，断言"指定矩形区域内不存在近白像素占比 > X%"。仍然是不变式。
2. **逐帧 digest（比像素更稳）—— 首选增强路径**
   - 本工程已有 `npm run record` + `npm run replay`（`src/tools/replay.ts` 的判据是**逐帧 digest 的 engine 段相等**）+ `scenario`（`src/tools/scenarioRun.ts`）。对**合成指令驱动渲染**这一类，「录一次真机/真语料、之后 headless 回放逐帧比对」比"断言 renderer 调用序列"强得多，且**没有像素脆弱性**（不依赖 DPR/字体抗锯齿/L2D 抖动/时刻）。
   - 现实约束：`tools/scenarios/` 只有 `gamestart.json` 一个 spec ⇒ 要覆盖本组（转场 `i24f/i250/i251`、`0x147/0x2f2`、`i214` 等）**需要新写 spec**，这是真正的成本项（也是 §6.2 的推荐落点）。
3. **金图像比对（不推荐）** —— 代价与风险：
   - 脆弱源：DPR/窗口尺寸（`shot.cjs` 的坐标常数在另一台机器上已实测对不上，见 `debugsrv.cjs:44-49` 的警告）、字体渲染、L2D、音频时钟、`set:BlankExtentMode` 这类**随包 INI 差异**（T-0031）、以及"贴边档"窗口几何（`window-edge`）。任何一条差异都会让整个文件红而理由与语义无关 ⇒ **违反"红得理由正确"**。
   - 稳定性风险还要加上：`shot` 需要 Electron + 构建（`npm run build:electron`），与主 agent 抢窗口（技能 §8.5 已把 `shot`/`verify` 列为串行资源）⇒ 不能进 `npm test`，只能做 nightly/手动 E4。
4. **增强而非替代的具体清单**（若做）：`op-020c`（.STH 不变式）、`missing-texture-skips-item`（白块区域不变式）、`sc-transition-*`（录一段含 `i251` 的真语料 → replay digest）、`blend-mode`（mode-1 离屏目标里画高亮 → 现有 `blend-mode:167-223` 已是 E2 接线，E3 只需 replay 覆盖）、`draw-item-slot-coverage`（在 TITLE 帧 `shot` 一次，人工/不变式确认背景存在）。

### 5.3 一个工具层面的缺口（不在本组文件里，但影响"能否替代"）

`dbg` 查询不到场景模型（`drawItems`/`meshes`/`render4.transitions`/`transitionRuntime`）。§5.1 里那些"探针型"条目（尤其转场运行期 `start/t`）**因此无法现场取证**，只能靠合成指令测试。建议给 `debugQuery` 加一个只读 `render`/`scene` 查询（转储 `scSnapshot` 的摘要行）——它能把本组相当一部分"合成指令断言模型字段"降级为探针，同时给 E4 提供可核对的现场。

---

## 6. 本组最该改的 3 件事（可执行、带行号）

### 6.1 修 `overlay.test.ts:121` 的未 await 断言（1 行；附带 0 处同型）

```diff
-    assert.rejects(store.write('x.txt', 'y'), /拒绝写/);
+    await assert.rejects(store.write('x.txt', 'y'), /拒绝写/);
```

- 这是本组**唯一**"在任何实现下都绿"的断言（§2.1，已用 node:test 语义实测）。全仓同型仅此 1 处（`grep -rn '^\s*assert\.rejects' test/*.ts | grep -v 'await\|return'`）。
- 顺带把 `:117-125` 的 `assert.rejects` 从"同步测试里裸调"改成 `async` 测试（`test('…', async () => …)`），否则 `await` 无法使用。

### 6.2 把两处"源文本冒充行为守卫"换成真行为断言（同一病、同一修法）

1. `missing-texture-skips-item.test.ts:64-85` → 用 `presenter.ts:403` 的 **public** `itemSprite` + `TextureCache` 桩：
   ```ts
   const root = new Container();
   const presenter = new ScenePresenter(root, new TextureCache(() => {}), Texture.WHITE, () => {}, VIEW_W, VIEW_H);
   const it = makeItem({ handle: 1, layer: 1, tex: 7, /* src/dst 任意 */ });
   assert.equal(presenter.itemSprite(scene, it, 0, 'normal'), null);   // 缺纹理 ⇒ 整项跳过
   assert.equal(root.children.length, 0);                              // 且**没有**任何占位精灵（换名字也抓）
   ```
   （构造法照抄 `transition-render-wiring.test.ts:185-191`。）保留 `:37-62` 的**引擎字面串棘轮**（那半边是对的），删掉 `:66-85` 的源正则与"注释里必须有 raw 122952"那条。
2. `sc-transition-window.test.ts:132-165` 的 46516 门 → 把**真宿主**拉进来做行为断言（现在只有 `transition-render-wiring.test.ts:139/144/148` 的源正则守接线）：
   ```ts
   // headlessScene.advanceModel 内部就是 scTransitionTick(this.scene, nowMs, freeze, () => this.poolPending())
   s.render4.transitions.set(7, fadeRecord(0, 100));
   scene.advanceModel(0);
   scSetVertexColorAlpha(...1000ms mesh 窗...);   // 池挂起位靠 mesh 窗维持
   scene.advanceModel(100);
   assert.equal(scene.scene.render4.transitions.size, 1, '真宿主必须把池挂起探针接上（否则清表）');
   ```
   这样"宿主忘了传第 4 参"会红，而**红的理由正确**。

### 6.3 给 `draw-item-slot-coverage.test.ts` 补里程碑/样本下限，并把自造宿主换成产品宿主

```diff
-  const rec = new SlotRecorder();                 // :56  自造宿主：detach 不清 slotBound
+  const rec = new HeadlessScene({});              // 产品宿主（src/renderer/headlessScene.ts），语义唯一
…
-  assert.ok(rec.items.size > 0, `应至少建立过一个绘制项（实际 steps=${steps}）`);   // :77
+  assert.ok(takenTitle, '必须真的跑到 TITLE（否则本测试的分母无意义）');              // 新增里程碑
+  assert.ok(rec.items.size >= 200, `分母太小（${rec.items.size}）⇒ 95% 不构成判据`);   // 新增样本下限
…
-    else if (sample.length < 8) sample.push(`handle=${it.tex} slot=${it.tex} layer=${it.layer}`);  // :82 字段印两遍
+    else if (sample.length < 8) sample.push(`handle=${it.handle} tex=${it.tex} layer=${it.layer}`);
```

- 里程碑怎么取：`draw-item-slot-coverage.test.ts:63-75` 的循环里已经能拿到 `e.curScript()`（`f.script.instructions.length`）；判"到 TITLE"可复用现成的链式判据（如 `game-start-chain.test.ts` / `config1-chain.test.ts` 的 `firstTextReached` 形态），或断言"某已知 handle 的绘制项存在"（例如 TITLE 的图元）。
- 为什么值得：这条是**唯一**跑真语料统计的守卫，现在它红/绿与"是否真的跑到目标"无关（§2.8 反例 A）。
- 零成本附带清理（同一次改动内）：`sc-transition-window.test.ts:332`（重复断言行）、`:340-341`（自证标志 `approximate`）、`op-205:75`（恒真断言）、`op-20b:101`（标题与覆盖不符）、`scene-xform:206-209/253-263`（note prose）。

---

## 7. 附录：核对记录与未做事项

**做了什么**
- 25/25 文件全文阅读（含被 `it()` 标题掩盖的断言体），被测量源码与 raw 抽查见文件头列表。
- 唯一一次执行：node:test 未 await `assert.rejects` 语义探针（本报告 §0）。
- 全仓扫描：`assert.rejects` 未 await（1 处，见 §2.1）；自造构造器口径 `function mk(`（28 文件）/ `function mk*`（50 文件，含 `mkScript`/`mkPair`/`mkBackend` 等）——与 T-0020 说的"17 处 `mk()` 变体"是不同计数口径，本组不新增变体；`readFileSync` 引擎 C 的测试（本组 2 个文件：`missing-texture-skips-item`(×2) 与 `op-22a-22f-scene-xform`(×1)）；`t.skip`（本组仅 `agf-size`×3 与 `overlay`×2）。
- 核对 `debugQuery.ts:95-224` 命令面（无 scene 查询）；核对 `native.ts` 宿主缝签名以判断假件忠实度。

**没做（及原因）**
- 未跑 `npm test` / `verify` / `shot` / `dbg:srv`（任务禁止抢占 CPU 与 Electron 窗口）⇒ 所有 `cost/慢` 是结构性判断，不是实测耗时；`op-22a-22f-scene-xform` 的 `note ≥80 字` 等断言是否当前为真，**未实测**（只判其作为判据的价值）。
- 未修改任何文件（本报告是唯一写入）。
- 未审计不在清单内的相邻文件：`sc-transition-geometry.test.ts`、`transition-render-wiring.test.ts`、`transition-corpus-e3.test.ts`、`headless-needs-render.test.ts`、`wait-gate-timer.test.ts`、`op-0202-negative-fallback.test.ts`（只作为重复矩阵/接线证据引用）。
