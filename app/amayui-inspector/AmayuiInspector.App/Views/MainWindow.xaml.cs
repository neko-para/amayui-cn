using System.Windows;
using AmayuiInspector.App.ViewModels;

namespace AmayuiInspector.App.Views;

public partial class MainWindow : Window
{
    public MainWindow()
    {
        InitializeComponent();
        DataContext = new MainViewModel();
    }
}
