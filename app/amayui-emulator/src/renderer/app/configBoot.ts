/**
 * 启动期把 `SYS4REG.INI` 灌进引擎字段（对齐引擎 `sub_492CB0` 装载 + 启动灌字段）。
 *
 * 目的：让读配置类 opcode（`0xC0` sound:Music / `0x131` message:MesWinAlpha / `0x2CE` display:ScreenMode…）
 * 拿到与真实存档一致的取值，而不是一律 0。
 *
 * 失败不致命：找不到/读不动 INI 时只记一行 trace，引擎字段沿用构造默认值。
 */
import { applyConfigToEngine, formatIni, parseIni } from '../../engineConfig.js';
import { DEFAULT_EMULATOR_OPTIONS, applyEmulatorOptionsToEngine, parseEmulatorOptions } from '../../emulatorOptions.js';
import { decodeSaveData, encodeSaveData, mergeSaveDataFallbacks } from '../../save/saveData.js';
import type { Engine } from '../../vm/engine.js';

/**
 * 启动期：配置（`SYS4REG.INI`）+ 玩家数据（`SAVE.DAT`）的装载。
 *
 * ★★两条通路**互不依赖**（`tickets/T-0030`）★★ —— 以前本函数在读不到 `SYS4REG.INI` 时直接 `return`，
 * 而 `SAVE.DAT` 的装载与回写接线写在那个 `return` **之后**，于是"首次运行"（overlay 里两份文件都没有）时：
 *  ① `SYSTEM4.txt:71 load-int (global 5)` 恒读到 0 ⇒ 每次启动都走 `INITCONFIG`+`INITCHARM`，把玩家数据覆盖成默认；
 *  ② `save-int` 改动不回写 ⇒ 连 `save-int (global 5) 1`（`SYSTEM4.txt:81`）都写不出去 ⇒ 永远产生不了 INI/存档（死循环）。
 * 现在各自收在独立函数里：任何一条失败都不连坐另一条。
 */
export async function loadEngineConfig(e: Engine, trace: (line: string) => void): Promise<void> {
  await loadConfigIni(e, trace);
  await attachSaveDataPersistence(e, trace);
}

/**
 * `SYS4REG.INI` → `e.config` + 引擎字段 + 配置**回写**。
 *
 * 目的：让读配置类 opcode（`0xC0` sound:Music / `0x131` message:MesWinAlpha / `0x2CE` display:ScreenMode…）
 * 拿到与真实存档一致的取值，而不是一律 0。失败不致命：找不到/读不动 INI 时只记一行 trace，
 * 引擎字段沿用构造默认值（`cfgInt` 等都有缺省回退）。
 *
 * ★不要在这里碰 `SAVE.DAT`：那是 `attachSaveDataPersistence` 的事（见上面的 `T-0030` 说明）。
 */
async function loadConfigIni(e: Engine, trace: (line: string) => void): Promise<void> {
  try {
    const ini = await window.api?.readConfigIni?.();
    if (!ini) {
      // 没有 INI 不再"什么都不做"（`tickets/T-0031`）：注册表可以按需长出来（`setConfigValue`），
      // 下面的回写接线照常挂上 ⇒ 玩家第一次改设置就会按**引擎键表全量固定顺序**生成一份 INI。
      trace('[config] 未找到 SYS4REG.INI（引擎字段用默认值；玩家一改设置即按引擎键表全量生成）');
    } else {
      const cfg = parseIni(ini.text);
      e.config = cfg;
      const applied = applyConfigToEngine(cfg, e.engineValues);
      trace(
        `[config] ${ini.path}（${ini.side}）分节=[${cfg.sections.join(',')}] 键=${cfg.values.size} 个；` +
          `写入引擎字段 ${applied.length} 个：` +
          applied.map((a) => `_this[${a.field}]=${a.value}(${a.key})`).join(' '),
      );
    }
    // ★配置**回写**：脚本用 SetConfig 族（0x141/0x1B5/0x1B9/0x2CD/0x2E7/0x2E8…）改了配置后，
    //   把整份 INI 交主进程写回同一个文件（引擎里这是退出时写盘；这里改为改一次写一次，1KB 文件无压力）。
    //   合并同帧内的多次改动：只在没有在途写入时发一份最新的；写完若又改过就再发一次。
    //   ★接线**与有没有 INI 无关**（`tickets/T-0031`）：无 INI 时 `e.config` 由 `setConfigValue` 按需创建。
    let inFlight = false;
    let pending: string | null = null;
    const flush = async (): Promise<void> => {
      if (inFlight || pending === null) return;
      const text = pending;
      pending = null;
      inFlight = true;
      try {
        await window.api?.saveConfigIni?.(text);
      } catch (err) {
        trace(`[config] 回写失败：${(err as Error).message}`);
      } finally {
        inFlight = false;
        void flush();
      }
    };
    e.onConfigChanged = (c) => {
      pending = formatIni(c);
      void flush();
    };
  } catch (err) {
    trace(`[config] 加载失败：${(err as Error).message}`);
  }
}

