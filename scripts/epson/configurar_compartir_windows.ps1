<#
.SYNOPSIS
  Prepara o limpia Windows para la Epson CW-C4000u (McKenna / Jenniffer).
  Transporte principal hacia el agente Linux: SMB (compartir impresora).

.PARAMETER Desinstalar
  Quita la impresora compartida CW-C4000u de Windows (cola).

.EXAMPLE
  .\configurar_compartir_windows.ps1
  .\configurar_compartir_windows.ps1 -Desinstalar
#>
param(
  [switch]$Desinstalar
)

# Si no es Admin, se relanza elevado (UAC) y sale
$principal = New-Object Security.Principal.WindowsPrincipal(
  [Security.Principal.WindowsIdentity]::GetCurrent()
)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host "Se necesitan permisos de administrador. Abriendo UAC..." -ForegroundColor Yellow
  $argList = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$PSCommandPath`"")
  if ($Desinstalar) { $argList += "-Desinstalar" }
  try {
    Start-Process -FilePath "powershell.exe" -Verb RunAs -ArgumentList $argList -Wait
  } catch {
    Write-Host "No se pudo elevar. Clic derecho en PowerShell → Ejecutar como administrador." -ForegroundColor Red
    Write-Host $_ -ForegroundColor DarkYellow
    exit 1
  }
  exit $LASTEXITCODE
}

$ErrorActionPreference = "Continue"
$ShareName = "CW-C4000u"
$DriverUrl = "https://epson.com/Support/Printers/Label-Printers/ColorWorks-Series/Epson-ColorWorks-CW-C4000/s/SPT_C31CK03101"

Write-Host ""
Write-Host "=== McKenna · Epson CW-C4000u (Windows 10 Pro / SMB) ===" -ForegroundColor Cyan
Write-Host ""

if ($Desinstalar) {
  Write-Host "Desinstalando impresora '$ShareName'..." -ForegroundColor Yellow

  $printers = Get-Printer -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -like "*C4000*" -or $_.Name -eq $ShareName -or $_.ShareName -eq $ShareName
  }
  foreach ($p in $printers) {
    try {
      Write-Host "  Quitando cola: $($p.Name)" -ForegroundColor Yellow
      Remove-Printer -Name $p.Name -ErrorAction Stop
      Write-Host "  OK." -ForegroundColor Green
    } catch {
      Write-Host "  No se pudo quitar $($p.Name): $_" -ForegroundColor DarkYellow
    }
  }
  if (-not $printers) {
    Write-Host "  No había cola CW-C4000u registrada." -ForegroundColor DarkYellow
  }

  Get-PrinterPort -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match "USB|EPSON|C4000" } |
    ForEach-Object {
      try {
        Remove-PrinterPort -Name $_.Name -ErrorAction SilentlyContinue
      } catch {}
    }

  Write-Host ""
  Write-Host "Siguiente en Windows (Jenniffer):" -ForegroundColor Cyan
  Write-Host "  1. Conecta USB, LCD = Listo"
  Write-Host "  2. Instala driver Epson: $DriverUrl"
  Write-Host "  3. Comparte de nuevo como $ShareName"
  Write-Host "  4. Ejecuta este script SIN -Desinstalar (SMB + firewall)"
  Write-Host "  5. En el panel McKenna: Instalar → Windows 10 Pro"
  Write-Host ""
  $open = Read-Host "¿Abrir página del driver Epson? (S/n)"
  if ($open -eq "" -or $open -match "^[sSyY]") {
    Start-Process $DriverUrl
  }
  Write-Host "Listo (desinstalación Windows)." -ForegroundColor Cyan
  exit 0
}

Write-Host "[1/5] Perfil de red = Privado (recomendado para compartir)..." -ForegroundColor Yellow
try {
  Get-NetConnectionProfile | ForEach-Object {
    if ($_.NetworkCategory -ne "Private") {
      Set-NetConnectionProfile -InterfaceIndex $_.InterfaceIndex -NetworkCategory Private -ErrorAction Stop
      Write-Host "  $($_.Name) → Privado." -ForegroundColor Green
    } else {
      Write-Host "  $($_.Name) ya es Privado." -ForegroundColor Green
    }
  }
} catch {
  Write-Host "  No se pudo cambiar el perfil automáticamente: $_" -ForegroundColor DarkYellow
  Write-Host "  Configuración → Red e Internet → Propiedades → Perfil Privado." -ForegroundColor DarkYellow
}

Write-Host "[2/5] Firewall: Compartir archivos e impresoras (Privado)..." -ForegroundColor Yellow
try {
  Set-NetFirewallRule -DisplayGroup "File and Printer Sharing" -Enabled True -Profile Private -ErrorAction Stop
  Write-Host "  OK." -ForegroundColor Green
} catch {
  try {
    Set-NetFirewallRule -DisplayGroup "Compartir archivos e impresoras" -Enabled True -Profile Private -ErrorAction Stop
    Write-Host "  OK." -ForegroundColor Green
  } catch {
    Write-Host "  Revisa manualmente el firewall (perfil de red = Privado)." -ForegroundColor DarkYellow
  }
}

Write-Host "[3/5] Asegurar impresora compartida como $ShareName..." -ForegroundColor Yellow
$printer = Get-Printer -ErrorAction SilentlyContinue | Where-Object {
  $_.Name -like "*C4000*" -or $_.Name -eq $ShareName -or $_.ShareName -eq $ShareName
} | Select-Object -First 1

if (-not $printer) {
  Write-Host "  No se encontró cola CW-C4000u. Instala el driver Epson y vuelve a ejecutar." -ForegroundColor DarkYellow
  Write-Host "  Driver: $DriverUrl" -ForegroundColor DarkYellow
} else {
  try {
    if (-not $printer.Shared -or $printer.ShareName -ne $ShareName) {
      Set-Printer -Name $printer.Name -Shared $true -ShareName $ShareName -ErrorAction Stop
      Write-Host "  Compartida: $($printer.Name) → \\localhost\$ShareName" -ForegroundColor Green
    } else {
      Write-Host "  Ya compartida como $ShareName." -ForegroundColor Green
    }
  } catch {
    Write-Host "  No se pudo compartir automáticamente: $_" -ForegroundColor DarkYellow
    Write-Host "  Manual: Propiedades de impresora → Compartir → nombre $ShareName" -ForegroundColor DarkYellow
  }
}

Write-Host "[4/5] (Opcional) Internet Printing Client — solo si usas IPP..." -ForegroundColor Yellow
try {
  $feat = Get-WindowsOptionalFeature -Online -FeatureName Printing-InternetPrinting-Client -ErrorAction Stop
  if ($feat.State -ne "Enabled") {
    Enable-WindowsOptionalFeature -Online -FeatureName Printing-InternetPrinting-Client -All -NoRestart | Out-Null
    Write-Host "  Activado (puede pedir reinicio). McKenna usa SMB por defecto; IPP es opcional." -ForegroundColor Green
  } else {
    Write-Host "  Ya estaba activo (opcional)." -ForegroundColor Green
  }
} catch {
  Write-Host "  Omitido (no requerido para SMB): $_" -ForegroundColor DarkYellow
}

Write-Host "[5/5] IP de este PC (usa la de la LAN / Wi‑Fi)..." -ForegroundColor Yellow
$ips = Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -notlike "127.*" -and $_.PrefixOrigin -ne "WellKnown" } |
  Select-Object -ExpandProperty IPAddress
foreach ($ip in $ips) {
  Write-Host "  → $ip" -ForegroundColor Green
  Write-Host "    URI agente: smb://$ip/$ShareName" -ForegroundColor Cyan
}
if (-not $ips) {
  Write-Host "  No se detectó IPv4. Ejecuta: ipconfig" -ForegroundColor DarkYellow
}

Write-Host ""
Write-Host "Checklist impresora:" -ForegroundColor Cyan
Write-Host "  1. Driver Epson instalado ($DriverUrl)"
Write-Host "  2. USB conectado, LCD = Listo"
Write-Host "  3. Compartir impresora con nombre exacto: $ShareName"
Write-Host "  4. Firewall: Compartir archivos e impresoras (Privado)"
Write-Host "  5. En el panel McKenna (Linux): Instalar → Windows 10 Pro → IP de arriba"
Write-Host ""

$open = Read-Host "¿Abrir página de descarga del driver Epson? (S/n)"
if ($open -eq "" -or $open -match "^[sSyY]") {
  Start-Process $DriverUrl
}

Write-Host "Listo." -ForegroundColor Cyan
