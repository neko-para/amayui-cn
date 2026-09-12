/**
 * 启动期把 `SYS4REG.INI` 灌进引擎字段（对齐引擎 `sub_492CB0` 装载 + 启动灌字段）。
 *
 * 目的：让读配置类 opcode（`0xC0` sound:Music / `0x131` message:MesWinAlpha / `0x2CE` display:ScreenMode…）
 * 拿到与真实存档一致的取值，而不是一律 0。
 *
 * 失败不致命：找不到/读不动 INI 时只记一行 trace，引擎字段沿用构造默认值。
 */
import { applyConfigToEngine, formatIni, parseIni } from '../../engineConfig.js';
import { decodeSaveData, encodeSaveData } from '../../vm/saveData.js';
import type { Engine } from '../../vm/engine.js';

export async function loadEngineConfig(e: Engine, trace: (line: string) => void): Promise<void> {
  try {
    const ini = await window.api?.readConfigIni?.();
    if (!ini) {
      trace('[config] 未找到 SYS4REG.INI（引擎字段用默认值）');
      return;
    }
    const cfg = parseIni(ini.text);
    e.config = cfg;
    const applied = applyConfigToEngine(cfg, e.engineValues);
    trace(
      `[config] ${ini.path}（${ini.side}）分节=[${cfg.sections.join(',')}] 键=${cfg.values.size} 个；` +
        `写入引擎字段 ${applied.length} 个：` +
        applied.map((a) => `_this[${a.field}]=${a.value}(${a.key})`).join(' '),
    );
    // ★配置**回写**：脚本用 SetConfig 族（0x141/0x1B5/0x1B9/0x2CD/0x2E7/0x2E8…）改了配置后，
    //   把整份 INI 交主进程写回同一个文件（引擎里这是退出时写盘；这里改为改一次写一次，1KB 文件无压力）。
    //   合并同帧内的多次改动：只在没有在途写入时发一份最新的；写完若又改过就再发一次。
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

    // ---- SAVE.DAT：脚本 `save-int`/`save-string` 两张表的持久化 ----
    // 引擎在 WinMain 里先装载存档（raw 142107 `sub_40AEE0`），脚本随后 `SYSTEM4.txt:71 load-int (global 5)`
    // 读「已初始化」标志：为 1 走 LOADCONFIG（恢复用户设置），为 0 走 INITCONFIG（写默认值并登记）。
    // 因此**必须在脚本跑之前**把表装好，否则每次启动都会被当成首次启动（设置永远回到默认）。
    await loadSaveData(e, trace);
    let savePending: Uint8Array | null = null;
    let saveInFlight = false;
    const flushSave = async (): Promise<void> => {
      if (saveInFlight || savePending === null) return;
      const bytes = savePending;
      savePending = null;
      saveInFlight = true;
      try {
        await window.api?.writeSaveData?.(bytes);
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
  } catch (err) {
    trace(`[config] 加载失败：${(err as Error).message}`);
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
    e.applySaveDataTables(r.data.tables);
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
