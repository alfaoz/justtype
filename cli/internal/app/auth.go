package app

import (
	"fmt"
	"os/exec"
	"runtime"
	"time"

	"github.com/gdamore/tcell/v2"
	"github.com/justtype/cli/internal/auth"
	"github.com/rivo/tview"
)

func (app *App) showAuth() {
	deviceAuth := auth.NewDeviceAuth(app.apiURL)

	// Request device code
	dcr, err := deviceAuth.RequestDeviceCode()
	if err != nil {
		app.showError(fmt.Sprintf("Failed to request device code: %v", err))
		return
	}

	// Build UI
	title := tview.NewTextView().
		SetText("login").
		SetTextAlign(tview.AlignCenter).
		SetTextColor(colorPurple)
	title.SetBorder(false).SetBackgroundColor(colorBackground)

	instructions := tview.NewTextView().
		SetText("visit: " + dcr.VerificationURI).
		SetTextAlign(tview.AlignCenter).
		SetTextColor(colorForeground)
	instructions.SetBorder(false).SetBackgroundColor(colorBackground)

	code := tview.NewTextView().
		SetText(dcr.UserCode).
		SetTextAlign(tview.AlignCenter).
		SetTextColor(colorPurple)
	code.SetBorder(true).SetBackgroundColor(colorBackground)

	status := tview.NewTextView().
		SetText("● waiting for authorization...").
		SetTextAlign(tview.AlignCenter).
		SetTextColor(colorDim).
		SetDynamicColors(true)
	status.SetBorder(false).SetBackgroundColor(colorBackground)

	help := tview.NewTextView().
		SetText("o open in browser  esc cancel").
		SetTextAlign(tview.AlignCenter).
		SetTextColor(colorDim)
	help.SetBorder(false).SetBackgroundColor(colorBackground)

	content := tview.NewFlex().
		SetDirection(tview.FlexRow).
		AddItem(nil, 0, 1, false).
		AddItem(title, 1, 0, false).
		AddItem(nil, 2, 0, false).
		AddItem(instructions, 1, 0, false).
		AddItem(nil, 2, 0, false).
		AddItem(code, 3, 0, false).
		AddItem(nil, 2, 0, false).
		AddItem(status, 1, 0, false).
		AddItem(nil, 2, 0, false).
		AddItem(help, 1, 0, false).
		AddItem(nil, 0, 1, false)

	centered := tview.NewFlex().
		AddItem(nil, 0, 1, false).
		AddItem(content, 60, 0, true).
		AddItem(nil, 0, 1, false)

	centered.SetBackgroundColor(colorBackground)

	// Handle keys
	centered.SetInputCapture(func(event *tcell.EventKey) *tcell.EventKey {
		if event.Rune() == 'o' {
			openBrowser(dcr.VerificationURI)
			return nil
		}
		if event.Key() == tcell.KeyEsc {
			app.pages.SwitchToPage(PageWelcome)
			return nil
		}
		return event
	})

	app.pages.AddPage(PageAuth, centered, true, true)

	// Start polling for token in background
	go func() {
		tokenResp, err := deviceAuth.PollForToken(dcr.DeviceCode, dcr.Interval, dcr.ExpiresIn)
		if err != nil {
			app.tviewApp.QueueUpdateDraw(func() {
				status.SetText("[red]✗ " + err.Error())
			})
			return
		}

		// Success!
		app.token = tokenResp.Token
		app.username = tokenResp.Username
		app.saveConfig()

		app.tviewApp.QueueUpdateDraw(func() {
			status.SetText("[green]✓ authorized as " + tokenResp.Username)

			// Initialize storage and show editor
			if err := app.initStorage(); err != nil {
				app.showError(fmt.Sprintf("Failed to initialize storage: %v", err))
				return
			}

			// Wait a moment for user to see success message
			go func() {
				time.Sleep(1 * time.Second)
				app.tviewApp.QueueUpdateDraw(func() {
					app.showEditor(nil)
				})
			}()
		})
	}()
}

func openBrowser(url string) {
	var cmd *exec.Cmd

	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "linux":
		cmd = exec.Command("xdg-open", url)
	default:
		return
	}

	cmd.Start()
}
