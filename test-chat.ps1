# Test script for EnderRealm Assistant API
param(
    [string]$Url = "http://localhost:8787/api/chat",
    [string]$Message = "Hello, EnderRealm Assistant! what is u chinese name?"
)

$body = @{
    message = $Message
} | ConvertTo-Json

Write-Host "Sending request to $Url" -ForegroundColor Cyan
Write-Host "Message: $Message" -ForegroundColor Yellow
Write-Host ""

$response = Invoke-WebRequest -Uri $Url -Method Post -ContentType "application/json" -Body $body -TimeoutSec 30

$sessionId = $response.Headers["X-Session-Id"]
if ($sessionId) {
    Write-Host "Session: $sessionId" -ForegroundColor Green
}

Write-Host ""
Write-Host "Response:" -ForegroundColor Cyan

$content = $response.Content -split "`n"
$fullResponse = ""

foreach ($line in $content) {
    if ($line -match 'data:\s*\{.*"content"\s*:\s*"([^"]*)"') {
        $fullResponse += $matches[1]
    }
}

Write-Host $fullResponse
