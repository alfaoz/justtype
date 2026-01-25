package app

import (
	"fmt"

	"github.com/gdamore/tcell/v2"
	"github.com/rivo/tview"
)

func (app *App) showSettings() {
	// Build settings info
	var info string
	if app.isCloud {
		info = fmt.Sprintf("signed in as: %s\nstorage: cloud (cached locally)\n\n[#666666]more settings available at justtype.io[-]", app.username)
	} else {
		info = fmt.Sprintf("storage: %s\n\n[#666666]more settings available at justtype.io[-]", app.storagePath)
	}

	infoView := tview.NewTextView().
		SetText(info).
		SetDynamicColors(true).
		SetTextColor(colorForeground)
	infoView.SetBorder(false).SetBackgroundColor(colorBackground)

	list := tview.NewList()

	// Options depend on mode
	if app.isCloud {
		list.AddItem("logout", "", 'l', func() {
			app.confirmLogout()
		})
	} else {
		list.AddItem("change storage location", "", 'c', func() {
			app.setupLocal()
		}).
			AddItem("login to sync", "", 'l', func() {
				app.showAuth()
			})
	}

	list.AddItem("back", "", 'b', func() {
		app.showEditor(app.currentSlate)
	})

	list.SetBorder(false).
		SetBackgroundColor(colorBackground)

	layout := tview.NewFlex().
		SetDirection(tview.FlexRow).
		AddItem(nil, 1, 0, false).
		AddItem(infoView, 3, 0, false).
		AddItem(nil, 2, 0, false).
		AddItem(list, 0, 1, true)

	layout.SetBorder(true).
		SetTitle(" settings ").
		SetTitleAlign(tview.AlignLeft).
		SetBackgroundColor(colorBackground)

	// Handle keys
	list.SetInputCapture(func(event *tcell.EventKey) *tcell.EventKey {
		if event.Key() == tcell.KeyEsc {
			app.showEditor(app.currentSlate)
			return nil
		}
		return event
	})

	app.pages.AddAndSwitchToPage(PageSettings, layout, true)
	app.tviewApp.SetFocus(list)
}

func (app *App) confirmLogout() {
	modal := tview.NewModal().
		SetText("logout and switch to local storage?").
		AddButtons([]string{"Logout", "Cancel"}).
		SetDoneFunc(func(buttonIndex int, buttonLabel string) {
			app.pages.RemovePage("confirm-logout")
			if buttonIndex == 0 {
				// Logout
				app.Close()
				app.token = ""
				app.username = ""
				app.isCloud = false
				app.storage = nil
				app.saveConfig()
				app.setupLocal()
			}
		})

	modal.SetBackgroundColor(colorBackground).
		SetTextColor(colorForeground).
		SetButtonBackgroundColor(colorPurple).
		SetButtonTextColor(colorForeground)

	app.pages.AddPage("confirm-logout", modal, true, true)
}
