using AmayuiInspector.Core.Model;

namespace AmayuiInspector.App.ViewModels;

/// <summary>左侧 Engine 面板：this / 模块 / key / 全局数组基址 / 控制流寄存器。</summary>
public sealed class EnginePanelVm : ViewModelBase
{
    private string _this = "-";
    private string _module = "-";
    private string _key = "-";
    private string _intBase = "-";
    private string _floatBase = "-";
    private string _strBase = "-";
    private string _ptrBase = "-";
    private string _fptrBase = "-";
    private string _cur = "-";
    private string _ret = "-";
    private string _link = "-";
    private string _flag = "-";

    public string This      { get => _this;      set => SetProperty(ref _this, value); }
    public string Module    { get => _module;    set => SetProperty(ref _module, value); }
    public string Key       { get => _key;       set => SetProperty(ref _key, value); }
    public string IntBase   { get => _intBase;   set => SetProperty(ref _intBase, value); }
    public string FloatBase { get => _floatBase; set => SetProperty(ref _floatBase, value); }
    public string StrBase   { get => _strBase;   set => SetProperty(ref _strBase, value); }
    public string PtrBase   { get => _ptrBase;   set => SetProperty(ref _ptrBase, value); }
    public string FptrBase  { get => _fptrBase;  set => SetProperty(ref _fptrBase, value); }
    public string Cur       { get => _cur;       set => SetProperty(ref _cur, value); }
    public string Ret       { get => _ret;       set => SetProperty(ref _ret, value); }
    public string Link      { get => _link;      set => SetProperty(ref _link, value); }
    public string Flag      { get => _flag;      set => SetProperty(ref _flag, value); }

    public void Update(EngineSnapshot s)
    {
        This = Fmt.Hex(s.This);
        Module = Fmt.Hex(s.ModuleBase);
        Key = Fmt.Hex(s.Key);
        IntBase = Fmt.Hex(s.GlobalIntBase);
        FloatBase = Fmt.Hex(s.GlobalFloatBase);
        StrBase = Fmt.Hex(s.GlobalStringBase);
        PtrBase = Fmt.Hex(s.GlobalPtrBase);
        FptrBase = Fmt.Hex(s.GlobalFloatPtrBase);
        Cur = Fmt.Sent(s.CurScript);
        Ret = Fmt.Sent(s.CallRet);
        Link = Fmt.Sent(s.CallLink);
        Flag = Fmt.Sent(s.CallFlag);
    }
}
