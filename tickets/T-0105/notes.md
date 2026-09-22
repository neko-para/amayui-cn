# T-0105 · 过程文档（notes.md）

## 2026-09-22 · 首次增量：判据 ①②③ 完成、判据 ① 做了 3/6、判据 ④ 定了口径

### 判据 ② 新条目 `copyright-effect`（raw 全部取自 `docs-new/03-engine/copyright-effect.md`，不凭空）

| 项 | 内容 |
|---|---|
| 时钟 | `Engine[92333]`（字节 +369332；池基读作 `Scene+46500`）/ 上一帧 `[92334]`；主循环 raw **20465-20576** 每帧 `timeGetTime()`（`0x2400` 含版权页等待旗标 `0x400` ⇒ 停脚本时时钟仍走）；脚本级时间戳 op `0x1F4`/`0x20C`/`0x23C` |
| 背景淡出（揭示） | mesh#1 顶点色窗：`0x322`→`sub_4AE2C0`(130789)、`0x323`→`sub_4AE330`(130806)；逐帧 `sub_4AF1C0`(131435) 131491-131501；`CalcDiffuse` `sub_4A2050`(120438) |
| 文字淡入 | draw-item diffuse-alpha 窗：`0x203`→`sub_4ACF60`(129850)、`0x202`→`sub_4AD0C0`(129936)；逐帧 `sub_49A300`(115116) |
| emulator | `modeled-verified` / E2，guard `test/mesh-vertex-quad.test.ts`（另见 `test/op-203-draw-color-alpha.test.ts`、`test/anim-window-done.test.ts`） |
| 落库位置 | `analysis/engine-capabilities.json`（`"id": "copyright-effect"`）→ 重生成 `docs-new/03-engine/engine-capabilities.md` |

### 判据 ① 已裁的 3 处（保留机制、逐字段交给台账）

- `adv-text-rendering.md`：换行步进只留「字号 + `Font+1380`（`i08b 10` ⇒ 46px）」与「注音不压上一行」的结论，字段清单回链 `#text-line-pitch-font-1380`。
- `rendering.md` §4.5：留公式 `M = T(-pivot)·S·R·Tt·T(+pivot)` 与那次实测事故，逐字段/门控回链 `#drawitem-world-matrix-composition`。
- `live2d.md`：节点矩阵合成只留「4 个窗在每帧绘制那一次求值 + 右乘进世界矩阵 + 对 z≡0 点的等价式」，其余（含四条实测口径、`wins.latched`）回链 `#live2d-node-matrix-compose` —— 核过该条目已包含被裁内容，无信息损失。

### 判据 ① 剩余 3 处 与 判据 ④ 口径

- 剩余：`sound-system.md:171-176`、`resource-loading.md:9-13` + §1.1 表；`stub-reaudit-2026-09.md:103` 是 `kind=record` 历史区（I8 只增不改）⇒ **不编辑**，改 narrative 指向 + 条目 note 说明（本次已做）。
- 「订正」话术：生成物（`opcode-table.md` 46 / `engine-capabilities.md` 7 / `opcode-gaps.md` 2）来自**数据层** ⇒ 不许手改生成物；手写文档 13 份 29 处待改写（清单见 ticket 判据 ④）。

## 2026-09-22 · 收尾：判据 ① 6/6、④ 手写范围清零 + 守卫 I9

### 判据 ① 剩下两处怎么裁的

- `sound-system.md` §5：留「曲号 ≠ 统一文件 id、两张表（扁平 = 曲号−2 / 分组 = 组号 1-based + 占位槽）、扁平表启动时从 SYS4INI 尾部读、分组表由 0x1D6-0x1D8 运行期长」+ 语料侧等价物（`BGM%03d.OGG`，`MUINIT.txt` 33/36）与 `TITLE.txt:14` 那个静音错曲的教训；删掉 `PCM+1304/+1320` 字段表和三路径逐函数 raw。
- `resource-loading.md` §1.1：六阶段表去掉「位置」列（`sub_455750`/`sub_401100`/`sub_41A000` 的 raw 区间）与异常/哨兵细节，留每阶段的**行为事实**（扫一次 `*.AAI`、@264 包号、@8 版本串 strcmp、槽 0 不用、`$n$AUTORUN` 派发、`SAVE.txt:875-888` 掩码比较、访问阶段可见报错）；emulator 现状压成一句 + 守卫名。
- `stub-reaudit-2026-09.md`：`kind=record`，按 I8 不动它；把该能力条目的 `narrative` 从「过期记录」改指 live 生成表 `opcode-table.md`（0x324-0x328 行全「已核对」）。

### 判据 ④：为什么"生成物没清"不是偷懒

- `grep -c 订正` 剩下的 57 处全在生成物里，文字来自数据层 146 处；手改生成物会被 `doc-model.test.ts` 的「生成物 = 真源渲染」断言打回 ⇒ 立 `T-0108`（含"改完把 I9 扩到生成物"这条判据，等于给数据层也上锁）。
- 新守卫 I9 的判据边界写在测试头注释里：只查 `03-engine` 的 `kind=narrative`；`record`/`session`/生成物不在内。
