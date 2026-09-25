# T-0149 · notes —— `partial` 处置位的定义、schema 与首批迁移账

> 本文件是**手写过程文档**；机器可读的真源是 `analysis/opcode-gaps.json`（`dispositions.partial` + 各条 `missing[]`）。

## 1. 为什么需要这个处置位（口径）

`disposition` 此前只有 `unimplemented` / `engine-internal` / `engine-internal-unjustified` / `implemented` / `deferred`
—— 它回答的是「**注册了没有**」。一旦写成 `implemented`，就再没有任何机制回来核对「相对引擎体做全了没有」。
审计（`docs-new/99-records/2026-09-impl-audit/impl-audit-2026-09.md`，436 条 kept finding）里绝大多数缺口正落在这一类：
**已注册、语料跑得通，但缺某条分支 / 某个消费端 / 某个写者，或某处只是披露近似。**

★**`partial` 的诚实定义**（写进 `analysis/opcode-gaps.json` 的 `dispositions.partial` 与生成物 §7 头部）：

- `partial` = handler **已达语料级可用**（不是硬停、不是纯 no-op），但**相对引擎体仍缺**某条分支 / 消费端 / 写者，或某处是**披露近似**。
- 与邻居的分工：`implemented` = 已读完体且不缺东西；`engine-internal` = 有据 no-op（引擎行为对 VM 不可观测）；
  `deferred` = 按当前重写范围**整个不做**；`unimplemented` = 根本没注册（命中即 `NotImplementedOp`）；**`partial` = 做了，但没做全**。
- ★`partial` **不是**降级：它比 `implemented` 信息更多，且把「谁来做」钉在了 `missing[].ticket` 上。

## 2. schema（`missing[]`）

```jsonc
{
  "opcode": 855,
  "disposition": "partial",
  "missing": [
    { "what": "缺哪条分支/能力（一句话，带引擎行为描述）", "ticket": "T-0151", "raw": "28440-28457" }
  ]
}
```

- `what`：非空（≥8 字），写**引擎行为**（缺的是哪条分支/消费端/写者），不写"待办"式空话；
- `ticket`：必须匹配 `^T-\d{4}$` **且** `tickets/<id>/ticket.json` 真实存在（承接票不许指向被删/未开的票）；
- `raw`：必须匹配 `^\d+(-\d+)?$` —— **只允许单一行号或单一段行区间**（不许 `117454-117479,133447` 这种多段）；
- `missing[]` **只允许挂在 `partial` 上**：`implemented` 带 `missing[]` 即红（"还缺东西"不许藏进 `implemented`）。

守卫：`app/amayui-emulator/test/opcode-gaps.test.ts` 的
`★缺口台账 \`partial\` 棘轮：missing[] 必须齐备、票号真实存在、raw 合法` +
`★缺口台账 \`partial\`：md §7 的每条 missing 都进了生成物`；生成器侧同一套规则在
`scripts/build-opcode-gaps.mjs` 的 `buildGapReport()` 里（`--check` / 守卫测试都会报成 problem）。

## 3. 首批迁移账（57 条 partial / 133 条 missing）

来源：审计报告 `§4.1`（Track 1 · 指令实现缺口，逐条 finding 的 `what` + `engine.lines`）
+ `app/amayui-emulator/.tmp/p1-fix/p23-worklist2.md`（票号归属）
+ `analysis/engine-capabilities.json` 的 `status: partial` 条目（残余，只读）
+ `app/amayui-emulator/.tmp/p1-fix/dispositions.json` 的 `residual`/`extensionPoint` 文本。

> ★下表按**条目主票**（台账里那条 `ticket` + 本批选表）统计；生成物 §7 是**按每条 `missing[].ticket` 分组**
> （同一条 opcode 的缺口可以分属不同票，例如 `0x321` 同时出现在 T-0154 与 T-0155 下）⇒ §7 的分组计数与本表不同，
> 两者都对、口径不同。

