# T-0132 · 现状盘点与实测（2026-09-23，由 T-0126 第 4 次变更分派）

## 1. 起点实测（本机）

```
$ npm run test:e4
（T2 真机档（需要 Electron）：0 个文件）            ← 本次分派的起点：档位在、文件没有

$ npm run verify
ℹ tests 1086   ℹ pass 1084   ℹ fail 0   ℹ skipped 2   real 34.6 s
```

| 事实 | 值 |
|---|---|
| `run.ts` 的 `all` | `run(pick(() => true))` ⇒ **含 T2**（但该文件头注写的是 `all = T0 + T1` ⇒ 两处口径不一致，本票要统一） |
| `run.ts` 的 `e4` | `run(byTier('T2'))` ⇒ 只跑 `@tier T2` |
| Electron | `app/amayui-emulator/node_modules/electron` v**44.2.0** 已装；`dist/electron/main.cjs` 已构建 |
| 真机产物 | `.tmp/*.png` 有历史 E4 截图（如 `itemrestore-0-title.png`，~4 MB）⇒ 这台机器跑得动 E4 |
| 可复用观测面 | `tools/shot.cjs` 一律 `waitLog(...)` 等日志标记（**不睡固定秒数**）；`tools/dbg.cjs` 支持 `click/clickimg/move/shot` 远程驱动 |
| 前置探测写法参考 | `test/realSlots.ts`（真资产探测 + `t.skip()` 口径）、`test/organization.test.ts` 的 R2（档位诚实） |

## 2. 本票要显式决定的那件事（不要留到实现里顺手定）

`all` 含 T2 ⇒ 落第一个 T2 文件的那一刻，`npm run verify` 就开始：
- 需要 GUI 会话（无显示器的 CI/沙箱会红）；
- 墙钟 +数十秒（对照 T-0115 的收口：51.4 s → 31.3 s，本轮 34.6 s）。

两条自洽的路（**选一条并在 changes.md 写理由 + 实测数字**）：
1. **T2 不进 `all`**（`all` = T0+T1，与它的头注一致）：T2 只能显式 `npm run test:e4` 跑。好处：`verify` 与 T-0115 的成本收口不冲突；
   代价：E4 不再是"提交前必跑"，需要在文档里写清"什么时候必须跑 e4"（改渲染宿主/输入/窗口时序时）。
2. **T2 进 `all`**：`verify` 承担 E4。好处：真机判据与提交同源；代价：`verify` 的机器要求与耗时都要重新写进 `docs-new/04-app/emulator.md` 的闸门表。

## 3. 首批文件的候选判据（供实现时选）

| 候选 | 判据 | 能抓住的症状类别 |
|---|---|---|
| 启动链到 TITLE | `shot` 日志出现 `-> TITLE.BIN`（`waitLog` 已有） | 启动链断/回归（T-0005/T-0128 的 E4 工具链就是这么发现问题的） |
| 首帧不是纯色 | 截图采样后同屏颜色数 > 1（或与基线 digest 一致） | **黑屏**（T-0040 贴边开窗）、**白块**（T-0102 ADV 正文行画成白矩形） |
| 两宿主 digest 一致 | `npm run record` + `npm run replay` 的 `FrameDigest` 逐字节相同（`T-0003` 验收 4 / `T-0128` 已把 l2d 段接上） | 渲染宿主与 headless 的漂移 |
