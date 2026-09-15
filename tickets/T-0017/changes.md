# T-0017 · 过程文档（changes.md）

## 2026-09-15


## 第 1 次变更（2026-09，实施）

### 结论先行
混合选择子**已按引擎语义建模并接线到渲染器**；实施中发现一条与真机可见行为矛盾的"状态泄漏"读法，
**完整实现但默认关闭**，并开票 `T-0041` 追踪（见下"未收敛"）。

### 改了什么
1. **新增共享模型** `src/renderer/scene/blend.ts`（不依赖 Pixi）：枚举 → `normal/add/none/subtract`、
   值 2 的**门控**、以及逐项状态机 `walkBlendSequence()`（含"泄漏"档）。
2. **补齐两条此前完全没实现的指令**（它们是混合模型的两个输入）：
   - `0x20D` **set-render-target**（`sub_423770` raw 31594-31602，argc=1；语料 **841** 处）→ `scene.render4.renderTargetSlot`；
   - `0x33F` **set-scene-blend**（`sub_427A90` raw 34411-34448，argc=3）→ `scene.render4.sceneBlend`（`Scene+1260`）。
   - `0x1F8` 的 op4（纹理创建模式，`CTexture+1048`）也落进 `scene.render4.slotModes`（两个宿主都在 `createTexture` 里记）。
3. **宿主接线**：`native.setRenderTarget`/`setSceneBlend`（`native.ts` + `nativeTap` 白名单 + `stubNative` +
   `headlessScene` + `pixiBackend`）；`pixi/presenter.ts` 把每项算出的档写进 `spr.blendMode`/`g.blendMode`（文本精灵按 draw-item 规则）。
4. **Pixi 侧注册两个自定义混合档**（`pixiBackend.ts` 的 `installD3DBlendModes()`）：
   `d3d-opaque = [ONE, ZERO]`、`d3d-rev-subtract = [ONE,ONE,ONE,ONE,FUNC_REVERSE_SUBTRACT,FUNC_REVERSE_SUBTRACT]`。
   ★**实测踩坑**：Pixi 内建的 `'none'` 是 `[0, 0]`（**画黑**），不是引擎的 `(ONE,ZERO)`「覆盖」——
   映射成 `'none'` 会让 TITLE 整屏变黑。
5. **闸门 C 收口**：`dead-writes.baseline.json` 的 `known` 清空（两条死写现在真有消费者）；
   `test/no-dead-writes.test.ts` 的第 2 条改成**合成输入**（真实模型已无死写字段）。
6. 快照可观测：`scene/snapshot.ts` 增加 `renderTargetSlot`/`slotModes`/`sceneBlend`（报告里能看到门控输入）。

### 判据 / 守卫
- `test/blend-mode.test.ts`（新，10 条）：选择子表（含 `0` 与 ≥4 的差异：draw-item「不改」vs mesh「显式 normal」）、
  门控（mode 必须**恰好 1**；mode 2 不算）、场景默认（`2` 档**没有门控**）、**泄漏档**（显式开档：
  `0` 继承前项、mesh 之后留 `(ONE,ZERO)`）、默认档（每项从场景默认开始）、
  以及**端到端**（`0x1F8(mode 1)` + `0x20D` + `0x33F` + `0x203` + `0x322` 走真 handler 到场景模型 → 混合档正确）。
- 闸门 C：`npm run check:dead-writes` 报"基线 0 个 / 当前死写 0 个"；`no-dead-writes` 2/2。
- `tsc`（3 个 tsconfig）干净；`registry-tables` 通过（新 handler 已注册）。

### E4（真机对照与回归）
`npm run shot -- --gamestart`（每步截图）：
- **静态帧零回归**：默认档下 `TITLE`（step 0）与 `GAMESTART`（step 6）与"修前行为（强制 normal）"**逐字节相同**；
- **同一份代码跑两次的确定性**：静态帧（TITLE/GAMESTART/两处 hover）逐字节一致，淡入中途的帧会差
  ⇒ ★比对只能看**静态帧**（这条经验写进了 `T-0041` 的 notes）；
- 序章首文案帧内容正确（天空 + 侧栏 + 正文）。
- ★对照点：**值 1（加算）在语料里真实存在**（`SC0000.txt:16648` 一带的 mesh 加算、`ALCHEMY.txt:985` 的辉光），
  本次投屏路线没有走到这些站点（`--gamestart` 只到序章首文案）；把它们纳入投屏场景列入 `T-0041` 的后续。

### 未收敛（→ `T-0041`）
"引擎 blend state 会泄漏"这条**读法与真机可见行为矛盾**：照它跑会让 TITLE 的 logo 透明区变黑、背景被覆盖
（`.tmp/t17fix2-0-title.png`）。⇒ 默认档按真机可见行为（每项从场景默认开始），泄漏档保留在
`BlendWalkOptions.leakStateAcrossEntries`（默认 false）；引擎里"由谁重设"的那一处还没找到。
另两条小的：① Pixi 的 `d3d-opaque` 与 D3D `(ONE,ZERO)` 在 α<255 时不同（Pixi 写预乘色）；
② `0x33F` 的 op2/op3（`Scene+1264` 颜色 → 效果对象 shader 常量，raw 65904-65907）那条**效果通路**未建模。
