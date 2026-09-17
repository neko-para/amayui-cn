# T-0063 · 过程文档（notes.md）

## 2026-09-17

## 排查：那两个『被忽略』的调用是不是成因？

控制面板的『忽略 clearMeshSlots, clearSlotRecords』= 
ativeTap 的丢弃闸门：宿主（Pixi/headless）没实现
NativeBridge 上这两个可选缝。逐个查调用面：

| opcode | 引擎 | 语料 | 调用时机 |
|---|---|---|---|
|
