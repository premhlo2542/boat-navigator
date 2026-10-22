# Opens a URL in headless Edge, waits, then evaluates a JS expression through the DevTools protocol.
# Usage: powershell -File tools/cdp-eval.ps1 -Url http://127.0.0.1:8765/tools/smoke.html -Expr "document.getElementById('out').textContent" -WaitSec 10
param([string]$Url, [string]$Expr, [int]$WaitSec = 10, [int]$Port = 9333)
$edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
$ud = Join-Path $env:TEMP ('bn-cdp-' + [guid]::NewGuid().ToString('N'))
$p = Start-Process $edge -ArgumentList '--headless=new', '--disable-gpu', '--no-first-run', "--user-data-dir=$ud", "--remote-debugging-port=$Port", '--remote-allow-origins=*', '--window-size=390,800', $Url -PassThru
try {
  Start-Sleep -Seconds $WaitSec
  $tabs = (Invoke-WebRequest "http://127.0.0.1:$Port/json" -UseBasicParsing).Content | ConvertFrom-Json
  $tab = $tabs | Where-Object { $_.type -eq 'page' -and $_.url -like "$Url*" } | Select-Object -First 1
  $ws = New-Object System.Net.WebSockets.ClientWebSocket
  $ws.ConnectAsync([Uri]$tab.webSocketDebuggerUrl, [Threading.CancellationToken]::None).Wait()
  $msg = @{ id = 1; method = 'Runtime.evaluate'; params = @{ expression = $Expr; returnByValue = $true; awaitPromise = $true } } | ConvertTo-Json -Depth 5 -Compress
  $bytes = [Text.Encoding]::UTF8.GetBytes($msg)
  $ws.SendAsync([ArraySegment[byte]]$bytes, 'Text', $true, [Threading.CancellationToken]::None).Wait()
  $buf = New-Object byte[] 1048576
  $sb = New-Object Text.StringBuilder
  do {
    $r = $ws.ReceiveAsync([ArraySegment[byte]]$buf, [Threading.CancellationToken]::None).Result
    [void]$sb.Append([Text.Encoding]::UTF8.GetString($buf, 0, $r.Count))
  } until ($r.EndOfMessage)
  $res = $sb.ToString() | ConvertFrom-Json
  $res.result.result.value
} finally {
  Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
  Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -like "*$ud*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

