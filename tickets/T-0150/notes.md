# T-0150 调查与设计：死写闸门（闸门 C）扩面到 Engine / SceneState / 文本对象

> 判据来源：`tickets/T-0150/ticket.json` 的 `acceptance`；动机来源 = 2026-09 全指令核对报告
> `docs-new/99-records/2026-09-impl-audit/impl-audit-2026-09.md` §5.0 第 2 条 + §6.4。
> 本文件只写**调查与设计**；改了什么、判据怎么跑，见 `changes.md`。

## 1. 现状（改之前，实测）

```
npm run check:dead-writes → 基线 0 / 当前 0 / 无新增
```

`src/tools/deadWrites.ts` 的修前口径：

- 字段清单只从 `export interface Item` / `export interface MeshObj`（`src/renderer/drawitem/model.ts`）取；
- 统计面 = 硬编码的 13 个文件的拼接文本；
- 「写」= `.field =`（赋值目标）/ 对象字面量键 / 接口声明行；「读」= `.field` 的其余出现；
- 诊断函数 `scSnapshot`/`snapshotToText`/`debug*` 先剔除。

⇒ 审计 §5.0 第 2 条说的正是这个：`missing-consumer` 类 finding 大多落在 `Engine`/`SceneState`/文本对象上，
**闸门看不见、不会红**。本票把它扩面，并逐条处置扩面后必然冒出来的一批存量死写。

## 2. 扩面设计（`SCOPES` 表）

| scope | 声明处 | 解析方式 |
|---|---|---|
| `Item` / `MeshObj` | `src/renderer/drawitem/model.ts` | `export interface`（原覆盖面，**保持**） |
| `Engine` | `src/vm/engine.ts` | `export class Engine`：按括号深度取**顶层成员块**（含多行类型注解/初始化），认 `readonly`/修饰符、构造函数的**参数属性**；排除方法/访问器/箭头函数字段 |
| `SceneState` | `src/renderer/scene/state.ts` | `export interface` |
| `SceneState.render4` | 同上 | **嵌套对象类型**：定位 `render4:` 之后的 `{`（`{` 可能在下一行），当 `indent = 4` 的接口体解析 |
| `SceneXform` | 同上 | `export interface` |
| `TextFrame` | `src/text/layout.ts` | `export interface` |

统计面 = 显式清单 ∪ **全部 `src/**`**，排除 `src/tools/`、`src/report.ts`（只做报告的目录）。

### 2.1 为什么必须换掉「按字段名全文计数」

只按字段名计数会把**同名的别的对象的字段**算成消费者。修前就踩过：`Item.blend` 被
`applyDrawColorAlpha(it, from, blend = 0)` 的参数名骗过（`src/tools/deadWrites.ts` 文件头有留档）。
扩面后更危险：`key`/`handle`/`level`/`frames` 这些名字在 `VideoGame` 到处出现。

判定分三步（全部落在 `receiverVerdict()`）：

1. **类型注解线索**：从全量文本里抓 `e: Engine` / `const x: SceneState` / 连写 `a, b: T`
   ⇒ 接收者基名命中该线索 = **消费者**（复合接收者如 `s.sceneXform` 的基名 `s: SceneState` 也走这支：
   它就是**拥有**该记录的那个类型）；
2. **可证伪**：单段接收者被注解成**别的** scope 的类型（`e: SceneState` 出现在 `Engine` 的判定里）
   ⇒ 那次访问 **不算** `Engine` 的字段。只认"其它 scope 的类型名"，不认 `x: number`
   （否则模型里 `posZ: number` 会把 `it.posZ` 判成别人的）；复合接收者一律跳过这一步
   （`sceneXform: SceneXform` 自伤）；
3. **字段集证据**：没有类型注解线索时，看"这个接收者被本 scope 的**别的**字段用过没有"
   （`it.posX`/`it.flags` ⇒ `it` 是 `Item`）。用命中的字段名和正在判定的字段比对，避免自己证明自己。

★**不对称是有意的**：这三步只用来**判读**，拿不准（`unknown`）一律**算读**。
代价是**假阳性**（报多了，人眼复核后进基线），收益是**不会假阴性**（不会把真死写洗成活的）。

