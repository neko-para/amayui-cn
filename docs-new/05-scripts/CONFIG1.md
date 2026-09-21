---
kind: generated
state: live
home: analysis/scripts.json
generated_by: scripts/build-scripts.mjs
---

# 脚本台账 · `CONFIG1`

> 由 `analysis/scripts.json` 生成（`node scripts/build-scripts.mjs`）—— **勿手改本文件**。

| 项 | 值 |
|---|---|
| 脚本 | `CONFIG1.BIN`（真源 `src/CONFIG1.txt`） |
| 状态 | ✅ 已分析 |
| 是什么 | 设置界面的**分类页主体**（本地化后的「系统设定」等页）：左侧分类列表 + 中部设置行（背景带 / 数值贴片 / 帮助图标 / 按 kind 的控件族）+ 右侧滚动条 + 行文本直绘。 |
| 怎么进/出 | CONFIG.BIN 在 `12721e == 4` 时 call-script 51cc；主循环入口 label_00001168 注册 joy/mouse 回调；退出走 label_0000d860（detach-texture 121000 区间 + exit）。跨脚本状态只在全局 `12721e`/`12721f`。 |

## 结构（读了哪些段）

| 行区间 | 锚点（必须出现在该区间内） | 职责 |
|---|---|---|
| `254-300` | `label_00001168` | 主循环入口：注册 joy-callback 0xa 个 + mouse-callback，初始读鼠标位置/滚轮 |
| `705-749` | `label_00002cec` | 滚动一步（键盘/滚轮）：把 5620 夹在 [0,5624]，再按 106+(428−拇指高)·5620/5624 重算拇指顶 3f6，并触发左列重绘 |
| `796-812` | `label_000032e0` | 切分类：12721e = 高亮项；置 7dd=1 ⇒ 退出脚本 ⇒ CONFIG.BIN 重新 call-script（重入） |
| `1070-1083` | `label_000045e0` | 鼠标点击分发：5625 = 高亮项；== 9 走滚动条拖拽（label_0000cab8），否则按分类/行处理 |
| `1099-1134` | `label_00004734` | 命中行的数值改动：由鼠标 x 与 325[]/130e60[] 表反算新值并写回配置 |
| `1136-1174` | `label_00004a78` | 重建当前分类的可见项表：36df[count] = (type<<16)\|value；主键 179f[count] = (type序<<16)\|value序 |
| `1176-1228` | `i12f (local-int 7ff)` | i12f 排序（A=7ff 索引 / B=179f 主键 / C=273f 次键）→ 467f[i] = 36df[7ff[i]]；再算 5622 行数 / 5623 拇指高 / 5624 最大起点 / 3f6 拇指顶 |
| `2488-2740` | `label_00009d80` | 行绘制循环：背景带 0x3e8+i / 数值贴片 0x3fc+i（源 Y=(type−1)·31）/ 帮助图标 0x410+i / 按 kind 画 0x514·0x528·0x5dc·0x5f0 控件族；行文本由 0x204 直绘进槽 196 再按行裁贴（0x1fb 槽 196，源 Y=行×40） |
| `2934-2971` | `label_0000c698` | 滚动条三段式拇指：轨道 → 上盖(27×23) → 中段(27×1，靠 0x1fd 纵向放大) → 下盖(27×24)；pivot（0x217）取的是**描画位置本身** |
| `2976-2990` | `label_0000cab8` | 拖动拇指：按鼠标 y 反算 5620（并 clamp 到 5624） |
| `3132-3138` | `label_0000d860` | 退出：detach-texture 121000 区间（0x3e8 个）+ exit |
| `872-908` | `call-script 51d3  // INITCONFIG0` | 「初始化本页」路径：按当前分类（12721e）分别 `call-script 51d3/51d4/51d5/51d7/51d9`（= INITCONFIG0..5，把该页设置写回默认并 save-int 登记），随后 INITREGINPUT(51da) + CHECKCONFIG(51db) 收尾（940-944 是「初始化全部」路径） |
| `2743-2760` | `set-font (global-string bbd)` | 设置行「参数文字/数值」（bbd）样式块 + 行文本直绘：★`i075 14`/`i076 ffffff`/`i077 ffffff` 在记忆门**之外**（每帧都执行）⇒ 行标签与行值是**白填充 + 白描边**；门内（3f36 != 9）才 `set-font bbd` + ★`i2bd 0`（不加粗）+ `i078 1`（单向描边）+ `i1a4 0 0`（无偏移）+ `i261 0`（横排）→ 3f36 = 9。随后 `draw-string c4 5 (7fe) 串` 把标签直绘进槽 196（值文本在 2770-2773，同一样式） |
| `2800-2810` | `set-font (global-string bbe)` | 设置行「参数数字」样式块（3f36 != 15 才设）：同一套参数但换 bbe 面，仍 ★i2bd 0 → 3f36 = 15 |
| `3025-3046` | `set-font (global-string bbf)` | 说明文（bbf）样式块：i075 1e + ★i2bd **1**（说明文是加粗的）+ i197 8 + i078 3 + i1a4 1 1 + i260 2 2 2 2 + i261 1 → 3f36 = 8；随后两条 draw-string（0x204）画进 create-texture c5 的表面（3043/3045） |
| `2870-2880` | `draw-texture (local-int 57c4) c4 0` | 把槽 196 的**行切片**（628×30 逻辑）贴到行上：引擎按槽表面的 **alpha** 合成 ⇒ 覆盖率 α 在这里生效（未涂到的像素 A=0 ⇒ 透出底板，所以真机/模拟器都看不到黑块） |
| `3196-3213` | `label_0000dc98` | ★**文本颜色的配置派生**（`i076/i077/i078/i1a4` 的唯一真源）：`f807b=ffffff`/`f807c=0` 是初值 → 按 `a9dd` 位 1/2 从**逐角色配色表** `adcd[14acda]` 取描边色/填充色 → 按 `a9de` 选描边档（=0 ⇒ `f8079=1`/`f807a=0`/**`f807c=f807b`**；≠0 ⇒ `f8079=3`/`f807a=1` 四向 1/1）→ `i076 f807b` / `i077 f807c` / `i078 f8079` / `i1a4 f807a f807a` 应用。真机 `a9dd=2`/`a9de=1` ⇒ **描边纯黑 0**、填充 = 配色色（暖白） |

## 关键槽 / 局部量

| 名字 | 含义 |
|---|---|
| `local 561f` | 当前分类的可见项数 |
| `local 5620` | 滚动起点（首个可见项在描述符表里的下标） |
| `local 5622` | 每页行数（项数 ≤ 9 时为项数，否则 9） |
| `local 5623` | 滚动条拇指高 = 428·9/项数，下限 0x2f=47 |
| `local 5624` | 最大滚动起点 = max(0, 项数−9)；为 0 时不画滚动条 |
| `local 3f6` | 滚动条拇指顶 y = 106 + (428−拇指高)·5620/5624（轨道 106..534） |
| `local 7e0 / 5625` | 高亮元素 / 按下元素（0..5 = 左侧分类，9 = 滚动条） |
| `local 7ff / 179f / 273f` | i12f 的 A（索引）/ B（主键）/ C（次键）三个数组 |
| `local 36df → 467f` | 源描述符表 → 排序后的描述符表（467f[i] = 36df[7ff[i]]） |
| `local 3e8 / 3fc / 410 / 514 / 528 / 5dc / 5f0 / 76c / 776..778` | 0x1d4c0 基址下的图元 handle 家族：行背景 / 数值贴片 / 帮助图标 / 控件两族 / 滚动条（轨道 + 拇指三段） |
| `global 12721e / 12721f` | 当前分类 / 上次高亮（与 CONFIG/CONFIG2 共享） |
| `call-script 51d3..51d9` | 六页默认值脚本（INITCONFIG0..5）的脚本 id |

## 不变量（拿它做回归断言）

- 0 ≤ local5620 ≤ local5624（滚动起点不得越界）
- 可见行序 = 按 i12f 的 B[x]+C[x] 升序排出的索引序，且**与 A 的初始内容无关**
- 拇指三段首尾相接：上盖底边 = 中段顶边、中段底边 = 下盖顶边
- 行描述符的 type ≥ 1（= 0 时数值贴片源 Y = −31 越界，那一行就只剩背景带）
- 行标签/行值所在的槽 196 表面：字形像素 alpha = 覆盖率 α（225/255）而**不是** 255 ⇒ 贴到行底板上字落在 α·255+(1−α)·底板 ≈ (233,231,230) 暖灰，且整个元件**不存在纯白 255 像素**（真机同口径）
- 行标签样式块（2746-2748）把填充与描边都写成**立即数 ffffff**，与 `a9dd`/`a9de` 派生的 `f807b/f807c` 无关（那两条每帧重设）

## 坑（踩过一次，别再踩）

- **切分类 = 退出 + 重入**（7dd=1 → exit → CONFIG.BIN 再 call-script）⇒ 帧局部池必须重建，否则 local5620 从上一页泄漏、拇指顶算到轨道外（实测：滚动条溢出轨道）
- i12f 的比较键是 B[A[j]]+C[A[j]]（用 A 里存的**索引**查 B/C），不是按位置比 A/C；且数组访存的 DEC/ENC 只能一层
- 0x204 直绘进槽 196 时必须先有 0x1f8 create-texture 建出的表面（引擎三个门：槽对象存在/可锁定/串非空）
- ★本页的行文本走 `draw-string`（0x204）⇒ 它**立即**消费当时的全局样式（与消息窗的「入队时钉住」正相反）；用户可改的字体/颜色设置正是靠这一点立刻生效
- ★「初始化本页」= 调用 INITCONFIG*（写默认值 + 登记），不是"重画界面"：误当无害重载会把玩家在该页的设置清掉
- ★**加粗是按文本块显式开关的、不跟着面走**：设置行（bbd/bbe）写 `i2bd 0`（20px），说明文（bbf）与 ADV 预览（bbb）写 `i2bd 1`；`global 3f36` 是样式代号记忆门（2/8/9/15），代号不变就不重设。⇒ 系统里装/不装粗体面**只会影响 i2bd 1 的那些文本**：真机「只装 400 时设置行是 400、之后装上 700 也没变」是**正常**的（T-0035 第 4 轮判定依据）
- ★设置行（bbd）的填充与描边**都是 ffffff**（2747-2748）⇒ 行标签/行值看起来"偏暗发暖"**不是取色问题**：可见值 = `α·255+(1−α)·底板`（α=225/255、底板≈(65,47,40) ⇒ (233,231,230)）。要动的是**槽表面的 alpha 合成**（capabilities `text-glyph-coverage-alpha-composite` / 函数 0x46D9F0），不要去改颜色
- `set-font`（0x1A5 → sub_4328F0）只换**字体面名**（+ 由当前字号推 lfHeight/lfWidth）、**不碰 Font+1360/1364/1372**（functions 0x433290）⇒ 样式块里 i076/i077 先于它执行也不会被覆盖；记忆门 3f36 只管 set-font/i2bd/i078/i1a4/i261，颜色三步每帧重设
- ★`f807b/f807c` 的**值**由本脚本 `label_0000dc98`（:3196-3213）按 `a9dd`（位 1=描边色 / 位 2=填充色）从 `adcd[当前角色]` 派生；真机 `a9dd=2` 只置**填充**色 ⇒ **描边是纯黑 0**，别把真机文字的暖调归给"描边色"（见 `docs-new/03-engine/adv-text-rendering.md` §10；这也是 T-0035 第 8 轮"暖暗描边"假设被排除的依据）

## 缺口

- 数值型行的**数字文本**走 0x205（GDI 数字绘制）——emulator 未实现（当前只画得出文本型的行值）

## 相关

- 引擎常态能力：`drawitem-world-matrix-composition`（见 `docs-new/03-engine/engine-capabilities.md`）
- 引擎常态能力：`glyph-raster-direct-to-slot`（见 `docs-new/03-engine/engine-capabilities.md`）
- 引擎常态能力：`script-frame-local-pool-lifecycle`（见 `docs-new/03-engine/engine-capabilities.md`）
- 引擎常态能力：`msgwin-window-reveal-gate-300`（见 `docs-new/03-engine/engine-capabilities.md`）
- 引擎常态能力：`text-style-scope-queue-time`（见 `docs-new/03-engine/engine-capabilities.md`）
- 引擎常态能力：`save-data-tables-persistence`（见 `docs-new/03-engine/engine-capabilities.md`）
- 函数结论：`0x42F560`（见 `analysis/functions.json`）
- 函数结论：`0x422FD0`（见 `analysis/functions.json`）
- 函数结论：`0x423390`（见 `analysis/functions.json`）
- 函数结论：`0x4AC5F0`（见 `analysis/functions.json`）
- 函数结论：`0x4ACF20`（见 `analysis/functions.json`）
- 函数结论：`0x4ACEE0`（见 `analysis/functions.json`）
- 函数结论：`0x46BE30`（见 `analysis/functions.json`）
- 函数结论：`0x434F60`（见 `analysis/functions.json`）
- 函数结论：`0x42DF40`（见 `analysis/functions.json`）
- 主题文档：`docs-new/03-engine/opcode-table.md`
- 主题文档：`docs-new/03-engine/message-config-gates.md`
- 主题文档：`docs-new/03-engine/adv-text-rendering.md`
- 守卫测试：`app/amayui-emulator/test/config1-chain.test.ts`
- 守卫测试：`app/amayui-emulator/test/draw-string.test.ts`
- 守卫测试：`app/amayui-emulator/test/draw-item-scale.test.ts`
- 守卫测试：`app/amayui-emulator/test/text-style-snapshot.test.ts`

## 证据与备注

- 证据：src/CONFIG1.txt 的区间见 layout；运行期断言见 test/config1-chain.test.ts 的 sort12f / configRows / scrollThumb / slotText 四项
- 备注：未读：左列重绘 label_000050f0 的细节、详情/说明区的**非样式部分**（翻页/裁剪/与 c5 表面的合成）、底部按钮与 0x1b5 一族的配置回写路径。★说明文区的样式块已读（3025-3046）。 ★本页行/值文本的样式归属与可见亮度机制已确证（2743-2760 + 2870-2880；`T-0042`）：行标签不是"描边是暗色"、也不是"不走那两行"，而是**白填充+白描边 + 槽表面覆盖率 α** 合成到底板上。
