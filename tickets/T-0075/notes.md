# T-0075 · 过程文档（notes.md）

## 2026-09-20

### 轮 7 复核：`op-1/0x100-push-return-point` = **stale（已修复），勿再当待办**

`docs-new/03-engine/audit-2026-09-opcodes.md` 的 `### op-1/0x100-push-return-point` 条在**审计当时**成立，但已在更早一轮落地（`tickets/T-0077/notes.md` §「B4 第三条」）：`app/amayui-emulator/src/vm/handlers/input.ts` 现在按两条分支**不对称**实现 —— `pushReturn(plusOne)`（现 `:163-167`），掩码分支 `pushReturn(false)`（现 `:186`，`ret` 回到 0x100 继续扫下一个键）、默认键分支 `pushReturn(true)`（现 `:196`）；扫描游标 `ENGINE_FIELD.keyScanCursor`（`Engine[cur+122287]`，写 `b+1`）也已建模（现 `:181`）。

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
