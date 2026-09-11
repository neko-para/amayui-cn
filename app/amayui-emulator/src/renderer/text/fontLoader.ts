/**
 * **内置字体加载**（`res/fonts/` → `document.fonts`），**按需 + 幂等**。
 *
 * 为什么按需：内置 CJK 字体每个 24 MB 级（Sarasa 的 Regular + Bold ≈ 48 MB），
 * 启动时全量读入会白白拖慢 boot（而脚本常用的可能只有一两个面）。
 * 因此 `ensureFont(family, weight)` 在**光栅化前**按实际用到的字族调用。
 *
 * 为什么走 IPC 而不是相对 URL：渲染页在 `dist/renderer/` 下，`file://` + CSP
 * （`default-src 'self'`）加载仓外资源不可靠。字体字节经 `window.api.font(file)` 由主进程读出
 * （**传 `Uint8Array` 而不是 `number[]`** —— 后者会把 24 MB 变成数千万个 JS number）。
 *
 * 未加载完就光栅化会落到浏览器 fallback 字体（字形会明显不同），
 * 因此 `fontVersion()` 在每个字族加载完成时自增，渲染层据此**重画一次**。
 */
import { fontFaceFor } from '../../text/fontSet.js';

/** 已注册的字族键（`family#weight`）。 */
const loaded = new Set<string>();
/** 进行中的加载（幂等）。 */
const pending = new Map<string, Promise<void>>();
const failures: string[] = [];
/** 每成功注册一个字族自增一次 —— 渲染层据此判断"要不要重画"。 */
let version = 0;

const key = (family: string, weight: number): string => `${family}#${weight}`;

/** 已加载字族的版本号：变化 ⇒ 之前用 fallback 画出来的文本需要重画。 */
export function fontVersion(): number {
  return version;
}

/** 该字族/字重是否已注册。 */
export function isFontLoaded(family: string, weight: number): boolean {
  return loaded.has(key(family, weight));
}

/** 加载失败的字族（诊断）。 */
export function fontFailures(): readonly string[] {
  return failures;
}

/**
 * 幂等地注册一个字族/字重。失败**不抛**：记一次日志并标记失败，调用方照常用 fallback 画
 * （"画出来字体不对"远好于"什么都不画"）。
 */
export function ensureFont(family: string, reqWeight: 400 | 700, log: (msg: string) => void): Promise<void> {
  const resolved = fontFaceFor(family, reqWeight);
  if (!resolved) {
    const k = key(family, reqWeight);
    if (!failures.includes(k)) {
      failures.push(k);
      log(`[font] 没有内置文件对应字族 ${k} → 用浏览器字体`);
    }
    return Promise.resolve();
  }
  // ★键用"文件声明的字重"：请求 700 而该族只有 Regular 时，注册的是 400 面
  //   （浏览器据此**合成**加粗）；按请求字重做键会导致每帧重复加载。
  const { file, weight } = resolved;
  const k = key(family, weight);
  if (loaded.has(k) || failures.includes(k)) return Promise.resolve();
  const inflight = pending.get(k);
  if (inflight) return inflight;

  const task = (async () => {
    try {
      const buf = await window.api.font(file);
      if (!buf || buf.length === 0) throw new Error('空文件 / 不存在');
      const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
      const face = new FontFace(family, bytes, { weight: String(weight) });
      await face.load();
      // lib.dom 的 FontFaceSet 在本 TS 版本里未声明 add（运行时存在）
      (document.fonts as unknown as { add(f: FontFace): void }).add(face);
      loaded.add(k);
      version++;
      log(
        `[font] ${k} ← ${file}（${Math.round(buf.byteLength / 1024)}KB）` +
          (reqWeight !== weight ? `（请求 ${reqWeight}，文件只有 ${weight} ⇒ 浏览器合成加粗）` : ''),
      );
    } catch (err) {
      failures.push(k);
      log(`[font] 加载失败 ${k} (${file}): ${(err as Error).message} → 回退浏览器字体`);
    } finally {
      pending.delete(k);
    }
  })();
  pending.set(k, task);
  return task;
}
