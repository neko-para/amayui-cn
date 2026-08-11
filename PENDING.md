# 待编译翻译（PENDING）

> macOS 环境只翻译文本、无法 assemble/安装。翻译完成但尚未编译的脚本在此登记，
> 待回到 Windows 后按条目执行 assemble 并同步 patch.config.json / PROGRESS.md。
> 条目处理完（assemble 通过并登记）后从本文件删除。

## 2026-08-11

- 脚本：GSINIT（周回引継項目定义）
  类型：完全新翻译
  状态：已翻译，未编译（macOS）
  改动：6 条 set-string（难度 / 单位・城砦 / 道具・持有金钱 / 克隆模式 / 多周目事件 / 敌方LV上限解除）
  关联：docs/keywords-周回引継.md、docs/prob-INFOFA.md
  待办：cd scripts && npm run assemble -- GSINIT；patch.config.json 增加 install/GSINIT.BIN；PROGRESS.md 登记

- 脚本：GSMES（周回/难度选择说明消息）
  类型：完全新翻译
  状态：已翻译，未编译（macOS）
  改动：15 条 show-text（@"译文" 形式，行宽 ≤25 中文字）
  关联：docs/keywords-周回引継.md、docs/prob-INFOFA.md
  待办：cd scripts && npm run assemble -- GSMES；patch.config.json 增加 install/GSMES.BIN；PROGRESS.md 登记

- 脚本：CVINIT（角色声音表）
  类型：完全新翻译
  状态：已翻译，未编译（macOS）
  改动：73 组「角色名+说明+声优」；角色名/说明已译，**声优名不译**（find-untranslated 报 9 条
  含假名 CV 名属预期，见 docs/prob-CVINIT.md）
  关联：docs/prob-CVINIT.md
  待办：cd scripts && npm run assemble -- CVINIT；patch.config.json 增加 install/CVINIT.BIN；PROGRESS.md 登记

- 脚本：DPINIT（城砦地图地点定义）
  类型：完全新翻译
  状态：已翻译，未编译（macOS）
  改动：12 条 set-string（工房/迷宫/商店/建筑/装饰/训练 及地点说明）
  关联：docs/keywords-工坊.md
  待办：cd scripts && npm run assemble -- DPINIT；patch.config.json 增加 install/DPINIT.BIN；PROGRESS.md 登记

- 脚本：MENU（系统菜单：存档/读档/回标题/结束确认）
  类型：完全新翻译
  状态：已翻译，未编译（macOS）
  改动：6 条 set-string（回标题/结束游戏确认、是/否）
  关联：无
  待办：cd scripts && npm run assemble -- MENU；patch.config.json 增加 install/MENU.BIN；PROGRESS.md 登记

- 脚本：GAMECLEAR（通关后引継数据设定画面）
  类型：完全新翻译
  状态：已翻译，未编译（macOS）
  改动：13 条字面量（引継数据设定/覆盖提示、回标题/结束确认、场景播放结束/取消、设定/不设定）
  关联：docs/keywords-周回引継.md
  待办：cd scripts && npm run assemble -- GAMECLEAR；patch.config.json 增加 install/GAMECLEAR.BIN；PROGRESS.md 登记

- 脚本：INFOFA（周回开始游戏设定画面）
  类型：完全新翻译
  状态：已翻译，未编译（macOS）
  改动：10 条字面量（游戏设定/通关次数/难度档位/继承・初始/路线地图；ＯＮ・ＯＦＦ 保持）
  关联：docs/keywords-周回引継.md、docs/prob-INFOFA.md
  待办：cd scripts && npm run assemble -- INFOFA；patch.config.json 增加 install/INFOFA.BIN；PROGRESS.md 登记

- 脚本：ADDSTOCK（物品追加/持有上限处理）
  类型：完全新翻译
  状态：已翻译，未编译（macOS）
  改动：4 条字面量（已超过持有上限、换成金钱（、丢弃、取消；G） 保持）
  关联：无
  待办：cd scripts && npm run assemble -- ADDSTOCK；patch.config.json 增加 install/ADDSTOCK.BIN；PROGRESS.md 登记

- 脚本：STAGERAID（迷宫袭击事件）
  类型：完全新翻译
  状态：已翻译，未编译（macOS）
  改动：2 条 set-string（袭击预警 / 盖达鲁复活）
  关联：无
  待办：cd scripts && npm run assemble -- STAGERAID；patch.config.json 增加 install/STAGERAID.BIN；PROGRESS.md 登记

- 脚本：INFOBA（情报「基本信息」页）
  类型：完全新翻译
  状态：已翻译，未编译（macOS）
  改动：1 条 draw-string 页签（基本情報→基本信息；「内容」同文保持）
  关联：docs/keywords-情报首页.md
  待办：cd scripts && npm run assemble -- INFOBA；patch.config.json 增加 install/INFOBA.BIN；PROGRESS.md 登记

