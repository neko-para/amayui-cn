# T-0025 · 过程文档（notes.md）

## 2026-09-13

## 2026-09-14 立案（G3 收口时发现的缺口）

T-0005 完成 G3 时发现：**0x208 的答案在录制侧依赖宿主的加载状态**（pixiBackend.getTextureSize 走
window.api.image 的异步 IPC ⇒ 图还没到就是 0×0），而脚本拿它算源矩形/描画位置 ⇒ 它直接改变场景状态。
headless 没有纹理加载过程，\
