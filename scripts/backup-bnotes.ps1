$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))

function Invoke-DockerToFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Arguments,
        [Parameter(Mandatory = $true)]
        [string]$Destination
    )

    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = 'docker'
    $startInfo.Arguments = $Arguments
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardOutput = $true

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    if (-not $process.Start()) {
        throw 'No se pudo iniciar Docker.'
    }

    $fileStream = [System.IO.File]::Open(
        $Destination,
        [System.IO.FileMode]::Create,
        [System.IO.FileAccess]::Write,
        [System.IO.FileShare]::None
    )
    try {
        $process.StandardOutput.BaseStream.CopyTo($fileStream)
    }
    finally {
        $fileStream.Dispose()
    }

    $process.WaitForExit()
    if ($process.ExitCode -ne 0) {
        Remove-Item -LiteralPath $Destination -Force -ErrorAction SilentlyContinue
        throw "Docker terminó con código $($process.ExitCode): docker $Arguments"
    }
}

$backupDirectory = $env:BNOTES_BACKUP_DIR
if ([string]::IsNullOrWhiteSpace($backupDirectory)) {
    $driveCandidates = @(
        'G:\Mi unidad\Backups_B_Notes',
        'G:\My Drive\Backups_B_Notes'
    )
    foreach ($candidate in $driveCandidates) {
        $driveFolder = Split-Path -Parent $candidate
        if (Test-Path -LiteralPath $driveFolder -PathType Container) {
            $backupDirectory = $candidate
            break
        }
    }
}

if ([string]::IsNullOrWhiteSpace($backupDirectory)) {
    $backupDirectory = Join-Path $projectRoot 'backups'
}

if (-not [System.IO.Path]::IsPathRooted($backupDirectory)) {
    $backupDirectory = Join-Path $projectRoot $backupDirectory
}

$backupDirectory = [System.IO.Path]::GetFullPath($backupDirectory)
New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null

$timestamp = Get-Date -Format 'yyyy-MM-dd_HH-mm'
$sqlFile = Join-Path $backupDirectory "bnotes_$timestamp.sql"
$sqlArchive = "$sqlFile.zip"
$n8nArchive = Join-Path $backupDirectory "n8n_$timestamp.tar.gz"

Push-Location $projectRoot
try {
    try {
        Invoke-DockerToFile `
            -Arguments 'compose exec -T postgres pg_dump -U bnotes bnotes' `
            -Destination $sqlFile
        Compress-Archive -LiteralPath $sqlFile -DestinationPath $sqlArchive -CompressionLevel Optimal -Force
    }
    finally {
        Remove-Item -LiteralPath $sqlFile -Force -ErrorAction SilentlyContinue
    }

    Invoke-DockerToFile `
        -Arguments 'run --rm --volume cerebro-digital_n8n_data:/data:ro alpine tar -czf - -C /data .' `
        -Destination $n8nArchive

    $retentionDate = (Get-Date).AddDays(-14)
    Get-ChildItem -LiteralPath $backupDirectory -File |
        Where-Object {
            ($_.Name -like 'bnotes_*.sql.zip' -or $_.Name -like 'n8n_*.tar.gz') -and
            $_.LastWriteTime -lt $retentionDate
        } |
        Remove-Item -Force

    Write-Output "Backup PostgreSQL: $sqlArchive"
    Write-Output "Backup n8n: $n8nArchive"
}
finally {
    Pop-Location
}
