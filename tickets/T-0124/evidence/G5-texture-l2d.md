# G5 组测试审计报告

**范围**：`app/amayui-emulator/test/` 下 22 个测试文件（纹理生命周期 / 转场语料 / Live2D / 引擎字段与槽 / agent 工作流），共 **129 个用例**。
**纪律**：全程**只读**（`src/`、`analysis/`、`tickets/`、`engine/天结_unpacked.exe_utf8.c`）；本轮唯一写出的文件就是本报告。
**未执行**：`npm test` / `npm run verify` / `npm run shot`（避免抢 CPU 与 Electron 窗口）。为取得可复核的成本数据，只对这 22 个文件做了两次**定向单文件组运行**（见 §0.3）。
**证据档位**：走工程口径 **E0** 未读体 / **E1** 已读体（静态）/ **E2** 合成指令单测 / **E3** 真实脚本语料场景级断言 / **E4** 与真机对照。
**价值判据（唯一）**：**实现改坏时它会不会红，且红的理由正确。** 注释写得好、覆盖率数字、`it()` 标题都不算价值证据。

---

## 0. 方法与基线

### 0.1 口径

| 字段 | 取值 | 判据 |
| --- | --- | --- |
| 类别 | `core` / `ratchet` / `tool` / `scaffold` / `unknown` | `core`=引擎语义/不变量守卫；`ratchet`=台账·注册表·同步棘轮（防回潮）；`tool`=测工装 CLI/脚本；`scaffold`=只断言测试自造假件 |
| oracle | `独立` / `自造` / `镜像` / `无` | `独立`=真语料·引擎 raw 行号/字面·`analysis/*.json` 真源·手算期望；`自造`=期望值由被测代码或同源 helper 算出；`镜像`=断言被测实现自己的表/常量/日志文案 |
| 强度 | `强` / `中` / `弱` | 强=独立判据 + 跨模块可观测行为；中=判据独立但只覆盖局部，或断言内部量但仍有回归判别力；弱=**当前实现下不可能为假**，或判据与被测实现同源 |
| cost | 跑真语料？skip？慢？ | skip 按**本机实际状态**记（本机有 `install/SC0010.BIN`、`install/SYS4INI.BIN`、`.tmp/appdata/.../*.overlay/SAVE/SAVE78|79.DAT`、`raw-parts/*.MOC`） |
| Verdict | `keep` / `keep-ratchet` / `merge` / `upgrade` / `drop` | `upgrade`=保留但必须补强/删弱；`merge` 必须写清与谁重复 |

### 0.2 台账登记情况（`analysis/engine-capabilities.json`）

只有 **10/22** 个文件被 `guard` 字段**机械引用**：

| 文件 | capability id | status | 台账自报 evidence |
| --- | --- | --- | --- |
| `transition-corpus-e3` | `clock-read-transition-window` | modeled-verified | **E3** ✅ 名副其实（真语料） |
| `texture-bind-race` | `texture-bind-async-stale-writeback` | modeled-verified | **E3** ❌ **分档虚高**：全部断言在 `GatedCache`（合成对象）上，无一句真语料 ⇒ 实为 E2 |
| `texture-frame-barrier` | `gfx-texture-load-sync` / `texture-bind-synchronous-then-query` | modeled-verified / partial | E2 |
| `texture-slot-resolve` | `lazy-texture-slot` | modeled-unverified | E2 |
| `engine-slot` | `save-load-drawitem-clear-and-restore` | modeled-verified | **E4**（本机真槽在 overlay；E4b 实跑，E4 主条因目录口径 skip —— 见 §5 第 2 件） |
| `engine-config` | `script-frame-refresh-opcode-20c` / `scene-norender-mode` | modeled-verified / partial | E2 / E1 |
| `l2d-node-compose` | `live2d-node-matrix-compose` | modeled-verified | E3 |
| `l2d-render-pending` | `live2d-slot-probe` | modeled-verified | E3 |
| `live2d-chain` | `lazy-live2d-slot` / `lazy-572b-node-map` / `live2d-node-draw-advance` | verified / partial / unverified | E3 |
| `live2d-render` | `chained-3d-layer-commit` / `l2d-node-draw-gate` / `live2d-mesh-batches` | modeled-verified | E3 |

其余 12 个**没有**机器可校验的链接：`texture-lifecycle`（`analysis/` 与 `tickets/` **零引用**，只有 `README.md:620` 与 `docs/10-texture-slot-to-agf-file.md:249`）、`clear-slot-records-keeps-bindings`、`engine-draw-item-decode`、`engine-field-ids`、`engine-field-store`、`agent-workflow`、`live2d-moc`、`live2d-deform`、`live2d-enabled-flag`、`l2d-node-transform-ops`、`sc-transition-geometry`、`transition-render-wiring`。
其中后两个只在 `clock-read-transition-window` 的 note 正文里被点名（不是 `guard` 字段）。
★另有一处**反向**缺口：`live2d-enabled-config-flag`（`engine-capabilities.json:3577-3579`）仍是 `"evidence":"E1"`, `"guard":""`，而 `test/live2d-enabled-flag.test.ts` 事实上就是它的守卫（`tickets/T-0054/ticket.json:212`）⇒ **孤儿守卫**，`docs-new/03-engine/engine-capabilities.md:170` 同步显示"部分/E1"。

### 0.3 实测基线

```
批 1（8 文件：texture-* ×4 / clear-slot-records / engine-field-* ×2 / engine-draw-item-decode）
  tests 37  pass 37  fail 0  skipped 0            wall 1.86s
transition-corpus-e3.test.ts 单跑
  tests 1   pass 1   fail 0  skipped 0  用例内 62.9ms  wall 0.33s
批 2（13 文件：l2d-* ×2 / live2d-* ×6 / sc-transition-geometry / transition-render-wiring / engine-slot / engine-config / agent-workflow）
  tests 91  pass 89  fail 0  skipped 2            wall 3.45s
  skip#1 = engine-config「真实 SYS4REG.INI」→ 只查 <base>/SYS4REG.INI（overlay 里其实有一份）
  skip#2 = engine-slot「★E4：本机真槽全部解出」→ 只查 <base>/SAVE（真槽在 overlay）
```

