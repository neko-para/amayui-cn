namespace AmayuiInspector.App.ViewModels;

/// <summary>全局 int 槽的一行（索引 hex / 解码值 / 是否在掉落区）。</summary>
public sealed class GlobalSlotRow
{
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
}
