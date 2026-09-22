# T-0052 · 过程文档（notes.md）

## 从 ticket.json 的 `notes` 字段迁入（2026-09 文档模型）

范围提示：本票只做『键盘 → 掩码位 0..6』这一条链（含默认绑定表）；**不改**掩码位含义、不动鼠标/手柄路径、不做按键绑定 UI（`0x107`/`0x10B`/`0x10C` 的写入路径若要做，另开）。★它同时是 `T-0051` 第 5 条（0x10A 的 E3）的前置。★为什么之前没做：`T-0027` 的粒度只到『两把刷子』，当时把键盘记为『仅登记』（`src/vm/input.ts` 的字段注释），而掩码位的消费者（`joy-callback`）在纯鼠标操作下看不出来 ⇒ 一直静默。

## 2026-09-22 · 轮 12：判据 ③（真 ADV 菜单键盘 E3）收尾

- **能力**：`ScenarioSpec` 新增 `keydown`/`keyup` + `vk`（`src/frame/scenario.ts`）⇒ 键盘进入统一 Scenario，
  Electron/headless 两宿主同义；回放天然带键盘（轨迹输入快照里已有 `keyEdge`/`keysHeld`）。
- **E3 载体**：真实 `src/TITLE.txt` 菜单（它注册 `joy-callback 0..b` + 每帧 `i100`），而不是合成脚本 ——
  实测落点见 `evidence/keyboard-title-e3.md`：`↓`+`Enter` ⇒ **GAMESTART**；只按 `Enter` ⇒ 仍 TITLE（对照）。
- **节拍**：按下 4 帧、松开后 1 s；长按会让 `0x100` 每帧重复扫同一位（落点不确定，实测会落到 QUIT）。
- **判据 ⑤**：`npm run verify` 全绿；四份台账 `--validate` 绿。