### 2.2 补的两个"写"口径（都是本票扩面时暴露的盲区）

1. **容器变更方法算写**：`map.set(…)` / `set.clear()` / `arr.push(…)` / `++` / `--`。
   修前 `Engine.texSlotFlags`（引擎 `0x258` 写 / `0x259` 整表复位）**一个"写"都统计不到**
   （体内全是 `.set()`/`.clear()`）⇒ 永远不进死写列表，闸门对 Map/Set/Array 型字段等于瞎的；
   同理 `SceneState.render4.commits++`（`0x20E`）与 `transitionClears++`（`0x224`）也漏看。
2. **嵌套 scope 的带路径访问**：字段可以写成 `render4.primReset`（限定符本身就是证据，不必再判接收者）。

### 2.3 有意剔除的两类"读"（写进文件头与 README）

- **诊断/报告函数**（`scSnapshot`/`snapshotToText`/`debugDrawItems`/`debugItemState`/`slotTable`）
  以及 `src/tools/`、`src/report.ts`；
- **测试文件**（`test/**` 不在扫描面内）。

理由：审计 `missing-consumer` 的定义就是"实现了但**生产路径**没效果"。一个字段只被快照/测试读，
在定义上仍属该缺陷（这也是本轮 14 条基线里多数的形状）。

### 2.4 基线格式扩了「理由 + 票号」

```jsonc
{ "known": [...], "reason": { "<id>": "为什么暂时是死写（≥20 字）" }, "tickets": { "<id>": "T-0154 | none" } }
```

`auditBaseline()` 是唯一判据（`check:dead-writes` 与 `test/no-dead-writes.test.ts` 共用）：
缺 `reason` / 少于 20 字 / 缺 `tickets` 各报一条 ⇒ exit 1。
为什么这么严：基线是**棘轮的豁免名单**，一句"已知"等于永久静音，必须留下可复核依据。

## 3. 扩面结果：逐条处置（2026-09-25 实测，`npm run check:dead-writes`）

扩面后**字段 154 个 / 当前死写 14 个**，全部登记进基线（每条带 `reason` + `tickets`）。
分类与判据：

