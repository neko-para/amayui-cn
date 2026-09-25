# T-0166 第 2 批变更记录（changes-c166.md）

> 范围：审计批 `app/amayui-emulator/.tmp/p1-fix/p23-worklist2.md` 里归到本票的 **16 行**工作清单。
> 本轮只做**只读核实 + 台账定点补丁**，不碰 `src/**`、`test/**`、`docs-new/**`、`tickets/*/ticket.json`。
> 交付物：`.tmp/t0166/patches.json`（10 条定点替换）+ 本文件。
> ★票面状态未动（`--set-status`/`doneWhy` 由 owner 复核后结算）。

## 0. 范围调整（父 agent 指令，2026-09-25）

`adv-flag-lifecycle`、`msgwin-cancel-key-state`、`msgwin-attr-font-opcodes` 三条**从本批剔除**：
前两条由 T-0151（msgwin/vm 半边）与 T-0161 认领，`msgwin-attr-font-opcodes` 亦在 T-0151 已交回的 9 条清单里。
本票因此保留 **12 行（= 10 个条目）**，产出 **10 条补丁**。

## 1. 逐行核实结论（12 行）

| # | sev | 条目 | kind | 核实结论 |
|---|---|---|---|---|
| 1 | P2 | `lazy-mesh-map-node` | stale-ledger | **成立** → 已给补丁 |
| 2 | P2 | `scene-3d-weather-effects-rain-snow-leaf` | stale-ledger | **前提被推翻**（台账已改） |
| 3 | P2 | `live2d-node-draw-advance` | stale-ledger | **成立** → 已给补丁（note 尾句） |
| 4 | P2 | `passive-camera-and-effect-render-state` | stale-ledger | **前提被推翻**（台账已改，T-0017 就订正过） |
| 5 | P2 | `text-white-level-on-composite` | stale-ledger | **P1 半边已改；P2 细节仍缺** → 已给补丁 |
| 6 | P3 | `scene-frame-commit` | stale-ledger | **半成立**（`a.key` 半边已有守卫；`a.order` 半边仍无） → 已给补丁（如实口径） |
| 7 | P3 | `lazy-texture-slot` | stale-ledger | **半成立**（guard 确实不指向同源机制；但「没有任何断言」不实） → 已给补丁 |
| 8 | P2 | `lazy-texture-slot` | approximation | **前提被推翻**（mode 已被消费） |
| 9 | P3 | `lazy-texture-slot` | overreach | **成立** → 已给补丁（whySilent） |
| 10 | P2 | `lazy-movie-dll` | overreach | **前提被推翻**（条目已改名+改写） |
| 11 | P2 | `lazy-script-operand-hashmap-node` | overreach | **成立** → 已给补丁（reads；审计的"第二张表"识别错） |
| 12 | P2 | `lazy-script-operand-hashmap-node` | stale-ledger | **成立** → 已给补丁（guard 留空） |
| 13 | P2 | `texture-bind-synchronous-then-query` | unclear | **成立** → 已给补丁（如实口径） |

### 三条"前提被推翻"的证据

1. **#2 `scene-3d-weather-effects-rain-snow-leaf`**：审计说 `emulator.guard` 写「（无）」。实测 `analysis/engine-capabilities.json` 该条 `guard = "test/scene-3d-weather.test.ts"`，
   且 note 里逐字写着「因为 `test/op-327-32e-setweather-noop.test.ts` 与 `test/registry-classification.test.ts` 把类别钉住」——审计要的订正**就在台账里**。
   全库机械查询：`guard` 为空或含「无」的条目共 30 条，**没有任何一条**是天气条目。
2. **#4 `passive-camera-and-effect-render-state`**：审计说台账记本条为「没有等价物（absent/E1）」。实测 `status = "modeled-verified"`、`evidence = "E3"`、`guard = "test/scene-3d-weather.test.ts"`，
   且该条自带 `journal` 记录：「`T-0017`：本条旧 note 的 overreach 已订正。」（`Scene+1260` 已由 `sceneDefaultBlend` 建模并由 `walkBlendSequence` 消费，`test/blend-mode.test.ts:63-67` 逐档断言。）
