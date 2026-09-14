/**
 * **配置注册表的权威键表**（键名 + 类型 + 内建默认值 + 顺序）—— 由引擎 `sub_491880`
 * （raw 111338-111845，注册表对象构造：`&Reg___vftable_` 之后逐条 `sub_434D00`(int)/`sub_434E00`(string)
 * 注入默认）**机械抽取**，不要手改（改就重抽；抽取口径见 `tickets/T-0031` 的 notes/changes）。
 *
 * 用途（`tickets/T-0031`）：
 *  - `formatIni()` 按本表的**顺序全量导出**（引擎的导出形态：`sub_490590` 是 53 次 `GetConfig` 的直线序列，
 *    固定顺序、无局部编辑）；
 *  - 缺值的键写**引擎内建默认**（`def`），因此首跑生成的 INI 天然是"全量 + 固定顺序"，
 *    而不是"只含玩家碰过的键"。
 *
 * ★注意：`debug:DebugOutFlag%d` 之类的**动态键**（raw 里由 sprintf 拼名、循环注入）不在此表内。
 */
export interface RegistryKey {
  /** `section:key`（大小写与引擎字符串一致）。 */
  key: string;
  kind: 'int' | 'string';
  /** 内建默认值（string 键多为空串）。 */
  def: number | string;
}