**结论先行**：这 22 个文件全绿、总代价 ~5.3s ⇒ **成本不是本组问题**。本组的问题是三件：①**判据来源**（少数断言锁死了错误取值 / 锁死了注释文本）；②**假绿**（5 处 `console.warn + return` 在干净 clone 上 0 断言报 passed）；③**重复覆盖**（尤其转场三层与 0x346 复位段）。

---

## 1. 22 文件完整表

| # | 文件（`app/amayui-emulator/test/`） | 用例 | 类别 | oracle | 强度 | 真语料/skip | 台账 guard | Verdict | 一句话理由 + 证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `sc-transition-geometry.test.ts` | 10 | core | 独立（性质判据）+ 自造（位移公式同式复写） | 中 | 无 / 0 | note 点名 | **upgrade** | 不重叠·覆盖·ripple 是性质判据（`:81-175`）；但位移只钉 case 0/1/2/3/4/8（`:196/:214/:177`），5/6/7/9/10/11 **方向无断言** |
| 2 | `transition-corpus-e3.test.ts` | 1 | core | 独立（真语料 `SC0010.BIN` + raw 136840-136841） | 中 | **是 / 0** | `clock-read-transition-window`(E3) | **keep** | 转场链**唯一**能抓"宿主忘了调 `scTransitionTick`"的守卫：`:74 assert.ok(seen.length > 0 …)`；实测 62.9ms |
| 3 | `transition-render-wiring.test.ts` | 6 | core+ratchet | 独立（真 handler→记录→快照）+ 镜像（源码文本/注释） | 中 | 无 / 0 | note 点名 | **upgrade** | `:183-267` 真 pixi 子集渲染 keep；`:100-103` 断言注释含 `类别 1`/`U2`（删注释即红）⇒ drop；`:160-167` 硬编码 6 文件应改 glob |
| 4 | `texture-bind-race.test.ts` | 12 | core | 独立（手算竞态时序）+ 镜像（3 处日志文案） | 强 | 无 / 0 | `texture-bind-async-stale-writeback`(E3→应 E2) | **keep** | `:101-105` create 后陈旧回写必须丢弃、`:241-257` H3 反面不许拿旧图顶、`:285-320` H2 30s 兜底、`:326-344` 源码棘轮 —— 判据都打在可观测行为上 |
| 5 | `texture-frame-barrier.test.ts` | 3 | core | 独立（屏障语义） | 中 | 无 / 0 | `gfx-texture-load-sync`(E2) | **merge → texture-bind-race** | 同被测物+同技法；`waitIdle`/`pendingCount` 已被 `texture-bind-race:285-320` 覆盖；`:63-71` 近同义反复；独有价值只剩 reject 路径（`:73-91`） |
| 6 | `texture-lifecycle.test.ts` | 3 | core（+1 条 scaffold） | 独立（手算销毁序列） | 中 | 无 / 0 | **未登记** | **upgrade** | `:44 ['a:destroy(true)','b:destroy(true)']` 有判别力；`:58-68` 是空转；★**根因不变量无守卫**（删 `pixiBackend.ts:1468` 的 `collectGarbage()` 三条全绿） |
| 7 | `texture-slot-resolve.test.ts` | 3 | core | 独立（引擎 op1=handle/op2=tex 口径） | 强 | 无 / 0 | `lazy-texture-slot`(E2) | **keep** | `:59 assert.equal(r2.tex, undefined, 'tex=100 未绑定 → 必须是 undefined（旧实现会误取 handle/layer 的槽）')` —— 改坏必红且理由正确 |
| 8 | `clear-slot-records-keeps-bindings.test.ts` | 4 | core | 独立（raw 25357-25374） | 中 | 无 / 0 | **未登记** | **keep-ratchet** | `:82 imgidOf(17)===0x5260` 是唯一有判别力的一条（文件 `:104-106` 自认）；`:98-133` 冗余，建议并入 `:62-74` |
| 9 | `l2d-node-compose.test.ts` | 18 | core | 独立（真 d3dx9_43.dll 重放 + raw + 真资产） | 强 | **是** / 1×`t.skip:547` | `live2d-node-matrix-compose`(E3) | **merge → l2d-node-transform-ops** | `:185-210` 与 `l2d-node-transform-ops:162-183` 是同一 0x346 复位不变量；且 `:196/:197/:199` 三条是 arrange=assert（复位前从未被改成非单位） |
| 10 | `l2d-node-transform-ops.test.ts` | 10 | core | 独立（raw 行号 + 手算） | 强 | 无 / 0 | **未登记** | **keep** | `:60` 7 条节点族都进 OPS、`:67-113` 逐 opcode 操作数形状（含 `record[0]&1` 门），保留本文件的 0x346 复位用例（比 compose 那条强） |
| 11 | `l2d-render-pending.test.ts` | 6 | core | 独立（raw 16025 / `sub_4A1AF0`） | 中 | 无 / 0 | `live2d-slot-probe`(E3) | **keep** | `:80-104` 槽非空 ⇒ 合成判据为真；`:107-119` 探针纯读（问一次不得吃窗）—— 这条对"查询有副作用"是真守卫 |
| 12 | `live2d-chain.test.ts` | 3 | core | 独立（真 TITLE/INFOEN 资产 + 真 VM 派发） | 强 | **是** / 3×`t.skip:80/173/240`（本机不触发） | `lazy-live2d-slot` 等(E3) | **keep** | `:88-91 model.stats.version === 10`、`:96-101` 参数/部件按模型缺省 —— 期望值来自真 `.MOC` 文件 |
| 13 | `live2d-deform.test.ts` | 6 | core | 独立（手算多线性权重 + 真语料） | 强 | 是 / **2×静默 return `:246/:288`** | **未登记** | **upgrade** | `:150-241` 多参数 2^m 角点混合是手算判据；但 `:246/:288` 用 `console.warn+return` ⇒ **干净 clone 上 0 断言报 passed**；`:99` 近同义反复 |
| 14 | `live2d-enabled-flag.test.ts` | 1 | core | 独立（真 boot 链 + 真资产 id） | 强 | 是 / `t.skip:85` | **孤儿**（`live2d-enabled-config-flag` 是 E1/空 guard） | **keep** | `a9d0 != 0 ⇒ l2dSlots 空 + 槽 5 = 0x5273 静态回落`；与 `T-0029/evidence/e4-title.png` 构成 E4 对照 —— 需回填台账 |
| 15 | `live2d-moc.test.ts` | 2 | core | 独立（335 真资产 + 自算 ∏pivots） | 强 | 是（11.6MB）/ **3×静默 return `:62/:183/:188`** | **未登记** | **upgrade** | `combos()` 自己算 ∏pivots（**未**调实现的 `pivotCombos`）⇒ 不镜像，加分；但 `:66 files.length > 0` 过松（实测 335，可棘轮 ≥300），且 skip 是假绿 |
| 16 | `live2d-render.test.ts` | 8 | core+ratchet | 独立（raw 手算 + 真资产 + Pixi GC 推理） | 强 | 是 / `t.skip:335` | `chained-3d-layer-commit` 等(E3) | **upgrade** | `:173-229` 批次几何（一个网格一批、UV/索引原样）强；`:254-263` 标题称 `VISIBLE:` 覆盖生效却直接 `partVisible.set` **绕过 `mtn.ts:103` 解析器**；`:278 mulColor` 是 arrange=assert |
| 17 | `engine-draw-item-decode.test.ts` | 3 | core | 独立（手写 740B 记录 + 诱饵；raw 116901… 行号表） | 强 | 无 / 0 | **未登记** | **keep** | `:142` 缩放取对角线（诱饵 9.75 保证错读必红）、`:148-158` B 层步长 4、`:188-190` 长度 739 抛错 —— 手写记录**不经过被测编码侧** |
| 18 | `engine-field-ids.test.ts` | 3 | ratchet | 独立（**raw 行号**，审计员逐条复核过） | 强 | 无 / 0 | **未登记** | **keep-ratchet** | `:54-72` 裸数字键棘轮 + `:105/:115/:120` 0x1F4/0x1F5 成对（幽灵键事故的唯一守卫）。★与 `fields.json` 不一致的是**台账**，不是它（§7） |
| 19 | `engine-field-store.test.ts` | 6 | core+ratchet | 独立（字段号/公式来自 raw，**不 import 被测常量**） | 强 | 无 / 0 | **未登记**（note 里被当守卫点名） | **keep** | `:90` 字节重排与 raw 28669 **逐字相同**、`:120` 消费端 `lineSpacing`、`:170` C 截断 `-5%3===-2`、`:137` 越界不写 |
| 20 | `engine-slot.test.ts` | 9 | core | 独立（夹具字面偏移 vs decode 独立读 + 真槽） | 强 | **是** / 2×`t.skip:220/280`（`:220` 本机**跳过**） | `save-load-drawitem-clear-and-restore`(E4) | **upgrade** | `:145-167` CRC 负例、`:93-118` 步长 2964 串位、`:262-314` 真槽逐条解码（本机实跑 107 项）；★`:213` 只查 `baseDir` ⇒ 最强落点断言在开发机永绿；`:316-327` 是测脚手 |
| 21 | `engine-config.test.ts` | 7 | core+ratchet | 独立（配置→字段落点可核 raw）+ 镜像（handlerKind 黄金表） | 中 | 否 / `t.skip:103`（本机跳过） | `script-frame-refresh-opcode-20c` 等(E2/E1) | **upgrade** | `:157-159` 落点表有独立棘轮（21668↔raw 23736、20980↔raw 23691）；★`:160 get(21293)===2` 与 raw 23695（`= v37 != 0`）**相反** ⇒ 会挡住正确修复 |
| 22 | `agent-workflow.test.ts` | 5 | tool + ratchet | 独立（spawn 真 CLI + 真台账沙箱副本）；`:268-307` 近乎无 oracle | 中 | 无 / 0 | **未登记** | **keep-ratchet** | `:78-190` `--set-json`/`--recount`（含只读快照 `snapshot(root)`）、`:335-347` 三份 SKILL.md 共享节**逐字节相等**是同源漂移棘轮；`:268-307` 应 drop（见 §5 第 3 件） |

