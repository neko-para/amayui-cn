# T-0061 · 过程文档（changes.md）

## 2026-09-17

## 第 1 次变更（2026-09）——存档退栈 + 读档控制转移

### 改动
- \src/vm/handlers/save-slot.ts\ 的 \saveSlotFromEngine\：先取 \ENGINE_FIELD.storedCur\（= 0x1AD \i1ad\ 写的那格），
  ≥ 0 就用它当『存档帧』（并在与 \cur\ 不同时写一行日志），否则退回 \.cur\；帧记录只铺 \
