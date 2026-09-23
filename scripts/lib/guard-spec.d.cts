/**
 * `guard-spec.cjs` 的类型声明（供 `app/amayui-emulator/test/guardAnchor.ts` import）。
 * 实现只有一份：`guard-spec.cjs`。
 */
export declare function splitGuardSpec(spec: string): { file: string; anchor: string | undefined };
export declare function checkGuard(root: string, spec: string): string | null;
export declare function checkGuards(root: string, pairs: Array<[string, string]>): string[];