**Verdict 汇总（按表内 Verdict 列逐行统计）**：`keep` **9**（#2/4/7/10/11/12/14/17/19）｜`keep-ratchet` **3**（#8/18/22）｜`merge` **2**（#5/9）｜`upgrade` **8**（#1/3/6/13/15/16/20/21）｜`drop` **0**。9+3+2+8 = 22 ✔
即：**没有一个文件值得整份 drop**（本组没有"纯测脚手"的文件），但有 **16 个文件里至少一条断言**应当删/改（见 §2：假绿 2 + 错 oracle 1 + 无判别力 8 + 镜像/测注释 6，其中 `engine-config` 同时命中①-B 与③）。

---

## 2. 「无意义 / 可疑」清单（每条给 `file:line` + 反例实验思路）

按严重度排序。①=最该修（假绿/错 oracle），②=无判别力，③=镜像/弱。

### ①-A 假绿：干净 clone 上 0 断言报 `passed`（**本组最严重**）

| 位置 | 形态 | 证据 |
| --- | --- | --- |
| `live2d-moc.test.ts:62` | `console.warn('[skip] 找不到 .MOC 语料目录…'); return;` | 回调**没有 `t` 参数** ⇒ node:test 记 passed，不是 skipped |
| `live2d-moc.test.ts:183` / `:188` | 同上（语料目录缺失 / BM021A 缺失） | 同上 |
| `live2d-deform.test.ts:246` / `:288` | 同上（`findMoc('$1$BM021A.MOC')` / `raw-parts/` 缺失） | 同上 |

- **反例实验**：`git clean`/干净 clone（`raw`、`raw-parts`、`install`、`.tmp` 全在 `.gitignore:1-4`）后跑 `node --test test/live2d-moc.test.ts` ⇒ 输出 `pass 2 fail 0`，**零断言执行**；而 `live2d-moc.test.ts:5` 自己写着"缺 ⇒ `skip` + 诊断（…**不假装通过**）"、`live2d-deform.test.ts:5` 写"缺失 ⇒ skip + 诊断" ⇒ **注释与行为相反**，实际正是"假装通过"。改成 `test('…', (t) => { … t.skip('…'); return; })` 后才会正确显示 skipped。
- **注**：本机有 `raw-parts`，所以这 5 条**实际跑了**（我的两次运行 skip 数分别为 0/2，不含它们）—— 这正是"本机能过、别人 clone 下来也过，但含义完全不同"的典型假绿。

