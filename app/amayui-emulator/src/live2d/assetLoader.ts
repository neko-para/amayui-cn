/**
 * **Live2D 资产装配**（宿主侧；把 `.MOC` / PNG / `.MTN` 读进来接到运行态上）。
 *
 * 为什么单独一层：opcode handler 只能调 `NativeBridge.l2d*`（同步/异步缝），而"读字节 → 解析 →
 * 写运行态"这段在**两个宿主里是同一份逻辑**（Pixi 与 headless 必须一致，否则"报告说装了、画面没装"）。
 * 宿主只需提供 `loadById`（统一文件 id → 文件名字节）。
 *
 * ## id 口径
 * `0x341`/`0x345`/`0x34E` 的 op1 是**统一文件 id**（见 `resource-loading.md` §1），
 * 由 `FileSource` 的 id→(归档,偏移,长度) 表解析（`NodeFileSource.readById` / IPC 侧等价物）。
 *
 * ## ★`tickets/T-0160`：三条装载路径（0x341/0x345/0x34E）的**读文件语义**
 * 引擎三条都是"**每次调用都真读一遍文件**"（`sub_4A1860` raw 121683 / `sub_4A1970` raw 121710 /
 * `sub_4A19F0` raw 121732 的 `ReadFile`），缓存只可能出现在**解析**这一级。旧实现把
 * `mocCache`/`mtnCache` 当成"整条装载"的短路（命中就连 `loadById` 都不调）⇒ 两个可观测分叉：
 * ① 同一 id 的第二次装不会重建（引擎是"析构旧实例 + 新建"，参数/部件显隐/动作队列全复位）；
 * ② 文件**已经**取不到、但同一 id 之前装过时，emulator 会静默装成功（引擎那条路是"旧模型已销毁、
 * 新模型装不上、抛 ShowMessage"）。
 * ⇒ 现在：**读字节无条件**；`mocCache`/`mtnCache` 只缓存**解析结果**。
 */
import { parseMoc, type MocModel } from './moc.js';
import { parseMtn, type Mtn } from './mtn.js';
import { l2dBindTexture, l2dLoadModel, l2dStartMotion, type L2dHost } from './runtime.js';

/** 统一文件 id → 文件名 + 原始字节（`FileSource.readById` 的子集）。 */
export interface Live2dAssetSource {
  loadById(id: number): Promise<{ name: string; data: Uint8Array } | null>;
}

export interface Live2dLoadLog {
  (msg: string): void;
}

/**
 * **一次装载失败的描述**（照引擎的失败支：组一条消息串 + 抛 `Command_ShowMessage_Exception`）。
 *
 * 引擎的原文（`sub_408050` 的格式串，文件名由 `sub_454FA0(FileDB, id)` 取）：
 *  - `0x341`：`L2Dモデルファイル %s の読み込みに失敗しました`（raw 34488）
 *  - `0x345`：`L2Dテクスチャファイル %s の読み込みに失敗しました`（raw 34548）
 *  - `0x34E`：`L2Dモーションファイル %s の読み込みに失敗しました`（raw 34728）
 */
export interface L2dLoadFailure {
  /** 引擎消息原文（`%s` 已替换）。 */
  engineText: string;
  /** 文件名（取不到文件时只有 id 的十六进制形式）。 */
  fileName: string;
  /** 细节（给 `ShowMessageError` 的 detail 用）。 */
  detail: string;
}

/** 三条失败消息的原文（`%s` = 文件名）。 */
export const L2D_FAIL_MODEL = 'L2Dモデルファイル %s の読み込みに失敗しました';
export const L2D_FAIL_TEXTURE = 'L2Dテクスチャファイル %s の読み込みに失敗しました';
export const L2D_FAIL_MOTION = 'L2Dモーションファイル %s の読み込みに失敗しました';

/** 把 `%s` 换成文件名（引擎 `sub_408050` 的一处替换）。 */
export function l2dFailText(template: string, fileName: string): string {
  return template.replace('%s', fileName);
}

