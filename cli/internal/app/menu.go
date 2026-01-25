package app

import (
	"github.com/gdamore/tcell/v2"
	"github.com/rivo/tview"
)

func (app *App) showMenu() {
	list := tview.NewList().
		AddItem("new", "", 'n', func() {
			app.pages.RemovePage("menu")
			app.currentSlate = nil
			app.showEditor(nil)
		}).
		AddItem("all slates", "", 'a', func() {
			app.pages.RemovePage("menu")
			app.showSlates()
		}).
		AddItem("settings", "", 's', func() {
			app.pages.RemovePage("menu")
			app.showSettings()
		}).
		AddItem("quit", "", 'q', func() {
			app.Close()
			app.tviewApp.Stop()
		})

	list.SetBorder(true).
		SetTitle(" menu ").
		SetTitleAlign(tview.AlignLeft).
		SetBackgroundColor(colorBackground)

	// Handle keys
	list.SetInputCapture(func(event *tcell.EventKey) *tcell.EventKey {
		if event.Key() == tcell.KeyEsc {
			app.pages.RemovePage("menu")
			app.tviewApp.SetFocus(app.editor)
			return nil
		}
		return event
	})

	// Center the menu
	centered := tview.NewFlex().
		AddItem(nil, 0, 1, false).
		AddItem(tview.NewFlex().SetDirection(tview.FlexRow).
			AddItem(nil, 0, 1, false).
			AddItem(list, 10, 0, true).
			AddItem(nil, 0, 1, false), 40, 0, true).
		AddItem(nil, 0, 1, false)

	centered.SetBackgroundColor(tcell.ColorDefault)

	app.pages.AddPage("menu", centered, true, true)
	app.tviewApp.SetFocus(list)
}