### ①-B 错 oracle：断言把与 raw 相反的值锁死（**会挡住正确修复**）

- `engine-config.test.ts:160`：`assert.equal(get(21293), 2, 'sound:Voice=2（下标 21293 = raw 字节 85172）')`，夹具 `:53 'Voice=2'`。
  但 raw **23695** 是 `*(_DWORD *)(a1 + 85172) = v37 != 0;`（同型 raw **23691** `*(a1+83920) = v35 != 0;`）⇒ 引擎存 **0/1**。
  `src/engineConfig.ts:243-244` 的 `soundSE`/`soundVoice` 绑定 note 自己写着"布尔化"却**没有 `map`**；`:236` 的 `messageRMouseEvent`（field 1384）note 写"0/1→键位+1，2→31（raw 23722-23735）"也没有 `map`，而且**测试里一次都没断言过 1384**（只被 `:162 applied.length >= 7` 计数）。
- **反例实验**：给 `engineConfig.ts:244` 补 `map: (v) => (v !== 0 ? 1 : 0)`（= 按 raw 修正）⇒ `engine-config.test.ts:160` **当场红**（`2 !== 1`），而红的原因是"测试期望与引擎相反"。**这是本组唯一"改对了反而红"的断言。**
- 影响目前潜伏：`handlers/audio.ts:297-322` 对该字段只做 truthiness 读 ⇒ 改对无副作用；但"note 写布尔化、代码不布尔化、测试断言非布尔值"三者并存，正是工程明令禁止的含糊形态。

### ② 无判别力（当前实现下不可能为假）

| 位置 | 断言 | 反例实验 |
| --- | --- | --- |
| `l2d-node-compose.test.ts:196` | `assert.deepEqual([...n.scale], [1,1,1])` | 该用例只跑过 `0x344/0x34a/0x349/0x34b`（没有 `0x347`），`n.scale` **复位前就是** `[1,1,1]` ⇒ arrange=assert。删 `runtime.ts:280` 照样绿 |
| `l2d-node-compose.test.ts:197` | `assert.deepEqual(n.rotation, {axis:[0,0,1],deg:0})` | 没跑过 `0x348` ⇒ 同上（删 `runtime.ts:281` 仍绿） |
| `l2d-node-compose.test.ts:199` | `assert.deepEqual([...n.matrixBase], [...AFFINE_IDENTITY])` | ★全工程 `matrixBase` **只有** `runtime.ts:132`（默认）与 `:283`（复位）两个写点、**无任何 opcode 写它** ⇒ 恒为单位阵（删 `runtime.ts:283` 仍绿） |
| `l2d-node-transform-ops.test.ts:174` | `assert.deepEqual(n.scale, [1,1,1])` | 同一形状（该用例跑了 `0x34a/0x349/0x34b`，仍未跑 `0x347`） |
| `texture-lifecycle.test.ts:58-68` | `pendingDestroyCount === 0` / `collectGarbage() === 0` | Node 无 DOM ⇒ `create` 不建画布 ⇒ 恒 0。**删 `pixiBackend.ts:1468` 的 `collectGarbage()` 调用，三条全绿** |
| `texture-frame-barrier.test.ts:63-71` | 无在途 ⇒ `waitIdle` 立即放行 | `pendingCount === 0` ⇒ `while` 条件直接为假 ⇒ 恒真。另 `:85-88` 断言日志含 `'fail'` 是镜像 `textureCache.ts:236` 文案 |
| `engine-slot.test.ts:316-327` | `buildScriptBin` 自检（表长 = opcode 出现次数） | 改 `OPCODE_TABLE` 里 0x71 的 argc ⇒ 该断言红，**但同一改动会让 `:42-44` 的 fixture 构造先抛** ⇒ 无独立信息量（定义#5 测脚手） |
| `agent-workflow.test.ts:268-307` | 三个 CLI 认得三个开关：只断言 `status===0` 且不含 `is not a function` | `capabilities.js:328-333` 的兜底 `else { printSummary; printIndex }` + `tickets.js:68-73` 的 `o[a.slice(2)] = true` ⇒ **未知开关也 exit 0**。反例：把 `capabilities.js:292` 的 `opt.recount` 改名 ⇒ 本测试**仍绿**，只有 `:117-190` 红 |
| `clear-slot-records-keeps-bindings.test.ts:98-133` | 清完再 `size()` 仍 1280×1792 | 文件 `:104-106` **自认**判别力只有第 2 条；把 `clearSlotRecords()` 换成**空函数**四条仍全绿（现实现 `textureCache.ts:710-716` 本就只写日志）⇒ 它是防回潮棘轮，不是行为验证 |
| `transition-corpus-e3.test.ts:76-78` | `cat∈0..3` / `dur>0` / `t∈[0,1)` | `t` 只在**首次观测**那一刻取（≈0）；把 `rec[3]` 读成 `rec[2]` 大体仍绿 ⇒ 数值半边不敏感（核心判据只有 `:74 seen.length>0` 与 `:85 cleared`） |

### ③ 镜像实现 / 测注释（不是语义判据）

