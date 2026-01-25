package app

import (
	"fmt"
	"time"

	"github.com/gdamore/tcell/v2"
	"github.com/justtype/cli/internal/storage"
	"github.com/rivo/tview"
)

func (app *App) showEditor(slate *storage.Slate) {
	if slate != nil {
		app.currentSlate = slate
	}

	// Create or reuse editor
	if app.editor == nil {
		app.editor = tview.NewTextArea()
		app.editor.SetBackgroundColor(colorBackground)
		app.editor.SetPlaceholder("start writing...")

		// On text change, trigger auto-save
		app.editor.SetChangedFunc(func() {
			app.isDirty = true
			app.scheduleAutoSave()
		})
	}

	// Load content
	if app.currentSlate != nil {
		app.editor.SetText(app.currentSlate.Content, true)
	} else {
		app.editor.SetText("", true)
	}

	// Build layout with centered textarea
	footer := tview.NewTextView().
		SetDynamicColors(true).
		SetTextAlign(tview.AlignCenter)
	footer.SetBackgroundColor(colorBackground)

	// Update footer text
	app.updateFooter(footer)

	// Refresh footer periodically
	go func() {
		ticker := time.NewTicker(1 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			app.tviewApp.QueueUpdateDraw(func() {
				app.updateFooter(footer)
			})
		}
	}()

	// Main flex layout
	editorWrapper := tview.NewFlex().
		SetDirection(tview.FlexRow).
		AddItem(app.editor, 0, 1, true).
		AddItem(footer, 1, 0, false)

	// Center horizontally
	centered := tview.NewFlex().
		AddItem(nil, 0, 1, false).
		AddItem(editorWrapper, 100, 0, true).
		AddItem(nil, 0, 1, false)

	centered.SetBackgroundColor(colorBackground)

	// Handle global keys
	app.editor.SetInputCapture(func(event *tcell.EventKey) *tcell.EventKey {
		// Esc opens menu
		if event.Key() == tcell.KeyEsc {
			app.saveNow()
			app.showMenu()
			return nil
		}

		// Ctrl+S force save
		if event.Key() == tcell.KeyCtrlS {
			app.saveNow()
			return nil
		}

		return event
	})

	app.pages.AddAndSwitchToPage(PageEditor, centered, true)
	app.tviewApp.SetFocus(app.editor)
}

func (app *App) updateFooter(footer *tview.TextView) {
	content := app.editor.GetText()
	words := storage.CountWords(content)

	var parts []string

	// Word count
	parts = append(parts, fmt.Sprintf("[#666666]%d words[-]", words))

	// Mode indicator
	if app.isCloud {
		parts = append(parts, fmt.Sprintf("[#666666]%s[-]", app.username))
	} else {
		parts = append(parts, "[#666666]local[-]")
	}

	// Help
	parts = append(parts, "[#666666]esc menu[-]")

	footer.SetText(joinParts(parts))
}

func (app *App) scheduleAutoSave() {
	if app.saveTimer != nil {
		app.saveTimer.Stop()
	}

	app.saveTimer = time.AfterFunc(1*time.Second, func() {
		app.tviewApp.QueueUpdateDraw(func() {
			app.saveNow()
		})
	})
}

func (app *App) saveNow() {
	if !app.isDirty {
		return
	}

	content := app.editor.GetText()
	if content == "" {
		return
	}

	if app.currentSlate == nil {
		app.currentSlate = &storage.Slate{
			Content: content,
		}
	} else {
		app.currentSlate.Content = content
	}

	if app.storage != nil {
		app.storage.Save(app.currentSlate)
	}

	app.isDirty = false

	// Refresh slates list
	if app.storage != nil {
		slates, _ := app.storage.List()
		app.slates = slates
	}
}

func joinParts(parts []string) string {
	result := ""
	for i, part := range parts {
		if i > 0 {
			result += "  [#666666]·[-]  "
		}
		result += part
	}
	return result
}
