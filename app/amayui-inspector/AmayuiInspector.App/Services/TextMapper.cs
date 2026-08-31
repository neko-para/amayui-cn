using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Text;
using System.Text.Json;

namespace AmayuiInspector.App.Services;

/// <summary>
/// 全局字符串展示解码：把运行时经 CP932 解码出的「日文写法占位」文本还原为真实简体。
/// 数据源为嵌入资源 <c>Resources/subs_cn_jp.json</c>（{简体: 日文写法}，构建时嵌入、预期少变更），
/// 这里取反查（日文写法 → 简体）。构建时嵌入，运行时无需依赖外部文件。
/// </summary>
public sealed class TextMapper
{
    private readonly IReadOnlyDictionary<char, char> _zhFromJp;

    public bool Loaded { get; }

    private TextMapper(IReadOnlyDictionary<char, char> map)
    {
        _zhFromJp = map;
        Loaded = map.Count > 0;
    }

    public static TextMapper LoadFromEmbedded()
    {
        const string resource = "AmayuiInspector.App.Resources.subs_cn_jp.json";
        try
        {
            using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(resource);
            if (stream == null) return new TextMapper(new Dictionary<char, char>());

            using var doc = JsonDocument.Parse(stream);
            var reverse = new Dictionary<char, char>();
            foreach (var p in doc.RootElement.EnumerateObject())
            {
                string zh = p.Name;                       // 简体
                string jp = p.Value.GetString() ?? "";    // 日文写法（代码点占位）
                if (zh.Length == 1 && jp.Length == 1)
                    reverse[jp[0]] = zh[0];               // 反查：占位码位 → 简体
            }
            return new TextMapper(reverse);
        }
        catch
        {
            return new TextMapper(new Dictionary<char, char>());
        }
    }

    /// <summary>把占位码位还原为简体；不在字典里的字符原样保留。</summary>
    public string MapText(string? s)
    {
        if (string.IsNullOrEmpty(s) || _zhFromJp.Count == 0) return s ?? "";
        var sb = new StringBuilder(s.Length);
        foreach (char c in s)
            sb.Append(_zhFromJp.TryGetValue(c, out char zh) ? zh : c);
        return sb.ToString();
    }

    /// <summary>还原为简体后再截取前 <paramref name="max"/> 个字符（用于表格展示）。</summary>
    public string MapAndTruncate(string? s, int max)
    {
        var t = MapText(s);
        return t.Length <= max ? t : t[..max];
    }
}
