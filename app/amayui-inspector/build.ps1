# 构建 amayui-inspector（M1 核心读取 + CLI 冒烟）。目标框架 net10.0（SDK 10 离线可用）。
# 说明：dotnet CLI 需跳过首次运行 sentinel（本沙箱禁写用户主目录，详见 README.md）。
$ErrorActionPreference = 'Stop'
$env:DOTNET_SKIP_FIRST_TIME_EXPERIENCE = '1'
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
$env:DOTNET_NOLOGO = '1'

$root = $PSScriptRoot
Set-Location $root

Write-Host '== build Core + Cli =='
dotnet build "$root\AmayuiInspector.Cli\AmayuiInspector.Cli.csproj" -c Debug -v minimal
if ($LASTEXITCODE -ne 0) { throw "build failed: $LASTEXITCODE" }

Write-Host ''
Write-Host '== run M1 smoke self-check =='
& dotnet "$root\AmayuiInspector.Cli\bin\Debug\net10.0\AmayuiInspector.Cli.dll" --no-process --sig "$root\..\..\scripts\re\dispatch_signature.json"