| # | 字段 | 类 | 证据 / 唯一读者 | 承接票 |
|---|---|---|---|---|
| 1 | `Engine.callFlag` | **a 真死写** | 只有声明初始化（`engine.ts:264`）与 `exit-script` 复位（`control.ts:509`），**0 生产读者**；测试仅把它放进 `vmState()` 快照做"一格都没动"的断言（`test/op-6-05-step-slot.test.ts:35`） | 无票（新增，建议 P3） |
| 2 | `Engine.callLink` | **a 真死写** | 同上（`engine.ts:263` / `control.ts:508`） | 无票（新增，建议 P3） |
| 3 | `Engine.dispatching` | **a 真死写** | ★JS 侧镜像：真值走 `ENGINE_FIELD.dispatchInProgress`（`_this[124350]`，raw 19024/24946/31556 读、25176/25187 写），生产读点在 `handlers/frame.ts:110` 与 `handlers/engine-fields.ts:437`；`Engine.dispatching` 只被 `setDispatching()` 写（`control.ts:341`），读者只有 `test/op-1f5-dequeue.test.ts` | T-0157 |
| 4 | `Engine.texSlotFlags` | **a 真死写**（审计 §5.2 `0x259`） | 写端 `handlers/gfx-state.ts:110`、清端 `handlers/gfx-misc.ts:87`；渲染/装配/快照/读档**都不含它**；引擎侧该标志随场景快照持久化（raw 17474）并在装载路径按 `flag_a == 1` 决定重建槽（raw 19877） | T-0154（另一个 agent 正在改该文件；T-0102 已复核画面无可见症状） |
| 5 | `Engine.l2dMotionCache` | **a 真死写**（★扩面新发现） | `live2d/runtime.ts:237` `.set()` + `:207` `.clear()`，全仓**没有任何 `.get()`** ⇒ 动作缓存从未命中（每次重解析 `.mtn`）。2026-09 审计的 live2d 批只点了 `0x341` 的两条，没点到这个字段 | T-0160 |
| 6 | `SceneState.render4.entryParams` | **b 记录型**（`0x242`） | `scene/ops.ts:1420` 自认"相邻对象 +504 的台账（宿主侧无该对象类型 ⇒ 只记）"；读者只有诊断 `scSnapshot` 与测试 | T-0154 |
| 7 | `SceneState.render4.slotParams` | **b 记录型**（`0x256`） | `scene/ops.ts:1454` 同类（注释自认"报告/digest 要能看到脚本下发的原值"） | T-0154 |
| 8 | `SceneState.render4.commits` | **b 记录型**（`0x20E`） | `scene/ops.ts:1344` `commits++` 只有计数；读者只有诊断/测试 | T-0154 |
| 9 | `SceneState.render4.transitionClears` | **b 记录型**（`0x224`） | `scene/ops.ts:1355` `transitionClears++` 同上 | T-0154 |
| 10 | `SceneState.render4.primReset` | **a 真死写**（`0x1FC`） | `scene/ops.ts:1304`；`ops.ts:1300` 自认"台账保留（报告/快照要能看到）"；语料 0 处 | T-0154 |
| 11 | `SceneState.render4.primTransform` | **a 真死写**（`0x1FE`） | `scene/ops.ts:1318`；presenter 的 drawItem 几何**不看它** ⇒ `D3DXMatrixRotationAxis` 的旋转完全不生效；语料 7 处/5 文件（`src/SC0000.txt:16409` 是 185°） | T-0154 |
| 12 | `SceneState.render4.released3D` | **a 真死写**（`0x32A`） | `scene/ops.ts:1486`；3D 模型槽表未建模 ⇒ 只有账没有对象 | T-0154 |
| 13 | `SceneXform.maskA` | **a 真死写** | `0x22D` op1（`Scene[295]`）/`0x22F` op1（`Scene[297]`）：`ops.ts:1904/1933` 写，合成只用 `scale/translate/axisScale/axis/axisTranslate` | T-0154 |
| 14 | `SceneXform.maskB` | **a 真死写** | 同 `maskA`（`0x22D` op2 / `0x22F` op2，`ops.ts:1905/1934`） | T-0154 |

**a（真死写，写了没有任何生产读者）＝ 10 条**：1/2/3/4/5/10/11/12/13/14。
**b（扫描器认不出消费者 / 唯一读者只是诊断或测试）＝ 4 条**：6/7/8/9。
★两类里**没有一条**是"消费者经由 `ENGINE_FIELD` 家族常量 / 动态下标 / native 回调 / 快照与读档序列化"
而被误判 —— 本票**判出**的 b 类恰恰相反：它们的生产消费者**确实不存在**（诊断读者不算），
所以登记基线是对的，不属于"塞假阳性"。真正被本票**当假阳性改掉扫描器**的是另外两处盲区：
容器变更方法（`Engine.texSlotFlags` 修前连"写"都统计不到）与嵌套对象类型（`render4.*` 修前根本不扫）。

## 4. 未覆盖的盲区（如实披露，不假装闸门是完备的）

1. **Map/Set 型字段的数字键**：`Engine.engineValues` 的 `-248`（`0x248` 的 `dword_55052C`，
   审计 `src/vm/handlers/gfx-misc.ts:59` 那条）—— 键是运行期枚举的，静态判不出"这个键没人读"。
   要覆盖它需要一张"键 → 消费者"的登记表（或给 `EngineFieldMap` 加一个 get 侧探针）；
2. **只被测试读的字段**：扫描面刻意不含 `test/**`，所以"字段有读者但只在测试里"仍会被报成死写
   （这是**有意**的：测试读它只证明值写进去了，不证明生产路径消费了它）。代价是这类条目要靠人复核；
3. **经 `ENGINE_FIELD` 常量 / 动态下标的读写**：跨字段镜像（`Engine.x` ↔ `ENGINE_FIELD.y`）不识别；
   `Engine.dispatching` 就是这种形状（本票按"JS 侧镜像无读者"判成真死写，而不是塞进 ignore）；
4. **报告/诊断目录整体剔除**：`Engine.lastDispatch` 之类的诊断字段若哪天只剩报告读者，会被误报；
   目前它仍有宿主读者（`renderer/app/session.ts`），所以没进基线。
