# T-0025 · 过程文档（notes.md）

## 2026-09-13

## 2026-09-14 立案（G3 收口时发现的缺口）

T-0005 完成 G3 时发现：**0x208 的答案在录制侧依赖宿主的加载状态**（pixiBackend.getTextureSize 走
window.api.image 的异步 IPC ⇒ 图还没到就是 0×0），而脚本拿它算源矩形/描画位置 ⇒ 它直接改变场景状态。
headless 没有纹理加载过程，\

## 2026-09-22 · 轮 12：headless 自带 AGF 尺寸解析（本票收尾）

### 1. 做法（分三层）

| 层 | 落点 | 说明 |
|---|---|---|
| 解析 | `app/amayui-emulator/src/arch/agfSize.ts` | `agfSizeOf(bytes, totalSize?)`：ACGF 头（meta@24，LZSS 解压后 `parseWhBpp`）+ **无头** plan 扫描（meta 偏移 24/28 × body 头 8/12 + 常见分辨率回退 + 评分）。**逐段移植**自 `scripts/agf/format.js`（`src/` 因 `rootDir: "src"` **不能** import 仓库根模块） |
| 读字节 | `NodeFileSource.readHeaderSync(id, 64 KB)` | **同步**读头：松散文件优先、否则 ALF 切片（与 `#readEntryRange` 同判定；抽出 `#lookupEntry` 与异步路径**共用**判定）。回传 `total`（真实文件大小） |
| 装配 | `HeadlessScene.sizeSource` + `scenarioBoot` | 默认把资源源接给 headless；`getTextureSize` 的优先级：**外部答案（`imageSize`/录制 tex）→ 自解析 → 0×0 + 缺口记录** |

### 2. ★为什么必须同步（实测两次失败后才定下来）

先在 `bindTexture` 里发起**异步预取**、再在帧循环里等屏障：实测回放仍在 frame 1607 分叉，日志显示
`0x208 问 0xb37 → pending=true` —— 脚本在**绑定后的同一条指令批**里就问尺寸，异步根本赶不上。
而引擎的 `set-texture` 是**同步**读 AGF + 解码 ⇒ 同步答案才是忠实等价物（帧屏障那条改动已撤回，
只保留纯粹的同步读）。

### 3. ★无头容器必须传真实文件大小（踩过的第二个坑）

`BG050ABL.AGF` 是**无头**容器（前 4 字节全 0，实测 0x4c00..0x5400 里 843 ACGF / **14 无头**）。
无头 plan 的评分里有 `bodyHdrPos + hdr + pak <= fileSize` 的边界校验 —— 只喂 64 KB 切片时
`fileSize` 被当成 65536 ⇒ **所有 plan 都被否掉** ⇒ 返回 `null`。修法：`readHeaderSync` 回传 `total`，
调用侧 `agfSizeOf(head.data, head.total)`。守卫把"切片不带 total ⇒ null / 带 total ⇒ 与 oracle 相同"两条都断言了。

### 4. 判据与守卫

- `test/agf-size.test.ts`（4 条，含变异证明）：与共享解码器逐值一致（真文件，ACGF + 无头）、非 AGF ⇒ null、
  `total` 语义、**产品装配**下绑定即同步答真实尺寸。
- `evidence/record-replay-cleared-tex.txt`：清掉轨迹 `tex` 后 `npm run replay` 仍 **2614 帧逐帧相等**（原始轨迹作对照）。
- `npm run verify` 全绿；四份台账 `--validate` 绿。
