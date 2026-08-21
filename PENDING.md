# 待编译翻译（PENDING）

> macOS 环境只翻译文本、无法 assemble/安装。翻译完成但尚未编译的脚本在此登记，
> 待回到 Windows 后按条目执行 assemble 并同步 patch.config.json / PROGRESS.md。
> 条目处理完（assemble 通过并登记）后从本文件删除。

## 待同步变更

- [ ] **`res/SO009A.AGF` 已变更（2026-08）**：2 个「返回」按钮（#42/#44，117×81，y≈809–971）已清理+渲染为 `res/SO009A-1.png` 并编译进 `res/SO009A.AGF`（bpp=8，ACIF=true，2,950,272 B；由 `res/SO009A.AGF` 注入 `res/SO009A-1.png`，上 #42 上半效果/下 #44 下半效果，文泉驿 30px）。待回 Windows 后执行 `npm run sync-patch`（patch.config.json 登记 `res/SO009A.AGF -> AGF/SO009A.AGF`）并更新 install-manifest.json；渲染细节见 `docs/images/SO009A.md` §7。

- [ ] **`res/SO020.AGF` 已变更（2026-08）**：① 4 个「探索开始/出击」按钮（y≈779–926）已清理+渲染为 `res/SO020-1.png` 并编译；② **8 个「返回/返回/物品/物品/装备/装备/技能/技能」按钮（y≈1049–1196，2 行 4 列）已清理+渲染为 `res/SO020-2.png` 并再次编译进 `res/SO020.AGF`**（bpp=8，ACIF=true，4,588,672 B；由 `res/SO020.AGF` 注入 `res/SO020-2.png`，含全部 22 按钮+关闭菜单+4 按钮+8 按钮中文）。待回 Windows 后执行 `npm run sync-patch`（patch.config.json 已有 `res/SO020.AGF -> AGF/SO020.AGF` 登记）并更新 install-manifest.json；渲染细节见 `docs/images/SO020.md` §7/§8。
