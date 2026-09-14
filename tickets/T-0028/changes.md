# T-0028 · 过程文档（changes.md）

## 2026-09-14

# 变更记录（T-0028）

## 第 1 次变更（2026-09）：实现 `0x256` 的「区间立即平移」——修掉"进 ADV 侧边栏即展开"

### 根因（一句话）

`0x256`（引擎 `sub_425C30` → `sub_4ACD10`，raw 33120 / 131733）的语义是
**对 `[op1, op1+op2)` 区间内**已存在**的绘制项做一次立即平移**（`+0x68=1` + 平移 **work** 矩阵 `+0x16C` + 置脏）；
emulator 一直把它和 A4 其它指令一起当"只记录"（写进 `SceneState.render4.slotParams`），**从不移动图元**。
而 `DRAWCHARM.txt:182-186` 正是靠它在**收起态**给侧边栏 21 个槽套 `(0x6e,0,0)`：

```
label_00001170
eq (local-int 0) (global-int 1399) 1
jcc (local-int 0) ffffffff label_000011f0    ; 1399 != 1（含 LOCK 的 2）⇒ 跳过
add (local-int 0) 19834 1
i256 (local-int 0) 15 6e 0 0                 ; [0x19835, 0x19835+0x15) 平移 +110px = 收起摆位
```

⇒ 只记录不生效 ⇒ 每次重绘（进场景/翻页）都把侧边栏画回基准位 `x=0x49c`（看起来"被 hover 展开"）；
首次悬停条带触发 `c74`（`i220 → 0`，视觉无变化）把 `global 1399` 抬到 2，再移开触发 `e78`（`i220 → 0x6e`）才真正收起 —— 与用户描述完全一致。

LOCK 开关（用户提示）：`global 139a`（侧边栏右下角 (1189,573) 按钮的 click handler `SN0000.txt:232`：`sub (global-int 139a) 1 (global-int 139a)`；dst 与第二个源同槽 ⇒ **`139a = 1 - 139a`，0↔1 开关**）。
`139a != 0`（LOCK ON）⇒ ① 场景启动 `1399 = 2`；② `SN0000.txt:64-66` **不登记全屏收起热点**（⇒ 无视 hover）；
③ `DRAWCHARM.txt:183-184` **跳过**上面那条 `i256` ⇒ 停在基准可见位。即「LOCK = 恒展开」。
**LOCK 逻辑本身没问题**，缺的是它旁边那条 `i256` 的实现。

### 改了什么

| 文件 | 改动 |
|---|---|
| `app/amayui-emulator/src/renderer/scene/ops.ts` | `scSetSlotParams` 从"只记录"改为**真应用**：保留 `render4.slotParams` 记录，并对 `[handle, handle+count)` 内**已存在**的项调 `applyDrawTranslation(it,x,y,z)`（= work+target 都写，与 `0x1FF` 同一原语；无窗时求值走 target）；返回 `SetterOutcome`（命中 0 项 ⇒ `created-gated`） |
| `app/amayui-emulator/src/vm/handlers/gfx-state.ts` | `0x256` 的 handler 注释写清 `op2 = count`（区间）+ work 矩阵语义（raw 131733 逐行） |
| `app/amayui-emulator/src/renderer/headlessScene.ts` / `pixiBackend.ts` | 两个宿主缝改名 `slot`/`count`，headless 走 `outcome()`、pixi 打日志（能看见 `applied` / `created-gated`） |
| `app/amayui-emulator/test/op-a4-a6.test.ts` | +1 例守卫（区间内已存在项被平移；区间外不动；不补建；记录仍保留） |
| `analysis/functions.json` | `0x425C30` 语义名改为 `setDrawItemRangeTranslation_425C30`，补 `sub_4ACD10` 的区间/work 矩阵结论与 emulator 修复说明 |
| `analysis/engine-capabilities.json` | `gfx-prim-mesh-and-render-state` 的 note 更新：`0x256` 从"只记录"移出，注明它是侧边栏收起的摆位手段 |

### 判据（先红后绿）

- `test/op-a4-a6.test.ts` 的新例：把 `scSetSlotParams` 临时改回"只记录"⇒ **红**；恢复 ⇒ **绿**。
- 全量 `npm test`：490 例 / 480 通过，7 个失败与改动前逐条相同（既存的 Windows 路径/配置类，与本票无关）。

### E4（产品路径，Electron + jp 资源）

`ELECTRON_DISABLE_SANDBOX=1 npm run shot -- --gamestart --name fix28`（产物 `tickets/T-0028/evidence/fix-*.png`）：

| 时刻 | 修复前 | 修复后 |
|---|---|---|
| 进 SN0000、未 hover（光标 (811,605)） | 侧边栏**展开**（`t0028-7`） | 侧边栏**收起** ✅（`fix-7`，只剩右侧装饰框） |
| 悬停条带 (1240,300) | 展开 + `オートモード` 高亮 | 同（`fix-9`，无回归） |
| 移到文本区 (400,300) | 收起 | 同（`fix-10`） |

### 另记：G3（两宿主一致性）

修复后重录 Electron 轨迹（`npm run record`）再 headless `npm run replay` ⇒ 见 changes 末行结论（本条只证明"两宿主仍逐帧一致"，不证明画面正确性 —— 正是这个盲区让本缺陷躲过了 G3/digest）。

## 2026-09-14


### G3 复核（修复后）

修复后重录 Electron 轨迹再在 headless 回放：

```
npm run record -- --scenario tools/scenarios/gamestart.json --out .tmp/fix28-electron.jsonl.gz
npm run replay -- .tmp/fix28-electron.jsonl.gz
→ [replay] ✅ engine 段逐帧相等（比对 3112 帧）
```

⇒ 两宿主在修复后仍逐帧一致（本缺陷的盲区正在于此：**G3/digest 只证明"两宿主一致"，不证明"画面与引擎一致"** ——
`0x256` 属于 A4「只记录」那一族，两个宿主一起漏，digest 里看不出来；抓到它靠的是 `DRAWCHARM` 的脚本文本 + 引擎 raw）。
