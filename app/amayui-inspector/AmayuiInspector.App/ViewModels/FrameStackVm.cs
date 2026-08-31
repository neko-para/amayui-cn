using AmayuiInspector.Core.Engine;
using AmayuiInspector.Core.Model;

namespace AmayuiInspector.App.ViewModels;

/// <summary>单帧字段行。</summary>
public sealed class FrameRow
{
    public FrameRow(int index, FrameSnapshot? f, bool active, string? scriptName)
    {
        Index = index;
        Active = active;
        if (f == null)
        {
            StrTable = Ip = LocalInt = LocalString = LocalPtr = ArrayContainer = "0";
            Caller = FrameArg = "-";
            Arity = "0";
            Script = "-";
        }
        else
        {
            StrTable = Fmt.HexOrZero(f.StrTable);
            Ip = Fmt.HexOrZero(f.Ip);
            LocalInt = Fmt.HexOrZero(f.LocalInt);
            LocalString = Fmt.HexOrZero(f.LocalString);
            LocalPtr = Fmt.HexOrZero(f.LocalPtr);
            ArrayContainer = Fmt.HexOrZero(f.ArrayContainer);
            Caller = Fmt.Sent(f.Caller);
            FrameArg = f.FrameArg >= 0x80000000u ? ((int)f.FrameArg).ToString() : f.FrameArg.ToString();
            Arity = f.Arity.ToString();
            Script = string.IsNullOrEmpty(scriptName) ? "-" : scriptName;
        }
        Header = (active ? "▶ " : "") + "#" + index;
    }

    public int Index { get; }
    public bool Active { get; }
    public string Header { get; }
    public string StrTable { get; }
    public string Ip { get; }
    public string LocalInt { get; }
    public string LocalString { get; }
    public string LocalPtr { get; }
    public string Caller { get; }
    public string FrameArg { get; }
    public string Arity { get; }
    public string ArrayContainer { get; }
    public string Script { get; }
}

/// <summary>脚本帧/调用栈 VM：40 帧字段 + 每帧 frame_arg 的脚本文件名解析。</summary>
public sealed class FrameStackVm : ViewModelBase
{
    private static readonly Lazy<ScriptIndex> _index = new(() => ScriptIndex.Load());

    private string _header = "未读取";
    private string _activeFrame = "-";
    private string _activeRender = "空闲";

    public FrameStackVm()
    {
        for (int i = 0; i < EngineOffsets.FrameCount; i++) Rows.Add(new FrameRow(i, null, false, null));
    }

    public System.Collections.ObjectModel.ObservableCollection<FrameRow> Rows { get; } = new();

    public string HeaderText { get => _header; set => SetProperty(ref _header, value); }
    public string ActiveFrame { get => _activeFrame; set => SetProperty(ref _activeFrame, value); }
    public string ActiveRender { get => _activeRender; set => SetProperty(ref _activeRender, value); }

    public void Update(EngineSnapshot s)
    {
        ActiveFrame = Fmt.Sent(s.CurScript);
        var index = _index.Value;

        Rows.Clear();
        for (int i = 0; i < EngineOffsets.FrameCount; i++)
        {
            bool active = (uint)i == s.CurScript;
            Rows.Add(new FrameRow(i, s.Frames[i], active, ResolveScript(index, s.Frames[i]?.FrameArg)));
        }

        var cur = s.CurScript < EngineOffsets.FrameCount ? s.Frames[(int)s.CurScript] : null;
        ActiveRender = cur == null
            ? $"空闲（cur={Fmt.Sent(s.CurScript)}）"
            : $"str=0x{cur.StrTable:X} ip=0x{cur.Ip:X} caller={Fmt.Sent(cur.Caller)} arg={Fmt.Sent(cur.FrameArg)} arity={cur.Arity} · {ResolveScript(index, cur.FrameArg) ?? "脚本?"}";
        HeaderText = $"40 帧 · cur_script={Fmt.Sent(s.CurScript)}" +
                     (index.Loaded ? $" · 脚本索引 {index.Count:N0} 项" : " · （未载入脚本索引）");
    }

    private static string? ResolveScript(ScriptIndex index, uint? frameArg)
    {
        if (frameArg is not uint arg) return null;
        if (arg == uint.MaxValue || arg == 0) return null;                    // 空/未初始化帧
        if (arg >= 0x0100_0000u) return $"派发槽 0x{arg:X}";                    // APPEND/派发编码
        return index.Resolve(arg) ?? $"0x{arg:X}（未命中）";
    }
}
