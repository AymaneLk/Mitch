param([string]$OutputFile)
Add-Type -AssemblyName System.Windows.Forms
$form=New-Object System.Windows.Forms.Form
$form.Text='Companion Accessibility Test Fixture'
$form.Size=New-Object System.Drawing.Size(430,230)
$form.StartPosition='CenterScreen'
$form.Add_Shown({$form.Show();$form.Activate()})
$edit=New-Object System.Windows.Forms.TextBox
$edit.AccessibleName='Test input'
$edit.Location=New-Object System.Drawing.Point(20,20)
$edit.Width=350
$form.Controls.Add($edit)
$password=New-Object System.Windows.Forms.TextBox
$password.AccessibleName='Protected input'
$password.UseSystemPasswordChar=$true
$password.Text='not-a-real-secret'
$password.Location=New-Object System.Drawing.Point(20,60)
$password.Width=350
$form.Controls.Add($password)
$button=New-Object System.Windows.Forms.Button
$button.Text='Confirm test'
$button.Location=New-Object System.Drawing.Point(20,100)
$button.Width=130
$button.Add_Click({[IO.File]::WriteAllText($OutputFile,$edit.Text,[Text.Encoding]::UTF8)})
$form.Controls.Add($button)
$timer=New-Object System.Windows.Forms.Timer
$timer.Interval=90000
$timer.Add_Tick({$form.Close()})
$timer.Start()
[System.Windows.Forms.Application]::Run($form)