| 位置 | 内容 | 反例实验 |
| --- | --- | --- |
| `transition-render-wiring.test.ts:100-103` | `assert.ok(backend.includes('类别 1') && backend.includes('U2'))` —— **断言注释文本** | 只删掉 `pixiBackend.ts` 里那两行注释、代码一字不改 ⇒ **红**（证明它测的是注释）。按审计定义应 drop |
| `engine-draw-item-decode.test.ts:159-163` | `W_COLOR===0 … W_FLIPBOOK===4` 五条 | 镜像 `renderer/drawItem.ts` 的常量顺序；把常量整体重排（实现同步改）⇒ 断言随实现一起变 ⇒ 无独立判据 |
| `engine-config.test.ts:66-92` | 夹具写 `ScreenMode=1/Music=3/MessageSpeed=7` 再断言解出同名数字 | 同义反复（只证明 `parseIni` 会解析） |
| `engine-config.test.ts:343-425` | 28 条 handlerKind 黄金表 = `OPS/NATIVE_OPS/ENGINE_INTERNAL_OPS` 的镜像（`interpreter.ts:74-81` 就是查这三张表） | 仍有价值（能抓"把 0x300 静默挪进 no-op"），但判据是镜面 |
| `texture-bind-race.test.ts:107/235/310` | 断言日志含 `回写丢弃` / `slotTex 自愈` / `放弃等待` | 改 `textureCache.ts:281/486/181` 的中文文案 ⇒ 红，但**行为没坏** ⇒ 红的理由不正确。建议改成结构化事件/回调计数 |
| `live2d-render.test.ts:254-263` | 标题「`VISIBLE:` 覆盖生效」；正文 `:260 e.l2dSlots.get(0)!.partVisible.set('P_HIDDEN', true)` **直接改表** | `mtn.ts:103` 的 `VISIBLE:` 解析器**全仓无守卫**：把 `:103` 写成永空 ⇒ 现有测试**无一变红**。真资产 `raw-parts/DATA6/TITLE.MTN:30 = VISIBLE:PARTS_01_SKETCH=1` 可直接做 E3 断言（`live2d-chain.test.ts:114` 之后加一行即可） |
| `live2d-render.test.ts:278` | `mulColor` 断言是 arrange=assert（`:277 textureFileId===null` 才有效） | 删实现里 `mulColor` 赋值 ⇒ `:278` 红… 但期望值就是刚 `l2dTextureMulColor(e,0,0x80ff00ff)` 传进去的数 ⇒ 只测"存进去了没丢" |
| `sc-transition-geometry.test.ts:161-175` | `case 8-11` 的 ripple 性质断言 | 把 `transition.ts:330-343`（case 9 = case 8 的镜像，`:329` 注释自认）整段换成 case 8 的体 ⇒ 不重叠/覆盖/计数/ripple **全部保持** ⇒ 镜像方向**没被钉住**，而文件头 `:10` 声称"用可证伪的不变量钉住、防镜像抄反" |

---

## 3. 重复覆盖矩阵

`▲`=同一个不变量在本组内被断多次；`△`=重复对象在本组之外。

| 不变量 | 本组内的断言点 | 判定 |
| --- | --- | --- |
| `TextureCache.waitIdle` 阻塞 + `pendingCount` + 到货放行 | `texture-frame-barrier.test.ts:37-61` ▲ `texture-bind-race.test.ts:285-320` | **真重复** ⇒ merge（屏障文件独有价值只剩 reject 路径 `:73-91`） |
| 0x259 后槽绑定保留 | `clear-slot-records-keeps-bindings.test.ts:62-96` ▲ `:98-133`（同文件内三读数）｜△ `texture-bind-race.test.ts:210-239`（H3 自愈）｜△ `slot-save-resume.test.ts:263-298`（VM 标志位半边） | 同文件内冗余 ⇒ 并入 `:62-74`；跨文件是**互补**（宿主表 / 自愈 / VM 标志），不 merge |
| 帧屏障源码棘轮（`waitIdle`/`texturesIdle`） | `texture-bind-race.test.ts:326-344` | △ `no-boot-preload.test.ts:87-102`（同一条调用链：`texturesIdle` 必须在 `present(` 之前）。两者不变量不同（超时字面量 vs 调用顺序）⇒ 保留，但应合并成一处源码棘轮工具 |
| `draw-texture` op1=handle / op2=tex | `texture-slot-resolve.test.ts:42-77` | △ `draw-item-slot-coverage.test.ts`（整条启动管线 ≥95% + 存在 `tex≠layer`）、`slot-load-screen.test.ts`（层序=handle）。层级不同 ⇒ 保留 |
| 740B DrawItem 逐字段解码 | `engine-draw-item-decode.test.ts:96-172`（手写记录） | △ `engine-slot.test.ts:262-314`（真槽 107 项）、`slot-load-screen.test.ts:109-190`（合成值抄自真槽 79）。三者是"合成→合成+真值→真数据"的金字塔 ⇒ 保留，但 `engine-draw-item-decode` 是唯一带诱饵的 ⇒ 不可省 |
| 转场到点清空整表（raw 136840-136841） | `transition-corpus-e3.test.ts:85` ▲ `transition-render-wiring.test.ts:81` ▲ △ `sc-transition-window.test.ts:79` | **三层各断一遍**。E3（真语料）与 wiring（整合）**可择一**：建议保留 E3 + `sc-transition-window:79`，wiring 的 `:81` 删（其独有价值在 `:52-78` 的四条写端整合） |
| 转场位移/相位公式 | `sc-transition-geometry.test.ts:177-229` | 与 `transition.ts:145-163` **同式复写**（自造 oracle）；△ `op-24f-250-251-transitions.test.ts:58-174` 覆盖的是**记录格**不是几何 ⇒ 保留但需补方向断言 |
| 转场 runtime 不回写记录表 | `transition-render-wiring.test.ts:159-181`（源码棘轮）｜△ `sc-transition-window.test.ts:204-218`（运行期 deepEqual） | 互补（静态/动态）⇒ 保留，但 wiring 应改 glob（现硬编码 6 文件，新增 `scene/*.ts` 写入点看不见） |
| 0x346 复位（只碰 4 矩阵块+`+76`，保留 wins/slot/flags） | `l2d-node-compose.test.ts:185-210` ▲ `l2d-node-transform-ops.test.ts:162-183` | **整段重复** ⇒ `merge`：删 compose 那条（transform-ops 的版本多一条 `flags&2`、少 3 条真空断言） |
| L2D 槽探针 `scL2dSlotProbe` | `l2d-render-pending.test.ts:80-104`（E2 合成）+ `live2d-chain.test.ts`（E3 真资产，台账 `:1045` 自述） | 互补的金字塔 ⇒ 保留 |
| 引擎字段号（dword 下标） | `engine-field-ids.test.ts:29-52`（常量值）｜`engine-field-store.test.ts:95-115`（handler 落点，**硬写不 import**） | 两层互补（注册表 vs 行为）⇒ 保留；但字段号在两处各写一遍 = 漂移风险（方向安全，漂移必红） |
| 配置 → 引擎字段 | `engine-config.test.ts:144-227` | △ `engine-field-store.test.ts:140-157`（0x106/0x201/0x130 getter）、`engine-field-ids.test.ts:39-47`（常量）⇒ 层级不同，保留 |

