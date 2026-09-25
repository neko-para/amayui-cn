# T-0160（Live2D 修缺批，P2 14 / P3 5）—— 变更记录

> 范围：`app/amayui-emulator/src/live2d/**`、`src/vm/handlers/live2d.ts`、`src/renderer/scene/ops.ts`（`scL2dTick` 一格）、
> `test/live2d-*.test.ts`（含扩展 `test/live2d-enabled-flag.test.ts`）、`dead-writes.baseline.json`（只收缩）。
> 引擎真源 = `engine/天结_unpacked.exe_utf8.c`（只读）。**未动**：`src/vm/engine.ts`、`src/vm/native.ts`、`src/vm/{msgwin,textItems,operandPlan}.ts`、
> `src/vm/handlers/{msgwin,gfx-texture}.ts`、`src/audio/**`、`src/text/**`、`src/tools/**`、`analysis/*.json`、`tickets/T-0160/ticket.json`。

## 0. 一句话结论

工作清单 19 条（P2 14 / P3 5）**全部处置**：16 条走代码修复（每条一个命名守卫，红→绿见 §2），3 条是台账条目本身的措辞/字段订正
（`live2d-enabled-config-flag` ×2、`lazy-572b-node-map` ×1，代码侧无改动，**待主 agent 应用**，见 §5）。
P2 14 条里 13 条代码可修、1 条（`live2d-enabled-config-flag` 的 stale-ledger）本质是台账漏记 E3 守卫；
P3 5 条里 3 条代码可修、2 条是台账 whySilent/name/reads 订正。

| # | sev | 对象 | kind | 状态 | 落点 |
|---|---|---|---|---|---|
| 1 | P2 | `0x341` | missing-branch | ✅ 修 | `assetLoader.loadModelIntoSlot` → handler 抛 `ShowMessageError` |
| 2 | P2 | `0x346` | approximation | ✅ 修 | `runtime.makeNode` 缺省轴 (0,0,0)、`l2dNodeReset` 不碰轴角 |
| 3 | P2 | `0x34a` | missing-behavior | ✅ 修 | `l2dNodeBaseOffset` 置 `Scene+46508` 锁存（不置 `+76`）+ `scL2dTick` 消费 |
| 4 | P3 | `0x34c` | host-invented | ✅ 修 | handler `p.float(6) ?? 0` |
| 5 | P2 | `0x34e` | missing-behavior | ✅ 修 | `startMotionOnSlot` → handler 抛 `ShowMessageError` |
| 6 | P2 | `0x34e` | missing-behavior | ✅ 修 | `L2dMotionRecord.textureNo/motionNo`（预置落 `+4/+8`） |
| 7 | P2 | `0x34e` | missing-branch | ✅ 修 | `startMotion` 只有槽 0 消费 `op4`（★审计语料数读错一格，见 §3.2） |
| 8 | P2 | `0x34f` | missing-behavior | ✅ 修 | 解码三分量 + 逐纹理下发 + `op2<0` 走既有宿主缝 |
| 9 | P2 | `0x350` | missing-behavior | ✅ 修 | `l2dResetMotion` 清 `+20/+21/+22`，门 = 模型非空 |
| 10 | P2 | `0x351` | missing-branch | ✅ 修 | `clampByte` + `v>0 ? v/255 : 0` |
| 11 | P3 | `0x351` | host-invented | ✅ 修 | 不建槽（门 = 槽存在且模型非空） |
| 12 | P2 | `0x352` | missing-branch | ✅ 修 | 不建槽（`l2dSetPending` 门同 §11） |
| 13 | P2 | `live2d-enabled-config-flag` | stale-ledger | 📋 台账 | §5.1（+ 扩展 `test/live2d-enabled-flag.test.ts`） |
| 14 | P3 | `live2d-enabled-config-flag` | overreach | 📋 台账 | §5.1（whySilent 订正） |
| 15 | P2 | `lazy-572b-node-map` | overreach | 📋 台账 | §5.2 |
| 16 | P3 | `0x341` | missing-behavior | ✅ 修 | 每次都真读；同槽重装 = 新实例（销毁+重建） |
| 17 | P3 | `0x341` | missing-consumer | ✅ 修 | 同上（动作队列/预置/乘色随 `sub_4785E0` 一并复位） |
| 18 | P2 | `0x34e` | missing-branch | ✅ 修 | 解析失败 ⇒ 坏记录留着、不入队；handler 抛错 |
| 19 | P2 | `0x34e` | missing-behavior | ✅ 修 | `+21/+22` 门与结算（`sub_4783D0` raw 92584-92602） |