| 票 | partial 条数 | opcode |
|---|---|---|
| `T-0151` | 11 | 0x82 0x6e 0x70 0x71 0x72 0x75 0x196 0x205 0x213 0x301 0x2be |
| `T-0152` | 6 | 0x1ba 0x2f5 0x2f6 0x2f8 0x1c9 0xbf |
| `T-0153` | 8 | 0x20b 0x23f 0x1f8 0x1f9 0x1fa 0x246 0x249 0x1ab |
| `T-0154` | 6 | 0x223 0x244 0x1f6 0x20d 0x229 0x321 |
| `T-0155` | 5 | 0x234 0x24f 0x202 0x320 0x32d |
| `T-0156` | 6 | 0x7c 0x133 0x134 0x3 0x9 0x8c |
| `T-0158` | 5 | 0x147 0x97 0x100 0x101 0xcd |
| `T-0159` | 2 | 0x19e 0x1ae |
| `T-0160` | 2 | 0x341 0x34e |
| `T-0161` | 2 | 0x2e9 0x201 |
| `T-0163` | 2 | 0x14c 0x14d |
| `T-0164` | 2 | 0x60 0x21d |

- **改判**（原 `implemented` → `partial`，13 条）：`0x82 0x7c 0x133 0x134 0x147 0x1ba 0x20b 0x223 0x234 0x23f 0x244 0x24f 0x2e9`
  —— 这 13 条正是"一旦写 `implemented` 就再没人回来核对"的那一类。改判时 `note` **保留原文**并追加一行
  `★T-0149：本条由 \`implemented\` 改判 \`partial\` —— …`（不改写、不删旧结论）。
- **新增**（原本不在台账里，44 条）：这些 opcode 早已注册进 `OPS`/`NATIVE_OPS`，此前**没有任何台账记录** ⇒ 缺口无人跟。

### 3.1 能力台账 `status: partial` 的 27 条 → opcode 落点

| 能力 id | 本次迁入到 | 说明 |
|---|---|---|
| `audio-device-init` | `0x1c9` | 设备丢失重建 + 10 通道重载（`sub_4B5090`）未实现 |
| `scene-slot-release-1000` | `0x1f6` | 1000 槽逐帧老化释放未建模 |
| `lazy-572b-node-map` | `0x244` | 572B 表（Scene+1084/Scene+1100）精灵/特效那一半未建模 |
| `msgwin-offscreen-surface-lifecycle` | `0x70` | 每窗离屏表面（0x70 重建 / 0x71 清底 / 逐行贴出）未建模 |
| `text-font-rebuild-cascade` | `0x75` | 字体参数 → GDI HFONT 句柄重建级联缺失 |
| `text-blank-extent-mode-gate` | `0x205` | 缺宿主字体度量来源 ⇒ `measured:false` 回退 |
| `live2d-enabled-config-flag` | `0x341` | `global a9d0` 开关在重写侧无引擎侧对应物 |
| 其余 20 条 | —（未迁入） | 见 `changes.md`「未做项」——多数没有单一 opcode 落点（属逐帧/子系统级），或落点被既有守卫钉死 |

## 4. 与 `implemented` 回链的关系

`dispositions.json`（48 条 P1）中**没有 `residual`/`extensionPoint`** 的条目保持 `implemented`，**没有**为它们补台账条目：
`analysis/opcode-gaps.json` 是**缺口台账**（`_doc` 只收「语料用到但未注册」「已注册为 no-op 但体内有真实效果」「已注册但只做了一部分」三类），
把一批"本来就不是缺口、本轮已修好"的 opcode 灌进去会稀释 §5/§7 的语义。
它们的机器可读处置留在 `app/amayui-emulator/.tmp/p1-fix/dispositions.json` 与审计报告 §4.8（`.tmp` 是临时区、不进证据；结论以报告为准）。
唯一从 `residual` 迁入的是 `0xcd`（T-0158）与 `0x2f5`（T-0152）。

## 5. 溯源（怎么复算）

1. 审计 finding（含 `engine.lines` 引擎行号）：`docs-new/99-records/2026-09-impl-audit/raw/findings-final.json`
   （`track==='opcode'`，`verify.decision==='keep'`）；
2. 票号归属：`app/amayui-emulator/.tmp/p1-fix/p23-worklist2.md` 的分节（`## T-015x`）；
3. `what` 文本 = 该 finding 的 `what` 首句（去 markdown，≤190 字）；`raw` = 该 finding 的 `engine.lines`——
   **没有一条是手写编造的引擎行号**（`raw` 全部来自审计的 `engine.lines`，或 `dispositions.json` 残句里点名的行）；
4. 只收**行为缺口类** `kind`（`missing-*` / `approximation` / `host-invented` / `wrong-*` / `extra-state` / `noop-claim-unjustified` / `model-drift`）；
   `stale-ledger` / `overreach` / `unclear` / `doc-mismatch` 是**台账文本**问题，不进 `missing[]`。