/** 抽取源：`engine/天结_unpacked.exe_utf8.c` raw 111338-111845（115 条；顺序 = 构造顺序）。 */
export const CONFIG_REGISTRY_KEYS: readonly RegistryKey[] = [
  { key: 'sound:Music', kind: 'int', def: 0 },
  { key: 'sound:Sound', kind: 'int', def: 1 },
  { key: 'sound:Voice', kind: 'int', def: 1 },
  { key: 'sound:SE', kind: 'int', def: 1 },
  { key: 'sound:Movie', kind: 'int', def: 1 },
  { key: 'debug:DebugFlag', kind: 'int', def: 0 },
  { key: 'display:UseDirectDrawEmuration', kind: 'int', def: 0 },
  { key: 'display:UseWideSurface', kind: 'int', def: 0 },
  { key: 'sound:UseDirectSound', kind: 'int', def: 1 },
  { key: 'sound:UseDirectSoundEmuration', kind: 'int', def: 1 },
  { key: 'sound:DirectSoundCooperativeLevel', kind: 'int', def: 1 },
  { key: 'debug:DebugOutLabel', kind: 'int', def: 1 },
  { key: 'debug:DebugOutVar', kind: 'int', def: 1 },
  { key: 'debug:DebugRemote', kind: 'int', def: 1 },
  { key: 'debug:DebugEnableOnDeactive', kind: 'int', def: 0 },
  { key: 'system:Path', kind: 'string', def: '' },
  { key: 'system:SaveBMPPath', kind: 'string', def: '' },
  { key: 'debug:FunclstPath', kind: 'string', def: '' },
  { key: 'debug:DebugComputerName', kind: 'string', def: '' },
  { key: 'message:Font', kind: 'string', def: '' },
  { key: 'message:RMouseEvent', kind: 'int', def: 0 },
  { key: 'message:MessageSpeed', kind: 'int', def: 5 },
  { key: 'message:MessageFade', kind: 'int', def: 0 },
  { key: 'message:MesWinAlpha', kind: 'int', def: 8 },
  { key: 'display:ScreenMode', kind: 'int', def: 0 },
  { key: 'display:FullScreenBit', kind: 'int', def: 16 },
  { key: 'display:UseIVideoWindow', kind: 'int', def: 1 },
  { key: 'display:DeviceType', kind: 'int', def: 0 },
  { key: 'display:VertexProcessing', kind: 'int', def: 0 },
  { key: 'display:PresentInterval', kind: 'int', def: 0 },
  { key: 'display:TextureBit', kind: 'int', def: 32 },
  { key: 'display:PixelShader', kind: 'int', def: -1 },
  { key: 'display:ForceScreen', kind: 'int', def: 0 },
  { key: 'display:VirtualFullScreen', kind: 'int', def: 0 },
  { key: 'display:AspectMode', kind: 'int', def: 0 },
  { key: 'display:FullScreenWidth', kind: 'int', def: 0 },
  { key: 'display:FullScreenHeight', kind: 'int', def: 0 },
  { key: 'display:LimitAero', kind: 'int', def: 0 },
  { key: 'display:VirtualFullScreenType', kind: 'int', def: 0 },
  { key: 'display:MultiSample', kind: 'int', def: 0 },
  { key: 'system:OutErrorLog', kind: 'int', def: 0 },
  { key: 'message:UseAntiFont', kind: 'int', def: 1 },
  { key: 'system:UseMMX', kind: 'int', def: 1 },
  { key: 'system:LimitJoy', kind: 'int', def: 0 },
  { key: 'system:LimitTouch', kind: 'int', def: 0 },
  { key: 'message:AutoMessageTime0', kind: 'int', def: 500 },
  { key: 'message:AutoMessageTime1', kind: 'int', def: 2000 },
  { key: 'message:AutoMessagePitch0', kind: 'int', def: 0 },
  { key: 'message:AutoMessagePitch1', kind: 'int', def: 0 },
  { key: 'message:AutoMessageOption', kind: 'int', def: 0 },
  { key: 'set:ClickOnUp', kind: 'int', def: 0 },
  { key: 'set:AlwaysBackupSurface', kind: 'int', def: 0 },
  { key: 'message:ReadTextSkip', kind: 'int', def: 0 },
  { key: 'set:CancelMesSkipOnClick', kind: 'int', def: 0 },
  { key: 'set:ControlDisibleCursor', kind: 'int', def: 0 },
  { key: 'set:CoexistMesSkip', kind: 'int', def: 0 },
  { key: 'set:ReDrawTextOnKey', kind: 'int', def: 1 },
  { key: 'set:AutoLineFeed', kind: 'int', def: 1 },
  { key: 'set:NoChangeClipOnBackup', kind: 'int', def: 0 },
  { key: 'set:UseAppDataFolder', kind: 'int', def: 0 },
  { key: 'set:SavePath', kind: 'string', def: '' },
  { key: 'set:RegFilePath', kind: 'string', def: '' },
  { key: 'system:EffectSkipOnClick', kind: 'int', def: 0 },
  { key: 'sound:MusicFadeOnVoicePlaying', kind: 'int', def: 1 },
  { key: 'sound:MusicFadeOnVoicePlayingVolume', kind: 'int', def: 50 },
  { key: 'set:KeepMusicVolume', kind: 'int', def: 0 },
  { key: 'set:TransferMusicVolume', kind: 'int', def: 0 },
  { key: 'set:RegRootPath', kind: 'string', def: '' },
  { key: 'set:RegSubKey', kind: 'string', def: '' },
  { key: 'set:Copyright', kind: 'string', def: '' },
  { key: 'set:GameVersion', kind: 'string', def: '' },
  { key: 'set:ScreenWarning', kind: 'int', def: -1 },
  { key: 'set:BitWarning', kind: 'int', def: -1 },
  { key: 'set:NoSetMusic', kind: 'int', def: 0 },
  { key: 'set:NoSaveDat', kind: 'int', def: 0 },
  { key: 'set:CheckVolume', kind: 'string', def: '' },
  { key: 'set:CheckFileName', kind: 'string', def: '' },
  { key: 'set:CDLabel', kind: 'string', def: '' },
  { key: 'set:VerRegPos', kind: 'string', def: '' },
  { key: 'set:Menu_Save', kind: 'int', def: 1 },
  { key: 'set:Menu_MesWinA', kind: 'int', def: 1 },
  { key: 'set:Menu_RClick', kind: 'int', def: 1 },
  { key: 'set:Menu_MesSpeed', kind: 'int', def: 1 },
  { key: 'set:Menu_Message', kind: 'int', def: 0 },
  { key: 'set:Menu_UseAntiFont', kind: 'int', def: 0 },
  { key: 'set:Menu_SoundONOFF', kind: 'int', def: 1 },
  { key: 'set:EnableAntiFont', kind: 'int', def: 0 },
  { key: 'set:EnableMemFlip', kind: 'int', def: 1 },
  { key: 'set:SaveVersion1', kind: 'int', def: 1 },
  { key: 'set:SaveVersion2', kind: 'int', def: 0 },
  { key: 'set:RCVersion', kind: 'int', def: 0 },
  { key: 'set:RegKey', kind: 'int', def: 0 },
  { key: 'set:WinX', kind: 'int', def: 640 },
  { key: 'set:WinY', kind: 'int', def: 480 },
  { key: 'set:AntiFontVersion', kind: 'int', def: 1 },
  { key: 'set:DisableHook', kind: 'int', def: 0 },
  { key: 'set:TexWidth', kind: 'int', def: 2048 },
  { key: 'set:TexHeight', kind: 'int', def: 2048 },
  { key: 'set:CreateObject', kind: 'int', def: 1 },
  { key: 'set:DrawMode', kind: 'int', def: 0 },
  { key: 'set:DependMovieSound', kind: 'int', def: 1 },
  { key: 'set:WheelKeyUp', kind: 'int', def: 3 },
  { key: 'set:WheelKeyDown', kind: 'int', def: 1 },
  { key: 'set:HWheelKeyUp', kind: 'int', def: -1 },
  { key: 'set:HWheelKeyDown', kind: 'int', def: -1 },
  { key: 'set:AutoFreeTex', kind: 'int', def: 0 },
  { key: 'set:BlankExtentMode', kind: 'int', def: 0 },
  { key: 'message:AdvanceMesOnWheel', kind: 'int', def: 0 },
  { key: 'set:OuterFrameMode', kind: 'int', def: 1 },
  { key: 'set:UseProportionalFont', kind: 'int', def: 0 },
  { key: 'message:AntiFontLevel', kind: 'int', def: 0 },
  { key: 'message:RubyShiftMode', kind: 'int', def: 0 },
  { key: 'set:SaveWinPos', kind: 'int', def: 0 },
  { key: 'set:WinPosLeft', kind: 'int', def: 0 },
  { key: 'set:WinPosTop', kind: 'int', def: 0 },
];

/** 键名（小写）→ 内建默认值。 */
export const CONFIG_REGISTRY_DEFAULTS: ReadonlyMap<string, number | string> = new Map(
  CONFIG_REGISTRY_KEYS.map((k) => [k.key.toLowerCase(), k.def]),
);
