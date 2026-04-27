# EnderRealm Assistant API Test Script
# Run with: .\test-chat.ps1 "your message"

param(
    [string]$Url = "http://localhost:8787/api/chat",
    [string]$Message = "你好"
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "EnderRealm Assistant API Test" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "URL: $Url" -ForegroundColor Gray
Write-Host "Message: $Message" -ForegroundColor Yellow
Write-Host ""

$body = @{"message" = $Message} | ConvertTo-Json -Compress
$tempFile = "$env:TEMP\ender_response_$PID.txt"

try {
    # Save response to temp file
    $null = Invoke-WebRequest -Uri $Url -Method Post -ContentType "application/json" -Body $body -TimeoutSec 60 -OutFile $tempFile

    # Read and parse
    $content = Get-Content $tempFile -Raw -Encoding UTF8
    $fullResponse = ""

    $lines = $content -split "`n"
    foreach ($line in $lines) {
        $trimmed = $line.Trim()
        if (-not $trimmed.StartsWith("data:")) { continue }

        $jsonStr = $trimmed.Substring(5).Trim()
        if ($jsonStr -eq "[DONE]" -or $jsonStr -eq "") { continue }

        try {
            $json = $trimmed.Substring(6) | ConvertFrom-Json -ErrorAction Stop
            if ($json.choices[0].delta.content) {
                $contentChunk = $json.choices[0].delta.content
                $fullResponse += $contentChunk
                Write-Host $contentChunk -NoNewline -ForegroundColor White
            }
        } catch {
            # Skip invalid lines
        }
    }

    Write-Host ""
    Write-Host ""
    Write-Host "----------------------------------------" -ForegroundColor Gray
    Write-Host "Full Response:" -ForegroundColor Green
    Write-Host "----------------------------------------" -ForegroundColor Gray
    Write-Host $fullResponse -ForegroundColor White

} catch {
    Write-Host "Error: $_" -ForegroundColor Red
}
finally {
    if (Test-Path $tempFile) {
        Remove-Item $tempFile -Force -ErrorAction SilentlyContinue
    }
}

Write-Host ""
