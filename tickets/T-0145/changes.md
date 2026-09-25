# T-0145 · 文档/注释与体不符三处（变更记录）

> 主 agent 于 2026-09-24 逐条核。**四条判据的现状**：3 条已闭合、1 条被 `T-0108` 挡着（不是被技术问题挡）。

## 判据 1（`global 3f90` 门极性）—— ⛔ **被 `T-0108` 挡着**（本票唯一的剩余项）

- 要改的是 `docs-new/05-scripts/NOVEL.md:25`（「门是 `3f90 != 0`（⇒ 恒不执行）；`3f90==0` 时整段跳过」）
  与 `SYSTEM4.md:31`（「`3f90==0` 时整块跳过」）——**这两份是 `analysis/scripts.json` 的生成物**
  （`node scripts/build-scripts.mjs`），真源是那两份脚本条目的 note/invariants。
- 而 `analysis/scripts.json` **此刻归 `T-0108`**（它正在全库搬沿革话术）⇒ 谁同时写谁覆盖谁。
- ⇒ **重开条件**：`T-0108` 交回后（或它明确释放 `scripts.json` 后），按本票 why 里的判据改真源 + 重生成：
  `eq local0,(3f90),0` + `jcc local0 ffffffff <skipLab>` 应读成 **`3f90 == 0` ⇒ 落下句、整块执行**；
  `3f90 != 0` ⇒ 跳过。判据链（不依赖对反编译的解读）已写在票里：`jcc` 表口径（`analysis/opcodes.json`
  的 `0xA0` 行）+ 运行期反证（`NOVEL.txt:191` 的 `i1f6` 在 SN0000→SC0000 边界确实执行，
  `tickets/T-0100/evidence/sn0000-sc0000-boundary.md`）。
- ★注意：`NOVEL.md:27/39` 与同页 invariants 里「恒不执行」的连带表述要一并改（否则同页自相矛盾）。

## 判据 2（有没有测试按旧极性钉着）—— ✅ **核完 = 无**

```
grep -r "3f90" app/amayui-emulator/test/  → 0 命中
```
⇒ 没有任何测试钉着旧极性（原票点的 `test/t0102-chapter-chain.test.ts` 也不含 `3f90`）。**判据 2 是 no-op**，
不需要改测试。

## 判据 3（`T-0090` 的旁注依据）—— ✅ **已落地**（复核确认，非本轮改动）

- `src/vm/handlers/save-slot.ts`：已按体订正 —— `:316-318` 写「读档装载内核 **`sub_410160` raw 19385-19388**…
  旧注释引的 raw 19913-19915 两次 `sub_403EF0` **不是**这条依据 —— 那两次复位的是两张仮想ディスプレイ」，
  `:258` 同口径；
- `src/live2d/runtime.ts:188`：`l2dResetHost` 的注释同样改引 `sub_410160` raw 19385-19388
  （本票 evidence 里那条「T-0145 ③ 已落地」的锚点就是这个）。

## 判据 4（留帧注释自相矛盾）—— ✅ **本轮改掉**

- 位置：`src/renderer/pixiBackend.ts` 的 `#holdFrameAfterCurtainDrop` 文档（票里的 `:848` 是旧行号，
  实际在 `:900-902`）。
- 旧文：「先留帧，直到有新内容建立（createMesh/draw-texture/copyScene）**或容器被整批清空
  （clearDrawContainer，此时画面本就该是空的/黑的）**」—— 把 `clearDrawContainer` 写成了**解除点**。
- 实现（`:1142-1153`）：`clearDrawContainer` 做的是
  `this.#holdFrames = Math.max(this.#holdFrames, HOLD_MAX_FRAMES)`，即 **续期到 60 帧、绝不解除**
  （它自己的行内注释 `:1145-1148` 早已写明「★2026-09 改：清容器**不再解除留帧**」）⇒ 两处口径相反。
