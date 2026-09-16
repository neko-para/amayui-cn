# T-0054 · 过程笔记（notes.md）

> ★**评估正文（Live2D 系统能力速查 / ★要不要引依赖库的三路线比对 / 工作量 / 分阶段计划 / 待拍板项）
> 已单独成文 → `docs-new/04-app/live2d-support-assessment.md`。**
> 本页只保留**这张单自己的东西**：范围与产出、决策记录（拍板后追加）、acceptance ↔ 阶段对照、复核命令。
> **不把评估正文抄回来**（会两处漂移）。

---

## 1. 本单范围与产出（M0，已完成）

- **范围**：先评估「支持 Live2D 要不要引入额外的依赖库、这套 Live2D 系统大概有什么能力」，再按 M1/M2/M3 落地（判据见 `ticket.json` 的 acceptance）。
- **产出**：
  - 评估正文：`docs-new/04-app/live2d-support-assessment.md`（系统能力 / 依赖路线 / 工作量 / 计划 / 待拍板）；
  - 引擎语义长文：`docs-new/03-engine/live2d.md`；
  - **格式长文（验收 #2 ①）**：`docs-new/03-engine/live2d-moc-format.md`（每条格式事实标 S1/S2/S3/O/E 来源）；
  - 数据层：`analysis/functions.json` 新增 **44 条** L2D 条目；`analysis/engine-capabilities.json` 的 5 条 Live2D 条目全部重评（见 §6）；
  - 变形语义报告（oracle 专项）：`analysis/live2d-deform-semantics.md`（856 行，逐条带 raw 行号）；
  - 本单（`ticket.json` + 本文件）。
- **结论一句话**：内嵌 SDK **2.0.06 for DirectX**（Cubism 2.x）；资产 `.MOC/.MTN/PNG`，**无需 `.model.json`、无需 moc3 转换**；**推荐自研移值**（无新依赖、可 headless）；唯一待拍板 = **是否接受把 `live2d.min.js`（专有运行时）随补丁再分发**。

---

## 2. 决策记录（拍板后在此追加，一条一次）

| 日期 | 决策 | 依据 / 影响 |
|---|---|---|
| 2026-09（评估） | 评估结论：**不引 Cubism 5**（只吃 moc3）；**B（`live2d.min.js`）仅作一次性对照 spike**；**主线走 C 自研移值** | 见评估文档 §3（四条判定标准 + 三路线表） |
| **2026-09-16** | **用户拍板：按 C（自研移值）实施**；参考源纪律 = **规范优先 / 资产实证兜底 / 反汇编只当 oracle**（`.moc` 字节布局无公开规范 ⇒ 用 335 个样本逼格式，反汇编降级为 oracle） | 评估文档 §3.3/§3.5；许可项（`live2d.min.js` 再分发）随之作废；本单转 `doing` |
|  |  |  |

> 追加格式：`\| YYYY-MM-DD \| 决策 \| 依据/影响 \|`。拍板后同时回写评估文档 §3.3/§6 与 `docs-new/03-engine/live2d.md` §7 的一句话结论。

---

## 3. acceptance ↔ 阶段对照

| acceptance | 阶段 | 状态 | 备注 |
|---|---|---|---|
| #1 | **M0 → M1 前置** | ✅ | 依赖路线定案（评估文档 §3） |
| #2 ① | **M1 格式长文** | ✅ | `docs-new/03-engine/live2d-moc-format.md`（S1/S2/S3/O/E 逐条标注） |
| #2 ② | **M1 解析不变量测试** | ✅ | `test/live2d-moc.test.ts`：**335/335** 逐字节 + 结构不变量全绿 |
| #2 ③ | **M1 资源直读 + 出画** | 🟡 部分 | 资源直读已通（`.MOC`/PNG/`.MTN` 按统一 id 从 `raw/` 直读，`test/live2d-chain.test.ts`）；**headless 快照已能导出节点/槽/变形几何**；**Pixi 侧三角网格出画未接**（见 §5.1） |
| #3 | **M2 装载/绑定/推进** | ✅ | 5 条 opcode 语义全落地 + `.MTN` 解析 + 入队 + **`scL2dTick` 已接进两个宿主的 `advanceModel`**（只在"这一帧真要画的节点"上推进，与引擎 raw 92578-92615 同口径） |
| #4 | **M3 集成/门控** | ❌ | `global a9d0` 未真读；`live2d-slot-probe` 未接进 `sceneNeedsRender` |
| #5 | **M3 验证** | 🟡 部分 | E3 已做（`test/live2d-chain.test.ts` + 两条解析/变形守卫，共 9 条断言组）；**E4 真界面截图未做** |
| #6 | **M3 文档** | ✅ | `opcode-table.md` 的 `0x344/0x345/0x34E` 订正 + `0x34F/0x350/0x351` 转「已核对」；`stub-reaudit-2026-09.md` §1.2 加改判注记（Live2D 一行整条划掉 + 理由） |

