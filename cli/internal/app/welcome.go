package app

import (
	"fmt"
	"os"

	"github.com/gdamore/tcell/v2"
	"github.com/rivo/tview"
)

func (app *App) showWelcome() {
	logo := `
     ╦╦ ╦╔═╗╔╦╗╔╦╗╦ ╦╔═╗╔═╗
     ║║ ║╚═╗ ║  ║ ╚╦╝╠═╝║╣
    ╚╝╚═╝╚═╝ ╩  ╩  ╩ ╩  ╚═╝
`

	subtitle := "distraction-free writing"

	list := tview.NewList().
		AddItem("write locally", "store slates in ~/.justtype", 'l', func() {
			app.setupLocal()
		}).
		AddItem("login to sync across devices", "sync with justtype.io", 's', func() {
			app.showAuth()
		})

	list.SetBorder(false).SetBackgroundColor(colorBackground)

	// Create centered layout
	logoText := tview.NewTextView().
		SetText(logo).
		SetTextAlign(tview.AlignCenter).
		SetTextColor(colorPurple)
	logoText.SetBorder(false).SetBackgroundColor(colorBackground)

	subtitleText := tview.NewTextView().
		SetText(subtitle).
		SetTextAlign(tview.AlignCenter).
		SetTextColor(colorDim)
	subtitleText.SetBorder(false).SetBackgroundColor(colorBackground)

	help := tview.NewTextView().
		SetText("↑/↓ select  enter confirm  q quit").
		SetTextAlign(tview.AlignCenter).
		SetTextColor(colorDim)
	help.SetBorder(false).SetBackgroundColor(colorBackground)

	content := tview.NewFlex().
		SetDirection(tview.FlexRow).
		AddItem(nil, 0, 1, false).
		AddItem(logoText, 4, 0, false).
		AddItem(subtitleText, 1, 0, false).
		AddItem(nil, 2, 0, false).
		AddItem(list, 4, 0, true).
		AddItem(nil, 2, 0, false).
		AddItem(help, 1, 0, false).
		AddItem(nil, 0, 1, false)

	centered := tview.NewFlex().
		AddItem(nil, 0, 1, false).
		AddItem(content, 60, 0, true).
		AddItem(nil, 0, 1, false)

	centered.SetBackgroundColor(colorBackground)

	// Handle global keys
	centered.SetInputCapture(func(event *tcell.EventKey) *tcell.EventKey {
		if event.Rune() == 'q' || event.Key() == tcell.KeyEsc {
			app.tviewApp.Stop()
			return nil
		}
		return event
	})

	app.pages.AddPage(PageWelcome, centered, true, true)
}

func (app *App) setupLocal() {
	var storageField *tview.InputField

	// Show input for storage path
	form := tview.NewForm()

	storageField = tview.NewInputField().
		SetLabel("Storage path").
		SetText(app.getDefaultStoragePath()).
		SetFieldWidth(50)

	form.AddFormItem(storageField)

	form.AddButton("Confirm", func() {
		path := storageField.GetText()

		// Expand ~
		if len(path) >= 2 && path[:2] == "~/" {
			homeDir, _ := os.UserHomeDir()
			path = homeDir + path[1:]
		}

		app.storagePath = path
		app.saveConfig()

		if err := app.initStorage(); err != nil {
			app.showError(fmt.Sprintf("Failed to initialize storage: %v", err))
			return
		}

		app.showEditor(nil)
	})

	form.AddButton("Cancel", func() {
		app.showWelcome()
	})

	form.SetBorder(true).
		SetTitle(" local storage ").
		SetTitleAlign(tview.AlignLeft).
		SetBackgroundColor(colorBackground)

	centered := tview.NewFlex().
		AddItem(nil, 0, 1, false).
		AddItem(tview.NewFlex().SetDirection(tview.FlexRow).
			AddItem(nil, 0, 1, false).
			AddItem(form, 10, 0, true).
			AddItem(nil, 0, 1, false), 60, 0, true).
		AddItem(nil, 0, 1, false)

	centered.SetBackgroundColor(colorBackground)

	app.pages.AddPage("setup-local", centered, true, true)
}

func (app *App) showError(message string) {
	modal := tview.NewModal().
		SetText(message).
		AddButtons([]string{"OK"}).
		SetDoneFunc(func(buttonIndex int, buttonLabel string) {
			app.pages.RemovePage("error")
		})

	modal.SetBackgroundColor(colorBackground).
		SetTextColor(colorForeground).
		SetButtonBackgroundColor(colorPurple).
		SetButtonTextColor(colorForeground)

	app.pages.AddPage("error", modal, true, true)
}
