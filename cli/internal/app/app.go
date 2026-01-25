package app

import (
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/gdamore/tcell/v2"
	"github.com/justtype/cli/internal/storage"
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

func (app *App) loadConfig() {
	// TODO: Load from config file
	// For now, check environment or defaults
}

func (app *App) saveConfig() {
	homeDir, _ := os.UserHomeDir()
	configDir := filepath.Join(homeDir, ".justtype")
	os.MkdirAll(configDir, 0755)

	// TODO: Save config to file
}

func (app *App) getDefaultStoragePath() string {
	homeDir, _ := os.UserHomeDir()
	return filepath.Join(homeDir, ".justtype")
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
