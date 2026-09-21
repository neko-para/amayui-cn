# T-0040 · 过程文档（notes.md）

## 从 ticket.json 的 `notes` 字段迁入（2026-09 文档模型）

实测（2026-09，`npm run shot -- --gamestart --name t17edge2`）：
```
[window] 贴边档=bottom 位置=(224,1085) 可用区=1728x1084@(0,33) 窗口=1280x720（只留 32px 可见；showInactive 不抢焦点）
[window] 贴边档=bottom 位置=(614,1085) 可用区=1728x1084@(0,33) 窗口=500x720（只留 32px 可见；showInactive 不抢焦点）
```
可用区下缘 = 33+1084 = 1117 ⇒ y=1085 = 1117−32 ⇒ 只有标题栏在屏内、窗口其余部分在屏幕下方。截图（`capturePage`）不受位置影响，仍与居中时逐像素一致。
