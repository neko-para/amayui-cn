# T-0049 · 过程文档（notes.md）

## 从 ticket.json 的 `notes` 字段迁入（2026-09 文档模型）

同轮顺带订正了 `rendering.md` 两处口径（由本单的 raw 复读逼出来的）：① 归并的 sort-key 是**表节点字节 +12 处的 key**（= handle = 层序），不是『项的 +12』——记录 `+12` 其实是源矩形 top（`sub_4ACE50` raw 131830-131833）；② `draw-texture` 记录 `+4 = op2 = 纹理槽`（`0x215` 用 `sub_4ADC20` 读它），不是『LAYER』；层序就是 map key。`i214` 的『整块互换但次序不变』正是『层序不在记录里』的反证。★未做：没有 E3 端到端（ADV 收场块在章节深处、BUNKIMOVE 需要武器画面状态；headless 里 boot SN0000 跑 2500 帧都到不了那些块），语义已由模型级 + VM 级守卫钉死。
