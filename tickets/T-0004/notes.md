# T-0004 · 过程文档（notes.md）

## 2026-09-13

★B4 迁移清单新增一条硬要求：删掉 session.#present() 里的 audio tick（帧泵已归驱动，见 T-0006）——保留会每帧双 tick（BGM 淡变两倍速/延迟 SE 提前到期），且这种 bug 在画面上很难看出来。

## 2026-09-13

## 2026-09-14 收口

B4 完成：session.ts = 装配 + 观察者 + yield；#present 三拆（音频归驱动）；G3（3047 帧逐帧相等）+ G4（关键行不变、截图一致）通过。三处真分叉的 before/after 见 changes.md。状态 ⇒ done。

★B4 迁移清单里那条硬要求（「删掉 session 的 #present 里的 audio tick，否则每帧双 tick」）已执行：现在 present 只做「屏障 + 合成」，音频 tick 由驱动每完整帧发一次。
