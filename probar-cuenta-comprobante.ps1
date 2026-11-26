$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

Push-Location (Join-Path $PSScriptRoot 'backend')
try {
    $lintFiles = @(
        'src/config/env.validation.ts'
        'src/common/utils/zoho-payment-account.util.ts'
        'src/modules/zoho/zoho-customer-payments.service.ts'
        'src/modules/zoho/interfaces/zoho-customer-payment.interface.ts'
        'src/modules/zoho/utils/zoho-payment-reconciliation.util.ts'
        'src/modules/payment-express/payment-express.service.ts'
        'test/zoho-preflight.safety.cjs'
        'test/zoho-reconciliation.safety.cjs'
    )
    # Aplica el formato de tu repositorio a los archivos de este bloque.
    & npx eslint @lintFiles --fix
    if ($LASTEXITCODE -ne 0) { throw 'Fallo ESLint backend.' }
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Fallo build backend.' }
    & node --test test/zoho-preflight.safety.cjs test/zoho-reconciliation.safety.cjs
    if ($LASTEXITCODE -ne 0) { throw 'Fallaron las pruebas de cuenta y conciliacion.' }
} finally {
    Pop-Location
}

Push-Location (Join-Path $PSScriptRoot 'frontend')
try {
    & npx eslint src/features/payment-result/utils/paymentReceiptPdf.ts src/features/payment-express/types/paymentExpress.types.ts
    if ($LASTEXITCODE -ne 0) { throw 'Fallo ESLint frontend.' }
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Fallo build frontend.' }
} finally {
    Pop-Location
}
Write-Host 'VERIFICACION LOCAL COMPLETADA. No se enviaron pagos ni se consultaron APIs externas.'
Write-Host 'Pendiente: verificar el destino en Zoho y descargar el PDF desde tu navegador.'
