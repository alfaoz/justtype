package app

import (
	"fmt"
	"time"

	"github.com/gdamore/tcell/v2"
	"github.com/justtype/cli/internal/storage"
	"github.com/rivo/tview"
)

func (app *App) showSlates() {
	list := tview.NewList()
	list.ShowSecondaryText(true)

	// Fetch slates from cloud (not cached)
	if app.storage != nil {
		list.AddItem("loading slates...", "", 0, nil)

		go func() {
			slates, err := app.storage.List()
			if err != nil {
				app.tviewApp.QueueUpdateDraw(func() {
					app.showError(fmt.Sprintf("Failed to load slates: %v", err))
				})
				return
			}

			app.slates = slates

			app.tviewApp.QueueUpdateDraw(func() {
				list.Clear()
				app.populateSlatesList(list)
			})
		}()
	}

	app.populateSlatesList(list)

	list.SetBorder(true).
		SetTitle(" my slates ").
		SetTitleAlign(tview.AlignLeft).
		SetBackgroundColor(colorBackground)

	help := tview.NewTextView().
		SetText("enter open · n new · p publish · d delete · esc back").
		SetTextAlign(tview.AlignCenter).
		SetTextColor(colorDim)
	help.SetBorder(false).SetBackgroundColor(colorBackground)

	layout := tview.NewFlex().
		SetDirection(tview.FlexRow).
		AddItem(list, 0, 1, true).
		AddItem(help, 1, 0, false)

	layout.SetBackgroundColor(colorBackground)

	// Handle keys
	list.SetInputCapture(func(event *tcell.EventKey) *tcell.EventKey {
		if event.Key() == tcell.KeyEsc {
			app.showEditor(app.currentSlate)
			return nil
		}

		if event.Rune() == 'n' {
			app.showEditor(nil)
			return nil
		}

		if event.Rune() == 'd' {
			idx := list.GetCurrentItem()
			if idx >= 0 && idx < len(app.slates) {
				app.confirmDelete(app.slates[idx])
			}
			return nil
		}

		if event.Rune() == 'p' {
			idx := list.GetCurrentItem()
			if idx >= 0 && idx < len(app.slates) {
				app.handlePublish(app.slates[idx])
			}
			return nil
		}

		return event
	})

	app.pages.AddAndSwitchToPage(PageSlates, layout, true)
	app.tviewApp.SetFocus(list)
}

func (app *App) populateSlatesList(list *tview.List) {
	// Add slates to list
	for _, slate := range app.slates {
		title := slate.Title
		if title == "" {
			title = "untitled"
		}

		subtitle := fmt.Sprintf("%d words  %s", slate.WordCount, formatTimeAgo(slate.UpdatedAt))

		// Add publish status
		if slate.IsPublished {
			subtitle += "  [published]"
		}

		// Capture slate in closure
		s := slate
		list.AddItem(title, subtitle, 0, func() {
			app.showEditor(s)
		})
	}
}

func (app *App) confirmDelete(slate *storage.Slate) {
	modal := tview.NewModal().
		SetText(fmt.Sprintf("delete \"%s\"?", slate.Title)).
		AddButtons([]string{"Delete", "Cancel"}).
		SetDoneFunc(func(buttonIndex int, buttonLabel string) {
			app.pages.RemovePage("confirm-delete")
			if buttonIndex == 0 {
				// Delete
				if app.storage != nil {
					app.storage.Delete(slate.ID)
				}
				app.showSlates()
			}
		})

	modal.SetBackgroundColor(colorBackground).
		SetTextColor(colorForeground).
		SetButtonBackgroundColor(colorPurple).
		SetButtonTextColor(colorForeground)

	app.pages.AddPage("confirm-delete", modal, true, true)
}

