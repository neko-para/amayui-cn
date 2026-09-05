# app 工具（三大子工程）

> 面向《天結いキャッスルマイスター》，`app/` 下三个**互相独立**的可运行子工程。各自有独立文档（见下表），
> 本总览只做定位与串接；各工具详情**直接阅读其自身文档**，不在本文重复。

| 子工程 | 目标 | 技术栈 | 自身文档 | 状态（见其 README） |
|---|---|---|---|---|
| [`amayui-emulator/`](./amayui-emulator/README.md) | 用 TS 重写 AGE 引擎 VM + Electron/PixiJS 渲染壳 | TypeScript + Electron + PixiJS v8 | [`docs/`](./amayui-emulator/docs/)（01-04,06-11，缺 05） | M0–M3 达成；`npm test` 12/12；跑到 TITLE；标题图像已接入 |
| [`amayui-inspector/`](./amayui-inspector/README.md) | 桌面进程内存查看器：定位 VM `this`、提取并可视化状态机数据 | C#/.NET 10 + WPF | [`docs/技术方案.md`](./amayui-inspector/docs/技术方案.md) | M1 Core+CLI 自检通过；M2 WPF 壳（扫描 this/全局表/脚本帧） |
| [`amayui-toolkit/`](./amayui-toolkit/docs/README.md) | 本地数据查询 / 制作规划 App（物品/建筑/配方/单位掉落） | React 18 + MUI 5 + TypeScript + Vite | [`docs/`](./amayui-toolkit/docs/)（README + 01-06） | 静态 Web + 可选 WebView2 壳；数据见 `public/data/metadata.json` |

## 工程独立性

- 三个工具**不共享 `scripts/` 环境**，各自 `package.json`/`tsconfig.json` 独立。
- 共同数据/事实源：`src/*.txt`（翻译真值）、`docs/re/`（逆向结论）——各工具按需读取，改动互不影响。
- `amayui-emulator` 与「引擎分析」方向紧密相关（其结论被 `docs/engine/README.md` 吸收），
  本总览按「app 工具」归列，但交叉引用见 [`docs/engine/README.md`](../docs/engine/README.md)。
