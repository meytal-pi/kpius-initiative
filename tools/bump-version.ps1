# Bumps the app version everywhere (version.json, app.js, index.html ?v= cache-busters).
# Devices notice the new version.json and reload themselves.
$root = Split-Path $PSScriptRoot -Parent
$utf8 = New-Object Text.UTF8Encoding $false
$vfile = Join-Path $root 'version.json'
$v = ([IO.File]::ReadAllText($vfile) | ConvertFrom-Json).version + 1
[IO.File]::WriteAllText($vfile, "{ ""version"": $v }`n", $utf8)
$app = Join-Path $root 'app.js'
[IO.File]::WriteAllText($app, ([IO.File]::ReadAllText($app) -replace 'const APP_VERSION = \d+;', "const APP_VERSION = $v;"), $utf8)
$idx = Join-Path $root 'index.html'
[IO.File]::WriteAllText($idx, ([IO.File]::ReadAllText($idx) -replace '\?v=\d+', "?v=$v"), $utf8)
"Version is now $v"
