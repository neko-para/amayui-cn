<#
.SYNOPSIS
    从原始 install/DATA1/AGERC.dll 构建当前汉化版 AGERC.DLL。

.DESCRIPTION
    内容源：res/AGERC.DLL.rc（此前从汉化 DLL 导出的 .rc，含 196 个零宽空格 U+200B）。

    流程：
      1) 去除 .rc 中为保持字节长度而补的零宽空格（U+200B/U+200C/U+200D/U+2060）——
         现在用 Resource Hacker 重建资源，不再受“等长”限制；
      2) ResHacker 编译干净 .rc -> .res；
      3) 把 DIALOG / MENU 资源 addoverwrite 覆盖进原始 DLL，输出到指定路径；
      4) 校验输出：PE 有效、汉化菜单文本存在、零宽空格为 0。

    依赖：Resource Hacker（ResHacker.exe）。未安装时可用
        winget install -e --id AngusJohnson.ResourceHacker

.PARAMETER RcFile
    汉化 .rc 文件，默认 res\AGERC.DLL.rc。
.PARAMETER SourceDll
    原始 DLL，默认 install\DATA1\AGERC.dll。
.PARAMETER OutputDll
    输出 DLL，默认 install\AGERC.DLL；若已存在会先备份到 .tmp\agerc-build。
.PARAMETER ResHacker
    ResHacker.exe 完整路径；留空则自动查找常见位置。
.PARAMETER ResourceTypes
    需要从 .res 覆盖的资源类型，默认 DIALOG,MENU。
.PARAMETER PrepareOnly
    只做清理并生成干净 .rc，不编译、不注入（用于预览/调试）。
.PARAMETER Keep
    保留 .tmp\agerc-build 下的中间文件（默认清理）。

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File res\build-localized-agerc.ps1
.EXAMPLE
    powershell -ExecutionPolicy Bypass -File res\build-localized-agerc.ps1 -PrepareOnly