**去重对象汇总（可执行）**：
1. `texture-frame-barrier.test.ts` 3 条 → 并入 `texture-bind-race.test.ts`（带走 reject 路径）。
2. `l2d-node-compose.test.ts:185-210` 删（保留 `l2d-node-transform-ops.test.ts:162-183`）。
3. `transition-render-wiring.test.ts:81-92` 删（本轮清空已被 `:79`（window）与 `transition-corpus-e3:85`（真语料）覆盖）。
4. `clear-slot-records-keeps-bindings.test.ts:98-133` 删或并入 `:62-74`。
5. `engine-config.test.ts:66-92` 夹具取值同义反复 → 与 `:100-142`（真 INI 结构自洽）合并成一条。

---

## 4. 可被新调试能力替代 / 增强的测试

### 4.0 先纠正一处 API 口径

任务是 `b event slot-bind idx == 0x11` —— **`slot-bind` 没有 `idx` 这个参数名**。`matchEvent` 按事件种类映射（`src/vm/debugBreak.ts:438-442`）：

```ts
where === 'slot-bind' ? { slot: values.slot ?? 0, imgid: values.imgid ?? 0 } : { idx, val }
```

正确写法（帮助文本 `debugBreak.ts:504` 的原例）：`b event slot-bind slot == 0x11 && imgid == 0x5260`。
事件本身是真的：`0x1F9`（`handlers/gfx-texture.ts:237`）与 `0x249`（`:95`）都发 `emitDebugEvent('slot-bind', {slot, imgid})`，消费点是 `session.ts:372`。
★**另一个必须知道的口径**：`dbg slot <n>` 只读 **VM 台账** `engine.texSlots`（`debugQuery.ts:207-219`），它自己在那句里写明"★宿主是否已把纹理就位要看 `[present]` 日志；本查询只读 VM 台账（提案 §3 的'宿主侧槽表'是后续步）"。⇒ **任何宿主侧（`TextureCache`）的状态都不是它可观测的。**

### 4.1 探针型 vs 守卫型

| 文件 | 类型 | `slot-bind` / `dbg` / `shot` 能做什么 |
| --- | --- | --- |
| `texture-bind-race.test.ts` | **守卫型**（确定性合成竞态） | **不能替代**：竞态发生在 `#slotImgid/#slotEpoch` + `decodeImage` 完成回调里（渲染进程），`slot-bind` 只在 VM 侧、在**绑定的那一刻**发一次，看不到回写丢弃/自愈。**可以增强**：用它把"生产形状"（`src/SC0000.txt:1036-1047`：bind → create-texture → 画）从注释引文升级成真会话里的机器可核对序列，证明竞态窗口在真机上真的可达。 |
| `texture-frame-barrier.test.ts` | **守卫型** | 不能替代。E4 的仪器其实**已经存在**：帧 digest 的 `DigestHost.barriers`（`src/frame/digest.ts:59-62`「纹理帧屏障等待次数」）＋ `record`/`replay` ⇒ 可回答"真会话里屏障到底等了几次/有没有撞上限"，无需新代码（注意该段按设计不参与 G3 比较）。 |
| `texture-lifecycle.test.ts` | **守卫型** + E4 目视 | `dbg` 看不到销毁时机；`shot` 才是它的 E4（文件 `:20` 自己写了）。★缺的那条守卫是**顺序**（`collectGarbage()` 必须在 `presenter.present()` 之后，`pixiBackend.ts:1466-1469`），可用源码棘轮 3 行钉住。 |
| `clear-slot-records-keeps-bindings.test.ts` | **探针型替身** | `:99-102` 的"开机绑一次、之后 5 次 `clearSlotRecords` 之间再无 `bindTexture slot=17`"是**从日志粘贴**来的前提。`b event slot-bind slot == 0x11` + `dbg slot 11` 能把 **VM 半边**变成机器探针；**宿主半边**（`slotTex`）需要先给 `debugQuery.ts` 加"宿主侧槽表"查询（`:216` 自认的后续步）。 |
| L2D 8 个文件 | 多数**守卫型**（合成模型/真资产离线） | `shot` 已给出**静态** E4（`tickets/T-0054/evidence/e4-title-live2d.md` → `T-0029/evidence/e4-title.png`，`npm run shot -- --gamestart`），但该证据自认"证明不了动作在动"。**能让它动起来的低成本通道是帧 digest**：`src/frame/digest.ts:107` 调 `scSnapshot(scene, nowMs)` **没传第三个参 `l2d`**（`snapshot.ts:369` 签名是 `scSnapshot(s, clock, l2d?: L2dSnapshotHost|null)`），且 `grep -n l2d src/frame/digest.ts` **零命中**、`DigestEngine` 无 l2d 字段 ⇒ 已经跑通的 `record`/`replay`（T-0029 实证 2614 帧 engine 段逐字段相等）**对 L2D 一字节未比**。补 `l2dHost` + `DigestEngine.l2d` 两行后，`live2d-chain.test.ts:88-137`、`live2d-render.test.ts:332-383`、`l2d-node-compose.test.ts:544-578` 可同时从 E3 抬到 E4。 |
| `engine-slot` / `engine-config` / `agent-workflow` / `sc-transition-geometry` | **守卫型** | 与"运行中的会话"无关，探针只会更慢更脆。**零适用**。 |
| `transition-render-wiring.test.ts:94-157` | **探针的替身（源码文本）** | 这是 `slot-bind` 最该接管的一批：把"源码里出现了 `freeze`/`poolPending` 形参"升级成"转场到期那一帧冻结真的让窗模型当帧收尾"的行为观测。**前提是先有可达路径**：`T-0091/ticket.json` 轮 9 已确认本机没有冷启动可达 `i223`/`i24f` 的路径（178 个含 `i223` 的脚本 × 前 12 个 × 3000 帧零命中）⇒ 探针不设路径就是另一种**永绿**；而 `SC0010` 的 `i250/i251` 是可达的（`transition-corpus-e3:31` 实跑拿到 `seen.length>0`），这一类**优先用 headless 进程内探针**（确定、可复现、不占 Electron 窗口）。 |
| L2D 数值级 E4 | — | `debugQuery.ts` 只有 `global/local/frame/flocal/slot/run`（`:95/:113/:129/:190/:207/:224`）⇒ **没有 l2d 查询**。加一条 `l2d <slot>`（模型 id / 参数 / 节点矩阵）是"数值级 E4"的唯一低成本通道；带 `i34d/i349` 的场景只在 `BTL`（`src/BTL.txt:906` 等），而 `ScenarioSpec`（`src/frame/scenario.ts:156-168`）无读档字段 ⇒ 目前只能靠 digest。 |

