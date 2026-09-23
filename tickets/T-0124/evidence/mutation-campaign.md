# 变异实测（mutation testing）：全量 1078 个用例对「引擎语义改坏」的反应

> 目的：**客观区分「守卫」与「冗余/空洞」**。做法是把**一处引擎语义**改坏（只改一处、可精确还原），
> 跑**全量** `node --test`，记录红了多少、**哪些文件**红。
> **零红 = 覆盖空洞**（没有任何测试能发现这处语义被改坏）。
>
> - 脚本：`.tmp/test-audit/mutate.mjs`（每条在 `try/finally` 里还原；跑完核对 `git status` 为空 —— **已核对**）
> - 原始 TAP：`.tmp/test-audit/mutations/<M*>.tap`（12 条）
> - 用例名 → 测试文件的映射：`.tmp/test-audit/summarize-mutations.mjs`（TAP 不带文件名，按用例名字面量反查）
> - 跑的时间：2026-09-23 12:19–12:39（本机）；每条一轮全量约 53–145 s

---

## 0. ★一个必须先说清的测量伪影

每一条变异都有一个**恒定 +1 的伪阳性**：

```
not ok 1036 - 看板与真源同步（忘跑 build-tickets.mjs 会红）
```

原因是：本票（T-0124）与它的 6 张后续票是在变异跑之前建的，但 `tickets/README.md`（看板）**还没重跑 `build-tickets.mjs`** ⇒
`ticket-ledger.test.ts` 的"看板与真源同步"这一条**在变异开始前就已经是红的**。
⇒ 下表里 **`ticket-ledger.test.ts` 的 ×1 一律是伪影**，已从"真抓到它的文件"里剔除。

（同一文件里另有两条是**真判据**，例如 M2 触发的 `★证据锚点棘轮` 就是 T-0102 锚在
`src/vm/handlers/msgwin.ts` 的 `fill: hex6(bgrToRgb(v(21664, 0xffffff))),` 上 —— 这正是台账锚点棘轮设计意图的现场演示。）

> 事后已重跑 `build-tickets.mjs`，`tickets.js --validate` 绿（128 张票，9 条既有 ⚠），`ticket-ledger.test.ts` 6/6 绿。

---

## 1. 结果表

| # | 变异（改坏了什么） | 目标语义 | 原始 fail | **真 fail** | 真正抓到它的文件（×用例数） | 判定 |
|---|---|---|---|---|---|---|
| **M1** | `bits.ts` 去混淆旋转 11→12 | int 池读写（最广） | 205 | **204** | **61 个文件**（top：config1-chain ×12、game-start-chain ×12、op-147 ×11、l2d-node-transform-ops ×9 …） | 全仓级守卫 ✅ |
| **M2** | `msgwin.ts` 取色少翻一次字节序 | T-0102 判据 4（COLORREF→RGB） | 8 | **5**（+T-0102 锚点 ×1 +伪影） | text-style-snapshot ×4、adv-name-color-chain ×1 | 3 处守卫（含真语料 E3）✅ |
| **M3** | `textureCache.ts` 清槽记录时连 `#slotImgid` 一起清 | T-0102 白底根因 | 2 | **1** | clear-slot-records-keeps-bindings ×1 | **单点**守卫 ✅ |
| **M4** | `layout.ts` 换行步进丢掉行间距 | T-0038 行距 | 3 | **2** | text-layout ×1 | **单点**守卫 ✅ |
| **M5** | `engine.ts` 等待泵改用手持态刷子 | T-0027 单击连翻页 | 3 | **2** | adv-msgwin ×2 | **单点**（同文件两例）✅ |
| **M6** | `input.ts` 键盘按下沿少并 bit0/bit1 | 键盘掩码 | 2 | **1** | keyboard-mask ×1 | **单点**守卫 ✅ |
| **M7** | `presenter.ts` 绘制项排序方向反转 | z 序（layer 排序） | 1 | **0** | —— | ★★**零覆盖** |
| **M9** | `deform.ts` Live2D 变形网格行列互换 | 网格取点几何 | 2 | **1** | live2d-deform ×1 | **单点**守卫 ✅ |
| **M10** | `audioEngine.ts` BGM 文件名 +1 | 曲号→文件名 | 7 | **6** | audio-engine ×3、audio-bgm-naming ×2、audio-node-host ×1 | 3 文件守卫 ✅ |
| **M12** | `snapshot.ts` 快照的"可绘制项"恒为空 | 快照计数 | 1 | **0** | —— | ★★**零覆盖** |
| **M13** | `crc32.ts` 查表移位 25→24 | CRC32(MSB) | 4 | **3** | engine-slot ×1、gallery-bgm-list ×1、keyboard-scenario-menu ×1 | 3 文件守卫 ✅ |
| **M16** | `control/control.ts` 指令码去掉前导零 | 面板 `0x0b5` 防混读（2026-09 用户实测修的那条） | 1 | **0** | —— | ★★**零覆盖** |

