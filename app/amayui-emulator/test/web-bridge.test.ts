/** @tier T0 @kind core @subsystem host */

/**
 * **`window.api` 的 web 实现守卫**（`tickets/T-0134` Phase 2）—— `src/renderer/webBridge.ts`。
 *
 * 这条桥是"浏览器宿主"的整个宿主面：它错了，症状会是"渲染窗起了但什么都读不到/存档写不进去"，
 * 而且**只在真跑浏览器时才看得见**。所以这里用注入的假 `fetch`/`EventSource` 把协议形状、字节口径、
 * 降级项一次性钉死 —— 与 `test/audio-*` 注入假宿主同一手法。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { WebBridge, type EventSourceLike } from '../src/renderer/webBridge.js';
import { KIND_HEADER, META_HEADER, decodeEnvelope, encodeEnvelope, formatMeta } from '../src/web/envelope.js';

/** 记录请求的假 fetch；由 `handler` 决定响应。 */
function fakeFetch(handler: (url: string, init: RequestInit) => Response) {
  const calls: { url: string; init: RequestInit; body: Uint8Array | null }[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body instanceof Uint8Array ? (init.body as Uint8Array) : null;
    calls.push({ url, init: init ?? {}, body });
    return handler(url, init ?? {});
  }) as unknown as typeof fetch;
  return { impl, calls };
}

/** JSON 响应。 */
const jsonRes = (v: unknown) =>
  new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' } });

/** 二进制响应（信封 + 元数据头）。 */
const binRes = (parts: Uint8Array[], meta: Record<string, unknown> = {}) =>
  new Response(encodeEnvelope(parts) as unknown as BodyInit, {
    status: 200,
    headers: { [KIND_HEADER]: 'bin', [META_HEADER]: formatMeta(meta), 'content-type': 'application/octet-stream' },
  });

/** 假 EventSource（测试自己推帧）。 */
type FakeEs = EventSourceLike & { url: string; closed: boolean; push(data: string): void };

function fakeEs() {
  const made: { url: string; es: FakeEs }[] = [];
  const factory = (url: string): EventSourceLike => {
    const rec: FakeEs = {
      url,
      closed: false,
      onmessage: null,
      onerror: null,
      close() {
        rec.closed = true;
      },
      push(data: string) {
        rec.onmessage?.({ data });
      },
    };
    made.push({ url, es: rec });
    return rec;
  };
  return { factory, made };
}

test('★JSON 方法：POST `<base>/<method>` + `{args:[…]}`，回值直通', async () => {
  const { impl, calls } = fakeFetch(() => jsonRes({ path: '/x/SYS4REG.INI', text: 'k=1', side: 'overlay' }));
  const b = new WebBridge({ base: '/dsh-emulator/api', fetchImpl: impl });
  const got = await b.api().readConfigIni();
  assert.deepEqual(got, { path: '/x/SYS4REG.INI', text: 'k=1', side: 'overlay' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, '/dsh-emulator/api/read-config-ini');
  assert.equal(calls[0]!.init.method, 'POST');
  assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), { args: [] });
});

test('★二进制方法：信封 + 元数据头 → `{name,width,height,data:Uint8Array}`', async () => {
  const rgba = new Uint8Array([1, 2, 3, 4, 5, 6]);
  const { impl } = fakeFetch(() => binRes([rgba], { name: 'SO020.AGF', width: 2, height: 1 }));
  const b = new WebBridge({ fetchImpl: impl });
  const img = await b.api().image(0x5245);
  assert.ok(img);
  assert.equal(img.name, 'SO020.AGF');
  assert.equal(img.width, 2);
  assert.equal(img.height, 1);
  assert.ok(img.data instanceof Uint8Array, '必须是 Uint8Array（不是 number[]）');
  assert.deepEqual(Array.from(img.data), [1, 2, 3, 4, 5, 6]);
});

test('★0 段信封 = "取不到" ⇒ `null`（与 Electron 侧同义，不能变成空 Uint8Array）', async () => {
  const { impl } = fakeFetch(() => binRes([], {}));
  const b = new WebBridge({ fetchImpl: impl });
  assert.equal(await b.api().readSaveData!(), null);
  assert.equal(await b.api().readSlotThumb!(3), null);
  assert.equal(await b.api().readById!(9), null);
});

