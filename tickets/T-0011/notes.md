# T-0011 · 过程文档（notes.md）

## 从 ticket.json 的 `notes` 字段迁入（2026-09 文档模型）

（2026-09-14 B1）两张 chain 的「无条件清 0x400 / 不推进动画窗 / ADV 分支吞异常」这些行为**没有改变**，只是从各家手写的 for 循环搬进了 `src/frame/loop.ts` 的驱动配置（`gates.anim='clear'`、`advErrors='swallow'`、帧末钩子里没有 `advance()`）。本票要决策的对象因此变成"驱动的那几个档位该不该保留"——证据锚点可从 chain 文件上移到驱动。

（2026-09-14 B2 第 1 批）本票拆成两半，进度一半：
- ✅ "两份 chain **从不推进动画窗**" ⇒ **已修**（B2/A1：`FrameHost.advanceModel` 每帧一次，chains 已接）。
- ⏸ "**每帧无条件清 0x400**" ⇒ 仍在（chains 传 `gates.anim: 'clear'`）。原因见 T-0002/notes：改成 `'wait'` 会改变
  脚本执行路径（`mesh-vertex-quad` ② 的 0x19640 端点色从 #80000000 变 #00000000），必须先做路径级 before/after。
