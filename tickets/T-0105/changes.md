# T-0105 · 变更记录

## 2026-09-22（判据 ①③④ 主体 + 收尾）

**文档（手写机制叙述瘦身：留机制、逐字段/raw 交台账）**

- `docs-new/03-engine/adv-text-rendering.md`：换行步进段删字段清单（回链 `#text-line-pitch-font-1380`）；4 处「订正」话术改直陈。
- `docs-new/03-engine/rendering.md` §4.5：世界矩阵段留公式与实测事故（回链 `#drawitem-world-matrix-composition`）；`#meshVisible` 判据句改直陈。
- `docs-new/03-engine/live2d.md`：节点矩阵合成段只留等价式（回链 `#live2d-node-matrix-compose`）；`0x348`/`0x345`/`0x34F-0x351` 的过时注记按 `analysis/opcodes.json` 现状改直陈。
- `docs-new/03-engine/sound-system.md` §5：曲号表段回链 `#music-number-table-lifecycle`；`[258]`/`0x2F8` 两处订正话术改直陈。
- `docs-new/03-engine/resource-loading.md` §1.1：六阶段表去「位置」列（回链 `#append-pack-discovery-and-activation`）；过期计数 `380/380` 改「全绿」。
- 同批清沿革话术：`runtime-memory.md`(4)、`save-data.md`(4)、`input-system.md`(2，表格行号直接改对 + 删 blockquote)、`scene-start-flow.md`(2，含过期 `380/380`)、`agerc-module.md`(1)、`copyright-effect.md`(1，旧行号 12679 → 只留 12762-12786)、`engine-reset-mainloop.md`(1)、`flow-control.md`(1)、`live2d-moc-format.md`(1)。

**台账**

- `analysis/engine-capabilities.json`：新增条目 `copyright-effect`（raw 全来自 `copyright-effect.md`）；`narrative` 字段落到 7 条（6 条重复条目 + 新条目）；`scene-3d-weather-effects-rain-snow-leaf` 的 `narrative` 从过期记录改指 live 生成表。生成物 `docs-new/03-engine/engine-capabilities.md` 由 `scripts/build-capabilities.mjs` 重生成（勿手改）。

**守卫**

- `app/amayui-emulator/test/doc-model.test.ts`：新增 **I9**「沿革不进叙述文档」（`03-engine` 的 `kind=narrative` 不得含「订正/旧句/历史判据」）；突变证明 `tickets/T-0105/evidence/i9-mutation.md`。

**新票**

- `tickets/T-0108`（P3）：数据层 146 处沿革话术（`semantics`/`note` → `journal[]`），并把 I9 扩到生成物。