- 脚本：INFOCH（情报「角色」图鉴页）
  类型：完全新翻译
  状态：已翻译，未编译（macOS）
  改动：1 条 draw-string 页签（キャラクター→角色）；？？？占位/符号保持
  关联：docs/keywords-情报首页.md、docs/keywords-角色名称.md
  待办：cd scripts && npm run assemble -- INFOCH；patch.config.json 增加 install/INFOCH.BIN；PROGRESS.md 登记

- 脚本：INFOEN（情报「单位/敌人」图鉴页）
  类型：完全新翻译
  状态：已翻译，未编译（macOS）
  改动：5 条字面量（单位/能力/掉落道具/出现关卡/（以下省略））
  关联：docs/keywords-情报首页.md
  待办：cd scripts && npm run assemble -- INFOEN；patch.config.json 增加 install/INFOEN.BIN；PROGRESS.md 登记

- 脚本：INFOIT（情报「道具」图鉴页）
  类型：完全新翻译
  状态：已翻译，未编译（macOS）
  改动：7 条字面量（道具/情报/分解炼石/获得手段/（以下省略））
  关联：docs/keywords-情报首页.md、docs/prob-INFO.md
  待办：cd scripts && npm run assemble -- INFOIT；patch.config.json 增加 install/INFOIT.BIN；PROGRESS.md 登记

- 脚本：INFOOF（情报「装备连携」图鉴页）
  类型：完全新翻译
  状态：已翻译，未编译（macOS）
  改动：5 条字面量（装备连携/效果/连携发动条件/无）
  关联：docs/keywords-情报首页.md、docs/keywords-装备与物品.md
  待办：cd scripts && npm run assemble -- INFOOF；patch.config.json 增加 install/INFOOF.BIN；PROGRESS.md 登记

- 脚本：INFOPL（情报「设施」图鉴页）
  类型：完全新翻译
  状态：已翻译，未编译（macOS）
  改动：2 条字面量（设施页签、无）
  关联：docs/keywords-情报首页.md、docs/keywords-设施.md
  待办：cd scripts && npm run assemble -- INFOPL；patch.config.json 增加 install/INFOPL.BIN；PROGRESS.md 登记

- 脚本：INFOSK（情报「技能」图鉴页）
  类型：完全新翻译
  状态：已翻译，未编译（macOS）
  改动：1 条 draw-string 页签（スキル→技能）
  关联：docs/keywords-情报首页.md、docs/keywords-SKINIT.md
  待办：cd scripts && npm run assemble -- INFOSK；patch.config.json 增加 install/INFOSK.BIN；PROGRESS.md 登记

- 脚本：INFOVO（情报「术语」图鉴页）
  类型：完全新翻译
  状态：已翻译，未编译（macOS）
  改动：1 条 draw-string 页签（専門用語→术语）
  关联：docs/keywords-情报首页.md、docs/keywords-术语词典.md
  待办：cd scripts && npm run assemble -- INFOVO；patch.config.json 增加 install/INFOVO.BIN；PROGRESS.md 登记

- 脚本：CNINIT（角色图鉴名称，已翻译脚本的术语统一）
  类型：修改
  状态：已翻译，未编译（macOS；术语统一重译）
  改动：クードヴァンス 2 处 库德凡斯→库德万斯（用户定稿 2026-08-11）
  关联：docs/keywords-角色名称.md、docs/prob-CVINIT.md
  待办：cd scripts && npm run assemble -- CNINIT（重编译；patch.config 已有条目）；PROGRESS.md 无需改动

- 脚本：CIINIT（角色图鉴正文，已翻译脚本的术语统一）
  类型：修改
  状态：已翻译，未编译（macOS；术语统一重译）
  改动：クードヴァンス 1 处 库德凡斯→库德万斯（用户定稿 2026-08-11）
  关联：docs/keywords-角色图鉴.md、docs/prob-CVINIT.md
  待办：cd scripts && npm run assemble -- CIINIT（重编译；patch.config 已有条目）；PROGRESS.md 无需改动

- 脚本：EBINIT（单位/角色名表，已翻译脚本的术语统一）
  类型：修改
  状态：已翻译，未编译（macOS；术语统一重译）
  改动：司教クードヴァンス 1 处 库德凡斯→库德万斯（用户定稿 2026-08-11）；
        亜人間族 5 处 亚人类族→亚人族（与 VIINIT/术语词典统一，2026-08-11）；
        魔法装置 5 处 去除「的」与 ITINIT 统一（敏捷/治愈/英雄/进击/铁壁魔法装置）；
        強制転送装置 1 处 强制传送→强制转移（与 ITINIT/SKINIT 统一）
  关联：docs/prob-EBINIT.md、docs/prob-CVINIT.md
  待办：cd scripts && npm run assemble -- EBINIT（重编译；patch.config 已有条目）；PROGRESS.md 无需改动

- 脚本：STINIT（战斗目标，已翻译脚本的术语统一）
  类型：修改
  状态：已翻译，未编译（macOS；术语统一重译）
  改动：『司教クードヴァンス』 1 处 库德凡斯→库德万斯（用户定稿 2026-08-11）
  关联：docs/keywords-战斗目标.md、docs/prob-CVINIT.md
  待办：cd scripts && npm run assemble -- STINIT（重编译；patch.config 已有条目）；PROGRESS.md 无需改动

