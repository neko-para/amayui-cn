# T-0003 · 过程文档（changes.md）

## 2026-09-13

## 第 1 次变更（2026-09-14）—— 验收 4 收口：FrameDigest + 两宿主等价测试

### 改了什么

| 文件 | 改动 |
|---|---|
| \src/frame/digest.ts\ | **新增**：\FrameDigest\（\ngine\ 段两宿主必须逐字段相等 / \host\ 段允许不同）+ 纯函数构建器 \uildFrameDigest(e, scene, …)\ + 规范化序列化 \canonicalize\ + 短哈希 \nv1a32\ + \diffEngineDigest\（指名