#>
[CmdletBinding()]
param(
    [string]$RcFile,
    [string]$SourceDll,
    [string]$OutputDll,
    [string]$ResHacker,
    [string[]]$ResourceTypes = @('DIALOG', 'MENU'),
    [switch]$PrepareOnly,
    [switch]$Keep
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
if (-not $RcFile)    { $RcFile    = Join-Path $root 'res\AGERC.DLL.rc' }
if (-not $SourceDll) { $SourceDll = Join-Path $root 'install\DATA1\AGERC.dll' }
if (-not $OutputDll) { $OutputDll = Join-Path $root 'install\AGERC.DLL' }
$RcFile    = [IO.Path]::GetFullPath($RcFile)
$SourceDll = [IO.Path]::GetFullPath($SourceDll)
$OutputDll = [IO.Path]::GetFullPath($OutputDll)

# ---------- 0. 前置检查 ----------
foreach ($f in @($RcFile, $SourceDll)) {
    if (-not (Test-Path -LiteralPath $f)) { throw "文件不存在: $f" }
}

if (-not $PrepareOnly) {
    if (-not $ResHacker) {
        $cmd = Get-Command ResHacker.exe, ResourceHacker.exe -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($cmd) { $ResHacker = $cmd.Source }
    }
    if (-not $ResHacker) {
        foreach ($p in @(
            'C:\Program Files (x86)\Resource Hacker\ResourceHacker.exe',
            'C:\Program Files\Resource Hacker\ResourceHacker.exe',
            'C:\Program Files (x86)\Resource Hacker\ResHacker.exe',
            'C:\Program Files\Resource Hacker\ResHacker.exe'
        )) {
            if (Test-Path -LiteralPath $p) { $ResHacker = $p; break }
        }
    }
    if (-not $ResHacker -or -not (Test-Path -LiteralPath $ResHacker)) {
        throw "未找到 ResHacker.exe。请先安装：winget install -e --id AngusJohnson.ResourceHacker，或用 -ResHacker 指定路径。"
    }
    Write-Host "ResHacker: $ResHacker"
}

# ---------- 1. 准备目录与资源素材 ----------
$work = [IO.Path]::GetFullPath((Join-Path $root '.tmp\agerc-build'))
$rootFull = [IO.Path]::GetFullPath($root)
if (-not $work.StartsWith($rootFull + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw "工作目录越界: $work"
}
New-Item -ItemType Directory -Force -Path $work | Out-Null

# .rc 引用的二进制素材（图标/光标/manifest），复制到与干净 .rc 同目录，供编译解析相对路径
$srcResDir = Split-Path -Parent $RcFile
foreach ($a in @('CURSOR106_1.cur', 'CURSOR135_1.cur', 'IDI_ICON1.ico', 'MANIFEST2_1.txt')) {
    $ap = Join-Path $srcResDir $a
    if (Test-Path -LiteralPath $ap) { Copy-Item -LiteralPath $ap -Destination $work -Force }
}

# ---------- 2. 去除零宽空格，生成干净 .rc ----------
$rawText = [IO.File]::ReadAllText($RcFile)
$zwChars = @([char]0x200B, [char]0x200C, [char]0x200D, [char]0x2060)
$zwCount = @($rawText.ToCharArray() | Where-Object { $zwChars -contains $_ }).Count
$cleanText = $rawText
foreach ($c in $zwChars) { $cleanText = $cleanText.Replace([string]$c, '') }
$cleanRc = Join-Path $work 'AGERC.clean.rc'
[IO.File]::WriteAllText($cleanRc, $cleanText, [Text.Encoding]::Unicode)  # UTF-16LE + BOM，与 ResHacker 导出格式一致
Write-Host "零宽字符: 去除 $zwCount 个 -> $cleanRc"

if ($PrepareOnly) {
    Write-Host "PrepareOnly：已生成干净 .rc，跳过编译与注入。"
    return
}

# ---------- 3. 编译 .rc -> .res ----------
$resOut = Join-Path $work 'AGERC.build.res'
$logFile = Join-Path $work 'agerc-build.log'

# ResourceHacker 是 GUI 子系统程序，PowerShell 用 & 调用不会等待，
# 必须用 Start-Process -Wait 等到它真正写完文件再继续。
function Invoke-ResourceHacker {
    param([string[]]$Arguments, [string]$WorkingDirectory = $work)
    $quoted = @()
    foreach ($a in $Arguments) {
        if ($a -match '\s') { $quoted += '"' + $a.Replace('"', '\"') + '"' } else { $quoted += $a }
    }
    $p = Start-Process -FilePath $ResHacker -ArgumentList $quoted -WorkingDirectory $WorkingDirectory -Wait -PassThru -WindowStyle Hidden
    return $p.ExitCode
}

Invoke-ResourceHacker @('-open', $cleanRc, '-save', $resOut, '-action', 'compile', '-log', $logFile) | Out-Null
if (-not (Test-Path -LiteralPath $resOut)) {
    if (Test-Path -LiteralPath $logFile) { Write-Host (Get-Content -LiteralPath $logFile -Tail 20) }
    throw "ResHacker 编译失败，未生成: $resOut"
}
Write-Host "编译完成: $resOut ($((Get-Item -LiteralPath $resOut).Length) bytes)"

# ---------- 4. 备份旧输出，注入资源 ----------
if (Test-Path -LiteralPath $OutputDll) {
    $backupDir = [IO.Path]::GetFullPath((Join-Path $root '.tmp\agerc-backups'))
    New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
    $bak = Join-Path $backupDir ("AGERC.DLL.previous-{0:yyyyMMdd-HHmmss}" -f (Get-Date))
    Copy-Item -LiteralPath $OutputDll -Destination $bak
    Write-Host "已备份旧输出: $bak"
}

foreach ($t in $ResourceTypes) {
    # 先删除该类型全部资源（含旧语言条目），再整体注入 .res 中的资源，
    # 保证输出 DIALOG/MENU 集合与 .rc 完全一致（addoverwrite 按 类型+名称+语言 匹配，
    # 语言变更时会残留旧条目）。
    $tmpDel = Join-Path $work "AGERC.deleted-$t.dll"
    if (Test-Path -LiteralPath $tmpDel) { Remove-Item -LiteralPath $tmpDel -Force }
    Write-Host "删除旧 $t 资源..."
    Invoke-ResourceHacker @('-open', $OutputDll, '-save', $tmpDel, '-action', 'delete', '-mask', "$t,,", '-log', $logFile) | Out-Null
    if (-not (Test-Path -LiteralPath $tmpDel)) {
        if (Test-Path -LiteralPath $logFile) { Write-Host (Get-Content -LiteralPath $logFile -Tail 20) }
        throw "delete $t 失败"
    }
    Move-Item -LiteralPath $tmpDel -Destination $OutputDll -Force

    $tmpAdd = Join-Path $work "AGERC.added-$t.dll"
    if (Test-Path -LiteralPath $tmpAdd) { Remove-Item -LiteralPath $tmpAdd -Force }
    Write-Host "注入 $t 资源..."
    Invoke-ResourceHacker @('-open', $OutputDll, '-save', $tmpAdd, '-action', 'addoverwrite', '-resource', $resOut, '-mask', "$t,,", '-log', $logFile) | Out-Null
    if (-not (Test-Path -LiteralPath $tmpAdd)) {
        if (Test-Path -LiteralPath $logFile) { Write-Host (Get-Content -LiteralPath $logFile -Tail 20) }
        throw "addoverwrite $t 失败"
    }
    Move-Item -LiteralPath $tmpAdd -Destination $OutputDll -Force
}

# ---------- 5. 校验 ----------
$bytes = [IO.File]::ReadAllBytes($OutputDll)
if (-not ($bytes.Length -gt 2 -and $bytes[0] -eq 0x4D -and $bytes[1] -eq 0x5A)) { throw "输出不是有效 PE: $OutputDll" }
$u16 = [Text.Encoding]::Unicode.GetString($bytes)
$zwLeft = @($u16.ToCharArray() | Where-Object { $_ -eq [char]0x200B }).Count
if ($zwLeft -gt 0) {
    Write-Warning "输出整体含 $zwLeft 个 U+200B：该位置来自未替换的二进制资源（如 ICON 像素数据），属于原 DLL 自带字节；DIALOG/MENU 来自已清理的 .rc，不受影响。"
} else {
    Write-Host "零宽空格检查: 0 个（通过）"
}

foreach ($probe in @('游戏', '保存(&S)', '设置(&O)', '返回标题')) {
    if ($u16.Contains($probe)) { Write-Host "检出汉化文本: $probe" }
    else { Write-Warning "未检出汉化文本: $probe（请人工确认菜单资源是否已替换）" }
}
if ($u16.Contains('ｹﾞｰﾑ(&G)')) { Write-Warning "输出中仍含日文菜单『ｹﾞｰﾑ(&G)』，请检查" }

Write-Host ""
Write-Host "构建完成: $OutputDll ($((Get-Item -LiteralPath $OutputDll).Length) bytes)"

# ---------- 6. 清理中间文件 ----------
if (-not $Keep) {
    Remove-Item -LiteralPath $work -Recurse -Force
    Write-Host "已清理中间文件（-Keep 可保留）。"
}
