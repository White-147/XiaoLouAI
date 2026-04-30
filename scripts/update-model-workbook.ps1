param(
  [Parameter(Mandatory = $true)]
  [string]$InputFile,

  [Parameter(Mandatory = $true)]
  [string]$OutputFile,

  [Parameter(Mandatory = $true)]
  [string]$SpecFile
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.IO.Compression.FileSystem

function Get-ColumnNumber {
  param([string]$Letters)
  $sum = 0
  foreach ($char in $Letters.ToUpper().ToCharArray()) {
    $sum = ($sum * 26) + ([int][char]$char - [int][char]'A' + 1)
  }
  return $sum
}

function Get-ColumnLetters {
  param([int]$Number)
  $letters = ""
  $value = $Number
  while ($value -gt 0) {
    $value--
    $letters = [char]([int][char]'A' + ($value % 26)) + $letters
    $value = [math]::Floor($value / 26)
  }
  return $letters
}

function Split-CellReference {
  param([string]$Reference)
  $match = [regex]::Match($Reference, '^([A-Z]+)(\d+)$')
  if (-not $match.Success) {
    throw "Invalid cell reference: $Reference"
  }
  [pscustomobject]@{
    Column = $match.Groups[1].Value
    Row    = [int]$match.Groups[2].Value
  }
}

function Set-XmlAttribute {
  param(
    [System.Xml.XmlElement]$Element,
    [string]$Name,
    [string]$Value
  )
  $attr = $Element.GetAttributeNode($Name)
  if ($null -eq $attr) {
    $attr = $Element.OwnerDocument.CreateAttribute($Name)
    $Element.Attributes.Append($attr) | Out-Null
  }
  $attr.Value = $Value
}

function Get-SharedStringIndex {
  param(
    [System.Xml.XmlDocument]$SharedStringsXml,
    [hashtable]$SharedStringMap,
    [string]$Text
  )

  if ($SharedStringMap.ContainsKey($Text)) {
    return [int]$SharedStringMap[$Text]
  }

  $namespaceUri = $SharedStringsXml.DocumentElement.NamespaceURI
  $si = $SharedStringsXml.CreateElement("si", $namespaceUri)
  $t = $SharedStringsXml.CreateElement("t", $namespaceUri)
  if ($Text.StartsWith(" ") -or $Text.EndsWith(" ") -or $Text.Contains("`n")) {
    $preserve = $SharedStringsXml.CreateAttribute("xml", "space", "http://www.w3.org/XML/1998/namespace")
    $preserve.Value = "preserve"
    $t.Attributes.Append($preserve) | Out-Null
  }
  $t.InnerText = $Text
  $si.AppendChild($t) | Out-Null
  $SharedStringsXml.DocumentElement.AppendChild($si) | Out-Null

  $index = $SharedStringsXml.DocumentElement.SelectNodes("*").Count - 1
  $SharedStringMap[$Text] = $index
  Set-XmlAttribute -Element $SharedStringsXml.DocumentElement -Name "uniqueCount" -Value ([string]($index + 1))
  Set-XmlAttribute -Element $SharedStringsXml.DocumentElement -Name "count" -Value ([string]($index + 1))
  return $index
}

function Get-OrCreateCell {
  param(
    [System.Xml.XmlElement]$RowNode,
    [string]$ColumnLetters
  )

  $rowNumber = [int]$RowNode.GetAttribute("r")
  $targetRef = "$ColumnLetters$rowNumber"
  $namespaceUri = $RowNode.NamespaceURI

  foreach ($cell in @($RowNode.SelectNodes("*"))) {
    if ($cell.LocalName -ne "c") { continue }
    $cellRef = Split-CellReference -Reference $cell.GetAttribute("r")
    $current = Get-ColumnNumber -Letters $cellRef.Column
    $target = Get-ColumnNumber -Letters $ColumnLetters
    if ($cell.GetAttribute("r") -eq $targetRef) {
      return $cell
    }
    if ($current -gt $target) {
      $newCell = $RowNode.OwnerDocument.CreateElement("c", $namespaceUri)
      Set-XmlAttribute -Element $newCell -Name "r" -Value $targetRef
      $RowNode.InsertBefore($newCell, $cell) | Out-Null
      return $newCell
    }
  }

  $created = $RowNode.OwnerDocument.CreateElement("c", $namespaceUri)
  Set-XmlAttribute -Element $created -Name "r" -Value $targetRef
  $RowNode.AppendChild($created) | Out-Null
  return $created
}

function Clear-CellValue {
  param([System.Xml.XmlElement]$Cell)
  foreach ($child in @($Cell.SelectNodes("*"))) {
    $Cell.RemoveChild($child) | Out-Null
  }
  $Cell.RemoveAttribute("t")
}

function Set-CellSharedString {
  param(
    [System.Xml.XmlElement]$RowNode,
    [string]$ColumnLetters,
    [string]$Text,
    [System.Xml.XmlDocument]$SharedStringsXml,
    [hashtable]$SharedStringMap
  )

  $cell = Get-OrCreateCell -RowNode $RowNode -ColumnLetters $ColumnLetters
  if ([string]::IsNullOrEmpty($Text)) {
    Clear-CellValue -Cell $cell
    return
  }

  $index = Get-SharedStringIndex -SharedStringsXml $SharedStringsXml -SharedStringMap $SharedStringMap -Text $Text
  Clear-CellValue -Cell $cell
  Set-XmlAttribute -Element $cell -Name "t" -Value "s"
  $valueNode = $cell.OwnerDocument.CreateElement("v", $cell.NamespaceURI)
  $valueNode.InnerText = [string]$index
  $cell.AppendChild($valueNode) | Out-Null
}

function Shift-RowNode {
  param(
    [System.Xml.XmlElement]$RowNode,
    [int]$Delta
  )

  $newRowNumber = [int]$RowNode.GetAttribute("r") + $Delta
  Set-XmlAttribute -Element $RowNode -Name "r" -Value ([string]$newRowNumber)

  foreach ($cell in @($RowNode.SelectNodes("*"))) {
    if ($cell.LocalName -ne "c") { continue }
    $ref = Split-CellReference -Reference $cell.GetAttribute("r")
    Set-XmlAttribute -Element $cell -Name "r" -Value ($ref.Column + ($ref.Row + $Delta))
  }
}

function Update-MergeRangesForInsert {
  param(
    [System.Xml.XmlDocument]$SheetXml,
    [System.Xml.XmlNamespaceManager]$NsManager,
    [int]$AfterRow
  )

  $mergeCellsNode = $SheetXml.SelectSingleNode("//x:mergeCells", $NsManager)
  if ($null -eq $mergeCellsNode) { return }

  foreach ($mergeCell in @($mergeCellsNode.SelectNodes("x:mergeCell", $NsManager))) {
    $ref = $mergeCell.GetAttribute("ref")
    $parts = $ref.Split(":")
    if ($parts.Count -ne 2) { continue }
    $start = Split-CellReference -Reference $parts[0]
    $end = Split-CellReference -Reference $parts[1]

    if ($start.Row -le $AfterRow -and $end.Row -gt $AfterRow) {
      $end.Row++
    } elseif ($start.Row -gt $AfterRow) {
      $start.Row++
      $end.Row++
    } else {
      continue
    }

    Set-XmlAttribute -Element $mergeCell -Name "ref" -Value ("{0}{1}:{2}{3}" -f $start.Column, $start.Row, $end.Column, $end.Row)
  }
}

function Update-SheetDimension {
  param(
    [System.Xml.XmlDocument]$SheetXml,
    [System.Xml.XmlNamespaceManager]$NsManager
  )

  $dimensionNode = $SheetXml.SelectSingleNode("//x:dimension", $NsManager)
  if ($null -eq $dimensionNode) { return }

  $sheetData = $SheetXml.SelectSingleNode("//x:sheetData", $NsManager)
  $rows = @($sheetData.SelectNodes("x:row", $NsManager))
  if (-not $rows.Count) { return }

  $lastRow = ($rows | ForEach-Object { [int]$_.GetAttribute("r") } | Measure-Object -Maximum).Maximum
  $ref = $dimensionNode.GetAttribute("ref")
  $parts = $ref.Split(":")
  if ($parts.Count -ne 2) { return }
  $start = Split-CellReference -Reference $parts[0]
  $end = Split-CellReference -Reference $parts[1]
  Set-XmlAttribute -Element $dimensionNode -Name "ref" -Value ("{0}{1}:{2}{3}" -f $start.Column, $start.Row, $end.Column, $lastRow)
}

function Write-Utf8Xml {
  param(
    [System.Xml.XmlDocument]$Xml,
    [string]$Path
  )

  $settings = New-Object System.Xml.XmlWriterSettings
  $settings.Encoding = New-Object System.Text.UTF8Encoding($false)
  $settings.Indent = $false
  $settings.NewLineHandling = [System.Xml.NewLineHandling]::None

  $writer = [System.Xml.XmlWriter]::Create($Path, $settings)
  try {
    $Xml.Save($writer)
  } finally {
    $writer.Dispose()
  }
}

function Resolve-ActualRow {
  param(
    [int]$OriginalRow,
    [System.Collections.ArrayList]$AppliedInsertions,
    [switch]$IncludeSameRow
  )

  $count = 0
  foreach ($value in $AppliedInsertions) {
    if ($IncludeSameRow) {
      if ([int]$value -le $OriginalRow) { $count++ }
    } else {
      if ([int]$value -lt $OriginalRow) { $count++ }
    }
  }
  return $OriginalRow + $count
}

$resolvedInput = (Resolve-Path -LiteralPath $InputFile).Path
$resolvedSpec = (Resolve-Path -LiteralPath $SpecFile).Path
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputFile)

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("model-workbook-" + [guid]::NewGuid().ToString("N"))
[System.IO.Directory]::CreateDirectory($tempRoot) | Out-Null