---

## 4. 本次（2026-09 续做）实际改了什么

**★解析器修了两个"字节流全对、语义全空"的静默 bug**（这是 M1 的真正突破点）：

1. **refno 表只登记了部分 kind**：`sub_4C7220` 在**每个**对象读完都写表（raw 152637），而实现只对 id/字符串/数组调 `reg()` ⇒ `AffineEnt(69)`/`ParamPivots(67)`/`PivotManager(66)`/`PartsData(133)`/`DrawData(70)`/`BDBoxGrid(65)` 在表里是空洞 ⇒ 指向它们的 refno 全解析成 `undefined`。
   **症状**：`BDAffine.affines` 恒为 0（4085/4085）、`PivotManager.params` 恒为空 —— 而**字节恰好读完**，所以字节级检查抓不到。
2. **复合对象缺 `kind` 判别字段**：`readAffineEnt()` 返回的对象没有 `kind`，而消费侧 `filter(kind === 'affineEnt')` ⇒ 全被滤掉（同一个症状）。

修完之后（E：335/335）：
```
BDAffine.affines.length == pivotOpacities.length == ∏pivotCount   （4085/4085）
DrawData.pivotPoints == pivotDrawOrders == pivotOpacities == ∏pivotCount （6686/6686）
pivotCount 取值 {2,3,4,5,21}；单对象最多 5 个参数（3^5 = 243 档）
```

**其余落地**：
- `live2d/deform.ts`：仿射（`T·R·S`，反射并入缩放符号）、**BDBoxGrid = 两轴各自 Bernstein 次数的张量积**（次数 = 控制点数−1，不是固定双三次）、pivot 组合下标（`params[0]` 最快变化）+ 分区间线性插值、`evaluateModel` 顶点生成。
- `live2d/mtn.ts`：`.MTN` 解析（`$fps/$fadein/$fadeout` + 等间隔曲线 + `VISIBLE:` + `LAYOUT:`）+ 播放态 + 淡入淡出权重 + `advanceMotion`。
- `live2d/runtime.ts`：10 实例槽 / 572B 节点 / 动作缓存三张表的纯逻辑（挂在 **`Engine`** 上，不是 `SceneState` —— 见 §5 的取舍）。
- `live2d/assetLoader.ts`：按统一文件 id 读 `.MOC`/PNG/`.MTN` 并接上运行态（两个宿主共用一份）。
- `vm/handlers/live2d.ts`：**18 条 opcode 全落地**（`LIVE2D_OPS` 14 条 + `LIVE2D_NATIVE_OPS` 3 条；`0x343` 不在本族）。
- 守卫：`test/live2d-moc.test.ts`（2 条）、`test/live2d-deform.test.ts`（5 条）、`test/live2d-chain.test.ts`（2 条，E3 真资产）。
- **接线（宿主侧）**：`SceneState.l2dHost` 挂 `Engine`（两个宿主各挂一次引用，读的是**同一份**运行态）；
  `scL2dTick(scene, nowMs)` 进两个宿主的 `advanceModel`；`scSnapshot(scene, clock, host)` 导出 `l2d` 段
  （槽 / 节点 / 可画节点的变形几何外接矩形）+ `snapshotToText` 的 `l2d-slot` / `l2d-node` 行。

**顺带订正的既有判断**：
- `0x344` 不是"纹理槽变换"而是**建/绑 572B 立绘节点**（`record[1] = L2D 实例槽号`）⇒ 从 `GFX_TEXTURE_OPS` 移出。
- `0x345` 不是"图形/3D 模型加载"而是 **L2D 纹理装载**。
- `0x346`–`0x34D`/`0x34F`–`0x352` 原先当 `ENGINE_INTERNAL_OPS` no-op；**"无模型时天然无输出 ⇒ no-op 安全"只对画面成立、对模型不成立**（它们写的是节点字段，跳过 ⇒ 节点表永远空）⇒ 全部转真实现。
- `version > 10` 被引擎**直接拒绝**（raw 143882/143912）⇒ 删掉按社区 SDK 写的 `version >= 11` 分支（clipId）。
- `deform.ts` 的坐标系注释订正为 **y 向下、原点画布左上**（投影 `OrthoLH(w,-h,-1,1)` raw 134354）。
- 顶点工作缓冲是 `{x,y,alpha,u,v}` **5 float/顶点**（O: raw 152897/153207），上传只取前 3 个做位置流。

---

## 5. 未完成 / 下一步（按优先级）

### 5.1 ★还差"最后一段"：把变形几何画到 Pixi 上

- **已完成**：`live2d/deform.ts` 能把参数求值成"每个网格的画布坐标顶点 + UV + 索引"；
  `scL2dTick` 已在两个宿主的 `advanceModel` 里推进动作；headless 的 `snapshot()` 已导出
  `l2d` 段（槽 / 节点 / **可画节点的变形几何外接矩形**）⇒ **可断言、可回归**。
