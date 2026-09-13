# T-0001 · 过程文档（notes.md）

## 2026-09-13

### 范围（B1）

- 新增 `src/frame/{frameLoop,host,observer,digest,scenario}.ts`；**frameLoop 只依赖接口**（不得 import pixi/DOM/electron）。
- 先把 headless 各入口（`report.ts` / `config1Chain.ts` / `gameStartChain.ts` / `run.ts`）接到 `frameLoop`。
- 每处差异用 `FramePolicy` **显式**表达（批上限 / 时钟 / 门分支集合 / 错误策略 / 是否推进模型）——
  ★**不许"顺手统一"**：B1 的判据是"零 diff"，任何行为变化都要留给 B2。
- 删死代码（T-0014 的两项：`interpreter.run()`、`Engine.pickHoverLabel()`）。

### 接口骨架

```ts
interface FrameHost { bridge; now(); yield(); present(); needsRender(); animationsDone(); texturesIdle?(); audio?(); digest(); }
interface FrameObserver { onFrameStart?; onStep?; onGate?; onDispatch?; onPresent?; onAudio?; onError?; }
```

### 判据（原样照抄设计文档）

1. `npm test` 全绿；
2. `test/scene-report.test.ts` 快照文本**逐字节不变**；
3. 各入口报告的 steps / clock / 门计数**逐字不变**。

### 回滚点

四家循环都是薄壳 ⇒ 逐个还原即可；`src/frame/*` 是新文件，删掉不影响别处。
