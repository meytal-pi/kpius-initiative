Add-Type -AssemblyName System.Drawing
foreach ($size in 192, 512) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.TextRenderingHint = 'AntiAliasGridFit'
  $g.Clear([System.Drawing.Color]::FromArgb(18, 20, 26))
  $s = $size / 512.0
  $gold = [System.Drawing.Color]::FromArgb(227, 180, 72)
  $pen = New-Object System.Drawing.Pen $gold, ([float](28 * $s))
  $pen.LineJoin = 'Round'
  $pts = @(@(256,56), @(429,156), @(429,356), @(256,456), @(83,356), @(83,156)) | ForEach-Object { New-Object System.Drawing.PointF ([float]($_[0] * $s)), ([float]($_[1] * $s)) }
  $g.DrawPolygon($pen, [System.Drawing.PointF[]]$pts)
  $font = New-Object System.Drawing.Font 'Segoe UI', ([float](140 * $s)), ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
  $fmt = New-Object System.Drawing.StringFormat
  $fmt.Alignment = 'Center'; $fmt.LineAlignment = 'Center'
  $brush = New-Object System.Drawing.SolidBrush $gold
  $g.DrawString('20', $font, $brush, (New-Object System.Drawing.RectangleF 0, 0, $size, $size), $fmt)
  $bmp.Save((Join-Path $PSScriptRoot "..\icon-$size.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}