func (app *App) handlePublish(slate *storage.Slate) {
	// Only works with cloud storage
	cs, ok := app.storage.(*storage.CloudStorage)
	if !ok {
		modal := tview.NewModal().
			SetText("Publishing requires cloud sync.\n\nPlease login to publish slates.").
			AddButtons([]string{"OK"}).
			SetDoneFunc(func(buttonIndex int, buttonLabel string) {
				app.pages.RemovePage("publish-error")
			}).
			SetBackgroundColor(colorBackground).
			SetTextColor(colorForeground).
			SetButtonBackgroundColor(colorPurple).
			SetButtonTextColor(colorForeground)

		app.pages.AddPage("publish-error", modal, true, true)
		return
	}

	if slate.IsPublished {
		// Unpublish
		modal := tview.NewModal().
			SetText(fmt.Sprintf("unpublish \"%s\"?", slate.Title)).
			AddButtons([]string{"Unpublish", "Cancel"}).
			SetDoneFunc(func(buttonIndex int, buttonLabel string) {
				app.pages.RemovePage("confirm-unpublish")
				if buttonIndex == 0 {
					go func() {
						if err := cs.Unpublish(slate); err != nil {
							app.tviewApp.QueueUpdateDraw(func() {
								app.showError(fmt.Sprintf("Failed to unpublish: %v", err))
							})
							return
						}
						app.tviewApp.QueueUpdateDraw(func() {
							app.showSlates()
						})
					}()
				}
			}).
			SetBackgroundColor(colorBackground).
			SetTextColor(colorForeground).
			SetButtonBackgroundColor(colorPurple).
			SetButtonTextColor(colorForeground)

		app.pages.AddPage("confirm-unpublish", modal, true, true)
	} else {
		// Publish
		go func() {
			shareURL, err := cs.Publish(slate)
			if err != nil {
				app.tviewApp.QueueUpdateDraw(func() {
					// Check if session expired
					if err.Error() == "SESSION_EXPIRED" {
						modal := tview.NewModal().
							SetText("Session expired. Re-login to continue?").
							AddButtons([]string{"Re-login", "Cancel"}).
							SetDoneFunc(func(buttonIndex int, buttonLabel string) {
								app.pages.RemovePage("session-expired")
								if buttonIndex == 0 {
									// Re-login
									app.showAuth()
								}
							}).
							SetBackgroundColor(colorBackground).
							SetTextColor(colorForeground).
							SetButtonBackgroundColor(colorPurple).
							SetButtonTextColor(colorForeground)

						app.pages.AddPage("session-expired", modal, true, true)
					} else {
						app.showError(fmt.Sprintf("Failed to publish: %v", err))
					}
				})
				return
			}

			app.tviewApp.QueueUpdateDraw(func() {
				modal := tview.NewModal().
					SetText(fmt.Sprintf("Published!\n\n%s", shareURL)).
					AddButtons([]string{"OK"}).
					SetDoneFunc(func(buttonIndex int, buttonLabel string) {
						app.pages.RemovePage("publish-success")
						app.showSlates()
					}).
					SetBackgroundColor(colorBackground).
					SetTextColor(colorGreen).
					SetButtonBackgroundColor(colorPurple).
					SetButtonTextColor(colorForeground)

				app.pages.AddPage("publish-success", modal, true, true)
			})
		}()
	}
}

func formatTimeAgo(t time.Time) string {
	diff := time.Since(t)

	if diff < time.Minute {
		return "just now"
	}
	if diff < time.Hour {
		mins := int(diff.Minutes())
		if mins == 1 {
			return "1 min ago"
		}
		return fmt.Sprintf("%d mins ago", mins)
	}
	if diff < 24*time.Hour {
		hours := int(diff.Hours())
		if hours == 1 {
			return "1h ago"
		}
		return fmt.Sprintf("%dh ago", hours)
	}
	if diff < 48*time.Hour {
		return "yesterday"
	}
	days := int(diff.Hours() / 24)
	if days < 7 {
		return fmt.Sprintf("%dd ago", days)
	}
	if days < 30 {
		weeks := days / 7
		return fmt.Sprintf("%dw ago", weeks)
	}
	return t.Format("Jan 2")
}
