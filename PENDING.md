# 待编译翻译（PENDING）

> macOS 环境只翻译文本、无法 assemble/安装。翻译完成但尚未编译的脚本在此登记，
> 待回到 Windows 后按条目执行 assemble 并同步 patch.config.json / PROGRESS.md。
> 条目处理完（assemble 通过并登记）后从本文件删除。

## 待同步变更

- [ ] **`res/SO020.AGF` 已变更（2026-08）**：4 个「探索开始/出击」按钮（y≈779–926）已清理+渲染为 `res/SO020-1.png` 并编译进 `res/SO020.AGF`（bpp=8，ACIF=true，4,588,672 B；由旧 `res/SO020.AGF` 注入 `res/SO020-1.png`）。待回 Windows 后执行 `npm run sync-patch`（patch.config.json 已有 `res/SO020.AGF -> AGF/SO020.AGF` 登记）并更新 install-manifest.json；渲染细节见 `docs/images/SO020.md` §7。
