# 03-engine · 资源加载（统一文件 id / 启动链 / 纹理·AGF）

## 1. 统一文件 id 空间

- ✅ 资源 id 与脚本索引**共用 ALF 索引**。本体 `SYS4INI.BIN`（S4IC，300B 头，TOC 为 LZSS 压缩）+ 5 个 `APPEND01..05.AAI`（S4AC，268B 头，**包号=头部 @264**）。
- ✅ 统一 id = `pack# << 24 | idx`。实测：SO006=`0x5245`、SO005=`0x5246`、SO004=`0x5272`、SO004A=`0x5273`、TITLE.MTN=`0x5274`、TITLE.BIN=`0x5264`。
- ✅ `NodeFileSource.resolveEntry(id)` 已实现 base+APPEND 合并；`npm test` 12/12。

## 2. 启动链

- ✅ `SYSTEM4(0)` → 数据表 INIT（AMINIT2/WDINIT/ALINIT/EBINIT/ITINIT/SKINIT/CGINIT/BTANINIT2…）→ `INIT` → `TITLE.BIN`（0x5264，622 指令）。
- ✅ 解释器已能无界面跑完到 `TITLE.BIN`（M0–M3，见 `../04-app/emulator.md`）。

## 3. 纹理 slot ↔ AGF 文件

- ✅ `set-texture <imgid> <slot>` 是**唯一绑定**：`[5*slot+466] = imgid`，imgid → `resolveEntry` → AGF 文件名。
- ✅ `draw-texture` 的 **tex 句柄**（如 `0x30d40`/`0xa`/`0x14`/`0x12c`…）是**图形子系统纹理对象句柄**（`sub_4AAD40` 按键查），与 `set-texture` 的 **slot**（`0x2a/0x2b/4/5`…）是**两个索引空间**，勿混。
- ✅ 纹理 id→图像 id 表 `_this[5*texid+81174]` 由 `set-texture`(0x1F9→sub_4A3800→sub_49E9D0，写 `[5*slot+466]=imgid`) 与数据载入 op(`sub_410160`) 运行时填充；启动→TITLE 路径只经 set-texture。

## 4. 标题场景/资源映射

| 图像 | id | 尺寸 | 角色 | 来源脚本 |
|---|---|---|---|---|
| SO006 | 0x5245 | 1280×720 RGB | 背景（步骤1） | `LOGO.txt` set-texture→slot 0x2a |
| SO005 | 0x5246 | 1280×720 RGBA | 版权（步骤1，叠加） | `LOGO.txt` set-texture→slot 0x2b |
| SO004 | 0x5272 | 1664×1536 RGBA | 主菜单（步骤3） | `TITLE.txt` set-texture→slot 4 |
| SO004A | 0x5273 | 740×700 RGBA | Live2D（暂不管） | `TITLE.txt` set-texture→slot 5 |

- ✅ LOGO 专用 opcode：`0x1F8`(create-texture) / `0x1FA`(release-texture) / `0x20F`(play-movie 视频句柄)。
- ✅ LOGO 场景：`SYSTEM4` 第 146 行 `call-script LOGO(0x5262)` 仅在 `_this[96983]`（`Engine.engineValues`，构造函数默认 1）为真时执行（opcode 0x130）。

## 5. 交叉引用

- 读取逻辑/绘制模型见 `./rendering.md`；AGF 图片格式与工具见 `../01-translation/format-toolchain.md`。