try {
  [System.IO.Compression.ZipFile]::ExtractToDirectory($resolvedInput, $tempRoot)

  $sheetPath = Join-Path $tempRoot "xl\worksheets\sheet1.xml"
  $sharedStringsPath = Join-Path $tempRoot "xl\sharedStrings.xml"

  [xml]$sheetXml = Get-Content -LiteralPath $sheetPath -Raw -Encoding UTF8
  [xml]$sharedStringsXml = Get-Content -LiteralPath $sharedStringsPath -Raw -Encoding UTF8
  $spec = Get-Content -LiteralPath $resolvedSpec -Raw -Encoding UTF8 | ConvertFrom-Json

  $nsManager = New-Object System.Xml.XmlNamespaceManager($sheetXml.NameTable)
  $nsManager.AddNamespace("x", $sheetXml.DocumentElement.NamespaceURI)

  $sharedStringMap = @{}
  $existingSharedStrings = @($sharedStringsXml.DocumentElement.SelectNodes("*"))
  for ($index = 0; $index -lt $existingSharedStrings.Count; $index++) {
    $textNode = $existingSharedStrings[$index].SelectSingleNode("*[local-name()='t']")
    $value = if ($null -ne $textNode) { $textNode.InnerText } else { "" }
    if (-not $sharedStringMap.ContainsKey($value)) {
      $sharedStringMap[$value] = $index
    }
  }

  $sheetData = $sheetXml.SelectSingleNode("//x:sheetData", $nsManager)
  $appliedInsertions = New-Object System.Collections.ArrayList

  $insertOps = @()
  if ($null -ne $spec.insertAfter) {
    $insertOps = @($spec.insertAfter)
  }

  foreach ($op in $insertOps) {
    $originalAfter = [int]$op.afterRow
    $actualAfter = Resolve-ActualRow -OriginalRow $originalAfter -AppliedInsertions $appliedInsertions -IncludeSameRow
    $templateOriginal = if ($null -ne $op.templateRow) { [int]$op.templateRow } else { $originalAfter }
    $templateActual = Resolve-ActualRow -OriginalRow $templateOriginal -AppliedInsertions $appliedInsertions

    $rowsToShift = @($sheetData.SelectNodes("x:row[number(@r) > $actualAfter]", $nsManager)) |
      Sort-Object { [int]$_.GetAttribute("r") } -Descending
    foreach ($row in $rowsToShift) {
      Shift-RowNode -RowNode $row -Delta 1
    }

    $templateRowNode = $sheetData.SelectSingleNode("x:row[@r='$templateActual']", $nsManager)
    if ($null -eq $templateRowNode) {
      throw "Template row not found: $templateOriginal"
    }

    $newRowNode = $templateRowNode.CloneNode($true)
    Shift-RowNode -RowNode $newRowNode -Delta (($actualAfter + 1) - $templateActual)

    if ($null -ne $op.values) {
      $propertyNames = $op.values.PSObject.Properties.Name | Sort-Object { Get-ColumnNumber $_ }
      foreach ($column in $propertyNames) {
        $value = [string]$op.values.$column
        Set-CellSharedString -RowNode $newRowNode -ColumnLetters $column -Text $value -SharedStringsXml $sharedStringsXml -SharedStringMap $sharedStringMap
      }
    }

    $anchorRow = $sheetData.SelectSingleNode("x:row[@r='$actualAfter']", $nsManager)
    if ($null -eq $anchorRow) {
      $sheetData.AppendChild($newRowNode) | Out-Null
    } else {
      if ($null -ne $anchorRow.NextSibling) {
        $sheetData.InsertBefore($newRowNode, $anchorRow.NextSibling) | Out-Null
      } else {
        $sheetData.AppendChild($newRowNode) | Out-Null
      }
    }

    Update-MergeRangesForInsert -SheetXml $sheetXml -NsManager $nsManager -AfterRow $actualAfter
    [void]$appliedInsertions.Add($originalAfter)
  }

  $updateOps = @()
  if ($null -ne $spec.updates) {
    $updateOps = @($spec.updates)
  }

  foreach ($op in $updateOps) {
    $actualRow = Resolve-ActualRow -OriginalRow ([int]$op.row) -AppliedInsertions $appliedInsertions
    $rowNode = $sheetData.SelectSingleNode("x:row[@r='$actualRow']", $nsManager)
    if ($null -eq $rowNode) {
      throw "Update row not found: $($op.row)"
    }

    $propertyNames = $op.values.PSObject.Properties.Name | Sort-Object { Get-ColumnNumber $_ }
    foreach ($column in $propertyNames) {
      $value = [string]$op.values.$column
      Set-CellSharedString -RowNode $rowNode -ColumnLetters $column -Text $value -SharedStringsXml $sharedStringsXml -SharedStringMap $sharedStringMap
    }
  }

  Update-SheetDimension -SheetXml $sheetXml -NsManager $nsManager

  Write-Utf8Xml -Xml $sheetXml -Path $sheetPath
  Write-Utf8Xml -Xml $sharedStringsXml -Path $sharedStringsPath

  if (Test-Path -LiteralPath $resolvedOutput) {
    Remove-Item -LiteralPath $resolvedOutput -Force
  }
  [System.IO.Compression.ZipFile]::CreateFromDirectory($tempRoot, $resolvedOutput)
}
finally {
  if (Test-Path -LiteralPath $tempRoot) {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force
  }
}
