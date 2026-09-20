# T-0077 · 过程文档（notes.md）

## 2026-09-19

B2（T-0082）的操作数口径守卫又独立命中三处本票条目，其中 0x20F 已修：引擎体 sub_4237B0（raw 31604-31670，arity 槽 7 ⇒ argc=3）读 op1=影片 id、op2=影片槽（对象表 [4*slot+378688]）、op3=音量/模式选择子；emulator 此前只读 op1 ⇒ 现按体读三位并让宿主缝 playMovie(id,slot,mode) 接收（Pixi/Stub 两处实现 + 声明同步）。0x1F9（丢颜色 op3）与 0x34B（丢 op4..op6、op2 类型错）仍在本票：0x34B 语料 0 处命中、0x1F9 需按体接颜色参数，排在 B4。

## 2026-09-19

B4 第一条（目标轮 6）：**0x305 文本块结束未清 Engine[122497]（注音/内嵌模式位）** —— 审计 P2 op-7-0x305-flags-not-cleared 已修。引擎 sub_41B1C0（raw 26033-26102）**三条出口都清** Engine[489988]（= dword 122497）：raw 26083/26095（共享 LABEL_12 与等待门分支）、raw 26099（else 出口）；emulator 此前不清 ⇒ 0x304 置 1 后一位永久留着，之后的 show-text 一直走 sub_46BE30 的注音分支（文本表现错）。实现：op_text_block_end 末尾 msgwin.flags = 0；守卫 test/char-reveal.test.ts（0x304 置 1 → 0x305 归 0）。同时把 0x305 的 opcode-table 行由「仅映射」补成「已核对」并记下出口处未建模的两段（effect_flags |= 0x20000000 + sub_453A60 / 清等待计时器三格）。

## 2026-09-19

B4 第二批（目标轮 8）：按审计逐条修掉四处「凭空/扩大范围」的实现：① **0x2E7**（审计 P2 op-10-001）—— 引擎只承认 idx 0/1（raw 33534-33562：if (read(1)) { if (read(1)==1) SetConfig(Pitch1) else 错误串 } else SetConfig(Pitch0)），emulator 修前 idx===1?1:0 把 idx≥2 静默写成 0 号键 ⇒ 现严格二分 + 非法值只留痕不写键；② **0x1B9**（同形状，raw 29191-29220，错误串 aGetautomessp）同修（审计只点了 0x2E7，读体发现兄弟同样问题）；③ **0x2FC**（审计 P2 op-10-003）—— 无触点路径引擎只写 op1=0 就 return（raw 40798-40799），emulator 此前多写 op2..op5（与自身注释矛盾）⇒ 现只写 op1，并把它登记进操作数口径守卫的 ALLOW（原因=引擎语义如此）；④ **0x1CE**（审计 P3 op-10-004）—— op1==0 时引擎**只对 Engine[122371]（当前窗）** 做一次 sub_45A940(...,-2,0)，emulator 此前对所有 reveal 窗整段收尾 ⇒ 现只收当前窗。守卫：test/config-version-substr.test.ts（0x2E7/0x1B9 的非法 idx 不写键 + 0x2E6/0x1B8 读回不变）、test/char-reveal.test.ts（0x1CE）、test/opcode-operands.test.ts（0x2FC 白名单）。

## 2026-09-19

B4 第三条（目标轮 14）：**0x100 按键派发的返回点与扫描游标**（审计 P2 op-1/0x100-push-return-point）。引擎 sub_419AF0（raw 25012-25066）两条分支压的返回点**不同**：① 掩码分支（raw 25039-25040）压 (ip-ip_base)>>2 = **本指令**（无 +1）⇒ handler 的 ret 回到 0x100 **继续扫下一个键**（写游标 Engine[cur+122287] = b+1，raw 25038）；② 默认键分支（raw 25052）压 +1 = 下一条。emulator 修前两条都压 index+1 ⇒ 一次 0x100 最多派发一个按键（多键/组合操作会漏）。修后：新增 ENGINE_FIELD.keyScanCursor = 122287（

## 2026-09-19

目标轮 15 决策记录：**0x34B / 0x348 暂不半修**。理由：体（raw 34643-34650）读 op2/op3 为 int(delay/dur)、op4..op6 为 **float 缩放三分量**，而 emulator 的 Live2D 节点模型是 \
ode.wins.scale = { value: percent/100, delay, dur }\（**标量**）—— 要按体修必须先把模型与 live2d/render.ts 的插值扩成三分量；而 0x34B 在语料里 **0 处**使用（0x348 同族、实为轴角旋转也可能要新字段）。按
