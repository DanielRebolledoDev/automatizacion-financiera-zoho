# Diagnostico de solo lectura. Compatible con Windows PowerShell 5.1.
# Colocar este archivo y el .cjs en la raiz, junto a backend y frontend.
$ErrorActionPreference = 'Stop'
$backend = Join-Path $PSScriptRoot 'backend'
$diagnosticScript = Join-Path $PSScriptRoot 'diagnosticar-paginacion-zoho.cjs'
$report = Join-Path $PSScriptRoot 'diagnostico-paginacion-zoho.json'
$previousRut = [Environment]::GetEnvironmentVariable('ZOHO_DIAGNOSTIC_RUT', 'Process')
$locationPushed = $false
$failureReason = 'INITIALIZATION_FAILED'

try {
  if (-not (Test-Path -LiteralPath (Join-Path $backend 'package.json') -PathType Leaf)) {
    $failureReason = 'BACKEND_NOT_FOUND'
    throw 'No se encontro backend/package.json.'
  }
  if (-not (Test-Path -LiteralPath (Join-Path $backend '.env') -PathType Leaf)) {
    $failureReason = 'ENV_FILE_NOT_FOUND'
    throw 'No se encontro backend/.env.'
  }
  if (-not (Test-Path -LiteralPath $diagnosticScript -PathType Leaf)) {
    $failureReason = 'DIAGNOSTIC_SCRIPT_NOT_FOUND'
    throw 'Falta el archivo diagnosticar-paginacion-zoho.cjs.'
  }
  $buildAtDist = Join-Path $backend 'dist/modules/zoho/zoho-books.service.js'
  $buildAtDistSrc = Join-Path $backend 'dist/src/modules/zoho/zoho-books.service.js'
  if (-not ((Test-Path -LiteralPath $buildAtDist -PathType Leaf) -or (Test-Path -LiteralPath $buildAtDistSrc -PathType Leaf))) {
    $failureReason = 'BUILD_REQUIRED'
    throw 'Primero ejecuta npm run build dentro de backend.'
  }
  if ($null -eq (Get-Command node -CommandType Application -ErrorAction SilentlyContinue)) {
    $failureReason = 'NODE_NOT_FOUND'
    throw 'No se encontro Node.js.'
  }

  $env:ZOHO_DIAGNOSTIC_RUT = Read-Host 'Ingresa el mismo RUT que fallo al consultar la deuda'
  Push-Location -LiteralPath $backend
  $locationPushed = $true
  & node --env-file=.env $diagnosticScript $report
  if ($LASTEXITCODE -ne 0) {
    $failureReason = 'NODE_EXECUTION_FAILED'
    throw 'Node no pudo ejecutar o guardar el diagnostico.'
  }
  Write-Host 'Adjunta el archivo diagnostico-paginacion-zoho.json de la raiz del proyecto.'
} catch {
  # No imprimir $_: una excepcion podria contener configuracion o datos privados.
  $failure = [ordered]@{
    diagnostic = 'zoho-pagination-37d-fix'
    completed = $false
    localDatabaseAccessed = $false
    businessWritesAttempted = $false
    pages = @()
    failedStage = 'INITIALIZATION'
    backendHttpStatus = $null
    code = 'DIAGNOSTIC_INITIALIZATION_FAILED'
    reason = $failureReason
  }
  try {
    $failure | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $report -Encoding UTF8
    Write-Host ('Diagnostico interrumpido: ' + $failureReason)
    if ($failureReason -eq 'BUILD_REQUIRED') {
      Write-Host 'Ejecuta npm run build dentro de backend y vuelve a ejecutar este script.'
    }
    Write-Host 'Adjunta el archivo diagnostico-paginacion-zoho.json de la raiz del proyecto.'
  } catch {
    Write-Host ('No se pudo guardar el diagnostico. Motivo de inicializacion: ' + $failureReason)
  }
} finally {
  if ($locationPushed) { Pop-Location }
  if ($null -eq $previousRut) {
    Remove-Item Env:ZOHO_DIAGNOSTIC_RUT -ErrorAction SilentlyContinue
  } else {
    $env:ZOHO_DIAGNOSTIC_RUT = $previousRut
  }
}