---

## 5. 本组最该改的 3 件事

### 第 1 件｜消灭 5 处"假绿"（最高优先：干净 clone 上零断言报 passed）

- `test/live2d-moc.test.ts:62`、`:183`、`:188`；`test/live2d-deform.test.ts:246`、`:288`。
- 改法：给这 5 个回调补 `(t)` 并把 `console.warn('[skip] …'); return;` 换成 `t.skip('…'); return;`。
- 附带两处收紧：`live2d-moc.test.ts:66` 的 `files.length > 0` → `>= 300`（本机实测 335，是真语料棘轮）；`findMocDir()` 的候选目录加上 `install`（与 `live2d-chain.test.ts:55-58` / `live2d-render.test.ts` 的口径统一）。

### 第 2 件｜打通两条已经存在的 E4 通道（各 1–2 行改动）

1. `test/engine-slot.test.ts:213`：`const dir = path.join(system.baseDir, 'SAVE')` → 与 `:268` 的 E4b 对齐用 `dirs = [base/SAVE, overlayDir/SAVE]`，并按 body 头 `+284 format` 过滤/`continue`（避免日后玩家在 emulator 存的 `format=0` 槽造成假红）。**理由（已实证）**：本机 base 目录不存在 ⇒ 这条最强断言（落点 opcode 与语义自洽）被 `:220` 跳过，而 overlay 里有 2 个 **format=3 真引擎槽**；审计侧复刻 `:227-256` 的循环得到 `SAVE78.DAT frames=3 ALL-OK`、`SAVE79.DAT frames=3 ALL-OK`。台账 `engine-capabilities.json:3233`「本机 47 个真槽全过」与 `:3957`（E4 / guard=本文件）因此在本机**不可复核**。
2. `src/frame/digest.ts:107`：`scSnapshot(scene, nowMs)` → `scSnapshot(scene, nowMs, scene.l2dHost)`，并给 `DigestEngine` 加 `l2d` 字段。**理由**：`snapshot.ts:369` 早已接受第三个参、`record`/`replay` 通道早已跑通，但 digest 里 `l2d` 零引用 ⇒ L2D 的 E4 卡在这两行。收益：一次性把 `live2d-chain:88-137`、`live2d-render:332-383`、`l2d-node-compose:544-578` 抬到 E4，并顺带补上 T-0054 自认的"静态截图证明不了动作在动"。
3. （同一件事的第 3 步，成本小）给 `src/vm/debugQuery.ts` 的 `slot` 查询补宿主侧槽表、并加 `l2d <slot>`；把 `clear-slot-records-keeps-bindings.test.ts:99-102` 的"生产形状"用 `b event slot-bind slot == 0x11`（注意参数名是 `slot`/`imgid`，**不是 `idx`**，`debugBreak.ts:440-442`）钉成机器探针。

### 第 3 件｜清掉无判别力的断言 + 修掉"会挡住正确修复"的那条 oracle

1. `test/engine-config.test.ts:160` → 期望值 `2` 改 `1`，并给 `src/engineConfig.ts:243-244` 的 `soundSE`/`soundVoice` 补 `map: (v) => (v !== 0 ? 1 : 0)`（raw 23691/23695 是 `= v != 0`）；同时按 raw 23722-23735 给 `:236` 的 `messageRMouseEvent` 补 `map` 并**新增** `get(1384)` 断言（现在只被 `applied.length` 计数）。只做 map 不改期望 ⇒ 当场红，这就是"测试挡修复"的证明。
2. `test/transition-render-wiring.test.ts:100-103` → 删（断言注释含 `类别 1`/`U2`；删注释即红）；`:160-167` 的硬编码 6 文件列表改成对 `src/renderer/**/*.ts` 的递归扫描；`:118` 的 `slice(indexOf(...))` 在符号改名时会退化成 `slice(-1, 1999)` ⇒ 改成"找不到锚点即红"。
3. 删/改一批真空与镜像断言（每条都带反例）：`l2d-node-compose.test.ts:196/197/199` 与 `l2d-node-transform-ops.test.ts:174`（复位用例里先跑 `0x347`/`0x348` 让断言真正有判别力）；`engine-draw-item-decode.test.ts:159-163`；`texture-lifecycle.test.ts:58-68`（换成"`collectGarbage()` 必须在 `presenter.present()` 之后"的源码棘轮）；`agent-workflow.test.ts:268-307`（改成"未知开关必须非零退出或点名"的负例）；`engine-slot.test.ts:316-327`（移进 `engineSlotFixtures` 自检）。
4. 顺带补两处**真缺口**（本组没有任何断言覆盖）：`mtn.ts:103` 的 `VISIBLE:` 解析（用 `raw-parts/DATA6/TITLE.MTN:30` 的真行，或 `live2d-chain.test.ts:114` 之后加一行 `inst.partVisible.get('PARTS_01_SKETCH') === true`）；`sc-transition-geometry.test.ts` 对 case 5/6/7/9/10/11 的方向断言（分界点坐标级，别再只用镜像下仍成立的性质判据）。

---

## 6. 逐文件详表（补充证据：审计员亲读的 9 个文件）

本节补 §1 表里放不下的反例实验与弱点；未列出的 13 个文件的证据见 §1 表内 `file:line` 与 §2、§3。

