param([int]$Port = 8000)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.js'   = 'application/javascript; charset=utf-8'
  '.tsx'  = 'application/javascript; charset=utf-8'
  '.ts'   = 'application/javascript; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.webmanifest' = 'application/manifest+json; charset=utf-8'
  '.svg'  = 'image/svg+xml'
  '.png'  = 'image/png'
  '.ico'  = 'image/x-icon'
  '.txt'  = 'text/plain; charset=utf-8'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://+:$Port/")
try { $listener.Start() } catch {
  Write-Host "Failed to bind port $Port. Try running this terminal as Administrator, or change the port." -ForegroundColor Red
  exit 1
}

Write-Host "Serving $root on port $Port. Press Ctrl+C to stop."

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $res = $ctx.Response
    try {
      $rel = [System.Uri]::UnescapeDataString($req.Url.AbsolutePath.TrimStart('/'))
      if ($rel -eq '') { $rel = 'index.html' }
      $path = Join-Path $root $rel
      $full = [System.IO.Path]::GetFullPath($path)
      if (-not $full.StartsWith([System.IO.Path]::GetFullPath($root))) {
        $res.StatusCode = 403
      } elseif (Test-Path $full -PathType Leaf) {
        $ext = [System.IO.Path]::GetExtension($full).ToLower()
        $res.ContentType = $mime[$ext]
        if (-not $res.ContentType) { $res.ContentType = 'application/octet-stream' }
        $bytes = [System.IO.File]::ReadAllBytes($full)
        $res.ContentLength64 = $bytes.Length
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
      } else {
        $res.StatusCode = 404
      }
    } catch {
      $res.StatusCode = 500
    } finally {
      $res.Close()
    }
  }
} finally {
  $listener.Stop()
}