3. **#8 `lazy-texture-slot`（approximation）**：审计说「emulator 完全忽略 mode，两者都建同一种 canvas 表面」。实测 `src/renderer/pixi/textureCache.ts` 已按 mode 分两套类：
   `:116` 注释「`slot → 表面类`（`0x1F8` 的 `mode == 3 ⇒ DividedTexture`，raw 122855-122871）」、`:344-349` 两套类的长注释、`:355` `const cls: SurfaceClass = mode === 3 ? 'divided' : 'normal';`、
   `:357` divided ⇒ `#slotTiles` 子纹理表、`:399-400` 日志带 `class=`、`:405/:410/:411` 有 `surfaceClassOf`/`dividedTilesOf` 查询口。**该 approximation 已被 T-0153 落地修掉**。
4. **#10 `lazy-movie-dll`（overreach）**：审计说条目名是『电影解码 DLL 重载』、whySilent 把机制框成「影片」。实测 `name = "惰性模块加载 = AGERC 模块接口（0x14B/0x14C/0x14D；**不是**影片解码库）"`、
   `whySilent = "LoadLibrary 失败时 GetLastError + _CxxThrowException(Command_ShowMessage) ⇒ **会报错**"`，note 末句逐字写着「★**名字与扩展点都错**：0x14B 是**通用模块加载**（raw 31073-31075 `op1 → FileDB 名 → LoadLibraryA`），全语料唯一调用点是 `src/SAVE.txt:7 i14b 5250`（AGERC.DLL）」。
   审计的结论已全部落在台账里；唯一调用点也复核过：`Select-String -Path src/*.txt -Pattern i14b` = **1 命中**（`SAVE.txt:7`）。
5. **#11 的审计细节错**：审计说两个字段「分别是 CMovieToTexture 对象表与 **Scene+42456 的 CTexture 槽表**」。读体（raw 31625-31653，0x20F 的 `sub_4237B0`）：
   `378688` = `Engine + 4*slot + 94672`（影片对象槽表，`operator new(0x480)` + `sub_489040`/`sub_488DC0`）；`365288` = `Engine + 4*slot + 91322`（影片**资源**表，空 ⇒ 抛 `asc_520248`）。
   `Scene+42456` 是**另一张**表（`sub_4A2C10` 里以 `_this = Scene` 为基址的 `_this + 4*a2 + 42456`，raw 122849/122853）——「在声明区间零出现」这半边成立，「它是 CTexture 槽表」这半边**不成立**。

## 2. 逐条补丁（10 条，全部定点替换 `emulator.note` / `emulator.guard` / `emulator.status` / `emulator.evidence` / `reads` / `whySilent` + `counts`）

