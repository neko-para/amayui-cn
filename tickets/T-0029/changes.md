# T-0029 · 过程文档（changes.md）

## 2026-09-21

## 2026-09-21

## 第 1 次变更：`PRELOAD_IMAGES` 与预载循环已删（判据 1 达成，判据 2/3/4 的代码面达成、E4 面待跑）

### 改了什么

`src/renderer/app/boot.ts`：
- 删掉 `const PRELOAD_IMAGES = [0x5245, 0x5246, 0x5272, 0x5273];`；
- 删掉 `for (const imgid of PRELOAD_IMAGES) { await native.preloadImage(imgid); }`；
- 原位留下**为什么删**的块注释（四条理由逐条：无引擎依据 / 两宿主漂移 / 白付启动成本 / 掩盖真实缺陷），
  并写明"若将来发现某张图确实绑定前就要用 ⇒ 登记进 `engine-capabilities.json`，**不要**把清单加回来"。

全仓核对：`grep PRELOAD_IMAGES` 只剩**注释里对历史的记录**；`0x5245/0x5246/0x5272/0x5273` 只剩
`docs/**`（旧文档）与 `test/texture-slot-resolve.test.ts`（当夹具用）——没有第二处加载入口。

### 守卫 `test/no-boot-preload.test.ts`（4 条）

① 源码里没有预载清单（`PRELOAD_IMAGES` / "3 个以上 imgid 的字面量数组"）；
② `preloadImage` 的**主动调用**只剩按需路径（`TextureCache` 内部 + `PixiBackend` 转发缝）；
③ **帧屏障真的存在且顺序对**：`TextureCache.waitIdle` 存在、`PixiBackend.texturesIdle` 存在、
   且 `session.ts` 里 `texturesIdle` 排在 `present(` **之前**（顺序反了首帧照样缺图 —— 预载就是被这么"需要"的）；
④ 按需语义没被改掉：`bind` 未命中缓存时仍 `preloadImage(imgid)`，且到货 `onReady` 通知宿主置脏（`T-0102` 的 H4）。

★注释剥离用的是**死写闸门同一个扫描器**（`stripCommentsAndStrings`，从 `tools/deadWrites.ts` 导入）——
本守卫第一版自造了一个"够用"的行注释剥离，被 `boot.ts` 的**说明注释**（里面提到被删的清单）假红。

★**辨别力已机械证明**：把清单与循环加回 `boot.ts` ⇒ ① 与 ② 红（4 条里 2 条），其余 2 条与清单无关；
删掉后 4/4 绿。

### 判据对照

| 票面判据 | 状态 |
|---|---|
| ① 常量与循环删除、全仓无该清单 | ✅（守卫 ① + 全仓 grep） |
| ② 4 张图改在 `0x1F9` 绑定时按需装载（启动日志不再有启动段 `image 0x5245…`） | 🟡 **代码面** ✅（消除第二入口 + 守卫 ②/④）；**日志面**要真跑 Electron 才看得到（E4） |
| ③ 首帧不缺图（TITLE/GAMESTART/SN0000 三屏目视一致） | ❌ 需 E4（`npm run shot -- --gamestart`） |
| ④ G3 `record`+`replay` 改后仍逐帧相等 | 🟡 **结构上成立**：`boot.ts` 是 **Electron 专属**启动路径，headless（`bootHeadless`/两份 chain/scenario）**从来不预载** ⇒ 本改动不可能改变 headless 侧 digest；Electron 侧的 G3 要真跑（E4） |
| ⑤ 若某张图必须启动期就绪 ⇒ 登记进能力台账 | ⏳ 等 ③ 的观察结果（若首帧确有缺图，就按这条登记，**不**恢复清单） |

⇒ 保持 `doing`：剩下的全是 Electron/E4 类判据（本机 headless 跑不了真窗口）。
