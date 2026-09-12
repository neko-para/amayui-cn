# 03-engine · 资源加载（统一文件 id / 启动链 / 纹理·AGF）

## 1. 统一文件 id 空间

- ✅ 资源 id 与脚本索引**共用索引文件**。本体 `SYS4INI.BIN`（`S4IC`，300B 头，TOC 为 LZSS；`S4IN` 则体直读）+ 扩展包 `APPEND01..05.AAI`（`S4AC`，268B 头，TOC 为 LZSS；**包号 = 头部 @264**）。
- ✅ 统一 id = `pack# << 24 | idx`；`pack#=0` 时低 24 位是本体文件号（须 `< file_count`），`pack#=1..255` 落在扩展包表。实测：`SO006=0x5245`、`SO005=0x5246`、`SO004=0x5272`、`TITLE.BIN=0x5264`、`$1$AUTORUN=0x1000000`、`$5$SC0370=0x5000001`。
- ✅ 引擎侧三个分派点：`sub_4559C0`（id → 句柄，含**可见报错**）、`sub_454FA0`（id → 名字）、`sub_455000`（名字 → id，**先扫本体再扫扩展包**）。
- ✅ 实测索引规模（`.tmp/appendProbe.mts`，读 `install/`）：SYS4INI `arcCount=8`（`DATA1..8.ALF`）/`filCount=21109`；APPEND01..05 各 `arcCount=1`（自己的 `APPEND0n.ALF`）/`filCount` = 678 / 261 / 1689 / 425 / 918，包内文件名一律带 `$n$` 前缀。
- ✅ `NodeFileSource.resolveEntry(id)` 已实现 base+APPEND 合并；`npm test` 12/12。

### 1.1 扩展包（APPENDnn.AAI + APPENDnn.ALF）的发现 · 注册 · 激活

**一句话**：引擎**启动时扫一次工作目录里的 `*.AAI`**，每个包按**自己的头部包号**登记进 FileDB 的包表；包内容的激活**不在引擎里**，而是本体脚本 `INIT2.txt:140` 的 `i143`（0x143）把每个已登记包的文件 #0（`$n$AUTORUN.BIN`）排进脚本队列 —— 包不在就**静默跳过**。

| 阶段 | 位置 | 事实 |
|---|---|---|
| ① 发现 | `sub_455750`（raw 67721-67783） | `GetCurrentDirectoryA` → `FindFirstFileA("<CWD>\\*.AAI")`，跳过目录、文件名转大写；**唯一调用点** = 索引装载函数 `sub_414AC0` 的末尾（raw 22340）⇒ 启动时扫一次、之后不再重扫。工作目录由 WinMain 的 `-sp`/`-path` 设定（raw 142025/142040）。**不硬编码 APPEND01..05**：放什么 `.AAI` 就装什么，子目录里的不算 |
| ② 解析 | `sub_401100`（raw 7850-7962） | 读 268B 头：@0 魔数（`S3AI/S4AI` = 体直读；`S3AC/S4AC` = 12B 区段头 + LZSS）、@4 版本 3 字节、**@8 版本串必须与 `SYS4INI.BIN` 头 @8 `strcmp` 相等**（实测两边都是「天結いキャッスルマイスタ」）、**@264 = 包号**；TOC 结构 = `arcCount` → 256B 归档路径（实测就是 `APPEND0n.ALF`）→ `fileCount` → 80B/项（`name[64] + archiveIndex + fileIndex + offset + length`） |
| ③ 注册 | `sub_455750` 内 | `FileDB.packs[包号] = AAIFileDB*`（`FileDB+0x3028` = `Engine+0xA90C4`，256 槽；槽 0 不用）。装载失败 ⇒ 日志「AAIファイルの読み込みに失敗しました． %s」+ 释放对象、槽留 NULL。同包号装两次 ⇒ 后者覆盖、前者泄漏（无查重） |
| ④ 激活 | `i143` = `sub_41A000`（raw 25168-25191） | 脚本侧唯一调用点 `INIT2.txt:140`（紧跟本体 40 张 INIT 之后）：遍历包表槽 1..255，**非零** ⇒ `queueScript(slot<<24)` 入队 + `dispatchQueuedScripts` 派发 ⇒ 该包文件 #0 = `$slot$AUTORUN.BIN` 开始执行。每个 `$n$AUTORUN` 用它包内的副本重跑整套 `$n$SCINIT`…`$n$BTANINIT2`（覆盖本体刚装好的同一批 globals），最后 `bit-set (global-int 7087f5) n` 置「第 n 包已安装」 |
| ⑤ 校验 | `SAVE.txt:875-888` | 存档界面把存档里记录的安装掩码（数组 `global fa6`）与**运行期掩码 `global 7087f5`** 逐位比较；存档要求某位而运行期没有 ⇒ 「インストール状況が一致しません／アペンドデータをインストールしてください」 |
| ⑥ 访问 | `sub_4559C0` / `sub_401410` | id 高字节非 0 ⇒ 取 `packs[id>>24]`；包为 NULL ⇒ **抛 `Command_ShowMessage` 异常**（「拡張ファイル情報ファイル %d は読み込まれていません．」）⇒ 与激活阶段的静默相反：**访问阶段是可见报错**。取到包后先按文件项自带的 64B 名在 CWD 找松散文件（翻译工程生成的 `$n$XXX.BIN` 松散副本就靠这条生效），否则从该包自己的 `APPEND0n.ALF` 按 offset/length 切片 |