---

## 1. 改了哪些文件

| 文件 | 改动要点 |
|---|---|
| `src/live2d/mtn.ts` | 新增 `L2dMotionRecord`；`L2dInstance` 加 `records/loop/loaded/mulColor/mulColorRaw/mulColors`；`startMotion` 按 `sub_478640` 逐句重写；新增 `motionQueueFinished`；`resetMotionQueue` 按 `sub_478500` 重写 |
| `src/live2d/runtime.ts` | `L2dNode.sceneDirty`（`Scene+46508` 锁存）+ 各写者置位；`makeNode` 缺省轴角；`l2dNodeReset` 不碰轴角；`l2dLoadModel` 整份换新实例；`l2dSetPending`/`l2dSetNamedParam`/`l2dTextureMulColor` 加"模型非空"门且**不建槽**；`clampByte`/`decodeL2dMulColor` 新增；`l2dAdvance` 加 `+21/+22` 门与结算；`l2dMotionCache` 变成**有读者的解析缓存** |
| `src/live2d/assetLoader.ts` | 三条装载路径**每次都真读文件**（`mocCache`/`mtnCache` 只缓存解析）；`L2dLoadFailure` + `L2D_FAIL_*` 原文串 + `onFail` 回调；`motionUsable`（`sub_4BCE90` 的等价物） |
| `src/live2d/render.ts` | 批次 `mulColor` 由"原始 int"改成**解码三分量**，且**按纹理号**取（`inst.mulColors`） |
| `src/vm/handlers/live2d.ts` | `0x341`/`0x34e` 失败抛 `ShowMessageError`；`0x34c` 缺 op6 取 0；`0x34f` 接 `NativeBridge.getDrawItemColor`（`op2<0` 的 `sub_4ADD60` 回退） |
| `src/renderer/scene/ops.ts` | `scL2dTick` 消费 `L2dNode.sceneDirty` → `SceneState.dirty` |
| `test/live2d-t0160.test.ts`（新） | 16 条命名守卫（§2 的红→绿用文件） |
| `test/live2d-enabled-flag.test.ts` | 扩展：加 `nodes` 断言（L2D 支建出节点 `0x14`、回落支 `l2dNodes` 空）+ 静默/抛错分界的注释 |
| `test/live2d-chain.test.ts` | 最小 retarget ×1（`inst.motions` → `inst.records.get(0)?.motion`） |
| `test/live2d-render.test.ts` | 最小 retarget ×1（乘色：原始 int → 解码三分量 + `mulColorRaw`；并订正"`0x80ff00ff` 是有符号负数 ⇒ 走回退支"） |
| `test/l2d-node-compose.test.ts` | 最小 retarget ×1（`0x346` 不再把轴角写回 `[0,0,1]`）+ 加强一条（设过轴角 ⇒ 复位后保留）；`resets` 1→2 |
| `test/l2d-node-transform-ops.test.ts` | 最小 retarget ×3（缺省轴 `[0,0,1]` → `[0,0,0]`：`:73` 的"缩放不得碰旋转"、`:134`/`:158` 的窗 `from`） |
| `dead-writes.baseline.json` | 移除 `Engine.l2dMotionCache`（14 → 13 条），`_removed` 里写清"选了给它真读者"及其语义 |

`git diff --stat`（仅本票范围）：`assetLoader +132 / mtn +159 / render +15 / runtime +229 / scene/ops +16 / handlers/live2d +62`（6 文件 +544/−69）。

---

## 2. 命令与红→绿证据

