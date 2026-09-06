Add-Type -AssemblyName System.Drawing

function Draw-LegacyIcon([int]$size, [string]$path) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::FromArgb(255, 59, 130, 246))

  $blue = [System.Drawing.Color]::FromArgb(255, 59, 130, 246)
  $white = [System.Drawing.Color]::FromArgb(255, 255, 255, 255)
  $light = [System.Drawing.Color]::FromArgb(255, 191, 219, 254)

  function U([float]$v) { return [float]($v * $size / 108.0) }

  # 白色日历卡片
  $g.FillRectangle((New-Object System.Drawing.SolidBrush($white)), (U 26), (U 32), (U 56), (U 52))

  # 两个挂环
  $g.FillEllipse((New-Object System.Drawing.SolidBrush($white)), (U 36), (U 22), (U 12), (U 12))
  $g.FillEllipse((New-Object System.Drawing.SolidBrush($white)), (U 60), (U 22), (U 12), (U 12))
  $g.FillEllipse((New-Object System.Drawing.SolidBrush($blue)), (U 39), (U 25), (U 6), (U 6))
  $g.FillEllipse((New-Object System.Drawing.SolidBrush($blue)), (U 63), (U 25), (U 6), (U 6))

  # 网格线（蓝色镂空）
  $g.FillRectangle((New-Object System.Drawing.SolidBrush($light)), (U 28), (U 48), (U 52), (U 6))
  $g.FillRectangle((New-Object System.Drawing.SolidBrush($light)), (U 28), (U 60), (U 52), (U 6))
  $g.FillRectangle((New-Object System.Drawing.SolidBrush($light)), (U 28), (U 72), (U 52), (U 6))

  $g.Dispose()
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}

$root = Join-Path $PSScriptRoot ".."
$sizes = @{
  "mdpi" = 48; "hdpi" = 72; "xhdpi" = 96; "xxhdpi" = 144; "xxxhdpi" = 192
}
foreach ($entry in $sizes.GetEnumerator()) {
  $dir = Join-Path $root "android\app\src\main\res\mipmap-$($entry.Key)"
  Draw-LegacyIcon $entry.Value (Join-Path $dir "ic_launcher.png")
  Draw-LegacyIcon $entry.Value (Join-Path $dir "ic_launcher_round.png")
}
Write-Output "ANDROID_ICONS_DONE"