/**
 * `SAVE.DAT`（脚本 `save-int`/`save-string` 两张表）的**装载 + 回写接线**（引擎 raw 142107 的等价物）。
 *
 * 引擎在 WinMain 里先装载存档（`sub_40AEE0`），脚本随后 `SYSTEM4.txt:71 load-int (global 5)` 读「已初始化」标志：
 * 为 1 走 `call-script 5258 LOADCONFIG` + `call-script 51c3 LOADCHARM`（恢复设置与侧栏编辑数据），
 * 为 0 走 `call-script 51dc INITCONFIG` + `call-script 51c8 INITCHARM`（写默认值）。
 * ⇒ **必须在脚本跑之前**把表装好、并把回写接线挂上，否则每次启动都被当成首次启动。
 *
 * ★与 `SYS4REG.INI` 存不存在**无关**（`tickets/T-0030`）；`io.write` 可注入，单测据此断言"无 INI 也接线"。
 */
export async function attachSaveDataPersistence(
  e: Engine,
  trace: (line: string) => void,
  io?: { write?: (bytes: Uint8Array) => Promise<unknown> },
): Promise<void> {
  await loadSaveData(e, trace);
  let savePending: Uint8Array | null = null;
  let saveInFlight = false;
  const write = io?.write ?? ((b: Uint8Array) => window.api?.writeSaveData?.(b) ?? Promise.resolve(null));
  const flushSave = async (): Promise<void> => {
    if (saveInFlight || savePending === null) return;
    const bytes = savePending;
    savePending = null;
    saveInFlight = true;
    try {
      await write(bytes);
    } catch (err) {
      trace(`[save] 写 SAVE.DAT 失败：${(err as Error).message}`);
    } finally {
      saveInFlight = false;
      void flushSave();
    }
  };
  e.onSaveDataChanged = () => {
    // ★连同「已使用文件」标志一起写回（引擎的 SAVE.DAT 同一份 payload 里就有这块：
    //   `sub_40AAE0` → `sub_404B20`/`sub_404BF0` → `sub_438320` 的 a7/a9）——
    //   少写它会在第一次配置改动时把玩家的鉴赏进度覆盖掉。
    savePending = encodeSaveData({ tables: e.saveDataTables(), usedFileIds: e.usedFileIds });
    void flushSave();
  };
}

/**
 * 启动期套用**外置选项文件**（`emulator.config.json`，可选）—— 与 `SYS4REG.INI` 无关的运行开关。
 *
 * 为什么单独一个函数（而不是塞进 `loadEngineConfig`）：那个函数在**没有 INI 时会提前 return**，
 * 而选项文件与 INI 存不存在无关。也必须在**装载首个脚本之前**调用 —— `src/SYSTEM4.txt:144-146` 的
 * `load-show-logo` 在脚本一开始就据 `_this[96983]` 决定要不要 `call-script LOGO`。
 *
 * 目前有两个节：`boot.showLogo`（LOGO/版权页）与 `resources.version`（字体面名解析策略，
 * 落到 `Engine.resourceVersion`）；见 `src/emulatorOptions.ts` 的文件头。
 * ★`resources.path`（资源根）**不在**这里生效：它必须建 `FileSource` 之前决定，由主进程在
 * `electron/paths.ts` 里解析（`decideResourceDir`），渲染进程只负责 `version`。
 */