```powershell
# 绿（本票 16 条守卫）
cd app/amayui-emulator
node --import tsx --test test/live2d-t0160.test.ts
#  → ℹ tests 16 / pass 16 / fail 0 / skipped 0

# 相关既有守卫（8 个文件）
node --import tsx --test test/live2d-chain.test.ts test/live2d-render.test.ts test/l2d-node-compose.test.ts `
  test/l2d-render-pending.test.ts test/live2d-enabled-flag.test.ts test/live2d-deform.test.ts `
  test/live2d-moc.test.ts test/slot-load-l2d-reset.test.ts
#  → ℹ tests 62 / pass 62 / fail 0（含扩展后的 live2d-enabled-flag）

# ★最终全扫（11 个 L2D 相关文件 = 上面 8 个 + l2d-node-transform-ops / l2d-clear-on-container-ops / 本票新文件）
node --import tsx --test test/live2d-chain.test.ts test/live2d-render.test.ts test/l2d-node-compose.test.ts `
  test/l2d-render-pending.test.ts test/live2d-enabled-flag.test.ts test/live2d-deform.test.ts `
  test/live2d-moc.test.ts test/slot-load-l2d-reset.test.ts test/live2d-t0160.test.ts `
  test/l2d-node-transform-ops.test.ts test/l2d-clear-on-container-ops.test.ts
