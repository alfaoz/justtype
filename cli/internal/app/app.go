package app

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gdamore/tcell/v2"
	"github.com/justtype/cli/internal/storage"
	"github.com/justtype/cli/internal/updater"
	"github.com/rivo/tview"
)

const (
	PageWelcome  = "welcome"
	PageAuth     = "auth"
	PageEditor   = "editor"
	PageSlates   = "slates"
	PageSettings = "settings"
)

type App struct {
	tviewApp *tview.Application
	pages    *tview.Pages

	// Storage
	storage     storage.Storage
	storagePath string
	isCloud     bool

	// Auth
	token    string
	username string
	apiURL   string

	// Current state
	currentSlate *storage.Slate
	slates       []*storage.Slate

	// Auto-save
	saveTimer *time.Timer
	isDirty   bool

	// UI components (created on demand)
	editor       *tview.TextArea
	menuModal    *tview.Modal
	slatesList   *tview.List
	settingsList *tview.List
}

func New() *App {
	// Set tview theme to match our color scheme
	tview.Styles = tview.Theme{
		PrimitiveBackgroundColor:    colorBackground,
		ContrastBackgroundColor:     colorBackground,
		MoreContrastBackgroundColor: colorBackground,
		BorderColor:                 colorDim,
		TitleColor:                  colorPurple,
		GraphicsColor:               colorForeground,
		PrimaryTextColor:            colorForeground,
		SecondaryTextColor:          colorDim,
		TertiaryTextColor:           colorPurple,
		InverseTextColor:            colorBackground,
		ContrastSecondaryTextColor:  colorDim,
	}

	app := &App{
		tviewApp: tview.NewApplication(),
		pages:    tview.NewPages(),
		apiURL:   "https://justtype.io",
	}

	// Load config
	app.loadConfig()

	return app
}

func (app *App) Run() error {
	// Check for updates in background (non-blocking)
	go app.checkAndUpdate()

	// Check if first run
	if app.token == "" && app.storagePath == "" {
		// First run - show welcome
		app.showWelcome()
	} else {
		// Initialize storage
		if err := app.initStorage(); err != nil {
			return fmt.Errorf("failed to initialize storage: %w", err)
		}

		// Go straight to editor
		app.showEditor(nil)
	}

	return app.tviewApp.SetRoot(app.pages, true).Run()
}

func (app *App) initStorage() error {
	if app.token != "" {
		// Cloud storage
		storagePath := app.getDefaultStoragePath()
		cloud, err := storage.NewCloud(storagePath, app.apiURL, app.token, app.username)
		if err != nil {
			return err
		}
		app.storage = cloud
		app.storagePath = storagePath
		app.isCloud = true
	} else if app.storagePath != "" {
		// Local storage
		local, err := storage.NewLocal(app.storagePath)
		if err != nil {
			return err
		}
		app.storage = local
		app.isCloud = false
	} else {
		return fmt.Errorf("no storage configured")
	}

	// Load slates
	slates, err := app.storage.List()
	if err != nil {
		return err
	}
	app.slates = slates

	// Load most recent slate
	if len(app.slates) > 0 {
		app.currentSlate = app.slates[0]
	}

	return nil
}

type Config struct {
	Token       string `json:"token"`
	Username    string `json:"username"`
	StoragePath string `json:"storage_path"`
}

func (app *App) getConfigPath() string {
	homeDir, _ := os.UserHomeDir()
	return filepath.Join(homeDir, ".justtype", "config.json")
}

func (app *App) loadConfig() {
	configPath := app.getConfigPath()
	data, err := os.ReadFile(configPath)
	if err != nil {
		// Config doesn't exist yet, that's fine
		return
	}

	var config Config
	if err := json.Unmarshal(data, &config); err != nil {
		// Invalid config, ignore
		return
	}

	app.token = config.Token
	app.username = config.Username
	app.storagePath = config.StoragePath
}

func (app *App) saveConfig() {
	homeDir, _ := os.UserHomeDir()
	configDir := filepath.Join(homeDir, ".justtype")
	os.MkdirAll(configDir, 0755)

	config := Config{
		Token:       app.token,
		Username:    app.username,
		StoragePath: app.storagePath,
	}

	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return
	}

	os.WriteFile(app.getConfigPath(), data, 0600)
}

func (app *App) getDefaultStoragePath() string {
	homeDir, _ := os.UserHomeDir()
	return filepath.Join(homeDir, ".justtype")
}

func (app *App) checkAndUpdate() {
	// Wait for UI to be ready
	time.Sleep(500 * time.Millisecond)

	// Check for updates
	info, err := updater.CheckForUpdate()
	if err != nil {
		// Fail silently - don't interrupt user experience
		return
	}

	if !info.Available {
		// Already up to date
		return
	}

	// Show update notification
	app.tviewApp.QueueUpdateDraw(func() {
		modal := tview.NewModal().
			SetText(fmt.Sprintf("Update available: %s → %s\n\nUpdating now...", info.CurrentVersion, info.LatestVersion)).
			SetBackgroundColor(colorBackground).
			SetTextColor(colorForeground)

		app.pages.AddPage("update", modal, true, true)
	})

	// Perform update
	if err := updater.Update(); err != nil {
		// Check if it's a permission error
		errMsg := err.Error()
		var message string
		if strings.Contains(errMsg, "permission denied") {
			message = fmt.Sprintf("Update available: %s → %s\n\nCan't auto-update (permission denied).\n\nRun this command to update:\ncurl -fsSL https://justtype.io/cli/install.sh | bash", info.CurrentVersion, info.LatestVersion)
		} else {
			message = fmt.Sprintf("Update failed: %v\n\nRun this command to update:\ncurl -fsSL https://justtype.io/cli/install.sh | bash", err)
		}

		// Show error
		app.tviewApp.QueueUpdateDraw(func() {
			app.pages.RemovePage("update")
			errorModal := tview.NewModal().
				SetText(message).
				AddButtons([]string{"OK"}).
				SetDoneFunc(func(buttonIndex int, buttonLabel string) {
					app.pages.RemovePage("update-error")
				}).
				SetBackgroundColor(colorBackground).
				SetTextColor(colorForeground).
				SetButtonBackgroundColor(colorPurple).
				SetButtonTextColor(colorForeground)

			app.pages.AddPage("update-error", errorModal, true, true)
		})
		return
	}

	// Update successful - show message and exit
	app.tviewApp.QueueUpdateDraw(func() {
		app.pages.RemovePage("update")
		successModal := tview.NewModal().
			SetText(fmt.Sprintf("Updated to %s!\n\nPlease restart justtype.", info.LatestVersion)).
			AddButtons([]string{"Quit"}).
			SetDoneFunc(func(buttonIndex int, buttonLabel string) {
				app.tviewApp.Stop()
			}).
			SetBackgroundColor(colorBackground).
			SetTextColor(colorGreen).
			SetButtonBackgroundColor(colorPurple).
			SetButtonTextColor(colorForeground)

		app.pages.AddPage("update-success", successModal, true, true)
	})
}

func (app *App) Close() {
	if app.storage != nil {
		app.storage.Close()
	}
}

// Theme colors
var (
	colorBackground = tcell.NewRGBColor(17, 17, 17)    // #111111
	colorForeground = tcell.NewRGBColor(212, 212, 212) // #d4d4d4
	colorDim        = tcell.NewRGBColor(102, 102, 102) // #666666
	colorPurple     = tcell.NewRGBColor(139, 92, 246)  // #8B5CF6
	colorGreen      = tcell.NewRGBColor(16, 185, 129)  // #10B981
)
