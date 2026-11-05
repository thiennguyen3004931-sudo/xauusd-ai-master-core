# Pure XML/argument planning. No Scheduled Task, process, broker or filesystem mutations.
Set-StrictMode -Version Latest
function Read-Phase7CWebActionValue([string]$Text, [string]$Name) {
  $pattern = '(?i)(?:^|\s)-' + [regex]::Escape($Name) + '\s+(?:"([^"]*)"|''([^'']*)''|([^\s]+))(?=\s|$)'
  $items = [regex]::Matches($Text, $pattern)
  if ($items.Count -ne 1) { throw 'WEB_REPAIR_ARGUMENT_NOT_UNIQUE' }
  foreach ($index in @(1,2,3)) { if ($items[0].Groups[$index].Success) { return [string]$items[0].Groups[$index].Value } }
  throw 'WEB_REPAIR_ARGUMENT_UNREADABLE'
}
function Read-Phase7CWebTaskXml([string]$Text) {
  if ($Text -match '(?i)<!DOCTYPE|<!ENTITY') { throw 'WEB_REPAIR_XML_ENTITY_REJECTED' }
  $doc = New-Object System.Xml.XmlDocument
  $doc.XmlResolver = $null
  $doc.PreserveWhitespace = $false
  $doc.LoadXml($Text)
  if ($doc.DocumentElement.LocalName -ne 'Task' -or $doc.DocumentElement.NamespaceURI -ne 'http://schemas.microsoft.com/windows/2004/02/mit/task') { throw 'WEB_REPAIR_XML_SCHEMA_INVALID' }
  return ,$doc
}
function Get-Phase7CWebTaskNamespaces($Document) {
  $ns = [System.Xml.XmlNamespaceManager]::new($Document.NameTable)
  $ns.AddNamespace('t', 'http://schemas.microsoft.com/windows/2004/02/mit/task')
  return ,$ns
}
function Test-Phase7CWebTaskOnlyApprovedFields([string]$BeforeXml, [string]$AfterXml) {
  $before = Read-Phase7CWebTaskXml $BeforeXml
  $after = Read-Phase7CWebTaskXml $AfterXml
  foreach ($doc in @($before,$after)) {
    $ns = Get-Phase7CWebTaskNamespaces $doc
    foreach ($path in @('/t:Task/t:Principals/t:Principal/t:UserId','/t:Task/t:Actions/t:Exec/t:Arguments')) {
      $nodes = $doc.SelectNodes($path,$ns)
      if ($nodes.Count -ne 1) { return $false }
      $nodes[0].InnerText = '__ONLY_APPROVED_FIELD__'
    }
  }
  return $before.OuterXml -ceq $after.OuterXml
}
function Get-Phase7CWebTaskXmlDigest([string]$Text) {
  $hash = [Security.Cryptography.SHA256]::Create()
  try { return [BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($Text))).Replace('-','').ToLowerInvariant() }
  finally { $hash.Dispose() }
}
function New-Phase7CWebTaskRepairPlan {
  param(
    [string]$TaskXml,
    [string]$CurrentUserSid,
    [string]$LiveEnvPath,
    [string]$ExpectedLauncher,
    [string]$ExpectedRuntime,
    [string]$ExpectedPowerShell
  )
  if ($CurrentUserSid -notmatch '^S-\d-(?:\d+-)+\d+$' -or $CurrentUserSid -in @('S-1-5-18','S-1-5-19','S-1-5-20')) { throw 'WEB_REPAIR_INTERACTIVE_USER_REQUIRED' }
  if ($LiveEnvPath -match '["\r\n]' -or -not [IO.Path]::IsPathRooted($LiveEnvPath)) { throw 'WEB_REPAIR_LIVE_ENV_PATH_INVALID' }
  $doc = Read-Phase7CWebTaskXml $TaskXml
  $ns = Get-Phase7CWebTaskNamespaces $doc
  if ($doc.SelectNodes('/t:Task/t:Principals/t:Principal',$ns).Count -ne 1 -or $doc.SelectNodes('/t:Task/t:Actions/*',$ns).Count -ne 1 -or $doc.SelectNodes('/t:Task/t:Actions/t:Exec',$ns).Count -ne 1) { throw 'WEB_REPAIR_TASK_SHAPE_INVALID' }
  $principal = $doc.SelectSingleNode('/t:Task/t:Principals/t:Principal',$ns)
  $user = $principal.SelectSingleNode('t:UserId',$ns)
  $logon = $principal.SelectSingleNode('t:LogonType',$ns)
  if ($null -eq $user -or [string]::IsNullOrWhiteSpace($user.InnerText) -or $null -eq $logon -or $logon.InnerText -ne 'InteractiveToken' -or $null -ne $principal.SelectSingleNode('t:GroupId',$ns)) { throw 'WEB_REPAIR_PRINCIPAL_SHAPE_INVALID' }
  $command = $doc.SelectSingleNode('/t:Task/t:Actions/t:Exec/t:Command',$ns)
  $argsNode = $doc.SelectSingleNode('/t:Task/t:Actions/t:Exec/t:Arguments',$ns)
  if ($null -eq $command -or $null -eq $argsNode -or $command.InnerText -notin @($ExpectedPowerShell,'powershell.exe')) { throw 'WEB_REPAIR_COMMAND_NOT_CANONICAL' }
  $arguments = [string]$argsNode.InnerText
  if ($arguments -match '(?i)(?:-EncodedCommand|-Command\s|invoke-expression|iex\s)') { throw 'WEB_REPAIR_COMMAND_NOT_CANONICAL' }
  $file = Read-Phase7CWebActionValue $arguments 'File'
  $workDir = Read-Phase7CWebActionValue $arguments 'WorkDir'
  $null = Read-Phase7CWebActionValue $arguments 'BridgeEnv'
  if ([IO.Path]::GetFullPath($file) -ine [IO.Path]::GetFullPath($ExpectedLauncher) -or [IO.Path]::GetFullPath($workDir).TrimEnd('\') -ine [IO.Path]::GetFullPath($ExpectedRuntime).TrimEnd('\')) { throw 'WEB_REPAIR_PATH_NOT_CANONICAL' }
  $envPattern = '(?i)(?:^|\s)-BridgeEnv\s+(?:"[^"]*"|''[^'']*''|[^\s]+)(?=\s|$)'
  $match = [regex]::Match($arguments,$envPattern)
  $newArguments = $arguments.Substring(0,$match.Index) + ' -BridgeEnv "' + $LiveEnvPath + '"' + $arguments.Substring($match.Index+$match.Length)
  $user.InnerText = $CurrentUserSid
  $argsNode.InnerText = $newArguments
  $newXml = $doc.OuterXml
  if (-not (Test-Phase7CWebTaskOnlyApprovedFields $TaskXml $newXml)) { throw 'WEB_REPAIR_PLAN_SCOPE_INVALID' }
  return [pscustomobject]@{ currentUserSid=$CurrentUserSid; newArguments=$newArguments; beforeDigest=(Get-Phase7CWebTaskXmlDigest $TaskXml); plannedXml=$newXml }
}

# Task Scheduler may return an unmappable display name through CIM/COM;
# the exported XML is the persisted principal reference.
function Get-Phase7CWebTaskPrincipalReference([string]$TaskXml) {
  $document=Read-Phase7CWebTaskXml $TaskXml
  $namespaces=Get-Phase7CWebTaskNamespaces $document
  $nodes=$document.SelectNodes('/t:Task/t:Principals/t:Principal/t:UserId',$namespaces)
  if ($nodes.Count -ne 1 -or [string]::IsNullOrWhiteSpace([string]$nodes[0].InnerText)) { throw 'WEB_REPAIR_XML_PRINCIPAL_NOT_UNIQUE' }
  return [string]$nodes[0].InnerText
}