---

## 2. 三条"零覆盖"（本次最值钱的客观发现）

| # | 语义 | 证据 | 该补什么 |
|---|---|---|---|
| **Z1** | **`ScenePresenter` 的绘制项 z 序排序方向**（`src/renderer/pixi/presenter.ts:179`）被反转 ⇒ **没有任何测试红** | `M7.tap` 里唯一的失败是看板伪影 | 一条断言"同 `layer` 与跨 `layer` 的实际出画次序"的行为用例（现有 `blend-mode`/`draw-item-*` 都只看单点属性，不看**次序**） |
| **Z2** | **`scSnapshot` 的"可绘制项"恒为空** ⇒ 没有任何测试红 | `M12.tap` 同上；印证 G1 的判断：`scene-report.test.ts:43-45` 的 `placeholderItems = drawItems.length - drawable.length` 是**恒等式**（`src/renderer/scene/snapshot.ts:419` 就是这么算的），三条断言分别断 `drawItems/drawable/placeholder` 时**同增同减**，抓不到 `drawable` 内部被改空 | 把 `scene-report.test.ts:43-45` 换成**独立期望**（例如"某场景下 drawable 必须 ≥ N"，N 由真语料给出） |
| **Z3** | **`control/control.ts` 的 `opHex()` 前导零**（`:38-43`）被删 ⇒ 没有任何测试红 | `M16.tap` 同上 | `control/**` 目前**零测试覆盖**。至少补一条 `opHex` 的纯函数用例（`0x0b5 → '0x0b5'`，而不是 `0xb5`），把 2026-09 用户实测踩过的那条结论钉住 |

★注意 Z1/Z2 都是**渲染/快照**侧，Z3 是**控制面板**侧 —— 这与分组审计的结论一致：
**覆盖面最薄的三块正好是"没有单测传统"的三块**（Pixi 出画次序、快照派生量、`control/` + `electron/`）。

---

## 3. 两条"冗余度"观察

1. **多数语义是"单点守卫"**：M3/M4/M5/M6/M9 各自**只有一个文件**（或同一文件里的 1~2 例）能发现改坏。
   ⇒ 结论与"删掉重复覆盖不损失检出"**不矛盾**：能删的是**同一不变量的第 2、3 份**（G1~G7 逐条给了替身位置），
   而不是"每个不变量只有一份"这件事本身 —— 后者恰恰说明**不该按"看起来重复"批量删**。
2. **只有 4 处变异被 ≥3 个文件抓到**（M1 / M2 / M10 / M13），其中 M2 的 `text-style-snapshot.test.ts` 是
   **独立 oracle**（逐字复刻 raw 79666 位表达式 + 真机 `SAVE.DAT` 调色板），M13 的 3 个文件里
   `engine-slot` / `gallery-bgm-list` 是**真语料**。⇒ **多守卫的地方，强的那个通常有独立 oracle**。

---

## 4. 实测订正与印证（与分组报告的对照）

| 分组报告的判断 | 变异实测的结论 |
|---|---|
| G1：`scene-report.test.ts:45` 是恒等式，改坏 `drawable` 抓不到 | ✅ **印证**（M12 真 fail = 0） |
| G3：删 `opHex` 的 `padStart` ⇒ 它审计的 24 个文件全绿 | ✅ **印证**（M16 真 fail = 0；且**全仓**都抓不到 —— `control/` 零覆盖） |
| G6：`save-data.test.ts:94` 的 `crc32MsbFirst(v) === msb` 是自证，抓不到表坏 | ✅ **印证**（该断言没红）—— 但 **M13 仍被另外 3 个文件抓到** ⇒ 该断言是**冗余**，不是唯一守卫 |
| G2：`call-frame.test.ts:81` 是"同义反复" | ❌ **不成立**（见 `verification-log.md` §B1：它是"重载不得清全局池"，只是结构上几乎不可证伪） |
| G4：`overlay.test.ts:121` 未 await ⇒ "永不红" | ⚠️ **过强**（见 `verification-log.md` §B2：实测 `fail 1`，但归因为"测试结束后产生异步活动"） |
| G5：`texture-lifecycle.test.ts:58-68` 删掉 `pixiBackend.ts:1468` 的 `collectGarbage()` 会全绿 | 未做变异（本次未抽到该点）；**保留为待验** |

---

## 5. 方法本身的价值（为什么建议把它变成常规闸门）

