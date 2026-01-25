package app

import (
	"github.com/gdamore/tcell/v2"
	"github.com/rivo/tview"
)

type Command struct {
	Label       string
	Description string
	Action      func()
}

func (app *App) showCommandPalette() {
	commands := []Command{
		{
			Label:       "new slate",
			Description: "create a new slate",
			Action: func() {
				app.pages.RemovePage("command_palette")
				app.currentSlate = nil
				app.showEditor(nil)
			},
		},
		{
			Label:       "all slates",
			Description: "view and manage all slates",
			Action: func() {
				app.pages.RemovePage("command_palette")
				app.showSlates()
			},
		},
		{
			Label:       "help",
			Description: "show keyboard shortcuts",
			Action: func() {
				app.pages.RemovePage("command_palette")
				app.showHelp()
			},
		},
		{
			Label:       "save",
			Description: "save current slate",
			Action: func() {
				app.pages.RemovePage("command_palette")
				app.tviewApp.SetFocus(app.editor)
				app.saveNow()
			},
		},
		{
			Label:       "settings",
			Description: "account settings",
			Action: func() {
				app.pages.RemovePage("command_palette")
				app.showSettings()
			},
		},
	}

	list := tview.NewList()
	list.SetBorder(true).
		SetTitle(" command palette ").
		SetTitleAlign(tview.AlignLeft).
		SetBackgroundColor(colorBackground)

	for i, cmd := range commands {
		cmd := cmd // capture loop variable
		// Add keyboard shortcuts
		var shortcut rune
		switch i {
		case 0:
			shortcut = 'n'
		case 1:
			shortcut = 'a'
		case 2:
			shortcut = 'h'
		case 3:
			shortcut = 's'
		case 4:
			shortcut = 'e' // settings = 'e' for "edit settings"
		}
		list.AddItem(cmd.Label, cmd.Description, shortcut, cmd.Action)
	}

	list.SetSelectedBackgroundColor(colorPurple)
	list.SetSelectedTextColor(colorBackground)
	list.SetMainTextColor(colorForeground)
	list.SetSecondaryTextColor(colorDim)
	list.SetShortcutColor(colorPurple)

	// Handle keys
	list.SetInputCapture(func(event *tcell.EventKey) *tcell.EventKey {
		if event.Key() == tcell.KeyEsc {
			app.pages.RemovePage("command_palette")
			app.tviewApp.SetFocus(app.editor)
			return nil
		}
		return event
	})

	// Center the command palette
	centered := tview.NewFlex().
		AddItem(nil, 0, 1, false).
		AddItem(tview.NewFlex().SetDirection(tview.FlexRow).
			AddItem(nil, 0, 1, false).
			AddItem(list, 15, 0, true).
			AddItem(nil, 0, 1, false), 60, 0, true).
		AddItem(nil, 0, 1, false)

	centered.SetBackgroundColor(colorBackground)

	app.pages.AddAndSwitchToPage("command_palette", centered, true)
	app.tviewApp.SetFocus(list)
}

func (app *App) showQuitMenu() {
	list := tview.NewList()
	list.SetBorder(true).
		SetTitle(" quit menu ").
		SetTitleAlign(tview.AlignLeft).
		SetBackgroundColor(colorBackground)

	// Add logout option if cloud mode
	if app.isCloud {
		list.AddItem("logout", "switch to local storage", 'l', func() {
			app.pages.RemovePage("quit_menu")
			app.confirmLogout()
		})
	}

	list.AddItem("quit", "exit justtype", 'q', func() {
		app.pages.RemovePage("quit_menu")
		app.confirmQuit()
	}).
		AddItem("cancel", "back to editor", 'c', func() {
			app.pages.RemovePage("quit_menu")
			app.tviewApp.SetFocus(app.editor)
		})

	list.SetSelectedBackgroundColor(colorPurple)
	list.SetSelectedTextColor(colorBackground)
	list.SetMainTextColor(colorForeground)
	list.SetSecondaryTextColor(colorDim)
	list.SetShortcutColor(colorPurple)

	// Handle keys
	list.SetInputCapture(func(event *tcell.EventKey) *tcell.EventKey {
		if event.Key() == tcell.KeyEsc {
			app.pages.RemovePage("quit_menu")
			app.tviewApp.SetFocus(app.editor)
			return nil
		}
		return event
	})

	// Center the quit menu
	centered := tview.NewFlex().
		AddItem(nil, 0, 1, false).
		AddItem(tview.NewFlex().SetDirection(tview.FlexRow).
			AddItem(nil, 0, 1, false).
			AddItem(list, 10, 0, true).
			AddItem(nil, 0, 1, false), 60, 0, true).
		AddItem(nil, 0, 1, false)

	centered.SetBackgroundColor(colorBackground)

	app.pages.AddAndSwitchToPage("quit_menu", centered, true)
	app.tviewApp.SetFocus(list)
}

func (app *App) confirmQuit() {
	// Check for unsaved changes
	if app.isDirty {
		modal := tview.NewModal().
			SetText("you have unsaved changes. quit anyway?").
			AddButtons([]string{"Quit", "Cancel"}).
			SetDoneFunc(func(buttonIndex int, buttonLabel string) {
				app.pages.RemovePage("confirm-quit")
				if buttonIndex == 0 {
					app.Close()
					app.tviewApp.Stop()
				} else {
					app.tviewApp.SetFocus(app.editor)
				}
			})

		modal.SetBackgroundColor(colorBackground).
			SetTextColor(colorForeground).
			SetButtonBackgroundColor(colorPurple).
			SetButtonTextColor(colorForeground)

		app.pages.AddPage("confirm-quit", modal, true, true)
	} else {
		app.Close()
		app.tviewApp.Stop()
	}
}
