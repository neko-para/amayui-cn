# T-0058 · 过程文档（changes.md）

## 2026-09-22

★2026-09-22 路径变更（`tickets/T-0119`）：本文件里提到的 `native/win32-input/**`（或 `native/macos-input/**`）现在合并成了 `native/host-input/**` —— 一个 addon、两个平台实现；产物名与 env 分别是 `host_input.node` 与 `AMAYUI_HOST_INPUT_NODE`，预置产物在 `prebuilds/darwin-universal/host_input.node`，守卫并成 `test/native-host.test.ts`。下文按当时的记录保留。
