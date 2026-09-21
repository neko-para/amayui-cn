# T-0102 · 过程文档（notes.md）

## 2026-09-21

## 轮 9：判据跑通 + 三处语义订正 + 候选重排（详见 `changes.md` §「轮 9」）

- **工具已就位**：`config1Chain` 新增 `ChainOptions.advReturnProbe`（可铺 `{fromAdv,g0,g1397,msg}`）⇒ 「右键退出 CONFIG → 回 ADV 重派生」这一段**可以一键复现并 dump**。
- **★三处语义误读已订正**：`jcc` 的两目标是 op2/op3（0xFFFFFFFF = 落下句）；`gre`/`lt` 的 **op1 是目的**、op2/op3 才是比较对象；`adcd` 存的是 **alpha=0 的 BGR（恒正）** ⇒ `:377-379` 是「`>= 0` ⇒ 应用」。
- **★新发现的门**：`CONFIG.txt:225` 的 `local10 = ((g0==1)||(g0==6)) && (1397==1)`，**`1397 != 1` 会把整块（含 `i082`）一起跳过**；而 `1397` 不由 CONFIG 维护（只有 4 处读），由调用方 `SN0000` 的逐页管线设。
- **实测**：`3f37 = -1`（旁白）⇒ `14acda = 0`、`f807b = #ffffff`、`i082` 被执行 ⇒ **重派生的脚本逻辑是对的**（原候选 1「算错」被证伪）。
- **守卫已补**（本票核心判据）：`test/config1-chain.test.ts` 新增「退出设置页的重派生会改全局文字色」——两组对照（旁白 ⇒ `#ffffff`；`1397=0` ⇒ 保持紫且不执行 `i082`）。
- **下一步（唯一判决实验）**：用 **ADV 入口**（`SN0000.txt:609` 的 `call-script 34 // CONFIG`，菜单项 id `f`）跑完整路径并 dump `1397`/`g0`/`3f38`/`3f37`/`f807b` + 当时窗里的文本样式。若判据指向「重派生跑了但没重画」⇒ `T-0104`（`i082` 真语义）升 **P1** 并与本票合并处置。
- ★**纪律**：不要把"重派生算错"再当结论；也不要用「清全局/清槽/re-set 样式」这类启发式去糊（引擎没有这一步）。

## 从 ticket.json 的 `notes` 字段迁入（2026-09 文档模型）

★**轮 9 现状**（白色半边）：分支判死（`708ada` 恒 0 ⇒ 恒走填灰支；槽 48 是 DEBUG 路径）；白底的形状 = **未解析纹理槽的 `draw-texture` 项被画成纯白矩形**（`presenter.ts` 的 `#placeholder` + tint 被 `itemColor` 覆盖）；「开合侧边栏才对」的机制 = 第二次 `set-texture` **同步**命中 `#imgCache`（探针实测）。**已修**：`TextureCache.onReady → pixiBackend.#markDirty()`（白占位块最多存活一帧）+ `session.ts` 的纹理屏障覆盖 `0x249`；守卫 `test/texture-bind-race.test.ts`(7)。**未修（登记）**：H2 `waitIdle` 500 ms 超时后仍静默按 0×0 走；H3 世代判据把槽打成永久无纹理后 `resolve`/`size` 无自愈点；`presenter` 对「`imgid` 已知但无纹理」**完全静默**（建议放宽到 `!tex`）。★**未证**：用户那一次白的是哪个槽/handle（冷载 `SC0000` 不画 ADV 窗口、DEBUG 入口在未实现的 `i140` 上活锁）⇒ 修复针对"白底这一类"的机制，不等于已复现用户那一帧。★**紫色半边**：判据已跑通（`advReturnProbe`），三处语义误读已订正、发现 `1397` 门；下一步 = 用 ADV 入口跑完整路径（判据见 `changes.md` §「轮 9」§5）。过程文档：`changes.md` / `white-report.md` / `notes.md`。
