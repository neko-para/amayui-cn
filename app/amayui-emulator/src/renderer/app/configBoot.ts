/**
 * 启动期把 `SYS4REG.INI` 灌进引擎字段（对齐引擎 `sub_492CB0` 装载 + 启动灌字段）。
 *
 * 目的：让读配置类 opcode（`0xC0` sound:Music / `0x131` message:MesWinAlpha / `0x2CE` display:ScreenMode…）
 * 拿到与真实存档一致的取值，而不是一律 0。
 *
 * 失败不致命：找不到/读不动 INI 时只记一行 trace，引擎字段沿用构造默认值。
 */
import { applyConfigToEngine, formatIni, parseIni } from '../../engineConfig.js';
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
      `[config] ${ini.path} 分节=[${cfg.sections.join(',')}] 键=${cfg.values.size} 个；` +
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
  } catch (err) {
    trace(`[config] 加载失败：${(err as Error).message}`);
  }
}