**`texture-bind-race.test.ts`（12 用例）** —— 反例：删 `textureCache.ts:279` 的两个判据条件 ⇒ ②④H3 三条红；`BARRIER_GIVEUP_MS` 改回 500 ⇒ `:300` 红；`pixiBackend.ts` 传 `waitIdle(300)` ⇒ `:340-344` 红。弱点只在 3 处日志文案断言。

**`texture-frame-barrier.test.ts`（3 用例）** —— 反例：`while (this.#inflight.size > 0)` 改 `while (false)` ⇒ `:51` 红；删 `preloadImage` 的 `finally { this.#inflight.delete(imgid) }` ⇒ `:84` 红。独有价值 = reject 路径。

**`texture-lifecycle.test.ts`（3 用例）** —— 反例：`flush()` 里 `t.destroy(true)`→`t.destroy()` ⇒ `:44` 红；删 `this.#q.length = 0` ⇒ `:45/:46/:55` 红；**删 `pixiBackend.ts:1468` 的 `collectGarbage()` ⇒ 三条全绿**（缺口）。

**`texture-slot-resolve.test.ts`（3 用例）** —— 反例：`textureCache.ts:734` 的 `it.tex` 改 `it.layer` ⇒ `:54` 红；`release()` 里加 `#slotImgid.delete` ⇒ `:86` 红。

**`clear-slot-records-keeps-bindings.test.ts`（4 用例）** —— 反例：`textureCache.ts:711` 加回 `this.#slotImgid.clear()` ⇒ 六处红；**改成空函数仍全绿** ⇒ 负空间棘轮。行为侧由 `slot-save-resume.test.ts:286` 负责。

**`transition-corpus-e3.test.ts`（1 用例）** —— 反例：摘掉 `loop.ts` 的 `host.advanceModel(...)` 或 `scTransitionTick` 接线 ⇒ `:74` 红；把 `rec[3]` 读成 `rec[2]` ⇒ `:77` 大体仍绿（数值不敏感）。**判据强度 = 中；值不值得留 = 值得**（全组唯一 E3 接线守卫，62.9ms）。

**`engine-draw-item-decode.test.ts`（3 用例）** —— 反例：`engineDrawItem.ts:147` 改成"连续 3 f32" ⇒ `:142` 红（诱饵 9.75）；`524 + 4*i` 改 `8*i` ⇒ `:148-158` 红；`+0x10` 当宽不取差 ⇒ `:112` 红。上限：与实现同源的人工阅读无法自证。

**`engine-field-ids.test.ts`（3 用例）** —— 反例：`engineFieldIds.ts:38` 改 `107440` ⇒ `:33` 红；handler 写 `429756` ⇒ `:54-72` + `:105` 双红；0x1F5 只清计数 ⇒ `:115` 红。**逐条 raw 复核通过**（见 §1 表）。

**`engine-field-store.test.ts`（6 用例）** —— 反例：0x76 目标字段改 21666 ⇒ `:90` 红；删 `0x107` 的 `>0x1F` 守卫 ⇒ `:137` 红；`mod` 改 floored ⇒ `:170` 红（★改 JS 原生 `%` 是等价的，测不出）。`0x8B` 消费端改常量 6 ⇒ `:120` 红。

---

## 7. 附录 A：台账交叉核对（4 处可核对点）

1. `texture-bind-async-stale-writeback` 自报 **E3**，唯一 guard 是**纯合成**（`GatedCache` 覆写 `decodeImage`）⇒ **分档虚高**，建议改 `E2`，若确有真语料证据请按 `live2d-slot-probe` 的写法在 note 里并列"E3 = 哪条守卫"。
2. `save-load-drawitem-clear-and-restore` 自报 **E4**：本机 overlay 有 `SAVE78.DAT`/`SAVE79.DAT`（format=3），E4b 实测"真槽 2 个（带绘制项清单 2 个），逐条解码 107 项" ⇒ 名副其实；但主条 E4 skip（§5 第 2 件）。
3. `clock-read-transition-window` 自报 **E3**：`transition-corpus-e3` 实测 not skipped、62.9ms 通过 ⇒ 名副其实。
4. 孤儿守卫：`live2d-enabled-config-flag`（`engine-capabilities.json:3577-3579`，E1/空 guard）应回填为 `guard: test/live2d-enabled-flag.test.ts`；另 `live2d-mesh-batches` 的顶层 `"evidence":"E4"`（`:3667`）是 validator 不读的死数据（它只读 `emulator.evidence`），建议删以免误导。

## 8. 附录 B：顺带发现（**只读发现，未修改任何台账**）

`analysis/fields.json` 有两条 Engine 字段的 `offset` 与其 `meaning` 文本、以及反编译真源**互相矛盾**：

| name | `offset` | `meaning` 里的字节 | raw 实证 | 结论 |
| --- | --- | --- | --- | --- |
| `frame_tick_lock` | `0x68F70` = 429936 | 429752（= 107438×4） | `17980 *(_DWORD *)(_this + 429752) = 0`、`25224-25227` | `offset` 错（应 `0x68EB8`；`grep -c 429936` 在 raw 里 **0**） |
| `frame_count` | `0x68F74` = 429940 | 429756（= 107439×4） | `17981`、`25221/25234` | 同上（应 `0x68EBC`） |

- 复核方式：对 `fields.json` 全部 368 条做"`offset` == 含义中的 `byte N`"扫描，**只有这两条**不一致；同区域其它条目（`input_advance_time`，含义 429808 ↔ raw `25840/25844`）是**含义对、offset 错**。
- 影响：`engine-field-ids.test.ts:32-35` / `engineFieldIds.ts:36-38` 用的是**正确值**。⇒ 这是"**测试比台账准**"的实例，也直接回答了本次审计对 `engine-field-ids` 的怀疑：**它不是"把 `fields.json` 抄进代码再自核"的镜像实现**（它锚在 raw 上）。反过来说，任何"改成从 `fields.json` 派生以获得更独立判据"的升级都会**先制造假红**，必须先修这两条 `offset`，或给 Engine 字段加机器可读的 `dword_index` 列。