test('★脚本/文件：`data` 是 Uint8Array 且带元数据（`ipcFileSource` 拿到就 new Uint8Array）', async () => {
  const script = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
  const { impl, calls } = fakeFetch(() => binRes([script], { index: 0, name: 'SYSTEM4.BIN' }));
  const b = new WebBridge({ fetchImpl: impl });
  const s = await b.api().readScript(0);
  assert.ok(s);
  assert.equal(s.index, 0);
  assert.equal(s.name, 'SYSTEM4.BIN');
  assert.deepEqual(Array.from(s.data), [0xde, 0xad, 0xbe, 0xef]);
  assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), { args: [0] });
  // `new Uint8Array(Uint8Array)` 是运行期同义的那次拷贝。
  assert.deepEqual(Array.from(new Uint8Array(s.data as unknown as Uint8Array)), [0xde, 0xad, 0xbe, 0xef]);
});

test('★多段：`readSaveDataBoth` 回 `Uint8Array[]`（两侧 SAVE.DAT）', async () => {
  const { impl } = fakeFetch(() => binRes([new Uint8Array([1, 1]), new Uint8Array([2, 2, 2])]));
  const b = new WebBridge({ fetchImpl: impl });
  const both = await b.api().readSaveDataBoth!();
  assert.equal(both.length, 2);
  assert.deepEqual(Array.from(both[0] as Uint8Array), [1, 1]);
  assert.deepEqual(Array.from(both[1] as Uint8Array), [2, 2, 2]);
});

test('★写字节：body 是单段信封、其余参数在 `x-amayui-args`（不能塞进 JSON 放大）', async () => {
  const payload = new Uint8Array([7, 7, 7, 7]);
  const { impl, calls } = fakeFetch(() => jsonRes({ path: '/overlay/SAVE/SAVE03.DAT' }));
  const b = new WebBridge({ fetchImpl: impl });
  await b.api().writeSaveSlot!(3, payload);
  assert.equal(calls[0]!.url, '/dsh-emulator/api/write-save-slot');
  assert.equal(calls[0]!.init.headers!['content-type' as never], 'application/octet-stream');
  assert.deepEqual(JSON.parse(decodeURIComponent(calls[0]!.init.headers!['x-amayui-args' as never] as string)), { args: [3] });
  assert.deepEqual(Array.from(decodeEnvelope(calls[0]!.body!)[0]!), [7, 7, 7, 7]);
});

test('★单向消息：`POST <base>/event` 带 `{channel,args}`（`ipcRenderer.send` 的等价物）', async () => {
  const { impl, calls } = fakeFetch(() => jsonRes(null));
  const b = new WebBridge({ fetchImpl: impl });
  b.api().logLine('hello');
  b.api().closeWindow();
  await new Promise((r) => setTimeout(r, 0)); // 让 fire-and-forget 的 promise 落地
  assert.equal(calls.length, 2);
  assert.equal(calls[0]!.url, '/dsh-emulator/api/event');
  assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), { channel: 'log-line', args: ['hello'] });
  assert.deepEqual(JSON.parse(String(calls[1]!.init.body)), { channel: 'close-window', args: [] });
});

test('★`logLineSync` 降级为 `sendBeacon`（唯一同步通道；返回值本来没人用）', async () => {
  const { impl } = fakeFetch(() => jsonRes(null));
  const beacons: { url: string; data: string }[] = [];
  const b = new WebBridge({
    fetchImpl: impl,
    beacon: (url, data) => {
      beacons.push({ url, data });
      return true;
    },
  });
  const ret = b.api().logLineSync('tail line');
  assert.equal(ret, '', '签名说返回 string ⇒ 给空串（调用点忽略返回值）');
  assert.equal(beacons.length, 1);
  assert.equal(beacons[0]!.url, '/dsh-emulator/api/event');
  assert.deepEqual(JSON.parse(beacons[0]!.data), { channel: 'log-line-sync', args: ['tail line'] });
});

