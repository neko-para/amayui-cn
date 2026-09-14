# T-0027 · 过程文档（repro.md）

## 2026-09-14

## A. headless 复现（30 秒，任意平台）

模型：等待门 + 按住不放 + 每帧泵一次。

```ts
// 显示面板、写一页、置等待门
step(0x94); step(0x6e, [im(0), str('一页文案')]); step(0x6f, [im(0)]); step(0x72, [im(0)]);
e.input.setCursor(10, 10); e.input.pressMouse(0);        // ★只按不松
for (let frame = 0; frame < 10; frame++) {
  if (e.awaitingAdvance && e.serviceAdvanceWait()) pages++;   // 泵
  step(0x72, [im(0)]);                                        // 脚本回到门重新挂起
  if ((frame + 1) % 3 === 0) e.input.releaseMouse(0);         // 第 3 帧才松（≈50ms 的普通点击）
}
```

现状：`pages = 3`（第 3 帧松开后停止）。期望：`pages = 1`。

**判据**：`pages` 必须恒为 1，与「按住多少帧」「down/up 是否同帧」无关。

## B. 产品路径手测（E4，macOS + jp 资源）

1. 启动 emulator 进 ADV 场景（序章/任意对话）。
2. 观察 trace 的 `=== advance-wait handled ===` 行与页计数。
3. **单击一次**（快速点一下就松）：文案只前进一页；不得出现连续多页滚过。
4. **按住左键 1 秒**：文案不推进（或按修正后的语义只推进一页）；不得持续翻页。
5. **按住后把指针拖出窗口再松开**（制造丢 mouseup）：松手后不得继续翻页；按钮态必须自愈。
6. 截图/日志（每帧一条 handled 的 trace）写进 `changes.md`。
