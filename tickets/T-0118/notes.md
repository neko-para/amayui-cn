# T-0118 · 阻塞复核（2026-09-23）

## 环境复核（本会话实测）

```
$ arch -x86_64 node -p process.arch
arch: posix_spawnp: node: Bad CPU type in executable     ← 仍然不行
$ sw_vers -productVersion   → 26.3.1
$ uname -m                  → arm64
$ ls /usr/libexec/rosetta   → debugserver oahd oahd-helper oahd-root-helper runtime translate_tool
```

`oahd`（Rosetta 的守护进程）在，但**本机的 Node 是 arm64 单架构** ⇒ 即使 Rosetta 可用，
`arch -x86_64 node` 也没有 x64 的 node 可跑（报的正是 `Bad CPU type in executable`）。

⇒ **本票的验收（在 Intel Mac 或"装了 Rosetta 2 且能跑 x64 Node"的机器上实跑 x86_64 slice）
在本机无法执行**。这不是"做不到"，而是"不在这台机器上"。

## 状态

**保持 open**（不设 `blocked`：按本工程纪律，`blocked` 需要同一阻塞条件跨 ≥3 轮持续存在；
本会话只复核了 1 轮）。需要时的最短路径：

1. 装 Rosetta：`softwareupdate --install-rosetta --agree-to-license` **且**备一个 x64 的 Node（如 nvm 装 x64 版本）；
2. 或换一台 Intel Mac；
3. 然后按 acceptance 跑 `native/host-input/tools/smoke.cjs` 与 `tools/verify-cursor.cjs`，
   并把结论回填 `tickets/T-0117/notes.md` §5 与 `native/host-input/README.md`。