#  → ℹ tests 77 / pass 77 / fail 0 / skipped 0
```

**红（先红后绿）**：把本票 6 个 `src/**` 文件的**行为**逐点改回修前口径（保留新 API 面以便模块能加载），跑同一份守卫：

```powershell
node --import tsx --test test/live2d-t0160.test.ts
#  → ℹ tests 16 / pass 2 / fail 14
```

14 条红与 §0 表的 1–12、16–19 一一对应（红/绿的**数字与用例名**都内联在本节，不再外指临时目录）。
反转点（每条一句话）：`M1` MOC 只记日志不抛 · `M2` MTN 只记日志不抛 · `M3` 命中解析缓存就不读文件 ·
`M4a/M4b` 缺省轴 `[0,0,1]` + `0x346` 顺手写回轴角 · `M5` `0x34a` 不置脏 · `M6` `?? 1` ·
`M7a` 两个槽都消费 `op4` · `M7b` 不落 `0x352` 预置 · `M7c` 解析错也继续入队 · `M7d/M8` 建槽 + 不钳位 ·
`M9` 不逐纹理下发 · `M10` `0x350` 只清 `current` · `M11` 无 `+21/+22` 门与结算 · `M12` 往旧实例里塞字段。

其它收尾：

```powershell
# 本机 `npm run typecheck` 会因 node_modules 无 .bin 而报 'tsc' is not recognized ⇒ 直接调 tsc：
node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit            # exit 0
node node_modules/typescript/bin/tsc -p tsconfig.control.json --noEmit    # exit 0
node node_modules/typescript/bin/tsc -p tsconfig.electron.json --noEmit   # exit 0
node --import tsx src/tools/deadWrites.ts   # ★无新增死写；基线 14 → 13（Engine.l2dMotionCache 已移除）
node --import tsx --test test/no-dead-writes.test.ts   # 7/7
node --import tsx test/run.ts all          # 见 §6（基线 3 条红之外的新增红逐条归因）
```

> 本机 `npm run typecheck:test` 当前有 **1 条与并行 agent 相关的红**：`test/gfx-state-operand-io.test.ts(76,12)`
> `override set3DColor` 不在 `StubNative` 里（`0x33F` 的宿主缝正在被 `T-0153` 改）—— 不是本票引入，本票文件无 TS 报错。

---

## 3. 逐条（现象 → 引擎 raw → 改了什么 → 守卫）

### 3.1 `0x341`（审计 row 87 / 280 / 281）

- **现象**：`.MOC` 取不到或解析失败时只写一条 log、槽留空、脚本继续跑（引擎是组错误串 + 抛异常）。
- **raw**：`sub_427BA0` raw 34482-34491（`if (!v4) { sub_405/…; sub_408050(v7, 1024, "L2Dモデルファイル %s の読み込みに失敗しました", v8); _CxxThrowException(…Command_ShowMessage_Exception…) }`）；
  `sub_4A1860` raw 121674-121681（先 `sub_4785E0(旧)+delete+槽=0`，再 `new(0x4C)` + `sub_478330` 解析）。
- **改了什么**：`loadModelIntoSlot` 先删槽（= 旧实例被析构）、**无条件** `src.loadById`；失败走 `onFail`
  → handler 抛 `ShowMessageError('L2Dモデルファイル …')`（既有通路：粘文本 + 横幅 + 停止）。
  同一条路顺带修 row 280/281：重装 = **新的 `L2dInstance`**（`l2dLoadModel`），`records/current/loaded/loop/pending/mulColor` 全部回缺省。
- **守卫**：`live2d-t0160.test.ts` 的「0x341：.MOC 取不到/解析失败 ⇒ 抛 ShowMessageError」与
  「0x341：同一 id 重装必须真读文件 + 重建」。
- **未做**：引擎此时槽里留的是"解析失败的半成品对象"，emulator 没有坏模型表示 ⇒ 用"删槽 = 节点整块不出画"
  代替（与 raw 134320 的出画门同观感）。

### 3.2 `0x346` / `0x34a` / `0x34c`（审计 row 88 / 89 / 282）

- **raw**：`sub_4AFC40` raw 133952-134032（只写 `+20..35`/`+52..67`/`+84..99`/`+127..142` 四个**矩阵块** + `+76 = 0` + `_this[11627] = 1`）；
  `sub_49CA10` raw 118487-118490（缺省轴 `+464/+468/+472 = 0.0`、`+488 = 0`）；
  `sub_4AFFF0` raw 134129-134140（写 `record[2..4]` + `_this[11627] = 1`，**不写** `+76`）；
  `sub_4280D0` raw 34666-34669（op4/op5/op6 都是无条件 `sub_41C300`）。
- **改了什么**：`makeNode` 缺省 `rotation = {axis:[0,0,0],deg:0}`；`l2dNodeReset` **不再**写 `node.rotation`；
  新增 `L2dNode.sceneDirty`（`Scene+46508` 锁存），由 `0x344`/`0x346`/`0x347`–`0x34D` 的写者置位（逐条 raw 见 `runtime.ts` 字段注释），
  `scL2dTick` **取并集**转成 `SceneState.dirty`；`0x34a` **只**置这个锁存、不置 `+76`；`0x34c` 的 `?? 1` → `?? 0`。
- **守卫**：三条（缺省轴/复位保留；`0x34a` 置锁存且不置 `+76` + `scL2dTick` 消费；`0x34c` 缺 op6 = 0）。
- **订正（审计 row 88 的括号）**：审计把 `+52..67` 说成"旋转"、把缺省角写成 `-1`。按体：`+52..67` 是 `v4[52..67]` = 字节 `+208..271`
  的**旋转矩阵块**，轴角在 `+464..492`；`sub_49CA10` 里被写成 `-1` 的是 `+68`/`+72`（颜色窗那对格，`*(_DWORD *)(v2 - 420) = -1`，v2 = `a1+488` → `a1+68`；第二圈 → `a1+72`），
  不是角。行为修法不受影响（"0x346 不动轴角、缺省轴为 0"两条都成立）。

### 3.3 `0x34e`（审计 row 90 / 91 / 92 / 93 / 94 → 本票 5、6、7、18、19）

- **raw**：`sub_428200` raw 34722-34731（失败 ⇒ 组串 + 抛）；`sub_478640` raw 92815-92861（全文见 §0 引用）；
  `sub_4783D0` raw 92578-92615（`+21/+22` 门 → `sub_4BCCA0` 结算 → `sub_4BCB50` 推进）。
- **改了什么**：
  1. **模型对象**：`L2dMotionRecord{motion,textureNo,motionNo,loop,parseError}`，`L2dInstance.records` 取代 `motions`；
     `startMotion` 逐句对齐：门 `if(!inst.model)` → 建**新记录** → 解析错 `return false` → 落 `0x352` 预置（`+4`/`+8`）并清标志 →
     入队 → **只有槽 0** `sub_4784D0`（`inst.loop`/`rec.loop`）→ `+21`/`+22`。
  2. **推进入口门**：`l2dAdvance` 只在 `loaded[0]||loaded[1]` 时推进；`motionQueueFinished` 为真时按
     `+22 → +20（重入队 records[0] 的动作）→ +21=0` 结算（`sub_4BCCA0` 那一跳的语义在 `mtn.ts` 里登记为**未完全确证**）。
  3. **失败**：文件取不到 ⇒ 记录一格不动 + 抛；文件在但没解析出曲线 ⇒ 记录换成坏对象、不入队 + 抛。
- **守卫**：四条（MTN 失败抛错；预置落 `+4/+8`；只有槽 0 消费 `op4`；解析失败留坏记录 + `+21/+22` 门；结算/重入队）。
- **★订正（审计 row 92 的语料统计）**：审计写"语料 4 处 `i34e` 的 op2 = 0/0/0/2 ⇒ 只有 1 处走不消费支线"。
  实测（`Select-String src\*.txt`）四条是：
  `BTL.txt:1637 i34e (local-ptr 0) 0 (local-int d) 1`、`INFOEN.txt:1591 i34e (local-ptr 1) 0 0 1`、
  `TITLE.txt:554 i34e 5274 0 0 1`、`BTL.txt:2671 i34e (local-ptr 0) 0 2 1` ⇒ **op2 全是 0**，
  审计列出的 `d`/`2` 是 `op3`（实例槽）。⇒ 四条都走槽 0、都消费 `op4=1`，本修法对语料**零行为变化**（不是"1 处变化"）。
- **未做**：`parseError` 没有 SDK 那个错误标志位，用"一条曲线都没解析出来"当等价物（`assetLoader.motionUsable`，已登记为近似）。

### 3.4 `0x34f`（审计 row 95）

- **raw**：`sub_428400` raw 34794-34821（`v2 = readInt(2)`；`v2 < 0 ⇒ v2 = sub_4ADD60(Scene, readInt(1))`；
  `v6/v7/v8 = BYTE2/BYTE1/BYTE0 ÷ 255`；`sub_4A0790(slots, readInt(1), v6, v7, v8)` → `sub_478590` raw 92723-92743
  **逐纹理**（10 个纹理槽里非空的那个）`sub_4BD150`）；`sub_4ADD60` raw 132579-132588（查 `Scene+1032` 的绘制项，取 `+96`，缺项返回 **-1**）。
- **改了什么**：`l2dTextureMulColor` 解码成三分量（`decodeL2dMulColor`）并按**纹理号**下发（`inst.mulColors`，
  只对已有纹理槽）；`render.ts` 的批次按自己的纹理号取；handler 用**既有宿主缝** `NativeBridge.getDrawItemColor`
  实现 `op2 < 0` 的回退（缝返回 `-1` ⇒ 三分量全 1，与引擎缺项返回值一致）。
- **守卫**：`live2d-t0160.test.ts` 的 `0x34f` 两条（含"`0x80ff00ff` 是有符号负数 ⇒ 走回退"这一半）。
- **未做**：Pixi 合成端**还没有把乘色当 tint 用**（`presenter.ts` 目前不读 `L2dBatch.mulColor`）——见 §5.3。

### 3.5 `0x350` / `0x351` / `0x352`（审计 row 96 / 97 / 283 / 98）

- **raw**：`sub_478500` raw 92653-92664（`if (*(_DWORD*)_this) { sub_4BCD40(队列); *(_WORD*)(_this+21)=0; _this[20]=0; }`）；
  `sub_428320` raw 34756-34775（钳位 → `/255`）；`sub_478520` raw 92667-92674（`if (v3)`）；
  `sub_478540`/`sub_478560` raw 92677-92702（`if (*(_DWORD*)_this)` 门）。
- **改了什么**：`resetMotionQueue` 门 = 模型非空、清 `current`+`loaded[0..1]`+`loop`；
  `l2dSetNamedParam` 加 `clampByte`（`>255→255`、`<0→0`、`v>0?v/255:0`）且门 = 槽存在且模型非空；
  `l2dSetPending` 同门；两者都**不再** `ensureSlot`（旧行为会凭空建槽，下游出画判据因此不同源）。
- **守卫**：三条（`0x350` 门与三个清点；`0x351` 钳位 + 不建槽；`0x352` 不建槽）。
- **订正（审计 row 96 的括注）**：引擎**不**清动作记录的 `+36`（`sub_478500` 只清实例 `+20/+21/+22` + 队列管理器）；
  审计那句"动作记录上的循环位也没清"说的是 emulator 缺这一整块，不是引擎清了它。

### 3.6 `Engine.l2dMotionCache`（本票点名的存量死写）

- **选了哪种**：**给它一个真读者**（字段声明在 `src/vm/engine.ts`，属 T-0151 的 range ⇒ 不删字段）。
- **读者**：`assetLoader.startMotionOnSlot` 里 `host.l2dMotionCache.get(fileId)` 命中则复用已解析的动作对象
  （miss 才 `parseMtn`）；写点仍是 `runtime.l2dStartMotion` 的 `.set()`（另有 `l2dResetHost` 的 `.clear()`）。
  ★**读文件仍然每次无条件做**（引擎 `sub_4A19F0` raw 121732 的 `ReadFile`）⇒ 缓存只短路"解析"。
- **证据**：`node --import tsx src/tools/deadWrites.ts` → `★ 无新增死写`（且提示基线过期）⇒ 已把
  `dead-writes.baseline.json` 的 `Engine.l2dMotionCache` 移除（14 → 13），理由写进该文件的 `_removed`。
  `test/no-dead-writes.test.ts` 7/7。

---

## 4. 未做项 / 有意保留（逐条到 文件:行）

| 项 | 落点 | 为什么不做 |
|---|---|---|
| `0x345` 的失败支也抛 `ShowMessageError`（引擎 `sub_427CF0` raw 34542-34552 的 `L2Dテクスチャファイル %s…` + 抛） | `src/live2d/assetLoader.ts:142`（`bindTextureToSlot` 仍只记日志） | **不在本票清单**；语料 `i345` **437 处**，其中若有一个 id 在本资源树取不到，改成抛会把现有 e2e 链（`gameStartChain`/`config1Chain`/`scenarioBoot`）当场打断 —— 需要先有一次"哪些纹理 id 取不到"的实测再决定。**建议另开票**（同族、同一份 raw 依据）。 |
| Pixi 合成端把 `mulColor` 当 tint | `src/renderer/pixi/presenter.ts:291-357`（`drawL2d`，目前不读 `b.mulColor`） | ① presenter 属 `T-0155` 的 finding 面（并行占用风险）；② 分量→tint 字节序（`[BYTE2,BYTE1,BYTE0]` → Pixi `tint` 的 R/G/B）没有真机对照，做错是**新引入的可见错**。数据面已就绪（`L2dBatch.mulColor` 是解码三分量）。 |
| `sub_4BCCA0`（`motionQueueFinished` 的依据）的 SDK 语义 | `src/live2d/mtn.ts`（`motionQueueFinished` 注释） | 该函数在 Live2D 插件里、不在本 exe 的 `.c` 里；只能从 `sub_4783D0` 的调用形状反推（"`+22` 清了就完 / `+20` 还在就重入队 / 否则清 `+21`"）。已按结构实现并**登记为未完全确证**。 |
| `0x345`/`0x342` 的"槽不存在"门 | `src/live2d/runtime.ts`（`l2dBindTexture` 仍走 `ensureSlot`） | `0x345` 的 handler 不读门（引擎 `sub_4A1970` 直接把可能为 0 的槽指针交给 `sub_478370`）；清单只点了 `0x351`/`0x352`。改它同样有 §上条 e2e 风险。 |

---

## 5. 台账待应用（**主 agent 串行应用**；本 agent 未动 `analysis/*.json`）

### 5.1 `analysis/engine-capabilities.json` → `live2d-enabled-config-flag`（审计 row 48 + row 85）

> 现状（`capabilities.js --id live2d-enabled-config-flag`）：`emulator: partial / E1`，**无 `guard`**，note 里只提 `test/live2d-chain.test.ts`。

1. `emulator.evidence`: `E1` → **`E3`**（理由：`test/live2d-enabled-flag.test.ts` 用**真 boot 链 + 真资产**跑了 `a9d0` 两条支路，
   断言 `l2dSlots`/`l2dNodes`/回落槽 5 = `0x5273` —— 这是场景级断言，不是静态结论）。
2. `emulator.guard`: 空 → **`test/live2d-enabled-flag.test.ts`**（本票在该文件里补了 `nodes` 断言，见 §1）。
   若主 agent 想更精确，可用规格 `test/live2d-enabled-flag.test.ts#global a9d0`（`#` 后串必须出现在文件里，现文件含该串）。
3. `emulator.status`: `partial` **保持不变**（缺口仍在：无 E4 真机对照），但 note 里的"缺口①"要改：
   `global a9d0` 是**脚本 global 槽**、整个反编译产物 `grep a9d0` **0 命中** ⇒ 引擎侧**不可能**有"跳过 L2D 装载"的门，
   重写侧只要如实执行两条支路（已由上面的 E3 守卫钉住）。⇒ 建议删除"缺口①"，只留"无 E4"。
4. `whySilent`: 现文「引擎侧没有 L2D 初始化断言 ⇒ 缺 L2D 时不会被当成故障」**在体里不成立**（审计 row 85）⇒ 改成：
   「**开关关掉 / 不执行装载指令**才是静默的（走静态贴图，画面照样有）；**装载指令执行了却失败不是静默** ——
   `sub_427BA0` raw 34488-34491 与 `sub_428200` raw 34728-34731 都组『L2Dモデルファイル/モーションファイル %s の読み込みに失敗しました』
   并 `_CxxThrowException(Command_ShowMessage_Exception)`。那半边由 `test/live2d-t0160.test.ts` 的两条抛错守卫钉住。」

### 5.2 `analysis/engine-capabilities.json` → `lazy-572b-node-map`（审计 row 40）

> 现状：`能力: 572B 节点表（精灵/特效）惰性插入（表头 eager 130366/130384）`；`读的字段: Scene+1080, Scene+1084, Scene+1096, Scene+1100`。

1. `name`：删掉「（表头 eager 130366/130384）」—— 那两行是 **`Scene+1084`/`Scene+1100` 两个表哨兵节点的
   `operator new(0x250u)` 构造点**（raw 130364-130380 落 `_this+1084`、raw 130382-130398 落 `_this+1100`），
   与"1080 表头"无关。
2. `reads`：`Scene+1080`/`Scene+1084` 是**表对象指针**（1080 那张表的哨兵在 1084），真正被读的"表内计数"是
   **`Scene+1088`（1080 表）/`Scene+1104`（1096 表）**（raw 130365 `*(_DWORD *)(_this + 1088) = 0`、
   raw 130383 `*(_DWORD *)(_this + 1104) = 0`）⇒ 建议写成 `Scene+1080(表头)/+1084(哨兵)/+1088(计数), Scene+1096/+1100/+1104`。
3. `emulator.note` 里的"立绘那一半已建模"一句建议补一句：**572B 立绘节点表的写者现在还会置 `Scene+46508`**
   （`L2dNode.sceneDirty` → `scL2dTick`），与 §5.1 无关但同属本票；缺口（精灵/特效那一半）不变。

### 5.3 其它待应用的文档/注释

1. `src/vm/native.ts:450` 的注释「★只给 `0x203` 用」**已过期**：本票让 `0x34f`（`op2 < 0` 的 `sub_4ADD60` 回退，raw 34808）
   也走同一条宿主缝。`native.ts` 属 T-0153 的 range ⇒ 本票**没有动**，请由该 owner 改（改成"`0x203` 与 `0x34f`"）。
2. `analysis/opcode-gaps.json` 的 **`i341`（行 2552-2586）** 与 **`i34e`（行 2587-2626）** 两条 `partial`：
   其 `missing[]` 共 **4 + 5 = 9 条**全部由本票处置（逐条对应见下），按该文件的规矩"全部清空即改回 `implemented`"。
   - `i341` missing[0]（`a9d0` 无引擎侧对应物）：**建议删**，理由同 §5.1-3（`grep a9d0` 0 命中 ⇒ 非缺口；守卫在 `test/live2d-enabled-flag.test.ts`）。
   - `i341` missing[1]（MOC 失败抛错）→ 已修，删。守卫：`test/live2d-t0160.test.ts#0x341`。
   - `i341` missing[2]（动作队列/pending 随换装复位）→ 已修，删。守卫：同上「同一 id 重装」条。
   - `i341` missing[3]（`mocCache` 命中就不读文件）→ 已修，删（现在 `mocCache` 只缓存**解析**）。
   - `i34e` missing[0]（MTN 失败抛错）→ 已修，删。
   - `i34e` missing[1]（`+21/+22` 消费端）→ 已修，删。守卫：「`+21/+22` 的结算」条。
   - `i34e` missing[2]（`0x352` 预置落 `+4/+8`）→ 已修，删。
   - `i34e` missing[3]（只有槽 0 消费 `op4`）→ 已修，删（★顺带把该票审计 row 92 的语料统计订正为"四条 `op2` 全 0"，见 §3.3）。
   - `i34e` missing[4]（失败时坏对象留在记录里）→ 已修，删（`parseError` 标记 + 不入队）。
3. `analysis/engine-capabilities.json` → `live2d-node-draw-advance` 的 `emulator.note` 尾句
   「**缺口**：宿主合成循环还没把"绘制节点"与 l2dAdvance 接起来」**已过期**（`scL2dTick` 早在 T-0096 就把两者接上了）；
   建议改为"已接：`renderer/scene/ops.ts` 的 `scL2dTick`（两个宿主共用）；本票又补上 `+21/+22` 门与结算"，
   `evidence` 可升 `E3`（守卫 `test/live2d-t0160.test.ts#+21/+22`）。
4. `analysis/engine-capabilities.json` → `lazy-live2d-slot` 的 note 里「`attachModel` …（= 引擎"槽非空先析构再建"的惰性重建语义）」
   建议改成「重装 = **整份新实例**（`l2dLoadModel`；等价于 `sub_4785E0` + `delete` + `new`）⇒ 参数/部件显隐/动作队列/预置/乘色一并复位」。
5. `docs-new/03-engine/live2d.md`（叙述层，**本票没动**）里若仍写"`0x346` 把旋转复位成 axis=(0,0,1)""`0x34F` 只把原始 int 存在 -1 号键"
   "`0x352` 会用 `ensureSlot` 建槽"这三处，需要同步（本票已把代码口径改为 §3.2/§3.4/§3.5）。
6. `dead-writes.baseline.json` 已由本票收缩（`Engine.l2dMotionCache` 移到 `_removed`）—— 若 `T-0150` 的 owner 也在改这个文件，
   请以"只许收缩"为准合并。

---

## 6. `test:all` 归因

`node --import tsx test/run.ts all`（2026-09 本机实测）→ **tests 1400 / pass 1390 / fail 8 / skipped 2**。

| 失败的测试 | 文件 | 归因 |
|---|---|---|
| `★0x347：key(int) + 三分量 float ÷100 ⇒ node.scale` | `test/l2d-node-transform-ops.test.ts` | **不是断言红**：整份文件**加载失败** —— 并行 agent 正在改的 `src/vm/handlers/config-read.ts` 当时有语法错（esbuild `Transform failed … config-read.ts:218:70 Expected ";" but found "cfgStr"`）。该文件里 3 条缺省轴断言已由本票 retarget（见 §1），等 `src/vm/**` 的并行编辑落定后重跑复核。 |
| `★0x34B/0x34C/0x34D：`record[0] & 1` 门` | 同上 | 同上（同一份文件的加载失败） |
| `★0x34C：…⇒ wins.rotation` | 同上 | 同上 |
| `★E4：本机真槽全部解出…` | `test/save-slot.test.ts` | 基线红（`save-slot` 真槽 `format`）+ `T-0159` 正在改 `save-slot.ts`（同期还报过 `gameNameOf is not defined`） |
| `E4：真存档槽的头 → 0x1A0 的六个 u16` | 同上 | 同上 |
| `★真进程 --idle-sec 1：登记 → 秒级自停 → 记录被摘掉` | `test/host-registry.test.ts` | 与本票无关（实例注册表/宿主进程；同期有别的 agent 在跑实例） |
| `TITLE: mouse_callback 登记 -> get-input-type 时间节流派发` | `test/input.test.ts` | 与本票无关（输入族，`T-0158` 面）；同样受 `src/vm/**` 的加载失败波及 |
| `场景执行报告：产出 op 计数 / 模型快照 / 三张缺口清单` | `test/scene-report.test.ts` | 基线红（可绘制项 24 ≤ 缺纹理项 26） |
| （基线第 3 条：`engine-slot` SAVE70/71 `storedDwords`） | `test/engine-slot.test.ts` ×1 | 基线红（CONTEXT §6） |

⇒ **本票没有引入新的断言红**：3 条基线红 + 2 条与本票无关的并行红（host-registry / input）+ 3 条"外部文件语法错导致的整份加载失败"。
本票自己的 16 条守卫与 8 个相关既有文件在**同一份代码**上跑过 **62/62 绿**（§2）；`test:all` 那一次的 3 条 L2D 红全部是加载失败，不是断言失败。

> ⚠️ 交给主 agent 的两件事（都不在本票 range）：① `src/vm/handlers/config-read.ts` / `src/vm/engineFieldIds.ts`
> 的并行编辑会让**任何**导入 `src/vm/ops.js` 的测试整份加载失败（含 L2D 族）；② 该状态下的 `npm run typecheck` 也会红。