export async function loadEmulatorOptionsFile(e: Engine, trace: (line: string) => void): Promise<void> {
  try {
    const hit = await window.api?.readEmulatorOptions?.();
    if (!hit) {
      trace('[options] 该 preload 没有 readEmulatorOptions 通道 ⇒ 用默认值');
      for (const n of applyEmulatorOptionsToEngine(e, DEFAULT_EMULATOR_OPTIONS)) trace(`[options] ${n}`);
      return;
    }
    if (!hit.exists) {
      trace(
        `[options] 未找到 ${hit.path}（用默认值：boot.showLogo=${DEFAULT_EMULATOR_OPTIONS.boot.showLogo}` +
          ` resources.version=${DEFAULT_EMULATOR_OPTIONS.resources.version}）`,
      );
    } else {
      trace(`[options] ${hit.path}`);
    }
    const { options, problems } = parseEmulatorOptions(hit.exists ? hit.text : '');
    for (const p of problems) trace(`[options] ⚠ ${p}`);
    for (const n of applyEmulatorOptionsToEngine(e, options)) trace(`[options] ${n}`);
  } catch (err) {
    trace(`[options] 加载失败：${(err as Error).message}`);
  }
}

/**
 * 装载 `SAVE.DAT` 里的 `save-int`/`save-string` 两张表（引擎 raw 142107 的等价物）。
 *
 * 失败不致命：读不到/不是本工程格式时只记一行 trace，脚本随后会把 `global 5` 读成 0 ⇒ 走
 * `INITCONFIG`（首次启动）分支，也就是"回到默认设置"——与真机首次启动的表现一致。
 */
export async function loadSaveData(e: Engine, trace: (line: string) => void): Promise<void> {
  try {
    const bytes = await e.fileSource?.readSaveData?.();
    if (!bytes) {
      trace('[save] 无 SAVE.DAT（首次启动：脚本将走 INITCONFIG 默认值分支）');
      return;
    }
    const r = decodeSaveData(bytes);
    if (!r.ok) {
      trace(`[save] 无法解析 SAVE.DAT：${r.reason}`);
      return;
    }
    // ★**按 key 并表**（`tickets/T-0069`）：overlay 那份可能由旧版本写过、缺了**按槽**的记录
    //   （槽标题 `\x05000004xx`、状态、日期…）⇒ 不并表就会出现"存档列表没标题、点不进读档"。
    //   真游戏那份（base）补缺键；引擎的表是单调增长的（从不删键）⇒ 并集与引擎语义一致。
    const both = await e.fileSource?.readSaveDataBoth?.();
    const m = mergeSaveDataFallbacks(r.data.tables, (both ?? []).slice(1), trace);
    e.applySaveDataTables(m.tables);
    if (m.added > 0 || m.failed > 0) {
      trace(`[save] 并表：补 ${m.added} 个键${m.failed ? `（${m.failed} 份解不出来）` : ''} ⇒ int=${m.tables.ints.size} str=${m.tables.strings.size}`);
    }
    // ★「已使用文件」标志（FileDB 的鉴赏/解锁表）：引擎在装载 SAVE.DAT 时一并还原（raw 15202-15238）
    //   ⇒ 回想界面的「回収数/回収率」与 BGM 鑑賞列表跨会话保留（不是每个存档槽各自一份）。
    //   优先用 `readSaveFlags()`（主进程把 overlay 与 base **两侧取并集**）；没有该 API 时退回本文件里的那份。
    const merged = await e.fileSource?.readSaveFlags?.();
    const flags = merged && merged.length > 0 ? merged : [...r.data.usage.usedFileIds];
    e.setUsedFileIds(flags);
    trace(
      `[save] ${r.data.title}（format=${r.data.format}，${r.data.tables.ints.size} 个 int / ` +
        `${r.data.tables.strings.size} 个 string，已使用文件 ${flags.length} 个` +
        `［本文件 ${r.data.usage.layout}:${r.data.usage.usedFileIds.size}${merged ? ` / 并集 ${merged.length}` : ''}］）` +
        '⇒ 脚本将走 LOADCONFIG 分支',
    );
  } catch (err) {
    trace(`[save] 装载失败：${(err as Error).message}`);
  }
}
