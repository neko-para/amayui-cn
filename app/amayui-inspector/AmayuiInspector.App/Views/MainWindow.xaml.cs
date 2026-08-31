using System.Runtime.InteropServices;
using System.Windows;
using AmayuiInspector.App.ViewModels;

namespace AmayuiInspector.App.Views;

public partial class MainWindow : Window
{
    // 目标为「物理像素」尺寸；WPF 的 Width/Height 是 DIP（逻辑像素），
    // 物理 = DIP × (DPI/96)，故按当前系统 DPI 反推 DIP，使窗口打开即为 2000×1200 物理像素。
    private const double DesiredPhysWidth = 2000;
    private const double DesiredPhysHeight = 1200;
    private const double DesiredPhysMinWidth = 1200;
    private const double DesiredPhysMinHeight = 800;

    public MainWindow()
    {
        InitializeComponent();
        DataContext = new MainViewModel();

        double scale = SystemScale();
        Width = DesiredPhysWidth / scale;
        Height = DesiredPhysHeight / scale;
        MinWidth = DesiredPhysMinWidth / scale;
        MinHeight = DesiredPhysMinHeight / scale;
    }

    private static double SystemScale()
    {
        uint dpi;
        try { dpi = GetDpiForSystem(); }
        catch { dpi = 120; } // 取不到时按 125% 兜底
        return dpi > 0 ? dpi / 96.0 : 1.0;
    }

    [DllImport("user32.dll")]
    private static extern uint GetDpiForSystem();
}
