package app

import (
	"fmt"
	"time"

	"github.com/gdamore/tcell/v2"
	"github.com/justtype/cli/internal/storage"
	"github.com/rivo/tview"
)

func (app *App) showEditor(slate *storage.Slate) {
	// Set current slate (nil means new blank slate)
	app.currentSlate = slate
	app.isDirty = false
	app.saveStatus = ""

	// Create or reuse editor
	if app.editor == nil {
		app.editor = tview.NewTextArea()
		app.editor.SetBackgroundColor(colorBackground)
		app.editor.SetPlaceholder("start writing...")

		// Set text style to prevent highlighting
		style := tcell.StyleDefault.
			Background(colorBackground).
			Foreground(colorForeground)
		app.editor.SetTextStyle(style)

		// Set selected style to same as normal text (no visible selection)
		app.editor.SetSelectedStyle(style)

		// Set placeholder style
		placeholderStyle := tcell.StyleDefault.
			Background(colorBackground).
			Foreground(colorDim)
		app.editor.SetPlaceholderStyle(placeholderStyle)

		// On text change, trigger auto-save
		app.editor.SetChangedFunc(func() {
			app.isDirty = true
			app.saveStatus = ""
			app.scheduleAutoSave()
		})
	}

	// Load content
	if app.currentSlate != nil {
		app.editor.SetText(app.currentSlate.Content, true)
		app.saveStatus = "saved"
	} else {
		app.editor.SetText("", true)
		app.saveStatus = ""
	}

	// Header showing account
	header := tview.NewTextView().
		SetDynamicColors(true).
		SetTextAlign(tview.AlignCenter)
	header.SetBackgroundColor(colorBackground)
	app.updateHeader(header)

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
		AddItem(header, 1, 0, false).
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
		// Esc opens quit menu
		if event.Key() == tcell.KeyEsc {
			app.showQuitMenu()
			return nil
		}

		// Ctrl+K opens command palette
		if event.Key() == tcell.KeyCtrlK {
			app.saveNow()
			app.showCommandPalette()
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

func (app *App) updateHeader(header *tview.TextView) {
	if app.isCloud && app.username != "" {
		header.SetText(fmt.Sprintf("[#8B5CF6]hey, %s[-]", app.username))
	} else {
		header.SetText("")
	}
}

func (app *App) updateFooter(footer *tview.TextView) {
	content := app.editor.GetText()
	words := storage.CountWords(content)

	var parts []string

	// Word count
	parts = append(parts, fmt.Sprintf("[#666666]%d words[-]", words))

	// Save status
	if app.saveStatus != "" {
		color := "#666666"
		if app.saveStatus == "saving..." {
			color = "#8B5CF6" // purple
		} else if app.saveStatus == "saved" {
			color = "#10B981" // green
		}
		parts = append(parts, fmt.Sprintf("[%s]%s[-]", color, app.saveStatus))
	}

	// Mode indicator
	if app.isCloud {
		parts = append(parts, "[#666666]cloud[-]")
	} else {
		parts = append(parts, "[#666666]local[-]")
	}

	// Help
	parts = append(parts, "[#666666]esc quit · ctrl+k commands[-]")

	footer.SetText(joinParts(parts))
}

func (app *App) scheduleAutoSave() {
	if app.saveTimer != nil {
		app.saveTimer.Stop()
	}

	// Show "saving..." immediately
	app.saveStatus = "saving..."

	app.saveTimer = time.AfterFunc(2*time.Second, func() {
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
		app.isDirty = false
		app.saveStatus = ""
		return
	}

	// For new slates, require minimum 10 words before creating
	if app.currentSlate == nil {
		words := storage.CountWords(content)
		if words < 10 {
			app.isDirty = false
			app.saveStatus = ""
			return
		}
	}

	// Show "saving..." status
	app.saveStatus = "saving..."

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
	app.saveStatus = "saved"

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
