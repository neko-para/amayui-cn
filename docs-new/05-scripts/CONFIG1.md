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

## 不变量（拿它做回归断言）

- 0 ≤ local5620 ≤ local5624（滚动起点不得越界）
- 可见行序 = 按 i12f 的 B[x]+C[x] 升序排出的索引序，且**与 A 的初始内容无关**
- 拇指三段首尾相接：上盖底边 = 中段顶边、中段底边 = 下盖顶边
- 行描述符的 type ≥ 1（= 0 时数值贴片源 Y = −31 越界，那一行就只剩背景带）

## 坑（踩过一次，别再踩）

- **切分类 = 退出 + 重入**（7dd=1 → exit → CONFIG.BIN 再 call-script）⇒ 帧局部池必须重建，否则 local5620 从上一页泄漏、拇指顶算到轨道外（实测：滚动条溢出轨道）
- i12f 的比较键是 B[A[j]]+C[A[j]]（用 A 里存的**索引**查 B/C），不是按位置比 A/C；且数组访存的 DEC/ENC 只能一层
- 0x204 直绘进槽 196 时必须先有 0x1f8 create-texture 建出的表面（引擎三个门：槽对象存在/可锁定/串非空）

## 缺口

- 数值型行的**数字文本**走 0x205（GDI 数字绘制）——emulator 未实现（当前只画得出文本型的行值）

## 相关

- 引擎常态能力：`drawitem-world-matrix-composition`（见 `docs-new/03-engine/engine-capabilities.md`）
- 引擎常态能力：`gdi-direct-text-to-slot`（见 `docs-new/03-engine/engine-capabilities.md`）
- 引擎常态能力：`script-frame-local-pool-lifecycle`（见 `docs-new/03-engine/engine-capabilities.md`）
- 引擎常态能力：`msgwin-window-reveal-gate-300`（见 `docs-new/03-engine/engine-capabilities.md`）
- 函数结论：`0x42F560`（见 `analysis/functions.json`）
- 函数结论：`0x422FD0`（见 `analysis/functions.json`）
- 函数结论：`0x423390`（见 `analysis/functions.json`）
- 函数结论：`0x4AC5F0`（见 `analysis/functions.json`）
- 函数结论：`0x4ACF20`（见 `analysis/functions.json`）
- 函数结论：`0x4ACEE0`（见 `analysis/functions.json`）
- 主题文档：`docs-new/03-engine/opcode-table.md`
- 主题文档：`docs-new/03-engine/message-config-gates.md`
- 守卫测试：`app/amayui-emulator/test/config1-chain.test.ts`
- 守卫测试：`app/amayui-emulator/test/draw-string.test.ts`
- 守卫测试：`app/amayui-emulator/test/draw-item-scale.test.ts`

## 证据与备注

- 证据：src/CONFIG1.txt 的区间见 layout；运行期断言见 test/config1-chain.test.ts 的 sort12f / configRows / scrollThumb / slotText 四项
- 备注：未读：左列重绘 label_000050f0 的细节、详情/说明区的绘制分支、底部按钮与 0x1b5 一族的配置回写路径。
