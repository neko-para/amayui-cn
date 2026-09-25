# T-0091 变更记录 —— 剩余四项的收口（2026-09-25，`T-0179` 第 70 轮 goal round 2）

> 范围：`src/renderer/scene/transition.ts`（+38 行，新判据函数）、`src/renderer/pixiBackend.ts`（+15 行，分支 + 日志）、
> `test/transition-render-wiring.test.ts`（+2 条守卫）、`analysis/engine-capabilities.json`（note 的 (b) 段）、
> 本票目录（notes.md / evidence/）。**未动台账 `missing[]`**（本票的缺口不是 opcode 级）。

## 第②项（本票最后一个代码项）：`[4]` 指向非 `create-texture` 槽

**体（`sub_4A50C0` raw 124819-124920，逐行读过）只有两条路**：

```c
v4 = *(_DWORD *)(*(_DWORD *)(_this + 1860) + 1040);          // 设备
if ( a2 > 0x3E7 ) {                                          // ★> 999；a2 是 unsigned ⇒ 含 -1
  …GetBackBuffer(vtable+72)… 失败 ⇒ "バックバッファ取得に失敗しました．"
  v15 = SetRenderTarget(vtable+148)                           //   绑后台缓冲
  if ( !v15 ) { …; *(_DWORD *)(_this + 46456) = -1; return 1; }   // ⇒ 记 -1、成功
} else {
  if ( !*(_DWORD *)(_this + 4 * a2 + 42456) ) {               // ★0..999 但该槽**没有 CTexture 对象**
    sprintf_s(… "SetTargetTexture エラー：テクスチャが作成されていません． TEXTURE=%d" …);
    return 0;                                                // ★不改 Scene+46456
  }
  …取该对象的 surface ⇒ SetRenderTarget ⇒ *(_DWORD *)(_this + 46456) = v2; return 1;
}
```

⇒ 三种情形的**可观测差别**：`> 999`（含 `-1`）⇒ **画到屏幕**（后台缓冲）且 `Scene+46456 = -1`；
`0..999` 且有对象 ⇒ 画进该槽；`0..999` 但对象为空 ⇒ 只报错、**不动已绑的渲染目标**。

**改法**：
1. `scene/transition.ts` 新增纯函数 **`transitionTargetKind(slot): 'slot' | 'backbuffer'`**（`slot < 0 || slot > 999 ⇒ 'backbuffer'`），
   函数头逐行引体（含 `a2` 是 unsigned 这个坑）。
2. `pixiBackend.#compositeTransitions` 用它分辨：后台缓冲分支打一条**点明 raw 的日志**并跳过；
   ★修前它会一路落进 `composeIntoSlot` 的「该槽没有 create-texture 出来的表面」——那是**错的理由**（该分支根本不查槽表）。
3. `emulator 只建模了中间那一种` ⇒ **如实登记为有据缺口**（能力条目 `clock-read-transition-window` 的「仍未建模 (b)」已升级为
   "判据已建模 + 已加守卫 + 两条重开条件"）。

**守卫**（`test/transition-render-wiring.test.ts`）：
- 单元：`transitionTargetKind` 8 例 —— `0/1/36/37/999 ⇒ 'slot'`，`1000/-1/-2 ⇒ 'backbuffer'`；
- 源棘轮（**作用域限 `#compositeTransitions` 函数体**）：宿主必须走 `transitionTargetKind(slot) === 'backbuffer'`，
  且**体内**不许内联判 `-1`／`slot < 0`（文件别处有正当的 `slot < 0`：`setRenderTarget` 日志与 `#captureStageIntoSlot` 守卫 ⇒ 不能扫全文）；
- 判据函数必须在 `scene/transition.ts` 且判据是 `slot < 0 || slot > 999`。

**红→绿（实测）**：把 `if (transitionTargetKind(slot) === 'backbuffer')` 变异成 `if (false)`（= 退回"混进没表面那条错路"）
⇒ `7/8`（1 红）；恢复 ⇒ `8/8`。

## 第④项：E4 可达路径（★本轮补齐证据）

- **可达、可复现**：起无头实例 `t0103` → `load-slot.mjs --slot 78` → **点 4 次消息区**即进入切章转场，
  日志出现 `[transition] id=0x18a9e cat=0 t=0.401 → 槽 9（交叉淡化；源=A(1项)/B(1项)）`。
  读档落点 = `cur=2 SN0000.BIN ip=2168/2793`（帧链 0=SYSTEM4 → 1=NOVEL → 2=SN0000）。
- **证据已归档**：`tickets/T-0091/evidence/` 的 `save78-loaded.png` + `chapter-transition-0..7.png`（命中后逐帧连拍 8 张），
  复现命令与判据写在该目录的 `README.md`。
- ★**如实披露**：这组截图证明的是"可达路径"，**不是**"像素级真机对照通过"（本机是 emulator 自己的渲染页）
  ⇒ 能力条目 `clock-read-transition-window` 的 `evidence` **保持 E3 不变**。
- ★验收原文要求 `npm run shot`；本次改用**无头实例 + `capture`**（理由：`shot` 会抢 Electron 窗口并覆盖同一个
  `.tmp/amayui-emulator.log`，而无头实例是 agent 自足通道、不与用户实例共用日志/overlay）。语义等价。
- ★**踩坑记录**：`debug-query` 的 body **整条命令必须放在 `args[0]`**（`src/web/host.ts:644`）；
  且本 build 的 `debug-query` **只读**，输入注入走渲染页的 `parseDebugCommand`（`move/click/press/release/wheel/key/keyup`）。

## 其余四项的状态复核（都在本轮之前已落地，本轮只核）

| 项 | 状态 | 证据 |
|---|---|---|
| ① 类别 3 的精确核 | ✅ 按验收的**替代路线**收口 | `TransitionBlurPlan` 的偏差披露 ①②（含 asm 判据 `0x4B3187: cmp eax,3 / jnz`），守卫 `test/sc-transition-window.test.ts` 的 D4 例 |
| ③ `Scene+46508/46512/46516` 三标志本身 | ✅ | G1/G2 已落地并带守卫；能力条目 `scene-dirty-flag-lifecycle` = **`modeled-verified`/E2**；`Scene/0xB5C0 wait_gate_deadbits`（三死位"本 exe 无写者"）已在 `analysis/fields.json` |
| ⑤ 到期帧仍把终值合成进 `[4]` | ✅ | D2：`scTransitionTick` 交付 `render` 快照（`rt.t = 1` + 终值通道），pixi 存进 `#pendingTransitionRender` 交给 `present()` |
| ⑥ 区间项的屏幕排除 | ✅ | D3：`scTransitionMarkedHandles` 在 `presenter.present` 里过滤 DrawItem/Mesh/572B 节点，对齐 `(flags & 0x10001) == 1` |

## 判绿

```
cd app/amayui-emulator && npm run verify   ⇒ exit 0（tests 1678 / pass 1676 / fail 0 / skipped 2）
四份台账 --validate 全绿；五份生成物 --check 全绿
node --import tsx --test test/transition-render-wiring.test.ts ⇒ 8/8
```