### 追加包系统脚本（AP1-5，非 SC/SG/SP，42 个）

> 以下条目统一：类型=完全新翻译；状态=已翻译，未编译（macOS）；
> 待办=`cd scripts && npm run assemble -- <脚本>`，通过后加入 patch.config.json 与 PROGRESS.md 并从本文件删除；
> 详细待定译名见 `docs/prob-追加包系统.md`。

- $1$AMINIT2（追加包１地点：弱者的遗迹/歪精域之森）
- $1$CCINIT（追加包１ Boss/回想名：归来的使魔/烂漫的神女/千刃的魔神 等）
- $1$CIINIT（追加包１角色图鉴正文：莉莉/瓦雷弗尔 客串角色档案）
- $1$CNINIT（追加包１角色图鉴名：莉莉/瓦雷弗尔/魔王大人）
- $1$CVINIT（追加包１角色声音表：CV 名不译）
- $1$EBINIT（追加包１单位/种族：歪魔/魔灵/赫塔家族 EX 单位；悪魔族／歪魔種→恶魔族／歪魔种 统一）
- $1$FAINIT（追加包１路线图：转移镜神殿/异界断层 任务）
- $1$OFINIT（追加包１装备连携：歪精灵）
- $1$PLINIT（追加包１设施：庭园/旅馆/樱花/神木/马厩/巨型弩炮/墓地/集会所/大教堂/赫塔泰特的像 等）
- $2$CDINIT2（追加包２卡片素材消息：神珠系 4 条）
- $2$CNINIT（追加包２角色图鉴名）
- $2$EBINIT（追加包２单位/种族：粘体/EX 系 25 条；亜人間族→亚人族 统一）
- $2$OFINIT（追加包２装备连携：天结大师/晚安/捕获大师）
- $2$PLINIT（追加包２设施：女神更衣室）
- $3$AMINIT2（追加包３地点：结骑之乡/引导之门/眩耀的宝物库（译名待定） 等）
- $3$CCINIT（追加包３ Boss/回想名：疾风/神速/轰鸣/剑术登峰造极的妖精）
- $3$CDINIT2（追加包３卡片消息：素材/装飾 30 条）
- $3$CIINIT（追加包３角色图鉴正文：由艾拉/月烂 客串档案）
- $3$CNINIT（追加包３角色图鉴名：由艾拉/月烂/痣之妖精）
- $3$CVINIT（追加包３角色声音表：CV 名不译）
- $3$DPINIT（追加包３地图地点：斡旋 → 保留原文，中日同文不译；见 docs/prob-追加包系统.md §4）
- $3$EBINIT（追加包３单位/种族：魅惑系列/睡魔/虫系/龙蛇系 60 条；睡魔種→睡魔种 统一）
- $3$FAINIT（追加包３路线图：黄橡华楼/歪宫 任务 12 条）
- $3$OBINIT（追加包３迷宫对象：由艾拉EV/由艾拉专用）
- $3$OFINIT（追加包３装备连携：东方魔术士/沙滩女神/女神的加护）
- $3$PLINIT（追加包３设施：魔兽中心/屯所/砂金采集箱/暗黑教会/塞纳尔商会/训练哨所/豪宅 等）
- $3$STINIT2（追加包３战斗地名：结骑之乡/黄橡华楼/浅縹流塔 等 22 条；眩耀的宝物库 译名待定）
- $4$CDINIT2（追加包４卡片消息：果实系 3 条）
- $4$EBINIT（追加包４单位/种族：BugBug 合作 编灵/石灵 系）
- $4$FAINIT（追加包４路线图：城砦印酒类/葡萄宫 任务 6 条）
- $4$STINIT2（追加包４战斗地名：桑巴格葡萄宫/葡萄宫叹刑殿）
- $5$AMINIT2（追加包５地点：鲸颚岬）
- $5$CCINIT（追加包５ Boss/回想名：寻得/被选中/被包围幸运的精灵）
- $5$CDINIT2（追加包５卡片消息：最上级素材 5 条）
- $5$CIINIT（追加包５角色图鉴正文：绝天缘菲亚-伊布拉姆 档案）
- $5$CNINIT（追加包５角色图鉴名：伊布拉姆/菲亚？/攻略指南/绝天缘）
- $5$CVINIT（追加包５角色声音表：CV 名不译）
- $5$EBINIT（追加包５单位/种族：绝天缘/黑歪魔/天使/木精 EX 系 17 条）
- $5$FAINIT（追加包５路线图：鲸颚岬/说服伊布拉姆 任务 7 条）
- $5$OFINIT（追加包５装备连携：影之女神）
- $5$PLINIT（追加包５设施：烤芋篝火/秋樱/秋刀鱼钓鱼池/收割稻田/台风发生装置/赏月套装 等）
- $5$STINIT2（追加包５战斗地名：鲸颚岬/罗森溪谷/雷利奎亚遗迹 等 5 条）
