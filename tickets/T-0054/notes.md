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
  - 数据层：`analysis/functions.json` 新增 **33 条** L2D 条目（并订正 `0x341/0x345`）；`analysis/engine-capabilities.json` 新增 **3 条** Live2D 能力（两条既有条目升 E1）；
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

| acceptance | 阶段 | 内容要点 |
|---|---|---|
| #1 | **M0 → M1 前置** | 依赖路线定案（写进评估文档 §3），若选 B 还要给出许可判定与 headless 验证方案 |
| #2 | **M1 静态姿态** | 资源直读（`.MOC`+PNG+`.MTN`，不依赖 `.model.json`/CDN）+ 572B 节点变换控制 → 标题立绘出画 |
| #3 | **M2 动作** | `0x341/0x342/0x345/0x352/0x34E` 语义对齐 + 「装载即入队」+ **推进绑在节点绘制那一次调用**（`live2d-node-draw-advance`）+ `.MTN` 的 `$fps/$fadein/$fadeout` |
| #4 | **M3 集成** | 10 槽接进 `sub_40BE10` 重画判据（`live2d-slot-probe`）+ `global a9d0` 门控与静态回落（`live2d-enabled-config-flag`） |
| #5 | **M3 验证** | headless E3（digest / 572B 节点快照，不依赖 WebGL）+ ≥1 张 Electron E4 截图与静图回落对照 + 守卫进 `tests[]` + 能力条目上调 |
| #6 | **M3 文档** | `opcode-table.md` 的 `0x345` 订正 + `0x34F/0x350/0x351` 转「已核对」+ `stub-reaudit-2026-09.md` 加改判注记 |

---

## 4. 复核命令（改数据层/文档后必跑）

```bash
node scripts/build-capabilities.mjs                                            # 第二层渲染物
node .agents/skills/amayui-engine-analysis/scripts/capabilities.js --validate
node scripts/build-tickets.mjs                                                 # 看板
node .agents/skills/amayui-ticket-ledger/scripts/tickets.js --validate
cd app/amayui-emulator && npx tsx --test test/capability-ledger.test.ts test/ticket-ledger.test.ts test/script-ledger.test.ts
```

---

## 5. 互链

- **评估正文**：`docs-new/04-app/live2d-support-assessment.md`（本单的"要不要引依赖库 / 系统大致能力"都在那里）
- 引擎语义长文：`docs-new/03-engine/live2d.md`
- 数据层：`analysis/functions.json`（`report.js --find live2d`）、`analysis/engine-capabilities.json`（`capabilities.js --subsystem Live2D`）
- 相关票：**T-0051**（E4 真界面待验证清单 —— 本单的 E4 项可挂在那里）
- 被本单改判的旧结论：`docs-new/03-engine/stub-reaudit-2026-09.md` §3 曾把 Live2D 列为"排除项"（acceptance #6 要加改判注记）
- **尚未登记的脚本**：`INFOEN` / `BTL` / `SETL2DMOC` 家族（M1 读到时按脚本台账纪律补 `analysis/scripts.json`；`TITLE` 已登记）