- 12 处变异里有 **3 处**暴露了"零覆盖"（25%），而这 3 处在 7 份静态审计报告里只有 2 处被**推测**到（Z2/Z3），
  Z1（z 序）**没有任何一份报告点出来** —— 静态读码看不出"排序方向反了没人管"。
- 与此同时它**推翻/修正**了 2 条静态结论（`call-frame:81`、`overlay:121`）⇒ 变异是**双向**的：既不放过空洞，也不冤枉守卫。
- 成本：12 条 × ~1.5 min ≈ **20 min**，且**完全离线**（不需要 Electron/人）。
  ⇒ 建议按 `T-0126` 落成 `npm run mutate`，作为"清理/重构之后"的常规档（不是每次提交都跑）。


---

## 6. 2026-09-23 复跑与订正（T-0125 / 闸门 E）

首次实测（§1 表）里有 **一条无效变异** 和 **两条已闭合的零覆盖**，全部在这一节订正；同时把清单做成了可复跑的闸门。

### 6.1 ★订正：`M7`（绘制项 z 序）的原始变异是**语义等价**的

首测把 `presenter.ts:179` 的 `[...scene.drawItems.values()].sort((a,b)=> a.layer-b.layer || a.handle-b.handle)`
反转，得到"全量无一红"，并据此判定 Z1 零覆盖。复跑发现**那处不是权威排序**：

```ts
// presenter.ts:365 —— 真正的归并排序（决定"谁盖住谁"）
entries.sort((a, b) => a.key - b.key || a.order - b.order);
```

`:179` 那三行只决定**等键（同 layer）时**喂给 `entries` 的初始次序，而我的变异保留了 `|| a.handle - b.handle`
⇒ 对同层项的相对次序没变、对不同层项又被 `entries.sort` 重新排过 ⇒ **改与不改结果相同**（实测：注入后
`root.children` 的 x 序列一字不变）。⇒ 首测的 Z1 结论方向对、但**依据无效**。

**重做**：变异改到权威排序上（`b.key - a.key`），并新增 `test/render-draw-order.test.ts`（2 例：正序 + 反向自检）：

| 口径 | 结果 |
|---|---|
| 新用例 `render-draw-order.test.ts` | **2/2 红** ✅ |
| 旧的 `draw-item-*` / `blend-mode` / `layer-direction` / `transition-render-wiring`（47 条） | **仍然 0 红** |

⇒ **Z1 是真缺口**（原结论成立），已由 `render-draw-order.test.ts` 闭合；变异也换了依据（`M7_draw_order_reversed`
现在打的是 `entries.sort`）。**教训**：写变异时必须先问"这处改动在运行时真的可观测吗"——否则"零覆盖"是假象。

### 6.2 已闭合的两处零覆盖

| 原判 | 闭合方式 | 证伪（现在会红吗） |
|---|---|---|
| **Z2** 快照 `drawable` 恒空 ⇒ 无一红 | `scene-report.test.ts` 的恒等式旁边补**独立下限**（`drawableItems >= 20`、`drawableItems > placeholderItems`；实测 32/24/8） | 注入 `drawable = []` ⇒ **红**（原来绿） |
| **Z1** z 序（同上，见 6.1） | 新增 `test/render-draw-order.test.ts` | 注入权威排序反转 ⇒ **2/2 红** |

**Z3**（`control/control.ts` 的 `opHex()` 前导零）仍然零覆盖，已登记 `T-0127`（补 `control/` 层最小测试）。

### 6.3 新增两条变异 + 一条错 oracle 的证伪

| 变异 | 语义 | 结果 |
|---|---|---|
| `M12_engine_config_voice_bool` | `sound:Voice` 少一步布尔化（引擎 raw 23695 = `v != 0`） | **1 条红**（`engine-config.test.ts`）。★这条变异**此前被测试挡着**：旧期望 `get(21293)===2` 与 raw 相反（T-0125），修掉后它才成为真守卫 |
| `M13_ophex_padstart_removed` | 面板指令码去前导零 | 零覆盖（= 原 Z3，登记 T-0127） |

### 6.4 闸门 E：`npm run mutate`（定向子集，实测 55.6 s）

清单 `app/amayui-emulator/test/mutations.json`（13 条）；判据：

- `expectCatch` 非空 ⇒ 跑那组文件，**至少 1 红**；全绿 ⇒ 闸门失败（"守卫丢了"，不是"测试少"）；
- `knownGap` ⇒ 只记录，并在**被覆盖之后提醒翻牌**；
- 每条跑完**自动还原并逐字节核对**（还原失败立刻抛）。

实测输出：**caught 12 / known-gap 1**，`✅ 闸门 E 通过`。`--all` 是"发现模式"（每条跑全量 1085 例，约 1.5 min/条）。
