namespace AmayuiInspector.App;

/// <summary>数值/地址格式化辅助。</summary>
public static class Fmt
{
    /// <summary>显示为 0xHEX。</summary>
    public static string Hex(uint v) => "0x" + v.ToString("X");

    /// <summary>帧下标/哨兵：&gt;= 0x8000_0000 视为负哨兵（-1/-10/-11）按有符号十进制显示，否则十进制。</summary>
    public static string Sent(uint v) => v >= 0x80000000u ? ((int)v).ToString() : v.ToString();

    /// <summary>地址：0 显示为 0，否则 0xHEX。</summary>
    public static string HexOrZero(uint v) => v == 0 ? "0" : ("0x" + v.ToString("X"));
}
