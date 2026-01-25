package app

import (
	"github.com/gdamore/tcell/v2"
	"github.com/justtype/cli/internal/updater"
	"github.com/rivo/tview"
)

func (app *App) showHelp() {
	helpText := `[purple]justtype cli v` + updater.GetVersion() + `[-]

[white]editor[-]
  ctrl+k        command palette
  esc           open menu
  ctrl+s        force save

[white]menu[-]
  n             new slate
  a             all slates
  s             settings
  h             help
  q             quit
  esc           back to editor

[white]all slates[-]
  enter         open slate
  n             new slate
  p             publish/unpublish
  d             delete slate
  esc           back to editor

[white]help screen[-]
  esc           back to editor
  q             back to menu

[white]workflow[-]
  1. write in editor (auto-saves after 1 second)
  2. press esc → all slates
  3. select your slate → press p to publish
  4. copy share URL from modal

[dim]local mode: publishing requires cloud sync[-]`

	textView := tview.NewTextView().
		SetText(helpText).
		SetDynamicColors(true).
		SetTextAlign(tview.AlignLeft)

	textView.SetBorder(true).
		SetTitle(" help ").
		SetTitleAlign(tview.AlignLeft).
		SetBackgroundColor(colorBackground)

	// Handle keys
	textView.SetInputCapture(func(event *tcell.EventKey) *tcell.EventKey {
		if event.Key() == tcell.KeyEsc {
			app.pages.RemovePage("help")
			app.tviewApp.SetFocus(app.editor)
			return nil
		}
		if event.Rune() == 'q' {
			app.pages.RemovePage("help")
			app.showMenu()
			return nil
		}
		return event
	})

	// Center the help
	centered := tview.NewFlex().
		AddItem(nil, 0, 1, false).
		AddItem(tview.NewFlex().SetDirection(tview.FlexRow).
			AddItem(nil, 0, 1, false).
			AddItem(textView, 30, 0, true).
			AddItem(nil, 0, 1, false), 60, 0, true).
		AddItem(nil, 0, 1, false)

	centered.SetBackgroundColor(colorBackground)

	app.pages.AddAndSwitchToPage("help", centered, true)
	app.tviewApp.SetFocus(textView)
}