/** 解析缓存：同一次会话里同一 id 只解析一次（引擎侧 `0x341` 的"槽非空先析构再建"仍照做）。 */
export const mocCache = new WeakMap<Live2dAssetSource, Map<number, MocModel>>();

function cacheFor(src: Live2dAssetSource): Map<number, MocModel> {
  let m = mocCache.get(src);
  if (!m) {
    m = new Map();
    mocCache.set(src, m);
  }
  return m;
}

/**
 * 装 `.MOC` 进实例槽（`0x341` 的宿主侧）。
 *
 * **失败语义**：引擎读不到/解析失败都会**先销毁旧实例**、再组「L2Dモデルファイル %s の読み込みに
 * 失敗しました」并 `_CxxThrowException`（raw 34482-34492）⇒ 调用方必须走 `onFail` 把它变成
 * `ShowMessageError`（`handlers/live2d.ts`），**不能**像旧实现那样只记一条日志后继续跑。
 * 槽本身按"旧实例已 delete、新实例装不上"清空（引擎此时槽里那个对象是解析失败的半成品；
 * emulator 没有"坏模型"表示 ⇒ 删槽 = 节点整块不出画，与引擎 raw 134320 同一条门控）。
 */
export async function loadModelIntoSlot(
  src: Live2dAssetSource,
  host: L2dHost,
  fileId: number,
  slot: number,
  log?: Live2dLoadLog,
  onFail?: (f: L2dLoadFailure) => void,
): Promise<MocModel | null> {
  // ★先销毁旧实例（引擎 raw 121674-121681 在 ReadFile **之前**），再读字节（无条件）
  const hadOld = host.l2dSlots.delete(slot);
  const bytes = await src.loadById(fileId);
  if (!bytes) {
    const fileName = `0x${fileId.toString(16)}`;
    log?.(`[l2d] 0x341：文件 id ${fileName} 取不到 ⇒ 槽 ${slot} 保持为空（节点不出画）`);
    onFail?.({
      engineText: l2dFailText(L2D_FAIL_MODEL, fileName),
      fileName,
      detail: `文件 id ${fileName} 取不到${hadOld ? '（旧实例已按引擎语义销毁）' : ''}`,
    });
    return null;
  }
  let model = cacheFor(src).get(fileId);
  if (!model) {
    try {
      model = parseMoc(bytes.data);
    } catch (e) {
      log?.(`[l2d] 0x341：${bytes.name} 解析失败（${(e as Error).message}）⇒ 槽 ${slot} 保持为空`);
      onFail?.({
        engineText: l2dFailText(L2D_FAIL_MODEL, bytes.name),
        fileName: bytes.name,
        detail: `.MOC 解析失败（${(e as Error).message}）`,
      });
      return null;
    }
    cacheFor(src).set(fileId, model);
  }
  l2dLoadModel(host, slot, fileId, model);
  return model;
}

/**
 * 装纹理（`0x345` 的宿主侧）。
 *
 * 运行态只记"模型内纹理号 → 纹理文件 id"（`l2dBindTexture`）；**真正的图像解码由渲染宿主做**
 * （Pixi 侧按 id 取 PNG 建纹理，headless 侧只需要 id 就能出报告/snapshot）。
 * ⇒ 这里只验"文件在不在"（不在就记一条），不做解码。
 *
 * ★与 `0x341/0x34E` 不同：引擎这条**不抛**（`sub_427CF0` raw 34542-34552 的失败支确实也组串 + 抛，
 * 但那是纹理 handler 自己的事；本函数只负责"验证 + 绑定"），调用方的口径见 `handlers/live2d.ts`。
 */
export async function bindTextureToSlot(
  src: Live2dAssetSource,
  host: L2dHost,
  fileId: number,
  slot: number,
  textureNo: number,
  log?: Live2dLoadLog,
): Promise<boolean> {
  const bytes = await src.loadById(fileId);
  if (!bytes) {
    log?.(`[l2d] 0x345：纹理 id 0x${fileId.toString(16)} 取不到 ⇒ 槽 ${slot} 纹理 ${textureNo} 无图`);
    return false;
  }
  l2dBindTexture(host, slot, fileId, textureNo);
  return true;
}

