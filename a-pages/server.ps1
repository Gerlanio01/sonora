# Servidor local do Sonora — sem dependencias (PowerShell + .NET)
# Uso: powershell -NoProfile -ExecutionPolicy Bypass -File server.ps1 [-Porta 8777] [-SemNavegador]
param(
    [int]$Porta = 8777,
    [switch]$SemNavegador
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

$mime = @{
    '.html'       = 'text/html; charset=utf-8'
    '.htm'        = 'text/html; charset=utf-8'
    '.css'        = 'text/css; charset=utf-8'
    '.js'         = 'text/javascript; charset=utf-8'
    '.mjs'        = 'text/javascript; charset=utf-8'
    '.json'       = 'application/json; charset=utf-8'
    '.webmanifest'= 'application/manifest+json; charset=utf-8'
    '.svg'        = 'image/svg+xml'
    '.png'        = 'image/png'
    '.jpg'        = 'image/jpeg'
    '.jpeg'       = 'image/jpeg'
    '.ico'        = 'image/x-icon'
    '.woff2'      = 'font/woff2'
    '.mp3'        = 'audio/mpeg'
}

# Script que atende cada conexao (roda em sua propria thread)
$handler = {
    param($client, $rootPath, $mimeMap)
    $stream = $null
    try {
        $client.ReceiveTimeout = 8000
        $stream = $client.GetStream()
        $reader = New-Object System.IO.StreamReader($stream)
        $requestLine = $reader.ReadLine()
        if (-not $requestLine) { $client.Close(); return }

        # consome os headers
        while ($true) {
            $line = $reader.ReadLine()
            if ($null -eq $line -or $line -eq '') { break }
        }

        $parts = $requestLine.Split(' ')
        if ($parts.Count -lt 2) { $client.Close(); return }
        $method = $parts[0].ToUpperInvariant()
        $rawPath = $parts[1]

        if ($method -ne 'GET' -and $method -ne 'HEAD') {
            $body = [Text.Encoding]::UTF8.GetBytes('Metodo nao suportado')
            $head = "HTTP/1.1 405 Method Not Allowed`r`nContent-Type: text/plain; charset=utf-8`r`nContent-Length: $($body.Length)`r`nConnection: close`r`n`r`n"
            $hb = [Text.Encoding]::ASCII.GetBytes($head)
            $stream.Write($hb, 0, $hb.Length)
            $stream.Write($body, 0, $body.Length)
            $stream.Flush()
            $client.Close()
            return
        }

        $pathOnly = $rawPath.Split('?')[0]
        $decoded = [System.Uri]::UnescapeDataString($pathOnly)
        if ([string]::IsNullOrWhiteSpace($decoded) -or $decoded -eq '/') { $decoded = '/index.html' }

        $relative = $decoded.TrimStart('/').Replace('/', [IO.Path]::DirectorySeparatorChar)
        $rootFull = [IO.Path]::GetFullPath($rootPath)
        $full = [IO.Path]::GetFullPath((Join-Path $rootFull $relative))

        $send = {
            param($status, $statusText, $type, $payload, $headOnly)
            $h = "HTTP/1.1 $status $statusText`r`nContent-Type: $type`r`nContent-Length: $($payload.Length)`r`nCache-Control: no-cache`r`nX-Content-Type-Options: nosniff`r`nConnection: close`r`n`r`n"
            $hb = [Text.Encoding]::ASCII.GetBytes($h)
            $stream.Write($hb, 0, $hb.Length)
            if (-not $headOnly) { $stream.Write($payload, 0, $payload.Length) }
            $stream.Flush()
        }

        if ($relative.Contains('..') -or -not $full.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase)) {
            & $send 403 'Forbidden' 'text/plain; charset=utf-8' ([Text.Encoding]::UTF8.GetBytes('Acesso negado')) ($method -eq 'HEAD')
            $client.Close(); return
        }

        if (Test-Path $full -PathType Container) { $full = Join-Path $full 'index.html' }

        if (-not (Test-Path $full -PathType Leaf)) {
            # rotas SPA (ex.: #/search) caem aqui apenas se o caminho nao existir
            $index = Join-Path $rootFull 'index.html'
            if (Test-Path $index) {
                $payload = [IO.File]::ReadAllBytes($index)
                & $send 200 'OK' 'text/html; charset=utf-8' $payload ($method -eq 'HEAD')
            } else {
                & $send 404 'Not Found' 'text/plain; charset=utf-8' ([Text.Encoding]::UTF8.GetBytes('Nao encontrado')) ($method -eq 'HEAD')
            }
            $client.Close(); return
        }

        $ext = [IO.Path]::GetExtension($full).ToLowerInvariant()
        $type = $mimeMap[$ext]
        if (-not $type) { $type = 'application/octet-stream' }

        $payload = [IO.File]::ReadAllBytes($full)
        & $send 200 'OK' $type $payload ($method -eq 'HEAD')
        $client.Close()
    }
    catch {
        try { if ($stream) { $stream.Close() } } catch { }
        try { $client.Close() } catch { }
    }
}

$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Porta)
$listener.Start()

$url = "http://localhost:$Porta/"
Write-Host ''
Write-Host '  ==============================  ' -ForegroundColor Magenta
Write-Host '   SONORA - servidor local' -ForegroundColor White
Write-Host "   $url" -ForegroundColor Cyan
Write-Host "   pasta: $root" -ForegroundColor DarkGray
Write-Host '   Ctrl+C para parar' -ForegroundColor DarkGray
Write-Host '  ==============================' -ForegroundColor Magenta
Write-Host ''

if (-not $SemNavegador) {
    Start-Sleep -Milliseconds 600
    Start-Process $url
}

$active = New-Object System.Collections.ArrayList

try {
    while ($true) {
        $client = $listener.AcceptTcpClient()
        try {
            $ps = [powershell]::Create()
            [void]$ps.AddScript($handler.ToString()).AddArgument($client).AddArgument($root).AddArgument($mime)
            [void]$active.Add($ps)
            $null = $ps.BeginInvoke()   # executa em assincrono (thread do pool)

            # libera as conexoes ja encerradas
            if ($active.Count -gt 48) {
                $done = @($active | Where-Object { $_.InvocationStateInfo.State -in @('Completed', 'Failed', 'Stopped') })
                foreach ($item in $done) {
                    try { $item.Dispose() } catch { }
                    [void]$active.Remove($item)
                }
            }
        }
        catch {
            try { $client.Close() } catch { }
        }
    }
}
finally {
    $listener.Stop()
    Write-Host 'Servidor encerrado.' -ForegroundColor Yellow
}
