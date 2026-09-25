---
kind: index
state: live
---
# 04-app · app 工具（三大子工程）

`app/` 下三个**互相独立**的可运行子工程。各自独立文档见下文（`docs-new/` 内部链接）。

| 子工程 | 目标 | 技术栈 | 现状（见其文档） |
|---|---|---|---|
| [`emulator.md`](./emulator.md) | 用 TS 重写 AGE 引擎 VM + Electron/PixiJS 渲染壳 | TypeScript + Electron + PixiJS v8 | ★**架构总览**（分层/真源/三闸门/缺口）；`npm run verify` 全绿（380 测试、3×tsc、死写棘轮）；链路 `SYSTEM4→…→TITLE→GAMESTART→SN0000` 零未实现 opcode |
| [`inspector.md`](./inspector.md) | 桌面进程内存查看器：定位 `this`、提取并可视化状态机数据 | C#/.NET 10 + WPF | M1 Core+CLI 自检通过；M2 WPF 壳（扫描 this/全局表/脚本帧） |
| [`toolkit.md`](./toolkit.md) | 本地数据查询 / 制作规划 App（物品/建筑/配方/单位掉落） | React 18 + MUI 5 + TS + Vite | 静态 Web + 可选 WebView2 壳；数据见 `public/data/metadata.json` |

## 工程独立性

- 三个工具**不共享 `scripts/` 环境**，各自 `package.json`/`tsconfig.json` 独立。
- 共同数据/事实源：`src/*.txt`（翻译真值，见 `../01-translation/publish-status.md`）、
  `app/amayui-toolkit` 的 `metadata.json`（业务数据，见 `../02-data/extraction.md`）、`scripts/` 工具。
- `amayui-emulator` 与「引擎分析」紧密相关（其结论被 `../03-engine/` 吸收），本总览按「app 工具」归列。

## 本目录其它文档（写代码/加测试前后该看的）

| 文档 | 回答 |
|---|---|
| [`emulator.md`](./emulator.md) | emulator 的**架构总览**：分层 / 真源 / 三闸门 / 缺口 |
| [`emulator-frame-loop-design.md`](./emulator-frame-loop-design.md) | 帧循环与等待门的**设计口径** |
| [`test-organization.md`](./test-organization.md) | **测试法**：分类头 `@tier/@kind`、执行入口、三条硬规则、`§10.1` 自造 fixture 棘轮 |
| [`emulator-refactor-plan.md`](./emulator-refactor-plan.md) | **重构清单**（活文档）：大文件拆分边界 + `§1.1` 拆分的操作纪律 + 已登记的后继工作 |
| [`native-addon.md`](./native-addon.md) | 原生插件（宿主缝）的接口与契约 |
| [`live2d-support-assessment.md`](./live2d-support-assessment.md) | Live2D 支持面评估 |
| [`emulator-copyright-effect.md`](./emulator-copyright-effect.md) | 版权页特效（AGERC 之外的那条链） |
| [`inspector.md`](./inspector.md) / [`toolkit.md`](./toolkit.md) | 另两个子工程 |

> 全量清单（含 `kind`/`state`）在生成物 [`../00-overview/index.md`](../00-overview/index.md)；
> **跨子工程的通行纪律**（踩过的坑）在 [`../00-overview/lessons.md`](../00-overview/lessons.md)。
