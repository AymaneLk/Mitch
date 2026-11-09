param([string]$HelperFile)
$ErrorActionPreference='Stop'
# Load only the helper's actual function definitions. Never run its stdin
# dispatcher, instantiate live COM, invoke native focus, or open a window.
$tokens=$null;$parseErrors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($HelperFile,[ref]$tokens,[ref]$parseErrors)
if($parseErrors.Count){throw 'Folder helper contains syntax errors.'}
$names=@('Local-FolderPath','Same-Path','Explorer-Inventory','Unambiguous-FolderWindows','Folder-OpenPlan')
foreach($definition in $ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst]},$false)){
  if($definition.Name -in $names){. ([scriptblock]::Create($definition.Extent.Text))}
}
$testPath=[IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($HelperFile))
$otherPath=[IO.Path]::GetDirectoryName($testPath)
function Assert($condition,[string]$message){if(!$condition){throw $message}}
function Window($id,[string]$folderPath){return [pscustomobject]@{FullName='C:\Windows\explorer.exe';HWND=$id;Document=[pscustomobject]@{Folder=[pscustomobject]@{Self=[pscustomobject]@{IsFileSystem=$true;IsFolder=$true;Path=$folderPath}}}}}
function Shell($windows){$s=[pscustomobject]@{MockWindows=@($windows)};$s|Add-Member ScriptMethod Windows {return ,$this.MockWindows};return $s}
$results=[Collections.Generic.List[string]]::new()

$inventory=Explorer-Inventory (Shell @((Window 71 $testPath)))
$selected=@(Unambiguous-FolderWindows $inventory $testPath)
Assert ($inventory.complete -and $selected.Count -eq 1 -and $selected[0].window_id -eq 71) 'Exact complete filesystem inventory should select its window.'
Assert ((Folder-OpenPlan $inventory $testPath).reused) 'Exact known window should be reused.'
$results.Add('exact filesystem window is reusable')

$inventory=Explorer-Inventory (Shell @((Window 71 $testPath),(Window 71 $otherPath)))
$plan=Folder-OpenPlan $inventory $testPath
Assert ($inventory.complete -and $plan.status -eq 'refused' -and $plan.code -eq 'folder_tab_ambiguous' -and !$plan.action_attempted) 'Different folders sharing HWND must refuse before input.'
$results.Add('different filesystem tabs cannot prove active folder')

$namespaceTab=Window 71 $testPath;$namespaceTab.Document.Folder.Self.IsFileSystem=$false;$namespaceTab.Document.Folder.Self.Path='::{679f85cb-0220-4080-b29b-5540cc05aab6}'
$inventory=Explorer-Inventory (Shell @((Window 71 $testPath),$namespaceTab))
$plan=Folder-OpenPlan $inventory $testPath
Assert ($inventory.complete -and $inventory.rows.Count -eq 2 -and @($inventory.rows|Where-Object{$_.kind -eq 'namespace'}).Count -eq 1) 'Home namespace HWND must be retained.'
Assert ($plan.status -eq 'refused' -and $plan.code -eq 'folder_tab_ambiguous' -and !$plan.action_attempted) 'Home plus filesystem tab must refuse before focus/open.'
$results.Add('Home and This PC namespace tabs remain HWND blockers')

$unreadable=Window 71 $testPath;$unreadable.PSObject.Properties.Remove('Document');$unreadable|Add-Member ScriptProperty Document {throw 'Mock COM document inaccessible'}
$inventory=Explorer-Inventory (Shell @((Window 71 $testPath),$unreadable))
$plan=Folder-OpenPlan $inventory $testPath
Assert (!$inventory.complete -and $inventory.rows.Count -eq 2 -and @($inventory.rows|Where-Object{$_.kind -eq 'unknown' -and $_.window_id -eq 71}).Count -eq 1) 'Unreadable document must retain HWND and mark incomplete.'
Assert ($plan.code -eq 'folder_inventory_incomplete' -and !$plan.action_attempted -and @(Unambiguous-FolderWindows $inventory $testPath).Count -eq 0) 'Unreadable tab cannot prove uniqueness.'
$results.Add('COM document failure blocks same-HWND verification')

$unknown=Window 0 $otherPath
$inventory=Explorer-Inventory (Shell @((Window 71 $testPath),$unknown))
$plan=Folder-OpenPlan $inventory $testPath
Assert (!$inventory.complete -and $plan.code -eq 'folder_inventory_incomplete' -and !$plan.action_attempted) 'Missing HWND must block global uniqueness even with an exact known row.'
$results.Add('unidentifiable HWND prevents incomplete-inventory success')

$unknown=Window 81 $otherPath;$unknown.PSObject.Properties.Remove('FullName');$unknown|Add-Member ScriptProperty FullName {throw 'Mock COM identity inaccessible'}
$inventory=Explorer-Inventory (Shell @($unknown))
$plan=Folder-OpenPlan $inventory $testPath
Assert (!$inventory.complete -and $inventory.rows[0].window_id -eq 81 -and $plan.code -eq 'folder_inventory_incomplete' -and !$plan.action_attempted) 'Unknown application identity cannot be treated as no Explorer windows.'
$results.Add('application identity failure cannot silently authorize duplicate launch')

$broken=Shell @();$broken|Add-Member ScriptMethod Windows {throw 'Mock Shell enumeration inaccessible'} -Force
$inventory=Explorer-Inventory $broken;$plan=Folder-OpenPlan $inventory $testPath
Assert (!$inventory.complete -and $plan.code -eq 'folder_inventory_incomplete' -and !$plan.action_attempted) 'Shell enumeration failure must prevent new launch.'
$results.Add('Shell enumeration failure refuses before open')

$nullShell=Shell @();$nullShell|Add-Member ScriptMethod Windows {return $null} -Force
$inventory=Explorer-Inventory $nullShell;$plan=Folder-OpenPlan $inventory $testPath
Assert (!$inventory.complete -and $plan.code -eq 'folder_inventory_incomplete' -and !$plan.action_attempted) 'Null Shell collection is not a genuinely empty inventory.'
$results.Add('null Shell collection refuses before open')

$inventory=Explorer-Inventory (Shell @());$plan=Folder-OpenPlan $inventory $testPath
Assert ($inventory.complete -and $plan.status -eq 'ready' -and !$plan.reused) 'A genuinely empty, complete inventory permits a single new-folder launch.'
$results.Add('complete empty inventory permits new-folder plan')

$other=Window 81 $otherPath;$other.FullName='C:\Program Files\Browser\browser.exe'
$inventory=Explorer-Inventory (Shell @((Window 71 $testPath),$other));$plan=Folder-OpenPlan $inventory $testPath
Assert ($inventory.complete -and $inventory.rows.Count -eq 1 -and $plan.reused) 'Identified non-Explorer windows must not poison Explorer inventory.'
$results.Add('identified non-Explorer windows are ignored')

@{passed=$results.Count;tests=@($results.ToArray());ui_operations=0}|ConvertTo-Json -Depth 4 -Compress
