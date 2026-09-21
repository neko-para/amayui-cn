# T-0085 · 过程文档（notes.md）

## 从 ticket.json 的 `notes` 字段迁入（2026-09 文档模型）

★本票由「扩展路线 C」的复核派生：路线 C 原定目标是 0x1d0/0x1d1，复核后发现那两条**不是度量族**（0x1d0 = 回看页索引表带步数读出、0x1d1 = GDI 文本页渲染器），真正的 GetTextExtent 缺口在这里。0x1d0/0x1d1 保持 deferred，理由与前提见 docs-new/99-records/2026-09-route-c/route-c-text-metrics-2026-09.md 与判定棘轮 test/op-1d0-1d1-text-metrics.test.ts。 ★本票落地（2026-09-20）：门与公式已接（src/text/layout.ts 的 BlankExtent/blankAdvance/numberCellExtent + handlers/msgwin.ts 的 blankExtentOf）；mode==0 与引擎的 font_size/(全角?1:2)（raw 87269-87280）逐字等价 ⇒ 原缺口降级为「仅非默认配置偏差」（触发方式 = 玩家把 INI 的 BlankExtentMode 设为 1）。★仍缺：宿主字体度量来源（GDI GetTextExtentPoint32A 的等价物）⇒ mode==1 显式回退为网格并把 TextFrame.blankExtentFallback 置真；要拿到什么与两种来源写在 src/text/layout.ts 文件尾「缺口」；0x204 直绘与绘制期「无轮廓字」未接。