- **静默失败**（为什么要记这条）：整条①→④**不报错、只少内容**。把 `APPEND03.AAI` 删掉再启动，游戏照常进标题、照常读档，只是包 3 的剧情/道具/立绘全部消失、`7087f5` 第 3 位恒 0 —— 直到进存档界面比较掩码才显形。反向（多装/错装）同样静默。
- **反向索引不对称**：`nameToId`（`sub_455000`）先扫本体再扫扩展包，且比较的是**完整名字**（扩展包名字带 `$n$` 前缀）⇒ 用普通名 `ITINIT.BIN` 按名查**永远不会**落到扩展包；本体的同名文件总是赢。引擎自己只用固定名调用它（`CALLBACK_LOAD/TEXT/SETTING/LOST/WINDOW.BIN`）。
- **emulator 现状（2026-09 已对齐，见第二层台账 `append-pack-discovery-and-activation`）**：索引侧 `NodeFileSource` **扫资源根下的 `*.AAI`、按 AAI 头 @264 的包号注册**（不再硬编码文件名、不再限制 5 包；`alf.ts` 支持 `S4AC`(LZSS) 与 `S4AI`(头后整段) 两种体，并按引擎口径用**高字节**判本体/扩展包）；激活侧 `0x143`(`op_dispatch_script_requests`) 按包号升序把 `包号<<24` 入队、逐条装进**帧 37**、脚本 `exit` 走 `-10` 哨兵继续派发、排空后还原发起者（INIT2）现场；访问未装载的包抛 `MissingAppendPackError`（措辞照抄引擎）。守卫 `test/append-packs.test.ts`（E3：真实语料跑完派发链 ⇒ `global 7087f5` 第 1..5 位置起；E4：标题画面左下角 6 个 INSTALL 徽章）。★残留缺口：`0x1D6`/`0x1D7`/`0x1D8`（数据管理器方法调用）仍是 no-op（只有 `$3$AUTORUN:67-68` 两处，结果写进被丢弃的 scratch 槽与无人读取的 `global 70801e`）—— 列在闸门 B 缺口里。
- 复现探针：`.tmp/appendProbe.mts`（读真实 AAI/ALF 打印表结构）；`.tmp/appendRun.log`（boot 日志，用于确认有没有 `$n$` 脚本被载入）。


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
