# T-0029 · E4 证据索引（Electron 真界面截图）

产出命令（在 app/amayui-emulator 下）：npm run shot -- --gamestart --name t0029-gs
（= npm run build:electron + electron tools/shot.cjs --gamestart；窗口 1603x903，含 DPR 1.2523）。

| 文件 | 屏 | 字节 | sha256 |
|---|---|---|---|
| e4-title.png | TITLE | 2000364 | 58595a52f06072b93cbd4dbbd2be0c36f5d15adf46fb86b6535b1600151833cf |
| e4-gamestart.png | GAMESTART | 1808885 | 856ed8dcf1f3c94c5243846220e54af9674cebc0daf0a66651c970294f920a8b |
| e4-sn0000-first-text.png | SN0000（首屏：背景） | 1376759 | 461bdadb68b2d20b397ffcb35f4e79e6c5ca03e99f20b34b1d29d75035866cd6 |
| e4-sn0000-next.png | SN0000（推进一页后：正文 + 等待光标） | 1060812 | 4a17a410ee71c03f9f7ea887a5d490e012d8e8aee94e7d88a802b93d749faca4 |

**改动前基准**（不入库，留在 .tmp）：.tmp/b5E-0-title.png（2026-09-19 21:30，2001914 B，sha256 d912cd1ec2af0c8425a4cf6af1c7afc5f3e41add5e5d0115dbb9ecf6630b35eb）—— 与 e4-title.png 目视一致（同构图、立绘/背景/按钮/版权全在）。

判据 ③（TITLE / GAMESTART / SN0000 三屏与改动前逐像素目视一致）的落点：
- TITLE：与 2026-09-19 的基准逐项目视一致（字节数差 0.08%，为 PNG 编码/AA 噪声）；
- GAMESTART：面板（基本設定/引継ぎ設定/周回プレイ設定）+ 立绘 + 三个按钮全在，无缺图；
- SN0000：背景全屏出图（无白占位/缺图），推进一页后正文与等待光标正常。
