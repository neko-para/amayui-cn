# T-0005 · 过程文档（notes.md）

## 2026-09-13

## 2026-09-14 收口

B5 完成：`ScenarioSpec` 一份定义被两个跑手共用；`npm run record`（Electron，真输入）+ `npm run replay`（headless，G3）一键可跑；`emulator.md` §7.1 闸门清单落地。状态 ⇒ done。

## ★缺口（诚实登记，未做）

1. **headless 自带 AGF 尺寸解析**：现在 `0x208` 的答案靠录制（见 changes.md）。要"不靠录制"就得让
   Node 侧也能同步回答图像尺寸（`NodeFileSource.readById` 是异步 ⇒ 需要预扫/预热那套），这是独立事项。
2. **回放只比 engine 段**：`host` 段（屏障次数/音频意图/字体缺字）本就允许不同（设计文档 §4）。
   "音频事件序列逐条一致"（T-0003 的等价性判据 5）仍是手工对照，没进 G3。
3. **`afterMarker` 的 headless 语义**只看"脚本名进入"，不看"页面/文案"；需要更细的等待条件时再加谓词。
