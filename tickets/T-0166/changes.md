# T-0166 · 能力台账同步批 · 变更记录

> 上游清单：`docs-new/99-records/2026-09-impl-audit/impl-audit-2026-09.md` §4.2（Track 2，P1「描述过期 / overreach / guard 名不副实」）。
> 本轮**只改** `analysis/engine-capabilities.json`（+ 生成物 `docs-new/03-engine/engine-capabilities.md`），
> **未改**任何 `app/src`、`src/`、`tickets/` 之外的业务文件（另一张实现票 `T-0147` 的锚点 retarget 见下）。

## 第 1 次变更（15 条 P1 逐条订正）

工具链：`node app/amayui-emulator/.tmp/audit/sync-capabilities-2026-09.mjs` →
`capabilities.js --recount` → `node scripts/build-capabilities.mjs` → `capabilities.js --validate`。

| # | 条目 | 订正 |
|---|---|---|
| ① | `world-matrix-identity-refresh` | `partial/E2`+`draw-item-anim-window.test.ts`（断言的是别的东西） ⇒ **`modeled-verified`/E2 + `test/op-22a-22f-scene-world.test.ts`**；note 改写（世界矩阵链 2026-09 已实现；剩余近似 = 层区间外支 + 只留"最近一次 kind"） |
| ② | `frame-pump-input-refresh` | **删除整条**：它引的 `sub_4BBAB0` 是 DirectSound **语音通道**每帧泵（不是输入刷新）⇒ 误分类 + 守卫张冠李戴；真正的输入态刷新已由 `input-keyboard-to-mask-bits`（`test/keyboard-mask.test.ts`）覆盖。连带把 `tickets/T-0027` 的 `links.analysis` 里那条悬空 id 去掉（该票 `done`，锚点未受影响） |
| ③ | `lazy-transition-map-node` | `absent/E0/无 guard` ⇒ **`modeled-verified`/E2 + `test/sc-transition-window.test.ts`**；note 写清 `render4.transitions`/`transitionRuntime`/清表条件与 4 个守卫文件 |
| ④ | `scene-flag-46528-bits` | `absent/E0` ⇒ **`modeled-verified`/E2 + `test/wait-gate-timer.test.ts`**；并订正 bit2 极性（raw 117441：bit2 **置位**时忽略已置冻结值） |
| ⑤ | `script-queue-dispatch` | `absent/E0/「0x143 是 no-op」` ⇒ **`modeled-verified`/E3 + `test/append-packs.test.ts`**；仍未实现的 `0x1F5` 帧驱动出队单列 |
| ⑥ | `lazy-gdi-font-set` | `absent/E0/「完全未建模」` ⇒ **`modeled-verified`/E2 + `test/config1-chain.test.ts`**；note 区分"参数面已建模"与"HFONT 层属渲染宿主等价物差异" |
| ⑦ | `msgwin-text-method-opcodes` | note 的"约 22 条仍是 no-op"与代码相反 ⇒ 改写（点名的九条已是真实现；真缺的是未注册的 `0x7D`），status 仍 `partial` |
| ⑧ | `msgwin-attr-font-opcodes` | 旧 P0 no-op 名单十一条**全部已实现** ⇒ **`modeled-verified`/E2 + `test/text-style-snapshot.test.ts`**；旧 guard 名不副实（那是字体选择器查表）已换 |
| ⑨ | `msgwin-config-gates` | (b) 节流键名（`MessageSpeed` 而非 `MesWinAlpha`）与 (c) "随包 INI 缺失 ⇒ 走不到"两条口径订正为"有效默认来自内建注册表 `sub_491880`（1/3/1）且分支可走到、emulator 已实现" |
| ⑩ | `text-layout-wrap-ruby` | `absent/E0/无 guard` ⇒ **`modeled-verified`/E2 + `test/text-layout.test.ts`**（等宽网格 + 边界硬断 + 注音配对 + 对齐，7 条守卫断言） |
| ⑪ | `msgwin-backlog-cursor` | `absent/E0` ⇒ **`partial`/E2 + `test/op-1d0-1d1-text-metrics.test.ts`**；note 改成"表与光标已建并接线，缺的是消费者（`moveCursor` 零调用者）与未注册的 `0x84`" |
| ⑫ | `text-white-level-on-composite` | note 的 `TEXT_WHITE_LEVEL = 0.89` / `#e3e3e3` 指纹已不存在 ⇒ 改写为**覆盖率合成**（`TEXT_FILL_ALPHA = 225/255` + `globalAlpha`），guard 换 `test/text-aa.test.ts` |
| ⑬ | `scene-norender-mode` | name/note 订正：`Engine+167990` = **`display:ScreenMode` 镜像**（19 处 `!167990` 门控窗口/全屏操作），不是"无渲染/隐藏窗口模式" |
| ⑭ | `scene-teardown-on-load-point` | note 两条结论都过期 ⇒ 改写为"`drawItems` + `native.restoreDrawItems` 有真消费者与 `test/slot-load-screen.test.ts` 机械判据"，并否掉旧"正解 = 恢复 clearDrawContainer" |
| ⑮ | `lazy-movie-dll` | 名字/子系统/扩展点都错（0x14B 是**通用模块加载**，全语料唯一调用点 = AGERC.DLL）⇒ 更名 + `subsystem=AGERC` + **`modeled-verified`/E2 + `test/op-a4-a6.test.ts`**（该守卫**早已存在**） |

### 计数变化（`--recount` 实测）
`absent 17 → 10`、`needsAttention 54 → 42`、条目数 `139 → 138`；`capabilities.js --validate` 通过。

### 连带
- 生成物重建：`docs-new/03-engine/engine-capabilities.md`（138 条）。
- `tickets/T-0147`：本轮另一张实现票修好了它指的三处口径，其 4 条证据锚点按棘轮 **retarget 到同义新串**
  （`operandPlan.ts` 的 `rw→r`、`msgwin.ts` 的 `plan.setInt(2, nx)` 删除处、注册表注释、`analysis/opcodes.json` 的
  in/out 口径），并追加守卫文件证据；**一条证据都没删**。
- 守卫：`test/capability-ledger.test.ts`、`test/ticket-ledger.test.ts`、`test/script-ledger.test.ts`、`test/doc-model.test.ts` 全绿（26 用例）。