/** `.MTN` 解析缓存（按文件 id；只缓存**解析结果**，读字节仍然每次都做）。 */
export const mtnCache = new WeakMap<Live2dAssetSource, Map<number, Mtn>>();

function mtnCacheFor(src: Live2dAssetSource): Map<number, Mtn> {
  let m = mtnCache.get(src);
  if (!m) {
    m = new Map();
    mtnCache.set(src, m);
  }
  return m;
}

/**
 * 动作可用性（= 引擎 `sub_4BCE90()`"解析出错"的 emulator 等价物）。
 *
 * ★口径与理由：`parseMtn` 是**容错**解析（读一行认一行，从不抛），没有 SDK 那个错误标志位；
 * 一份 `.MTN` 若一条曲线都没有，SDK 那边就是"没有动作数据" ⇒ 这里按解析失败处理
 * （登记为近似：真实 `.MTN` 330/330 都有曲线，见 `mtn.ts` 头部实测）。
 */
export function motionUsable(motion: Mtn): boolean {
  return motion.curves.length > 0;
}

/**
 * 装 `.MTN` 并**入队**（`0x34E` 的宿主侧；引擎里 `sub_478640` → `sub_4BCA20(queue, motion, 1)`）。
 *
 * ★读文件仍然无条件（引擎 `sub_428200` → `sub_4A19F0` raw 121732 的 `ReadFile`）：
 * 文件取不到 ⇒ 动作记录**一格不动**（引擎连 `sub_478640` 都没调），由 `onFail` 上报；
 * 文件在、但解析失败 ⇒ 记录里换成坏对象（`L2dMotionRecord.parseError`）、不入队，同样由 `onFail` 上报。
 *
 * ★`Engine.l2dMotionCache` 的**唯一读者就在这里**（按动作 id 复用已解析的动作对象；
 * 它此前只有 `.set()`/`.clear()`，是本票点名的存量死写）。
 *
 * @returns 解析出的动作；`null` = 连文件都取不到（此时 `onFail` 已调用）。
 */
export async function startMotionOnSlot(
  src: Live2dAssetSource,
  host: L2dHost,
  fileId: number,
  slot: number,
  motionSlot: number,
  loop: boolean,
  log?: Live2dLoadLog,
  onFail?: (f: L2dLoadFailure) => void,
): Promise<Mtn | null> {
  const bytes = await src.loadById(fileId);
  if (!bytes) {
    const fileName = `0x${fileId.toString(16)}`;
    log?.(`[l2d] 0x34E：动作 id ${fileName} 取不到 ⇒ 槽 ${slot} 不播动作（记录不动）`);
    onFail?.({
      engineText: l2dFailText(L2D_FAIL_MOTION, fileName),
      fileName,
      detail: `动作 id ${fileName} 取不到（动作记录未改动）`,
    });
    return null;
  }
  let motion = host.l2dMotionCache.get(fileId);
  if (!motion) {
    motion = mtnCacheFor(src).get(fileId);
    if (!motion) {
      motion = parseMtn(bytes.data, bytes.name);
      mtnCacheFor(src).set(fileId, motion);
    }
  }
  const ok = l2dStartMotion(host, slot, fileId, motion, motionSlot, loop, { parseError: !motionUsable(motion) });
  if (!ok) {
    const usable = motionUsable(motion);
    log?.(`[l2d] 0x34E：${bytes.name} 装载未生效（${usable ? '槽不存在或槽里没有模型' : '解析失败'}）`);
    onFail?.({
      engineText: l2dFailText(L2D_FAIL_MOTION, bytes.name),
      fileName: bytes.name,
      detail: usable
        ? `槽 ${slot} 不存在或槽里没有模型（引擎 sub_478640 raw 92817 的 if (!*_this) return 0）`
        : `.MTN 解析失败（没有解析出任何参数曲线）`,
    });
  }
  return motion;
}