test('★SSE 推送：按 channel 派发；退订后不再回调；`connect()` 幂等', async () => {
  const { impl } = fakeFetch(() => jsonRes(null));
  const es = fakeEs();
  const b = new WebBridge({ fetchImpl: impl, createEventSource: es.factory });
  const seen: unknown[] = [];
  const off = b.api().onTraceAll((v) => seen.push(v));
  const off2 = b.api().onTraceAll((v) => seen.push(`2:${String(v)}`));
  assert.equal(es.made.length, 1, 'connect() 必须幂等（只建一条 SSE）');
  assert.equal(es.made[0]!.url, '/dsh-emulator/events');
  es.made[0]!.es.push(JSON.stringify({ channel: 'renderer-set-trace-all', args: [true] }));
  assert.deepEqual(seen, [true, '2:true']);
  es.made[0]!.es.push(JSON.stringify({ channel: 'renderer-set-trace-filter', args: [[1, 2]] }));
  assert.equal(seen.length, 2, '别的 channel 不该触发');
  off();
  es.made[0]!.es.push(JSON.stringify({ channel: 'renderer-set-trace-all', args: [false] }));
  assert.deepEqual(seen, [true, '2:true', '2:false']);
  off2();
  b.close();
  assert.equal(es.made[0]!.es.closed, true, 'close() 必须真的关掉 SSE');
});

test('★坏 SSE 帧只记日志、不炸（推送通道不能把渲染窗带崩）', async () => {
  const logs: string[] = [];
  const { impl } = fakeFetch(() => jsonRes(null));
  const es = fakeEs();
  const b = new WebBridge({ fetchImpl: impl, createEventSource: es.factory, log: (l) => logs.push(l) });
  b.connect();
  es.made[0]!.es.push('{not json');
  assert.equal(logs.filter((l) => l.includes('不是 JSON')).length, 1);
});

test('★降级项确实**不存在**（`audioStreamBase` / `setSystemCursor` / `control*`）', async () => {
  const { impl } = fakeFetch(() => jsonRes(null));
  const api = new WebBridge({ fetchImpl: impl }).api();
  const o = api as unknown as Record<string, unknown>;
  assert.equal(o.audioStreamBase, undefined, '不提供 ⇒ streamUrl() 返回 undefined（静音/解码退化）');
  assert.equal(o.setSystemCursor, undefined, '可做但故意不做（T-0133 §0.9 订正 2）');
  assert.equal(o.controlForceClose, undefined, '控制面板是另一个页面，不是这个 iframe');
  assert.equal(o.record, undefined, '录制是 Electron 录制器的场景');
});

test('★`fetch` 必须**裸调**：receiver 不能是桥实例（浏览器里否则 Illegal invocation）', async () => {
  // 端到端实跑抓到过的真 bug：`this.#fetch(url)` 把桥实例当 receiver ⇒ 浏览器报
  // "Failed to execute 'fetch' on 'Window': Illegal invocation"。Node 的 fetch 不挑 receiver，
  // 所以只有这条断言能守住它。
  const orig = globalThis.fetch;
  let receiver: unknown = 'never-called';
  globalThis.fetch = function (this: unknown) {
    receiver = this;
    return Promise.resolve(jsonRes({ ok: 1 }));
  } as unknown as typeof fetch;
  try {
    const b = new WebBridge({});            // ★不给 fetchImpl ⇒ 走默认路径
    await b.api().readConfigIni();
  } finally {
    globalThis.fetch = orig;
  }
  assert.notEqual(receiver, undefined === receiver ? 'x' : receiver, 'sanity');
  assert.ok(!(receiver instanceof WebBridge), `fetch 的 receiver 不许是桥实例（实际 ${String(receiver)}）`);
});

test('★HTTP 失败要冒出来（不静默返回 undefined —— 那会表现成"读不到但不知为什么"）', async () => {
  const { impl } = fakeFetch(() => new Response('boom', { status: 500, statusText: 'Internal Error' }));
  const b = new WebBridge({ fetchImpl: impl });
  await assert.rejects(() => b.api().readScript(0), /HTTP 500/);
});
