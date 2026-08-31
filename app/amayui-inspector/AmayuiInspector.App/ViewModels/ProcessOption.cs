namespace AmayuiInspector.App.ViewModels;

/// <summary>进程下拉项。</summary>
public sealed record ProcessOption(int ProcessId, string Name)
{
    public override string ToString() => $"{Name}  (PID {ProcessId})";
}