- **未完成**：Pixi 侧还没有把 `evaluateModel` 的结果画成三角网格 —— 即"标题立绘真的出现在屏幕上"。
  路径已经清楚：`engine.l2dNodes` → `l2dNodeDrawable` → `evaluateModel` → 每个 textureNo 一个
  Pixi Mesh（顶点 = 画布坐标 + 572B 节点的平移/缩放，UV 来自 `dd.uvs`，索引来自 `dd.indices`，
  纹理按 `inst.textures.get(dd.textureNo)` 取 PNG）。
- **注意**：`presenter.ts` 现在是"按 DrawItem/Mesh/文本各画一遍"，L2D 是**第四类图元**，
  层序要与四路归并一致（引擎里 572B 节点也走同一次归并，见能力条目 `render-merge-two-pass-reorder`）。

### 5.2 其余

1. **M3 门控**：`global a9d0` 真读 + 把"10 槽里有没有活模型"接进 `sceneNeedsRender`（能力条目 `live2d-slot-probe`）。
   - 注意 `sceneNeedsRender` 是**共享场景层**函数，而槽表在 VM 层 ⇒ 现在通过 `SceneState.l2dHost` 这个引用够了。
2. **E4**：Electron 真界面截图（TITLE 的 L2D 支）并与 `a9d0 != 0` 静图回落支对照。
3. **脚本台账**：`SETL2DMOC` 家族未登记（560+ 处 `i34x`）；`INFOEN` / `BTL` 的 L2D 段未登记（`INFOIT` 1 处）。
4. **`0x348` 的 op3**（汇总参数）语义未逐行确证 ⇒ `PARTIAL`。
5. **多参数同时插值（`m ≥ 2`）未实现**：E 实测本作语料不可达（`params.length ≥ 2` 的网格只有 97 个且取值总在端值），写成注释而非静默。
6. **`DrawData.pivotPoints` 是否已含 BDAffine 变换**：当前实现按"点是局部坐标、BDAffine 再变换"；
   E4 对照后若发现双倍变换，改法是"不叠乘最内层"（`deform.ts` 的 `evaluateModel` 注释里写了）。

---

## 6. 能力条目（第二层）本次的重评

| id | 之前 | 现在 | 依据 |
|---|---|---|---|
| `lazy-live2d-slot` | absent / E1 | **modeled-unverified / E3** | `Engine.l2dSlots` = 10 槽表；`attachModel` 做"槽非空先析构再建"；守卫 `test/live2d-chain.test.ts` |
| `l2d-node-draw-gate` | absent / E1 | **modeled-unverified / E3** | `l2dNodeDrawable` 逐字复刻 raw 134320；守卫同上 |
| `live2d-node-draw-advance` | absent / E1 | **modeled-unverified / E3** | `l2dAdvance` 只由节点绘制驱动；`.MTN` 的 `$fps/$fadein/$fadeout` 生效；守卫同上 |
| `live2d-enabled-config-flag` | absent / E1 | **partial / E1** | 装载链已通（`i341/i345/i34E` 真实现），但 `a9d0` 仍未被真读（M3） |
| `live2d-slot-probe` | absent / E1 | absent / E1（**未动**） | 运行态有了，判据还没接进 `sceneNeedsRender` |

> 三条升 `modeled-unverified` 而非 `modeled-verified` 的理由：**判据已实现且有 E3 守卫，但两个宿主的合成路径还没调用它们** ⇒ 只算"已建模"，不算"已核验到画面"。

---

## 7. 复核命令（改数据层/文档后必跑）

```bash
node scripts/build-capabilities.mjs                                            # 第二层渲染物
node .agents/skills/amayui-engine-analysis/scripts/capabilities.js --validate
node scripts/build-scripts.mjs                                                 # 第三层渲染物
node .agents/skills/amayui-engine-analysis/scripts/scripts.js --validate
node scripts/build-tickets.mjs                                                 # 看板
node .agents/skills/amayui-ticket-ledger/scripts/tickets.js --validate
cd app/amayui-emulator && npm run verify
```

---

## 8. 互链

- **评估正文**：`docs-new/04-app/live2d-support-assessment.md`（本单的"要不要引依赖库 / 系统大致能力"都在那里）
- 引擎语义长文：`docs-new/03-engine/live2d.md`
- **格式长文**：`docs-new/03-engine/live2d-moc-format.md`
- 变形语义报告（oracle 专项）：`analysis/live2d-deform-semantics.md`
- 数据层：`analysis/functions.json`（`report.js --find live2d`）、`analysis/engine-capabilities.json`（`capabilities.js --subsystem Live2D`）、`analysis/scripts.json`（`scripts.js --id TITLE`）
- 相关票：**T-0051**（E4 真界面待验证清单 —— 本单的 E4 项可挂在那里）
- 被本单改判的旧结论：`docs-new/03-engine/stub-reaudit-2026-09.md` §1.2（Live2D 一行已划掉并注明改判理由）
