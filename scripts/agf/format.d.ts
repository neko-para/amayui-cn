/**
 * `scripts/agf/format.js` 的**最小**类型声明（`tickets/T-0126`）。
 *
 * 为什么需要：`app/amayui-emulator/test/agf-size.test.ts` 把共享解码器当 oracle
 * （`src/` 因 `tsconfig.json` 的 `rootDir: "src"` 不能 import 仓库根下的 `scripts/`，
 * 只能由 `test/` 跨目录引用 —— 见该测试文件头），而 `tsconfig.test.json` 不开 `allowJs`
 * ⇒ 没有声明就是 TS7016「implicitly has an 'any' type」，等于把 oracle 的返回值放成 `any`。
 *
 * ★只声明**被跨目录引用**的那一个出口：其余出口不声明，引用到就会报错，
 * 而不是拿到一个 `any` 静默通过（这正是本文件存在的理由）。
 */
export interface AgfRgba {
  width: number;
  height: number;
  /** top-down RGBA，长度 `width * height * 4`。 */
  rgba: Uint8Array;
}

/** 把 AGF 字节解码成 top-down RGBA；无法识别返回 `null`（`format.js:631`）。 */
export function decodeAgfRgba(buf: Uint8Array, log?: (msg: string) => void): AgfRgba | null;