- 新文：「…直到有新内容建立（createMesh/draw-texture/copyScene）；★**`clearDrawContainer` 不是解除点**
  —— 它只把留帧**续期**到 `HOLD_MAX` 帧并继续留上一帧…最多留 `HOLD_MAX` 帧，防止"幕撤了但确实什么都不画"
  的场景被永久冻住。」

## 收尾

- `git diff --stat`：`src/renderer/pixiBackend.ts` 一处注释（+2/-2 级别）。
- 未跑 `npm run verify`（只改注释；四份台账 `--validate` 与本改动无关，且此刻 `scripts.json` 正被 `T-0108` 改写）。
- **票保持 `doing`**：判据 1 未完成（等 `T-0108`），其余三条已闭合。

## 2026-09-24

## 2026-09-24 判据 1 落地（主 agent 亲自做）+ 关单

**判据 1 的证据链（不靠对反编译的解读，回到 opcode 表）**
- 两条脚本原文同型：`src/NOVEL.txt:33-34` 与 `src/SYSTEM4.txt:184-185` = `eq (local-int 0) (global-int 3f90) 0` + `jcc (local-int 0) ffffffff <skipLab>`。
- `analysis/opcodes.json` 的 `0xA0` 行写死：`op1≠0` → 跳 `op2`（`op2 == 0xFFFFFFFF` ⇒ 落下句）；`op1==0` → 跳 `op3`。
- ⇒ 这两处 = 「`3f90 == 0` ⇒ `local0 = 1` ⇒ **落下句、整块执行**；`3f90 != 0` ⇒ 跳 skipLab、跳过」。**旧文档是反的。**
- 运行期反证（不依赖解读）：`src/NOVEL.txt:191` 的 `i1f6` 在 `SN0000 → SC0000` 边界确实执行过（`tickets/T-0100/evidence/sn0000-sc0000-boundary.md`，日志行 7953 一带），而它正处在这道门之后。

**顺手改正的第二处反向结论（旧文档没点名的）**：SYSTEM4/NOVEL 两处都写「`4fd9 != 0` 时才走 `i1f6` 那一支」—— **也是反的**。真值：`jcc 4fd9 ffffffff <L>` ⇒ `4fd9 == 0` 跳到 `L`，而 `L` 里才有 `i1f6`/`i23d`（`src/SYSTEM4.txt:211-213`、`src/NOVEL.txt:60-62`）；`4fd9 != 0` 走的是画 `draw-texture 186a0` 那一支。

**改了 6 处**（全在 `analysis/scripts.json`，随后 `node scripts/build-scripts.mjs` 重生成 `docs-new/05-scripts/{NOVEL,SYSTEM4}.md`）：SYSTEM4 的 layout `what`（3f90 极性 + 4fd9）、SYSTEM4 的 gotcha（把「3f90 恒 0 ⇒ 恒不执行」改成「恒放行，真正分叉的是 4fd9」）、NOVEL 的 layout `what` ×2（32-58 的门极性、174-191 的 ADV 收场极性）、NOVEL 的 invariant（「恒不执行」→「恒执行」+ 结论仍在但理由换成 4fd9）。

**锚点纪律**：`evidence[4]`（`docs-new/05-scripts/SYSTEM4.md`）的 anchor 原为 `3f90==0 时整块跳过` —— 该串虽仍在文中（降为「★原写…是反的」的引述），但已不代表结论 ⇒ 按棘轮纪律 **retarget** 到 `3f90 == 0 ⇒ 落下句、整块执行`，note 写清原因。

**守卫**：`node --import tsx --test` 跑 doc-model / capability-ledger / script-ledger / ticket-ledger / opcode-gaps / op-1d0-1d1-text-metrics / opcode-arity / opcode-operands / operand-plan / harness-convergence / registry-classification = **55/55 绿**。

**判据 5 的说明**：四份台账 `--validate` 全绿；`test:all` 的 3 条基线红不变；本轮多出的红都在 B 波正在改的 `src/**` 文件里 ⇒ 本票只动文档/数据层，波次收口时再整体复核一次。