| # | 条目 | 改了哪些字段 | 新值大意 |
|---|---|---|---|
| 1 | `lazy-mesh-map-node` | status→`modeled-verified`、evidence→`E2`、guard→`test/blend-mode.test.ts#0x322 的 op2 必须落进 MeshObj.blend`、note | 实现是 `scEnsureMesh`（不是 `scCreateMesh`，两者刻意分开）；「无专门测试」不实 —— `mesh-vertex-quad.test.ts` 是 0x320/0x322/0x323 回归套件、`blend-mode.test.ts:191/197` 端到端钉住「从未建过的 handle ⇒ 建项」 |
| 2 | `live2d-node-draw-advance` | note | 删掉假缺口「宿主合成循环还没把绘制节点与 l2dAdvance 接起来」：两宿主 `advanceModel` 都调 `scL2dTick`（headlessScene.ts:882 / pixiBackend.ts:1487），它按 `l2dNodeDrawable` 过滤后调 `l2dAdvance`（ops.ts:2002-2005）；**真正的剩余缺口 = `+16` EyeBlinkMotion / `+23` 眨眼门控未建模**（`src/live2d/` 无 blink） |
| 3 | `text-white-level-on-composite` | note | 「三处断言」→ **两处活断言**（`adv-msgwin.test.ts:152-163`、`draw-string.test.ts:105-108` 都断言 `fill:'#ffffff'`）+ 第三处 `text-style-snapshot.test.ts` 的 `rgbOf(:80)` **已无调用者（死代码）**；唯一一处 `#E3E3E3` 在 `clear-slot-records-keeps-bindings.test.ts:7` 且**无关** |
| 4 | `scene-frame-commit` | note 的 ② | 如实口径：「跨路提交次序」是**半守卫** —— `entries.sort((a,b)=>a.key-b.key\|\|a.order-b.order)`（presenter.ts:394）的 `a.key` 半边已由 `test/render-draw-order.test.ts` 用可见出画次序钉住（+反向自检）⇒「要可测就得抽到共享层」已被证伪；`a.order` 半边（四路同键）仍未守卫 |
| 5 | `lazy-texture-slot` | whySilent | 「失败仅置空槽」在体里无支持：表面创建失败（类对象 vtable+12 非 0）时**保留**刚建出的对象（槽已在 LABEL_9 赋值，raw 122875），只 `sprintf_s(_this+8,…"関数：CTexture エラー…")`+`sub_4034C0` 写日志并 `return 0`（raw 122879-122887）；**只有 `operator new` 失败**才是空槽（raw 122873） |
| 6 | `lazy-texture-slot` | guard→`test/texture-lifecycle.test.ts`、note | guard 换成**同源**文件（DestroyQueue「push 不销毁 / flush 才 destroy(true) / 幂等」+ collectGarbage 空跑）；note 记录两套表面类已建模（mode==3 ⇒ divided）、并承认**仍缺**：`0x1F8`「旧表面释放→新建」的端到端接线无断言（Node 无 DOM）、程序化内容未生成、`tileSize` 是近似 |
| 7 | `lazy-script-operand-hashmap-node` | reads | 删掉区间内**零出现**的 `Engine+378688`/`Engine+365288`，换成区间内真实字段：`95776`(=383104/4 当前脚本槽)、`95782+30*cur`(=383128+120*cur 操作数描述表)、`95789..95794+30*cur`(四张值表, raw 37354-37364)、`388236`(=97059 哈希盐)、全局池数组 `382976/382984/383000/383008/383072/383168` |
| 8 | `lazy-script-operand-hashmap-node` | guard→`""`、note | `test/xval.test.ts` 与本条无关（只断言 BIN 解析器 vs 反汇编文本的指令名顺序，不 import `Engine`/`ops`，删掉整个操作数池层仍全绿）⇒ **承认无守卫**（E1 静态结论，guard 留空） |
| 9 | `texture-bind-synchronous-then-query` | note | 屏障①有守卫（`texture-frame-barrier.test.ts`；另有 `no-boot-preload.test.ts:93-104` 的源棘轮）；屏障②（`session.ts:698` 的 `#awaitTextureBound`，体在 :881-886）**无守卫**；删掉指向 `.tmp/gs2-*.png` 的「端到端证据」（.tmp 不算证据，且该次运行自带日志把两张 SN0000 判成「★几乎全黑：可能有渲染缺陷」，`.tmp/shot-gs2.log:51-52`） |
| 10 | `counts` | 整块 | status 只改了 1 条（`lazy-mesh-map-node` modeled-unverified→modeled-verified）⇒ `modeled-verified 76→77`、`modeled-unverified 5→4`、`needsAttention 41→40`（其余不变）。按 `capabilities.js` 的 recount 公式在**构建时**从磁盘现况动态算出 |

★**未动**：任何条目的 `missing[]`、任何未列出的条目、`engine.fns`/`engine.raw`、以及全部 `src/**`、`test/**`、`docs-new/**`。

## 3. 自证

```
$ node .tmp/t0166/build.mjs
counts: { total:141 … modeled-verified:76 … needsAttention:41 }  ⇒  { … 77 … 40 }
写出 10 条补丁 → .tmp/t0166/patches.json

$ node .tmp/settle/apply.mjs --patches .tmp/t0166/patches.json --no-append --dry
· analysis/engine-capabilities.json: 246494 → 250745 字节
（dry-run，未写盘）
```

