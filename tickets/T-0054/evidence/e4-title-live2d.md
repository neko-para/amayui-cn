# T-0054 判据 #4 的 E4：**真界面**里 Live2D 立绘确实出画（Electron 截图）

来源（不改一份图，直接指向 `T-0029` 归档的那张，避免同一张 2 MB 图在库里放两份）：

- 文件：[`../T-0029/evidence/e4-title.png`](../T-0029/evidence/e4-title.png)
- sha256：`58595a52f06072b93cbd4dbbd2be0c36f5d15adf46fb86b6535b1600151833cf`
- 产出命令（`app/amayui-emulator` 下）：`npm run shot -- --gamestart --name t0029-gs`
  ⇒ `<仓库根>/.tmp/t0029-gs-0-title.png`（1603×903，Electron 真界面）
- 同批还有 `../T-0029/evidence/e4-gamestart.png`（GAMESTART 屏，立绘仍在动）

## 这张图证明了什么

1. **Live2D 立绘在真界面出画**：TITLE 屏左侧的白发蓝翼角色 = 引擎的 L2D 模型
   （`0x341` 装 `TITLE.MOC`(0x4f9e) + `0x345` 绑 `TITLE00.PNG`(0x4f9f) + `0x34E` 装 `TITLE.MTN`(0x5274)，
   由 `f8c46/f8c47` → `call-script SETL2DMOC` 驱动）；同一屏的标题 logo/按钮/INSTALL 缎带/版权行也都正常
   ⇒ 不是"立绘出画但其它全丢"的假阳性。
2. **与 `a9d0` 回落支的对照**（同判据要求的那一半）在 headless 侧做成守卫：
   `app/amayui-emulator/test/live2d-enabled-flag.test.ts` —— `a9d0 != 0` 时 `l2dSlots` 为空、
   槽 5 = `0x5273`（静态回落图 `SO004A.AGF`），`a9d0 == 0` 时槽 0 装 `0x4f9e`。
3. **它不是"预载掩盖"**：`T-0029` 已删掉启动期预载，图中纹理全部走 `0x1F9` 绑定时按需装载
   （见 `../T-0029/evidence/startup-bind-log.txt`）。

★未做（诚实边界）：这张是真界面**静态**截图，不能证明"动作在动"（那需要连拍/录屏）；
动作推进的正确性由 headless 侧守卫保证（`test/live2d-chain.test.ts` 的 `0x34E` 入队 + `l2dAdvance`
推进断言、`test/live2d-render.test.ts` 的批次几何）。
