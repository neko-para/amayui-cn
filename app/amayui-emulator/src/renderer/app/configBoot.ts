/**
 * 启动期把 `SYS4REG.INI` 灌进引擎字段（对齐引擎 `sub_492CB0` 装载 + 启动灌字段）。
 *
 * 目的：让读配置类 opcode（`0xC0` sound:Music / `0x131` message:MesWinAlpha / `0x2CE` display:ScreenMode…）
 * 拿到与真实存档一致的取值，而不是一律 0。
 *
 * 失败不致命：找不到/读不动 INI 时只记一行 trace，引擎字段沿用构造默认值。
 */
import { applyConfigToEngine, parseIni } from '../../engineConfig.js';
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
  } catch (err) {
    trace(`[config] 加载失败：${(err as Error).message}`);
  }
}
