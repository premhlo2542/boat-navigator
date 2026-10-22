# Generates PNG app icons (navy tile + cyan navigation arrow). Run: powershell -File tools/make-icons.ps1
Add-Type -AssemblyName System.Drawing
$out = Join-Path (Split-Path $PSScriptRoot -Parent) 'icons'
New-Item -ItemType Directory -Force $out | Out-Null

function New-Icon($size, $file, $maskable) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $rect = New-Object System.Drawing.Rectangle 0, 0, $size, $size
  $grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, ([System.Drawing.Color]::FromArgb(255, 11, 42, 74)), ([System.Drawing.Color]::FromArgb(255, 4, 14, 28)), 90
  if ($maskable) { $g.FillRectangle($grad, $rect) }
  else {
    $r = [int]($size * 0.22); $d = $r * 2
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc(0, 0, $d, $d, 180, 90); $path.AddArc($size - $d, 0, $d, $d, 270, 90)
    $path.AddArc($size - $d, $size - $d, $d, $d, 0, 90); $path.AddArc(0, $size - $d, $d, $d, 90, 90); $path.CloseFigure()
    $g.FillPath($grad, $path)
  }
  $k = if ($maskable) { 0.30 } else { 0.38 }  # arrow half-size (maskable keeps the safe zone)
  $c = $size / 2; $h = $size * $k
  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(90, 34, 211, 238)), ([single]($size * 0.012))
  $g.DrawEllipse($pen, [single]($c - $h * 1.15), [single]($c - $h * 1.15), [single]($h * 2.3), [single]($h * 2.3))
  $pts = @(
    (New-Object System.Drawing.PointF $c, ($c - $h * 1.05)),
    (New-Object System.Drawing.PointF ($c + $h * 0.8), ($c + $h * 0.95)),
    (New-Object System.Drawing.PointF $c, ($c + $h * 0.5)),
    (New-Object System.Drawing.PointF ($c - $h * 0.8), ($c + $h * 0.95))
  )
  $g.FillPolygon((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 34, 211, 238))), $pts)
  $g.DrawPolygon((New-Object System.Drawing.Pen ([System.Drawing.Color]::White), ([single]($size * 0.018))), $pts)
  $bmp.Save((Join-Path $out $file), [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}
New-Icon 192 'icon-192.png' $false
New-Icon 512 'icon-512.png' $false
New-Icon 512 'icon-maskable-512.png' $true
New-Icon 180 'apple-touch-icon.png' $true
Write-Host 'icons written to' $out
