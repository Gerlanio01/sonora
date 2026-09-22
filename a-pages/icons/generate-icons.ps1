# Gera os icones PNG do app Sonora (sem dependencias externas).
# Uso: powershell -NoProfile -ExecutionPolicy Bypass -File generate-icons.ps1
Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'
$out = Split-Path -Parent $MyInvocation.MyCommand.Path

function Get-Rgb([string]$hex) {
    $hex = $hex.TrimStart('#')
    $r = [Convert]::ToInt32($hex.Substring(0, 2), 16)
    $g = [Convert]::ToInt32($hex.Substring(2, 2), 16)
    $b = [Convert]::ToInt32($hex.Substring(4, 2), 16)
    return [System.Drawing.Color]::FromArgb(255, $r, $g, $b)
}

function New-AppIcon([int]$size, [string]$fileName, [bool]$maskable) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

    $c1 = Get-Rgb '#7c3aed'
    $c2 = Get-Rgb '#ec4899'
    $rect = New-Object System.Drawing.Rectangle 0, 0, $size, $size
    $angle = [float]50
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, $c1, $c2, $angle

    if ($maskable) {
        $g.FillRectangle($brush, $rect)
    }
    else {
        $path = New-Object System.Drawing.Drawing2D.GraphicsPath
        $r = [int]($size * 0.225)
        $w = $size - 1
        $h = $size - 1
        $path.AddArc(0, 0, 2 * $r, 2 * $r, 180, 90)
        $path.AddArc($w - 2 * $r, 0, 2 * $r, 2 * $r, 270, 90)
        $path.AddArc($w - 2 * $r, $h - 2 * $r, 2 * $r, 2 * $r, 0, 90)
        $path.AddArc(0, $h - 2 * $r, 2 * $r, 2 * $r, 90, 90)
        $path.CloseFigure()
        $g.FillPath($brush, $path)
        $path.Dispose()
    }
    $brush.Dispose()

    # Equalizador: 5 barras arredondadas
    $spread = $size * 0.54
    $cx = $size / 2
    $cy = $size / 2
    $maxH = $size * 0.44
    $fractions = @(0.46, 0.74, 1.0, 0.60, 0.86)
    $penW = [float]($size * 0.078)
    $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(240, 255, 255, 255)), $penW
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    for ($i = 0; $i -lt 5; $i++) {
        $x = [float]($cx - ($spread / 2) + ($spread / 4) * $i)
        $half = [float](($maxH * $fractions[$i]) / 2)
        $g.DrawLine($pen, $x, [float]($cy - $half), $x, [float]($cy + $half))
    }
    $pen.Dispose()

    $g.Dispose()
    $path2 = Join-Path $out $fileName
    $bmp.Save($path2, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Output "ok: $fileName ($size px)"
}

New-AppIcon 192 'icon-192.png' $false
New-AppIcon 512 'icon-512.png' $false
New-AppIcon 512 'icon-maskable-512.png' $true
New-AppIcon 96 'icon-96.png' $false
