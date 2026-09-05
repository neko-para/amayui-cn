# 01-translation · 界面图片汉化（AGF / AGERC）

## 1. 流程（AGF→PNG→改图→有头注入）

1. **清理**：`clean_fill.py` 列/行填充清理原日文（纯色底保持左右 15px / 渐变底 20px / 面板 40px / 按钮按模板；fill-col 需避开笔画）。
2. **渲染**：`.tmp` 下渲染 HTML + headless Chrome 截图（透明背景，需提权）；**渲染页必须 @font-face 引用本地字体** `res/fonts/SarasaGothicSC/*.ttf`，否则 headless 对拉丁 fallback。
3. **注入**：`node scripts/agf/cli.js inject <DATA1原版.AGF> <渲染PNG> -o <install根>.AGF`（8bpp+ACIF，有头注入体积膨胀属正常=无损）。
4. **同步**：复制到 `res\images\` → `npm run sync-patch`（patch.config.json 已登记各图）→ `npm run manifest` 更新 install-manifest。
5. 还原：从 `install\DATA1\<NAME>.AGF` 复制覆盖 install 根即可。

> ⚠️ 渲染用 **Sarasa Gothic SC**（真实浏览器）；游戏内为 **Amayui CN**（Sarasa 基底 cnjp 替换版），两者区分。

## 2. 当前完成的 UI 图（见总览表）

| 图 | 尺寸 | 变更内容 | 当前版本（res\images\） |
|---|---|---|---|
| SO001 | 1280×1792 | ①中簇 15 按钮（5×3）②右带上下菜单按钮（7×3×2）③操作説明面板 ④中簇文字下移 1px | SO001-4 |
| SO002 | 640×256 | 「メニュー」两块按钮中文化 | SO002-1 |
| SO009A | 1280×1152 | 三行金文字 + 返回大按钮×2 | SO009A-2 |
| SO009B | 712×256 | 第二三列六行中文（第一列 outline 未处理） | SO009B-2 |
| SO017 | 900×1280 | 兵种技能名红字渐变（SKINIT 全量，96 区域） | SO017-2 |
| SO020 | 1792×1280 | 22 按钮 + 关闭菜单面板 + 探索开始/出击 4 + 返回/物品/装备/技能 8 | SO020-4 |
| SO021 | 1280×1280 | 菜单块 A/B + 「去城砦」×2 | SO021-3 |
| SO025 | 1280×512 | 菜单块 A/B + 6 按钮（城砦效果/阿瓦罗的工房/出城门） | SO025-2 |
| SO030 | 2000×2000 | 菜单块 A/B + 8 组 16 按钮 + 防卫开始/决定 4 + 普通/简易动画 6 | SO030-4 |
| SO039 | 1280×1280 | 锁定/释放 2×3（列 3 上白下浅绿两段式） | SO039-1 |

## 3. 效果速查（E1–E9）

| 效果 | 要点 | 用于 |
|---|---|---|
| E1 纯文本行 | 20px 同色 0.5px 描边 + `2px 2px 1px #000` | SO009A 三行、SO009B 第二三列 |
| E2 纯色底按钮（黑字） | 20px 黑字 + 0.5px 黑描边，字距 1px | SO020 上半、SO021/SO025/SO030 菜单块 A |
| E3 渐变底按钮（黑字+白边） | 黑字 + 外层 2px 半透明白描边 | SO020 下半、SO021/SO025/SO030 菜单块 B |
| E4 红描边渐变字 | 22px 白心纵向渐变 + 2px `#C90000` 描边 + 黑阴影 | SO017 兵种名 |
| E5 30px 规则 | 30px 黑字 + 0.5px 黑描边；白描边 4px（上 100%+阴影/下 50%） | SO030 16 按钮、SO020 8 按钮、SO009A 返回×2 |
| E6 红字+白描边 | 同 E5 骨架，内层 `#FD480A` 无黑描边 | SO030 防卫开始/决定、SO020 探索开始/出击 |
| E8 两段式渐变字 | 24px 上白 `#FFFFFF`/下浅绿 `#CDFDCD` 硬切 + 深绿描边 3px `#015514` + 黑阴影 | SO039 第三列 |
| E9 黑红混排按钮字 | 黑（E5 上半）+ 红（E6）同框；白描边 4px | SO021 去城砦、SO025 列1 城砦效果 |

## 4. AGERC.DLL（主菜单 / 对话框）

- `AGERC.DLL`（335,872 B）含主菜单 MENU 110/124 + 16 个对话框（DIALOG 3 退出确认框已定稿）。
- 构建资产在 `res/`：`AGERC_RAW.DLL.rc`、`AGERC.DLL.rc`、`build-localized-agerc.ps1`、`inject-localized-agerc.rsh`、`IDI_ICON1.ico` 等。

## 5. 待办（优先级低）

- SO009B 第一列（outline 阴刻方案已定，待最终渲染）；SO009A「初期化/戻る」大按钮；SO021 头部块与下方小块；SO017 游戏内目检。

## 6. 与引擎/数据的接口

- 脚本 txt 不直接引用 `.AGF` 文件名；界面→AGF 映射在资源表/内存层面（见 `../03-engine/resource-loading.md`）。**优先级低**（文案/剧情优先）。
