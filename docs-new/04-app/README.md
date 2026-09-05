# 04-app · app 工具（三大子工程）

`app/` 下三个**互相独立**的可运行子工程。各自独立文档见下文（`docs-new/` 内部链接）。

| 子工程 | 目标 | 技术栈 | 现状（见其文档） |
|---|---|---|---|
| [`emulator.md`](./emulator.md) | 用 TS 重写 AGE 引擎 VM + Electron/PixiJS 渲染壳 | TypeScript + Electron + PixiJS v8 | M0–M3 达成；`npm test` 12/12；跑到 TITLE；标题图像已接入 |
| [`inspector.md`](./inspector.md) | 桌面进程内存查看器：定位 `this`、提取并可视化状态机数据 | C#/.NET 10 + WPF | M1 Core+CLI 自检通过；M2 WPF 壳（扫描 this/全局表/脚本帧） |
| [`toolkit.md`](./toolkit.md) | 本地数据查询 / 制作规划 App（物品/建筑/配方/单位掉落） | React 18 + MUI 5 + TS + Vite | 静态 Web + 可选 WebView2 壳；数据见 `public/data/metadata.json` |

## 工程独立性

- 三个工具**不共享 `scripts/` 环境**，各自 `package.json`/`tsconfig.json` 独立。
- 共同数据/事实源：`src/*.txt`（翻译真值，见 `../01-translation/publish-status.md`）、
  `app/amayui-toolkit` 的 `metadata.json`（业务数据，见 `../02-data/extraction.md`）、`scripts/` 工具。
- `amayui-emulator` 与「引擎分析」紧密相关（其结论被 `../03-engine/` 吸收），本总览按「app 工具」归列。