`apply.mjs` 的 `old 出现 N 次（应为 1）` 一条都没报。另跑 `.tmp/t0166/verify.mjs`（内存内演算，不写盘）：
① counts 与 recount 公式自洽 ✓；② 109 条 guard 全部可解析（含新增的两条），空 guard 条目的证据都是 E0/E1 ✓；
③ n/a `why:` 规则 ✓；④ 变化字段**只有**上表点名的 14 格（`missing[]` 与其它条目逐字节相同、条目数 141→141、标识集合一致）✓。

## 4. 需要别人接的代码活（本票不动手）

| # | 文件 | 改什么 | 判据 |
|---|---|---|---|
| ① | `src/live2d/`（`runtime.ts` / `assetLoader.ts` 占位中，**有别人占着**） | 建模实例 `+16` EyeBlinkMotion 与 `+23` 眨眼门控（引擎 `sub_4783D0` raw 92578-92615 的 `if ( *((_BYTE*)_this + 23) )` 分支） | 新增用例：装载后绘制节点 N 次 ⇒ `+23` 门控下的眨眼曲线按 `$fps` 推进；`src/live2d/` 全库出现 blink 符号 |
| ② | `src/renderer/pixi/textureCache.ts`（`create`/`release` → `DestroyQueue` 那条接线） | 让「换尺寸/释放 ⇒ 旧纹理入队」这一步可测（把入队判据抽成纯函数，或在测试里注入假 canvas 工厂） | 新增断言：`create(slot, 新尺寸)` ⇒ `pendingDestroyCount === 1`；`release(slot)` ⇒ 同尺寸 `create` 复用画布（`pendingDestroyCount` 不增） |
| ③ | `src/renderer/app/session.ts` 的屏障②（若要走守卫） | 让 `0x1F9` 之后的 `awaitTextureBound` 可被测试观测（例如把「派发后是否调用了该缝」记进 `DebugQuery`/trace） | 新用例：对 `0x1F9` 派发一次 ⇒ 观测到屏障②被 await（当前产物侧无从断言，只有源棘轮可写） |
| ④ | `src/renderer/pixi/presenter.ts` 四路同键次序 | 若要把 `a.order` 半边也变成可测：给跨路**同键**造一条用例（同 layer 的 item+text+mesh+L2D），断言可见次序 = item→text→mesh→L2D（raw 135560-135614） | 用例反转 `order` ⇒ 必红 |
| ⑤ | `test/xval.test.ts` 之外的、针对「JS Map 版操作数池」的守卫（可选） | 若决定给 `lazy-script-operand-hashmap-node` 补守卫：断言首次写入某操作数槽才建项、`frames`/`globals` 池互不串 | 删掉池层 ⇒ 用例红 |

## 5. 交接注意

- `docs-new/03-engine/engine-capabilities.md` 是生成物：应用补丁后必须由 owner 重跑 `node scripts/build-capabilities.mjs`（`counts` 行与 note 摘要都会变），否则 `test/capability-ledger.test.ts` 的「md 与数据层同步」一项会红。
- `counts` 补丁是按**构建时**磁盘状态算的（当时 `modeled-verified = 76`）。若 owner 的合并集里还有**别的** status 变更（T-0151/T-0161 的 9 条），请**丢弃 `counts` 那一条**并改跑 `node .agents/skills/amayui-engine-analysis/scripts/capabilities.js --recount`。
- 落盘期间 `analysis/engine-capabilities.json` 被并发改过一次（`346959` 字节、mtime 2026/9/25 1:43:35；counts 由 77/29 变成 76/30）。本批全部 10 条 `old` 在该次写入**之后**重新校验过（`build.mjs` 每次从磁盘现切片 + 逐一校验唯一性）。
- `tickets/README.md` 的「过程文档」清单里还没有本文件；owner 结算时跑 `node scripts/build-tickets.mjs` 即可（该文件不在测试的必查项里）。
