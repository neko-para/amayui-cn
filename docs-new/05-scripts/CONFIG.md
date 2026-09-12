# 脚本台账 · `CONFIG`

> 由 `analysis/scripts.json` 生成（`node scripts/build-scripts.mjs`）—— **勿手改本文件**。

| 项 | 值 |
|---|---|
| 脚本 | `CONFIG.BIN`（真源 `src/CONFIG.txt`） |
| 状态 | ✅ 已分析 |
| 是什么 | 「OPTION（设置）」的常驻父脚本：左侧分类切换（按当前分类 call-script CONFIG1 / CONFIG2）、消息显示预览（0x300 逐行贴出闸门 + ADV 样例窗）、底部按钮与返回。 |
| 怎么进/出 | TITLE 菜单点「CONFIG」→ call-script 进来；它自己**不退出**，而是按全局 `12721e`（当前分类）反复 call-script CONFIG1/CONFIG2（第 53/57 行）——所以『切分类』在脚本层面的实现是**子脚本退出后被这里重新调起**。 |

## 结构（读了哪些段）

| 行区间 | 锚点（必须出现在该区间内） | 职责 |
|---|---|---|
| `44-58` | `call-script 51cc  // CONFIG1` | 按全局 12721e 二选一：53 行 call CONFIG2、57 行 call CONFIG1（切分类 = 子脚本退出后在这里重新调起） |
| `30-40` | `i070 9 338 78 144 23a` | ADV 样例预览窗几何：窗 9 = 824×120 @ (324,570) |
| `38-40` | `i213 9 2c114 1f4` | 正文行层序起点 = 0x2c114 = 180500（文本必须画在普通 UI 图元之上） |
| `150-172` | `i300 9 1 3e8` | 全局文本样式（i075 1e=30px / i076·i077 颜色 / i2bd 1 加粗 / i197 a 注音 10px / i261 1 竖排标志）+ 打开窗 9 的贴出闸门并设 1000ms 停留 |
| `173-183` | `show-text 0 @"神缘ＳＡＭＰＬＥ"` | ADV 样例文案（原文 174-175 + 汉化 177-178 两行对照）+ 182 行 i301 9 收尾 |
| `190-200` | `i300 9 0 0` | 离开设置前关掉窗 9 的闸门（恢复常规消息行为） |

## 关键槽 / 局部量

| 名字 | 含义 |
|---|---|
| `global 12721e` | 当前分类索引（跨子脚本、跨退出重入保留） |
| `global 12721f` | 上次高亮的左侧元素（重进时恢复光标） |
| `win 9` | ADV 样例预览窗（几何 / 样式 / 闸门都作用于它） |
| `Engine[122466+9] / [122476+9]` | 窗 9 的闸门位（bit0）+ 停留毫秒（= i300 的 op2/op3） |

## 不变量（拿它做回归断言）

- 闸门开启期间由 sub_409400 每帧贴出一行；整段贴完后停留 op3 ms 清场并把 win+132 归零，**闸门位仍为 1** ⇒ 无限循环演示（设置界面的消息显示预览）

## 坑（踩过一次，别再踩）

- 0x300 是**每窗**闸门（Engine[122466+win] / [122476+win]），不是全局开关
- 子脚本（CONFIG1/CONFIG2）退出后由本脚本重新 call-script ⇒ 它们**一定是重入**，帧局部池必须重建
- ★样式有**作用域**：i075/i076/i077/… 只是「下一次排版用哪套样式」；引擎在**排版入队时**（0x6E → sub_46BE30）就把字形连颜色画进该窗的离屏表面，之后再改全局色**不回溯**。本脚本 150-183 行「设样式 → i071 9 → show-text」的顺序正是为此 —— 样例窗因此不会被 CONFIG2 逐行设的角色名颜色染上（详见引擎台账 text-style-scope-queue-time）

## 相关

- 引擎常态能力：`msgwin-window-reveal-gate-300`（见 `docs-new/03-engine/engine-capabilities.md`）
- 引擎常态能力：`text-reveal-pump-409400`（见 `docs-new/03-engine/engine-capabilities.md`）
- 引擎常态能力：`adv-perframe-dispatch`（见 `docs-new/03-engine/engine-capabilities.md`）
- 引擎常态能力：`script-frame-local-pool-lifecycle`（见 `docs-new/03-engine/engine-capabilities.md`）
- 引擎常态能力：`text-style-scope-queue-time`（见 `docs-new/03-engine/engine-capabilities.md`）
- 函数结论：`0x426990`（见 `analysis/functions.json`）
- 函数结论：`0x46BE30`（见 `analysis/functions.json`）
- 主题文档：`docs-new/03-engine/message-config-gates.md`
- 主题文档：`docs-new/03-engine/adv-text-rendering.md`
- 守卫测试：`app/amayui-emulator/test/config1-chain.test.ts`
- 守卫测试：`app/amayui-emulator/test/text-style-snapshot.test.ts`

## 证据与备注

- 证据：src/CONFIG.txt:30-40 / 44-58 / 150-183 / 190-200；闸门语义见 analysis/functions.json 的 sub_426990 与台账 msgwin-window-reveal-gate-300
- 备注：未读：底部按钮（初始化本页/全部/返回）的具体分支与 0x142/0x2ce 一族的用法。
