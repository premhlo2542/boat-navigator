# Loads the app in headless Edge with a fake GPS position, optionally runs JS steps, saves screenshots.
# Usage: powershell -File tools/cdp-shot.ps1 -Out shot.png [-Steps "js1;;js2"] [-Theme dark] [-Width 390 -Height 800]
param([string]$Url = 'http://127.0.0.1:8765/index.html', [string]$Out, [string]$Steps = '', [int]$Width = 390, [int]$Height = 800, [double]$Lat = 12.9236, [double]$Lng = 100.8825, [int]$Port = 9334, [int]$WaitSec = 6)
$edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
$ud = Join-Path $env:TEMP ('bn-shot-' + [guid]::NewGuid().ToString('N'))
$p = Start-Process $edge -ArgumentList '--headless=new', '--disable-gpu', '--no-first-run', "--user-data-dir=$ud", "--remote-debugging-port=$Port", '--remote-allow-origins=*', "--window-size=$Width,$Height", 'about:blank' -PassThru
$script:id = 0
function Send($ws, $method, $params = @{}) {
  $script:id++
  $msg = @{ id = $script:id; method = $method; params = $params } | ConvertTo-Json -Depth 8 -Compress
  $b = [Text.Encoding]::UTF8.GetBytes($msg)
  $ws.SendAsync([ArraySegment[byte]]$b, 'Text', $true, [Threading.CancellationToken]::None).Wait()
  $buf = New-Object byte[] 4194304
  while ($true) {
    $sb = New-Object Text.StringBuilder
    do { $r = $ws.ReceiveAsync([ArraySegment[byte]]$buf, [Threading.CancellationToken]::None).Result; [void]$sb.Append([Text.Encoding]::UTF8.GetString($buf, 0, $r.Count)) } until ($r.EndOfMessage)
    $o = $sb.ToString() | ConvertFrom-Json
    if ($o.id -eq $script:id) { return $o }
  }
}
try {
  Start-Sleep 3
  $tabs = (Invoke-WebRequest "http://127.0.0.1:$Port/json" -UseBasicParsing).Content | ConvertFrom-Json
  $tab = $tabs | Where-Object { $_.type -eq 'page' } | Select-Object -First 1
  $ws = New-Object System.Net.WebSockets.ClientWebSocket
  $ws.ConnectAsync([Uri]$tab.webSocketDebuggerUrl, [Threading.CancellationToken]::None).Wait()
  [void](Send $ws 'Browser.grantPermissions' @{ permissions = @('geolocation') ; origin = ([Uri]$Url).GetLeftPart('Authority') })
  [void](Send $ws 'Emulation.setGeolocationOverride' @{ latitude = $Lat; longitude = $Lng; accuracy = 8 })
  [void](Send $ws 'Emulation.setDeviceMetricsOverride' @{ width = $Width; height = $Height; deviceScaleFactor = 2; mobile = $true })
  [void](Send $ws 'Runtime.enable')
  [void](Send $ws 'Page.navigate' @{ url = $Url })
  Start-Sleep $WaitSec
  $n = 0
  foreach ($step in ($Steps -split ';;' | Where-Object { $_.Trim() })) {
    $r = Send $ws 'Runtime.evaluate' @{ expression = $step; returnByValue = $true; awaitPromise = $true }
    if ($r.result.exceptionDetails) { Write-Host 'STEP ERROR:' $r.result.exceptionDetails.exception.description }
    elseif ($r.result.result.value) { Write-Host 'STEP:' $r.result.result.value }
    Start-Sleep 1
  }
  $s = Send $ws 'Page.captureScreenshot' @{ format = 'png' }
  [IO.File]::WriteAllBytes($Out, [Convert]::FromBase64String($s.result.data))
  $errs = Send $ws 'Runtime.evaluate' @{ expression = "JSON.stringify(window.__errs||[])"; returnByValue = $true }
  Write-Host 'saved' $Out
} finally {
  Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
  Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -like "*$ud*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}
