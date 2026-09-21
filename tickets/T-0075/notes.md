# T-0075 · 过程文档（notes.md）

## 2026-09-20

### 轮 7 复核：`op-1/0x100-push-return-point` = **stale（已修复），勿再当待办**

`docs-new/99-records/2026-09-audit/audit-2026-09-opcodes.md` 的 `### op-1/0x100-push-return-point` 条在**审计当时**成立，但已在更早一轮落地（`tickets/T-0077/notes.md` §「B4 第三条」）：`app/amayui-emulator/src/vm/handlers/input.ts` 现在按两条分支**不对称**实现 —— `pushReturn(plusOne)`（现 `:163-167`），掩码分支 `pushReturn(false)`（现 `:186`，`ret` 回到 0x100 继续扫下一个键）、默认键分支 `pushReturn(true)`（现 `:196`）；扫描游标 `ENGINE_FIELD.keyScanCursor`（`Engine[cur+122287]`，写 `b+1`）也已建模（现 `:181`）。

已在审计正文该条下加 **★订正（轮 7 复核）** 段说明「已落地 + 旧行号已漂 + 残留近似是扫描游标复位没有帧泵钩子」。

⇒ 本票的剩余清单里**不要**再列这一条；同类「审计条已被后续轮次修掉」的条目应继续按此法逐条标注（这是本票 P1 的一部分价值：审计本身也会陈旧）。

## 2026-09-20

## 轮 8 追加批：一处「文档自相矛盾」（典型凭空点形态）

- `app/amayui-emulator/src/vm/msgwin.ts:75` 注释：「`background` ← `sub_43B070(dd, 表面, 色)`（op `0x70` 之后引擎用窗口底色填面）」。
- `analysis/engine-capabilities.json` 的 `text-glyph-coverage-alpha` 条目 note（★T-0035 第 10 轮订正）：「`sub_43B070` 是"**设色键**"不是"填底色"；填面是 `sub_43E260`」。

两者不可能同时成立。轮 8 追加批另确证：宿主端 `src/renderer/text/raster.ts:326` 的填面注释引的是 raw **74261-74265**（= `sub_43E260` 的调用点，与台账一致），而 `msgwin.ts:75` 引的是 `sub_43B070`（与台账矛盾）。
⇒ **初判 `msgwin.ts:75` 的括号说明是凭空点**（被引函数名错），但 `.lst` 逐字节复核未做 ⇒ 待 `T-0102` 的白底取证结论落定后一并订正（订正时同时核对 `docs-new/03-engine/adv-text-rendering.md` 是否复述了同一句）。

## 2026-09-20

### 轮 8 追加批：上一条矛盾**已定案并订正**

取证用 `.lst` 复核完毕（`T-0102` 的白底取证）：`sub_43B070` 的错误串是 `"関数：ddSetColor エラー：不正なsurface"`、尾调用 `mov eax,[ecx+74h]` = 表面 vtable+0x74 = **SetColorKey**（参 8 = `DDCKEY_SRCBLT`），`.lst:97104` 起；`ddFillSurface` 是 `sub_43E260`（`.lst:102245` 起）。
⇒ **能力台账对，`app/amayui-emulator/src/vm/msgwin.ts` 的注释是凭空点**。已订正两处（都在本批）：`src/vm/msgwin.ts` 的 `WinGeom.background`（原「← `sub_43B070`…用窗口底色填面」）与 `src/renderer/text/raster.ts` 的填面分支（原「引擎 dd 路径 `ddFillSurface(surfaces[20+win], 底色)`」）；两处都补了 `.lst` 级证据与「该字段恒 `null`、全 `src/` 无写入点、分支是死码」的结论。
★顺带一条**同类风险的提醒**：`Scene+1560` 曾被当成"窗底色缓存"，实际是**像素格式掩码**（`sub_43B260` `.lst:97339` 写 `0x00FF0000/0x0000FF00/0x000000FF` 到 `+1556/+1560/+1564`）⇒ **引擎没有"窗自己的底色字段"**。凡是把"某个 Scene/Font 偏移"直接命名成语义字段的地方，都该按这个教训复核一遍（正是本票的活）。

## 从 ticket.json 的 `notes` 字段迁入（2026-09 文档模型）

方法学副产品（对后续审计有用）：① 判断「某字段是不是死写」必须自己 grep 全文件的读写点 —— 本次一个 P0 与一个 P1 都源自旧文档把「有读者的字段」写成死写（0x238 / 0xD9 的 0x1000 位）；② 台账/文档里的「已实现/未实现」不能互相信任，必须打开代码与测试（本次实证：台账说「两宿主没接线」实际每帧都在消费；说「完全没接」实际 7 条参数面 + 面名映射都已落地）。③ opcode-table.md 里「已核对但无 raw 引用」的 37 行是历史遗留（算术族 0x50-0x5F 等），多数语义正确但没有行号锚点。

## 2026-09-21

## 轮 9：交付物自包含性收尾（本票结算）

审计明细本身早已落地（三份报告 + 总览），本轮补的是**"报告自包含"这一条验收**：

1. ★**总览引用了一个不存在的节**：§5 写「执行状态见 §6」，而 `audit-2026-09.md` 只有 §5 与 §7
   —— 对下一个读报告的人，"执行状态"等于不存在。已补 **§6 执行状态**（B0..B7 逐批：票号 / 内容 / 状态 /
   出口判据与守卫；副表记"审计自身陈旧"的处理法（`op-1/0x100-push-return-point` 就地加★订正））。
2. ★**机器可读清单只住在 `.tmp/`**（gitignore）⇒ 报告正文引用的"数据清单"别人拿不到。
   已归档为票据证据：`tickets/T-0075/evidence/audit-final-{opcodes,capabilities,docs}.json`
   （kept/dropped/unclear = 95/9/0、84/9/6、67/13/2，与三份报告的统计一致 —— 由守卫核对）。
3. 新增守卫 `app/amayui-emulator/test/audit-report-completeness.test.ts`（3 条）：
   ① 三份明细各自含「方法 / 覆盖 / 统计 / 误报」四件套 + 复核分布；
   ② §6 存在且 B0..B7 各有归属票（钉住上面第 1 条，防它再次腐烂）；
   ③ 归档清单存在且 kept/dropped/unclear 与报告口径一致（钉住上面第 2 条）。
   意义：这类"报告必须自包含"的要求**不写进守卫必然腐化** —— 本轮的第一条缺陷就是它腐化的实证。

### 判据
- `npx tsx --test test/audit-report-completeness.test.ts` ⇒ 3/3 绿。
- 全量 `npm test` 绿（见 changes 记录）。
- 未改动任何被锚定的报告正文行（只在总览里**新增** §6；§5 的引用句与三份明细原样保留）。
