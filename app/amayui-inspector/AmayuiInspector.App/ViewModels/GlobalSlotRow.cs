using System.ComponentModel;
using System.Runtime.CompilerServices;

namespace AmayuiInspector.App.ViewModels;

/// <summary>全局 int 槽的一行。index/value/isDrop 不可变；StringText 为当前页异步回填的字符串展示列。</summary>
public sealed class GlobalSlotRow : INotifyPropertyChanged
{
    private string _stringText = "";

    public GlobalSlotRow(uint index, uint value, bool isDrop)
    {
        Index = index;
        Value = value;
        IsDrop = isDrop;
    }

    public uint Index { get; }
    public uint Value { get; }
    public bool IsDrop { get; }

    public string IndexText => Fmt.Hex(Index);
    public string ValueText => Value.ToString();
    public string ZoneText => IsDrop ? "掉落区" : "";

    /// <summary>对应槽位的 global-string 展示（已还原简体，截断前 16 字符）；未提取成功为空。</summary>
    public string StringText { get => _stringText; set => Set(ref _stringText, value); }

    public event PropertyChangedEventHandler? PropertyChanged;

    private void Set(ref string field, string value, [CallerMemberName] string? name = null)
    {
        if (field == value) return;
        field = value;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
    }
}
