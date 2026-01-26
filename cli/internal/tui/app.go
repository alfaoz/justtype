package tui

import (
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/spinner"
	"github.com/charmbracelet/bubbles/textarea"
	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"

	"github.com/justtype/cli/internal/api"
	"github.com/justtype/cli/internal/config"
	"github.com/justtype/cli/internal/store"
	"github.com/justtype/cli/internal/updater"
)

type View int

const (
	ViewWelcome View = iota
	ViewLogin
	ViewRegister
	ViewEditor
	ViewSlates
	ViewMenu
	ViewSettings
	ViewExport
	ViewConfirm
)

// Mode represents whether user is in local or account mode
type Mode int

const (
	ModeUnset Mode = iota
	ModeLocal
	ModeAccount
)

type Model struct {
	// Window
	width  int
	height int

	// Navigation
	view         View
	previousView View
	selected     int
	mode         Mode

	// Core data
	config *config.Config
	store  *store.Store
	client *api.Client
	slates []*store.Slate

	// Current slate being edited
	currentSlate *store.Slate

	// Built-in editor
	titleInput textinput.Model
	textarea   textarea.Model
	lastSave   time.Time
	autoSaveTimer *time.Timer

	// Login/Register inputs
	usernameInput textinput.Model
	passwordInput textinput.Model
	emailInput    textinput.Model
	inputFocus    int

	// Export
	exportInput textinput.Model

	// Search
	searchInput textinput.Model
	searching   bool

	// UI state
	spinner       spinner.Model
	loading       bool
	loadingMsg    string
	statusMsg     string
	statusTime    time.Time
	errorMsg      string
	confirmMsg    string
	confirmAction func()

	// Login state
	loginError string

	// Update state
	updateAvailable bool
	latestVersion   string
}

// Messages
type (
	updateCheckMsg struct {
		available bool
		version   string
		err       error
	}
	cloudSyncMsg struct {
		slates []*store.Slate
		err    error
	}
	cloudSaveMsg struct {
		slateID string
		cloudID int
		err     error
	}
	loginResultMsg struct {
		success  bool
		username string
		token    string
		err      error
	}
	registerResultMsg struct {
		success  bool
		username string
		token    string
		err      error
	}
	autoSaveMsg struct{}
)

func NewModel() (*Model, error) {
	cfg, err := config.Load()
	if err != nil {
		return nil, err
	}

	st, err := store.New()
	if err != nil {
		return nil, err
	}

	client := api.New(cfg.APIURL, cfg.Token)

	// Title input for editor
	ti := textinput.New()
	ti.Placeholder = "untitled"
	ti.CharLimit = 200
	ti.Width = 60

	// Main textarea for writing
	ta := textarea.New()
	ta.Placeholder = "start writing..."
	ta.ShowLineNumbers = false
	ta.SetWidth(80)
	ta.SetHeight(20)
	ta.Focus()

	// Login inputs
	userInput := textinput.New()
	userInput.Placeholder = "username"
	userInput.CharLimit = 50
	userInput.Width = 40

	passInput := textinput.New()
	passInput.Placeholder = "password"
	passInput.EchoMode = textinput.EchoPassword
	passInput.CharLimit = 100
	passInput.Width = 40

	emailInput := textinput.New()
	emailInput.Placeholder = "email"
	emailInput.CharLimit = 100
	emailInput.Width = 40

	searchInput := textinput.New()
	searchInput.Placeholder = "search..."
	searchInput.CharLimit = 50
	searchInput.Width = 40

	exportInput := textinput.New()
	exportInput.Placeholder = "~/Documents/justtype"
	exportInput.CharLimit = 200
	exportInput.Width = 50

	s := spinner.New()
	s.Spinner = spinner.Dot
	s.Style = SpinnerStyle

	// Determine initial view and mode
	initialView := ViewWelcome
	mode := ModeUnset

	if !cfg.IsFirstRun() {
		// Already set up - go straight to editor
		if cfg.IsLoggedIn() {
			mode = ModeAccount
		} else {
			mode = ModeLocal
		}
		initialView = ViewEditor
	}

	m := &Model{
		view:          initialView,
		mode:          mode,
		config:        cfg,
		store:         st,
		client:        client,
		slates:        st.List(),
		titleInput:    ti,
		textarea:      ta,
		usernameInput: userInput,
		passwordInput: passInput,
		emailInput:    emailInput,
		searchInput:   searchInput,
		exportInput:   exportInput,
		spinner:       s,
	}

	return m, nil
}

func (m Model) Init() tea.Cmd {
	cmds := []tea.Cmd{
		tea.EnterAltScreen,
		textinput.Blink,
		textarea.Blink,
		m.spinner.Tick,
		checkForUpdate(),
	}

	// If going straight to editor, create or load a slate
	if m.view == ViewEditor {
		// Load most recent slate or create new one
		if len(m.slates) > 0 {
			m.currentSlate = m.slates[0]
		}
	}

	// If logged in, sync slates
	if m.mode == ModeAccount {
		cmds = append(cmds, m.pullCloudSlates())
	}

	return tea.Batch(cmds...)
}

func checkForUpdate() tea.Cmd {
	return func() tea.Msg {
		info, err := updater.CheckForUpdate()
		if err != nil {
			return updateCheckMsg{err: err}
		}
		return updateCheckMsg{
			available: info.Available,
			version:   info.LatestVersion,
		}
	}
}

func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmds []tea.Cmd

	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		// Update textarea size
		m.textarea.SetWidth(min(m.width-4, 100))
		m.textarea.SetHeight(m.height - 8)
		return m, nil

	case tea.KeyMsg:
		// Global quit with ctrl+c
		if msg.String() == "ctrl+c" {
			return m, tea.Quit
		}

		// Handle by view
		switch m.view {
		case ViewWelcome:
			return m.updateWelcome(msg)
		case ViewLogin:
			return m.updateLogin(msg)
		case ViewRegister:
			return m.updateRegister(msg)
		case ViewEditor:
			return m.updateEditor(msg)
		case ViewSlates:
			return m.updateSlates(msg)
		case ViewMenu:
			return m.updateMenu(msg)
		case ViewSettings:
			return m.updateSettings(msg)
		case ViewExport:
			return m.updateExport(msg)
		case ViewConfirm:
			return m.updateConfirm(msg)
		}

	case spinner.TickMsg:
		var cmd tea.Cmd
		m.spinner, cmd = m.spinner.Update(msg)
		cmds = append(cmds, cmd)

	case loginResultMsg:
		return m.handleLoginResult(msg)

	case registerResultMsg:
		return m.handleRegisterResult(msg)

	case updateCheckMsg:
		if msg.err == nil && msg.available {
			m.updateAvailable = true
			m.latestVersion = msg.version
		}
		return m, nil

	case cloudSyncMsg:
		m.loading = false
		if msg.err != nil {
			m.errorMsg = "sync failed: " + msg.err.Error()
		} else {
			for _, slate := range msg.slates {
				m.store.ImportFromCloud(slate)
			}
			m.slates = m.store.List()
			if len(msg.slates) > 0 {
				m.statusMsg = fmt.Sprintf("synced %d slates", len(msg.slates))
				m.statusTime = time.Now()
			}
		}
		return m, nil

	case cloudSaveMsg:
		if msg.err == nil && msg.cloudID > 0 {
			m.store.SetCloudID(msg.slateID, msg.cloudID)
			if m.currentSlate != nil && m.currentSlate.ID == msg.slateID {
				m.currentSlate = m.store.Get(msg.slateID)
			}
			m.statusMsg = "saved to cloud"
			m.statusTime = time.Now()
		}
		return m, nil

	case autoSaveMsg:
		return m.doAutoSave()
	}

	return m, tea.Batch(cmds...)
}

func (m Model) View() string {
	if m.width == 0 {
		return ""
	}

	switch m.view {
	case ViewWelcome:
		return m.viewWelcome()
	case ViewLogin:
		return m.viewLogin()
	case ViewRegister:
		return m.viewRegister()
	case ViewEditor:
		return m.viewEditor()
	case ViewSlates:
		return m.viewSlates()
	case ViewMenu:
		return m.viewMenu()
	case ViewSettings:
		return m.viewSettings()
	case ViewExport:
		return m.viewExport()
	case ViewConfirm:
		return m.viewConfirm()
	}

	return ""
}

// ============================================================================
// WELCOME VIEW - First time setup
// ============================================================================

func (m Model) viewWelcome() string {
	logo := `
     ╦╦ ╦╔═╗╔╦╗╔╦╗╦ ╦╔═╗╔═╗
     ║║ ║╚═╗ ║  ║ ╚╦╝╠═╝║╣
    ╚╝╚═╝╚═╝ ╩  ╩  ╩ ╩  ╚═╝`

	var b strings.Builder
	b.WriteString(LogoStyle.Render(logo) + "\n")
	b.WriteString(DimStyle.Render("        v" + updater.GetVersion()) + "\n\n")
	b.WriteString(SubtitleStyle.Render("distraction-free writing for your terminal") + "\n\n")

	options := []string{
		"use locally",
		"login to justtype.io",
		"create account",
	}
	descriptions := []string{
		"notes stored in ~/.justtype",
		"sync across devices",
		"free account",
	}

	for i, opt := range options {
		cursor := "  "
		style := MenuItemStyle
		if i == m.selected {
			cursor = CursorStyle.Render("▸ ")
			style = SelectedStyle
		}
		line := style.Render(opt)
		line += "  " + DimStyle.Render(descriptions[i])
		b.WriteString(cursor + line + "\n")
	}

	b.WriteString("\n" + HelpStyle.Render("↑/↓ select • enter confirm • q quit"))

	box := WelcomeBoxStyle.Render(b.String())
	return Centered(m.width, m.height, box)
}

func (m *Model) updateWelcome(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "up", "k":
		if m.selected > 0 {
			m.selected--
		}
	case "down", "j":
		if m.selected < 2 {
			m.selected++
		}
	case "enter":
		switch m.selected {
		case 0: // Local mode
			m.mode = ModeLocal
			m.config.CompleteFirstRun()
			m.view = ViewEditor
			m.currentSlate = nil // New slate
			m.textarea.Focus()
			return m, textarea.Blink
		case 1: // Login
			m.view = ViewLogin
			m.selected = 0
			m.usernameInput.Focus()
			return m, textinput.Blink
		case 2: // Register
			m.view = ViewRegister
			m.selected = 0
			m.usernameInput.Focus()
			return m, textinput.Blink
		}
	case "q", "esc":
		return m, tea.Quit
	}
	return m, nil
}

// ============================================================================
// LOGIN VIEW
// ============================================================================

func (m Model) viewLogin() string {
	var b strings.Builder
	b.WriteString(TitleStyle.Render(" login to justtype.io ") + "\n\n")

	// Username
	b.WriteString(LabelStyle.Render("username") + "\n")
	if m.inputFocus == 0 {
		b.WriteString(FocusedInputStyle.Render(m.usernameInput.View()) + "\n\n")
	} else {
		b.WriteString(InputStyle.Render(m.usernameInput.View()) + "\n\n")
	}

	// Password
	b.WriteString(LabelStyle.Render("password") + "\n")
	if m.inputFocus == 1 {
		b.WriteString(FocusedInputStyle.Render(m.passwordInput.View()) + "\n\n")
	} else {
		b.WriteString(InputStyle.Render(m.passwordInput.View()) + "\n\n")
	}

	if m.loginError != "" {
		b.WriteString(ErrorStyle.Render(m.loginError) + "\n\n")
	}

	if m.loading {
		b.WriteString(m.spinner.View() + " logging in...\n\n")
	}

	b.WriteString(HelpStyle.Render("tab next • enter login • esc back"))

	box := DialogStyle.Width(50).Render(b.String())
	return Centered(m.width, m.height, box)
}

func (m *Model) updateLogin(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "tab", "down":
		m.inputFocus = (m.inputFocus + 1) % 2
		if m.inputFocus == 0 {
			m.usernameInput.Focus()
			m.passwordInput.Blur()
		} else {
			m.usernameInput.Blur()
			m.passwordInput.Focus()
		}
		return m, textinput.Blink
	case "shift+tab", "up":
		m.inputFocus = (m.inputFocus + 1) % 2
		if m.inputFocus == 0 {
			m.usernameInput.Focus()
			m.passwordInput.Blur()
		} else {
			m.usernameInput.Blur()
			m.passwordInput.Focus()
		}
		return m, textinput.Blink
	case "enter":
		return m.doLogin()
	case "esc":
		m.view = ViewWelcome
		m.usernameInput.SetValue("")
		m.passwordInput.SetValue("")
		m.loginError = ""
		m.selected = 1
		return m, nil
	default:
		var cmd tea.Cmd
		if m.inputFocus == 0 {
			m.usernameInput, cmd = m.usernameInput.Update(msg)
		} else {
			m.passwordInput, cmd = m.passwordInput.Update(msg)
		}
		return m, cmd
	}
}

func (m *Model) doLogin() (tea.Model, tea.Cmd) {
	user := strings.TrimSpace(m.usernameInput.Value())
	pass := m.passwordInput.Value()

	if user == "" {
		m.loginError = "please enter username"
		return m, nil
	}
	if pass == "" {
		m.loginError = "please enter password"
		return m, nil
	}

	m.loading = true
	m.loginError = ""

	return m, func() tea.Msg {
		resp, err := m.client.Login(user, pass)
		if err != nil {
			return loginResultMsg{err: err}
		}
		return loginResultMsg{
			success:  true,
			username: resp.User.Username,
			token:    resp.Token,
		}
	}
}

func (m *Model) handleLoginResult(msg loginResultMsg) (tea.Model, tea.Cmd) {
	m.loading = false

	if msg.err != nil {
		m.loginError = msg.err.Error()
		return m, nil
	}

	m.config.SetCredentials(msg.token, msg.username)
	m.config.CompleteFirstRun()
	m.client.SetToken(msg.token)
	m.mode = ModeAccount
	m.view = ViewEditor
	m.currentSlate = nil
	m.usernameInput.SetValue("")
	m.passwordInput.SetValue("")
	m.statusMsg = fmt.Sprintf("welcome, %s!", msg.username)
	m.statusTime = time.Now()
	m.textarea.Focus()

	// Pull cloud slates
	return m, tea.Batch(textarea.Blink, m.pullCloudSlates())
}

// ============================================================================
// REGISTER VIEW
// ============================================================================

func (m Model) viewRegister() string {
	var b strings.Builder
	b.WriteString(TitleStyle.Render(" create account ") + "\n\n")

	// Username
	b.WriteString(LabelStyle.Render("username") + "\n")
	if m.inputFocus == 0 {
		b.WriteString(FocusedInputStyle.Render(m.usernameInput.View()) + "\n\n")
	} else {
		b.WriteString(InputStyle.Render(m.usernameInput.View()) + "\n\n")
	}

	// Email
	b.WriteString(LabelStyle.Render("email") + "\n")
	if m.inputFocus == 1 {
		b.WriteString(FocusedInputStyle.Render(m.emailInput.View()) + "\n\n")
	} else {
		b.WriteString(InputStyle.Render(m.emailInput.View()) + "\n\n")
	}

	// Password
	b.WriteString(LabelStyle.Render("password") + "\n")
	if m.inputFocus == 2 {
		b.WriteString(FocusedInputStyle.Render(m.passwordInput.View()) + "\n\n")
	} else {
		b.WriteString(InputStyle.Render(m.passwordInput.View()) + "\n\n")
	}

	if m.loginError != "" {
		b.WriteString(ErrorStyle.Render(m.loginError) + "\n\n")
	}

	if m.loading {
		b.WriteString(m.spinner.View() + " creating account...\n\n")
	}

	b.WriteString(HelpStyle.Render("tab next • enter create • esc back"))

	box := DialogStyle.Width(50).Render(b.String())
	return Centered(m.width, m.height, box)
}

func (m *Model) updateRegister(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "tab", "down":
		m.inputFocus = (m.inputFocus + 1) % 3
		m.usernameInput.Blur()
		m.emailInput.Blur()
		m.passwordInput.Blur()
		switch m.inputFocus {
		case 0:
			m.usernameInput.Focus()
		case 1:
			m.emailInput.Focus()
		case 2:
			m.passwordInput.Focus()
		}
		return m, textinput.Blink
	case "shift+tab", "up":
		m.inputFocus = (m.inputFocus + 2) % 3
		m.usernameInput.Blur()
		m.emailInput.Blur()
		m.passwordInput.Blur()
		switch m.inputFocus {
		case 0:
			m.usernameInput.Focus()
		case 1:
			m.emailInput.Focus()
		case 2:
			m.passwordInput.Focus()
		}
		return m, textinput.Blink
	case "enter":
		return m.doRegister()
	case "esc":
		m.view = ViewWelcome
		m.usernameInput.SetValue("")
		m.emailInput.SetValue("")
		m.passwordInput.SetValue("")
		m.loginError = ""
		m.selected = 2
		return m, nil
	default:
		var cmd tea.Cmd
		switch m.inputFocus {
		case 0:
			m.usernameInput, cmd = m.usernameInput.Update(msg)
		case 1:
			m.emailInput, cmd = m.emailInput.Update(msg)
		case 2:
			m.passwordInput, cmd = m.passwordInput.Update(msg)
		}
		return m, cmd
	}
}

func (m *Model) doRegister() (tea.Model, tea.Cmd) {
	user := strings.TrimSpace(m.usernameInput.Value())
	email := strings.TrimSpace(m.emailInput.Value())
	pass := m.passwordInput.Value()

	if user == "" {
		m.loginError = "please enter username"
		return m, nil
	}
	if email == "" {
		m.loginError = "please enter email"
		return m, nil
	}
	if pass == "" {
		m.loginError = "please enter password"
		return m, nil
	}
	if len(pass) < 8 {
		m.loginError = "password must be at least 8 characters"
		return m, nil
	}

	m.loading = true
	m.loginError = ""

	return m, func() tea.Msg {
		resp, err := m.client.Register(user, email, pass)
		if err != nil {
			return registerResultMsg{err: err}
		}
		return registerResultMsg{
			success:  true,
			username: resp.User.Username,
			token:    resp.Token,
		}
	}
}

func (m *Model) handleRegisterResult(msg registerResultMsg) (tea.Model, tea.Cmd) {
	m.loading = false

	if msg.err != nil {
		m.loginError = msg.err.Error()
		return m, nil
	}

	m.config.SetCredentials(msg.token, msg.username)
	m.config.CompleteFirstRun()
	m.client.SetToken(msg.token)
	m.mode = ModeAccount
	m.view = ViewEditor
	m.currentSlate = nil
	m.usernameInput.SetValue("")
	m.emailInput.SetValue("")
	m.passwordInput.SetValue("")
	m.statusMsg = fmt.Sprintf("welcome, %s!", msg.username)
	m.statusTime = time.Now()
	m.textarea.Focus()

	return m, textarea.Blink
}

// ============================================================================
// EDITOR VIEW - Built-in editor (matches web UI)
// ============================================================================

func (m Model) viewEditor() string {
	// Word count
	content := m.textarea.Value()
	words := len(strings.Fields(content))

	// Calculate centered textarea dimensions
	maxTextWidth := 80
	textWidth := min(m.width-8, maxTextWidth)
	textHeight := m.height - 4 // leave room for footer

	// Update textarea size
	m.textarea.SetWidth(textWidth)
	m.textarea.SetHeight(textHeight)

	// Center the textarea horizontally
	leftPadding := (m.width - textWidth) / 2
	if leftPadding < 0 {
		leftPadding = 0
	}

	// Build the centered textarea
	textareaView := m.textarea.View()

	// Pad each line to center it
	lines := strings.Split(textareaView, "\n")
	var centeredLines []string
	for _, line := range lines {
		centeredLines = append(centeredLines, strings.Repeat(" ", leftPadding)+line)
	}
	centeredTextarea := strings.Join(centeredLines, "\n")

	// Build footer
	var footerParts []string

	// Word count
	wordStr := fmt.Sprintf("%d words", words)
	footerParts = append(footerParts, DimStyle.Render(wordStr))

	// Status message
	if m.statusMsg != "" && time.Since(m.statusTime) < 3*time.Second {
		footerParts = append(footerParts, SuccessStyle.Render("✓ "+m.statusMsg))
	} else if m.errorMsg != "" {
		footerParts = append(footerParts, ErrorStyle.Render(m.errorMsg))
		m.errorMsg = ""
	}

	// Mode indicator
	if m.mode == ModeAccount {
		footerParts = append(footerParts, DimStyle.Render(m.config.Username))
	} else {
		footerParts = append(footerParts, DimStyle.Render("local"))
	}

	// Help
	footerParts = append(footerParts, DimStyle.Render("esc menu"))

	footer := strings.Join(footerParts, DimStyle.Render("  ·  "))

	// Center footer
	footerPadding := (m.width - lipgloss.Width(footer)) / 2
	if footerPadding < 0 {
		footerPadding = 0
	}
	centeredFooter := strings.Repeat(" ", footerPadding) + footer

	// Fill remaining vertical space to push footer to bottom
	contentHeight := len(lines)
	emptyLines := m.height - contentHeight - 2
	if emptyLines < 0 {
		emptyLines = 0
	}

	return centeredTextarea + strings.Repeat("\n", emptyLines) + "\n" + centeredFooter
}

func (m *Model) updateEditor(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	// Check for escape to open menu
	if msg.String() == "esc" {
		// Save current content first
		m.saveCurrentSlate()
		m.view = ViewMenu
		m.selected = 0
		return m, nil
	}

	// Handle ctrl+s for manual save
	if msg.String() == "ctrl+s" {
		m.saveCurrentSlate()
		m.statusMsg = "saved"
		m.statusTime = time.Now()

		// Sync to cloud if logged in
		if m.mode == ModeAccount && m.currentSlate != nil {
			return m, m.syncSlateToCloud(m.currentSlate)
		}
		return m, nil
	}

	// Update textarea
	var cmd tea.Cmd
	m.textarea, cmd = m.textarea.Update(msg)

	// Schedule auto-save after typing stops (debounced)
	return m, tea.Batch(cmd, tea.Tick(2*time.Second, func(t time.Time) tea.Msg {
		return autoSaveMsg{}
	}))
}

func (m *Model) doAutoSave() (tea.Model, tea.Cmd) {
	// Only auto-save if content has changed
	content := m.textarea.Value()
	if content == "" {
		return m, nil
	}

	// Get title from first line or use "untitled"
	lines := strings.SplitN(content, "\n", 2)
	title := strings.TrimSpace(lines[0])
	if title == "" {
		title = "untitled"
	}

	// Don't save if nothing has changed
	if m.currentSlate != nil && m.currentSlate.Content == content {
		return m, nil
	}

	m.saveCurrentSlate()

	// Sync to cloud if in account mode
	if m.mode == ModeAccount && m.currentSlate != nil {
		return m, m.syncSlateToCloud(m.currentSlate)
	}

	return m, nil
}

func (m *Model) saveCurrentSlate() {
	content := m.textarea.Value()
	if content == "" {
		return
	}

	// Extract title from first line
	lines := strings.SplitN(content, "\n", 2)
	title := strings.TrimSpace(lines[0])
	if title == "" {
		title = "untitled"
	}

	if m.currentSlate == nil {
		// Create new slate
		m.currentSlate = m.store.Create(title, content)
	} else {
		// Update existing
		m.store.Update(m.currentSlate.ID, title, content)
		m.currentSlate = m.store.Get(m.currentSlate.ID)
	}

	m.slates = m.store.List()
	m.lastSave = time.Now()
}

// ============================================================================
// SLATES VIEW - List of slates (like web)
// ============================================================================

func (m Model) viewSlates() string {
	var b strings.Builder

	// Header
	header := TitleStyle.Render(" my slates ")
	newBtn := ButtonStyle.Render("+ new")
	headerLine := header + "  " + newBtn
	b.WriteString(headerLine + "\n\n")

	if m.searching {
		b.WriteString(FocusedInputStyle.Render(m.searchInput.View()) + "\n\n")
	}

	if len(m.slates) == 0 {
		b.WriteString(DimStyle.Render("no slates yet. press n to create one.") + "\n")
	} else {
		// List slates in web-style format
		listWidth := min(m.width-8, 80)

		for i, slate := range m.slates {
			cursor := "  "
			style := ListItemStyle
			if i == m.selected {
				cursor = CursorStyle.Render("▸ ")
				style = SelectedListStyle
			}

			// Title
			title := slate.Title
			if title == "" {
				title = "untitled"
			}
			if len(title) > 40 {
				title = title[:37] + "..."
			}

			// Word count and time
			wordStr := fmt.Sprintf("%d words", slate.WordCount)
			timeStr := formatTimeAgo(slate.UpdatedAt)

			// Status badges
			var badges string
			if slate.IsPublished {
				badges += " " + PublishedBadgeStyle.Render("public")
			}
			if slate.Synced && m.mode == ModeAccount {
				badges += " " + SyncedBadgeStyle.Render("synced")
			}

			// Build line
			meta := DimStyle.Render(fmt.Sprintf("%s  %s", wordStr, timeStr))
			line := style.Render(fmt.Sprintf("%-40s", title)) + "  " + meta + badges

			// Ensure line fits
			if len(line) > listWidth {
				line = line[:listWidth-3] + "..."
			}

			b.WriteString(cursor + line + "\n")
		}
	}

	b.WriteString("\n")
	b.WriteString(HelpStyle.Render("↑/↓ select • enter open • n new • d delete • / search • esc back"))

	return AppStyle.Render(b.String())
}

func (m *Model) updateSlates(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	if m.searching {
		switch msg.String() {
		case "esc":
			m.searching = false
			m.searchInput.SetValue("")
			m.slates = m.store.List()
			return m, nil
		case "enter":
			m.searching = false
			return m, nil
		default:
			var cmd tea.Cmd
			m.searchInput, cmd = m.searchInput.Update(msg)
			// Filter slates
			query := m.searchInput.Value()
			if query != "" {
				m.slates = m.store.Search(query)
			} else {
				m.slates = m.store.List()
			}
			m.selected = 0
			return m, cmd
		}
	}

	switch msg.String() {
	case "up", "k":
		if m.selected > 0 {
			m.selected--
		}
	case "down", "j":
		if m.selected < len(m.slates)-1 {
			m.selected++
		}
	case "enter":
		if len(m.slates) > 0 && m.selected < len(m.slates) {
			m.currentSlate = m.slates[m.selected]
			m.textarea.SetValue(m.currentSlate.Content)
			m.view = ViewEditor
			m.textarea.Focus()
			return m, textarea.Blink
		}
	case "n":
		m.currentSlate = nil
		m.textarea.SetValue("")
		m.view = ViewEditor
		m.textarea.Focus()
		return m, textarea.Blink
	case "d":
		if len(m.slates) > 0 && m.selected < len(m.slates) {
			slate := m.slates[m.selected]
			m.confirmMsg = fmt.Sprintf("delete \"%s\"?", slate.Title)
			m.confirmAction = func() {
				m.store.Delete(slate.ID)
				if m.mode == ModeAccount && slate.CloudID > 0 {
					m.client.DeleteSlate(slate.CloudID)
				}
				m.slates = m.store.List()
				if m.selected >= len(m.slates) && m.selected > 0 {
					m.selected--
				}
			}
			m.view = ViewConfirm
		}
	case "/":
		m.searching = true
		m.searchInput.Focus()
		return m, textinput.Blink
	case "esc":
		m.view = ViewMenu
		m.selected = 0
		return m, nil
	}
	return m, nil
}

// ============================================================================
// MENU VIEW - Quick menu (esc from editor)
// ============================================================================

func (m Model) viewMenu() string {
	var b strings.Builder

	b.WriteString(TitleStyle.Render(" menu ") + "\n\n")

	items := []struct {
		label string
		desc  string
	}{
		{"go back", ""},
		{"new slate", "create new note"},
		{"my slates", fmt.Sprintf("%d notes", len(m.slates))},
	}

	if m.mode == ModeAccount {
		items = append(items,
			struct{ label, desc string }{"sync", "sync with cloud"},
		)
	} else {
		items = append(items,
			struct{ label, desc string }{"login", "sync to cloud"},
		)
	}

	items = append(items,
		struct{ label, desc string }{"settings", "export, update"},
	)

	if m.mode == ModeAccount {
		items = append(items,
			struct{ label, desc string }{"logout", m.config.Username},
		)
	}

	items = append(items,
		struct{ label, desc string }{"quit", ""},
	)

	for i, item := range items {
		cursor := "  "
		style := MenuItemStyle
		if i == m.selected {
			cursor = CursorStyle.Render("▸ ")
			style = SelectedStyle
		}

		line := style.Render(item.label)
		if item.desc != "" {
			line += "  " + DimStyle.Render(item.desc)
		}
		b.WriteString(cursor + line + "\n")
	}

	// Status
	if m.statusMsg != "" && time.Since(m.statusTime) < 3*time.Second {
		b.WriteString("\n" + SuccessStyle.Render("✓ " + m.statusMsg))
	}

	b.WriteString("\n\n" + HelpStyle.Render("↑/↓ select • enter choose • esc back to editor"))

	box := DialogStyle.Width(45).Render(b.String())
	return Centered(m.width, m.height, box)
}

func (m *Model) updateMenu(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	menuLen := 6
	if m.mode == ModeAccount {
		menuLen = 7
	}

	switch msg.String() {
	case "up", "k":
		if m.selected > 0 {
			m.selected--
		}
	case "down", "j":
		if m.selected < menuLen-1 {
			m.selected++
		}
	case "enter":
		return m.handleMenuSelect()
	case "esc":
		m.view = ViewEditor
		m.textarea.Focus()
		return m, textarea.Blink
	case "q":
		return m, tea.Quit
	}
	return m, nil
}

func (m *Model) handleMenuSelect() (tea.Model, tea.Cmd) {
	idx := m.selected

	if m.mode == ModeAccount {
		switch idx {
		case 0: // Go back
			m.view = ViewSlates
			m.selected = 0
			m.slates = m.store.List()
		case 1: // New slate
			m.currentSlate = nil
			m.textarea.SetValue("")
			m.view = ViewEditor
			m.textarea.Focus()
			return m, textarea.Blink
		case 2: // My slates
			m.view = ViewSlates
			m.selected = 0
			m.slates = m.store.List()
		case 3: // Sync
			m.loading = true
			m.loadingMsg = "syncing..."
			return m, m.syncSlates()
		case 4: // Settings
			m.view = ViewSettings
			m.selected = 0
		case 5: // Logout
			m.config.ClearCredentials()
			m.client.SetToken("")
			m.mode = ModeLocal
			m.statusMsg = "logged out"
			m.statusTime = time.Now()
			m.selected = 0
		case 6: // Quit
			return m, tea.Quit
		}
	} else {
		switch idx {
		case 0: // Go back
			m.view = ViewSlates
			m.selected = 0
			m.slates = m.store.List()
		case 1: // New slate
			m.currentSlate = nil
			m.textarea.SetValue("")
			m.view = ViewEditor
			m.textarea.Focus()
			return m, textarea.Blink
		case 2: // My slates
			m.view = ViewSlates
			m.selected = 0
			m.slates = m.store.List()
		case 3: // Login
			m.view = ViewLogin
			m.selected = 0
			m.usernameInput.Focus()
			return m, textinput.Blink
		case 4: // Settings
			m.view = ViewSettings
			m.selected = 0
		case 5: // Quit
			return m, tea.Quit
		}
	}
	return m, nil
}

// ============================================================================
// SETTINGS VIEW
// ============================================================================

func (m Model) viewSettings() string {
	var b strings.Builder

	b.WriteString(TitleStyle.Render(" settings ") + "\n\n")

	items := []struct {
		label string
		value string
	}{
		{"export all slates", ""},
	}

	if m.updateAvailable {
		items = append(items, struct{ label, value string }{"update", "v" + m.latestVersion + " available"})
	} else {
		items = append(items, struct{ label, value string }{"check for updates", "v" + updater.GetVersion()})
	}

	items = append(items, struct{ label, value string }{"back", ""})

	for i, item := range items {
		cursor := "  "
		style := MenuItemStyle
		if i == m.selected {
			cursor = CursorStyle.Render("▸ ")
			style = SelectedStyle
		}

		line := style.Render(item.label)
		if item.value != "" {
			line += "  " + DimStyle.Render(item.value)
		}
		b.WriteString(cursor + line + "\n")
	}

	b.WriteString("\n" + HelpStyle.Render("↑/↓ select • enter choose • esc back"))

	box := DialogStyle.Width(45).Render(b.String())
	return Centered(m.width, m.height, box)
}

func (m *Model) updateSettings(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "up", "k":
		if m.selected > 0 {
			m.selected--
		}
	case "down", "j":
		if m.selected < 2 {
			m.selected++
		}
	case "enter":
		switch m.selected {
		case 0: // Export
			m.view = ViewExport
			m.exportInput.Focus()
			return m, textinput.Blink
		case 1: // Update
			if m.updateAvailable {
				m.loading = true
				m.loadingMsg = "updating..."
				return m, func() tea.Msg {
					err := updater.Update()
					if err != nil {
						return updateCheckMsg{err: err}
					}
					return updateCheckMsg{available: false}
				}
			}
		case 2: // Back
			m.view = ViewMenu
			m.selected = 0
		}
	case "esc":
		m.view = ViewMenu
		m.selected = 0
	}
	return m, nil
}

// ============================================================================
// EXPORT VIEW
// ============================================================================

func (m Model) viewExport() string {
	var b strings.Builder

	b.WriteString(TitleStyle.Render(" export slates ") + "\n\n")
	b.WriteString(LabelStyle.Render("export directory:") + "\n")
	b.WriteString(FocusedInputStyle.Render(m.exportInput.View()) + "\n\n")
	b.WriteString(DimStyle.Render(fmt.Sprintf("will export %d slates as .txt files", len(m.slates))) + "\n\n")
	b.WriteString(HelpStyle.Render("enter export • esc cancel"))

	box := DialogStyle.Width(55).Render(b.String())
	return Centered(m.width, m.height, box)
}

func (m *Model) updateExport(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "enter":
		path := m.exportInput.Value()
		if path == "" {
			path = "~/Documents/justtype"
		}
		// Expand ~
		if strings.HasPrefix(path, "~/") {
			home, _ := os.UserHomeDir()
			path = home + path[1:]
		}
		err := m.store.ExportAll(path)
		if err != nil {
			m.errorMsg = "export failed: " + err.Error()
		} else {
			m.statusMsg = fmt.Sprintf("exported %d slates to %s", len(m.slates), path)
			m.statusTime = time.Now()
		}
		m.view = ViewSettings
		m.selected = 0
	case "esc":
		m.view = ViewSettings
		m.selected = 0
	default:
		var cmd tea.Cmd
		m.exportInput, cmd = m.exportInput.Update(msg)
		return m, cmd
	}
	return m, nil
}

// ============================================================================
// CONFIRM VIEW
// ============================================================================

func (m Model) viewConfirm() string {
	var b strings.Builder

	b.WriteString(WarningStyle.Render("⚠ confirm") + "\n\n")
	b.WriteString(m.confirmMsg + "\n\n")
	b.WriteString(HelpStyle.Render("y confirm • n cancel"))

	box := DialogStyle.Width(40).Render(b.String())
	return Centered(m.width, m.height, box)
}

func (m *Model) updateConfirm(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "y", "enter":
		if m.confirmAction != nil {
			m.confirmAction()
		}
		m.view = ViewSlates
		m.confirmMsg = ""
		m.confirmAction = nil
	case "n", "esc":
		m.view = ViewSlates
		m.confirmMsg = ""
		m.confirmAction = nil
	}
	return m, nil
}

// ============================================================================
// CLOUD SYNC HELPERS
// ============================================================================

func (m *Model) pullCloudSlates() tea.Cmd {
	return func() tea.Msg {
		cloudSlates, err := m.client.ListSlates()
		if err != nil {
			return cloudSyncMsg{err: err}
		}

		var slates []*store.Slate
		for _, cs := range cloudSlates {
			full, err := m.client.GetSlate(cs.ID)
			if err != nil {
				continue
			}

			createdAt, _ := time.Parse(time.RFC3339, cs.CreatedAt)
			updatedAt, _ := time.Parse(time.RFC3339, cs.UpdatedAt)

			slates = append(slates, &store.Slate{
				ID:          fmt.Sprintf("cloud-%d", cs.ID),
				Title:       full.Title,
				Content:     full.Content,
				WordCount:   full.WordCount,
				CreatedAt:   createdAt,
				UpdatedAt:   updatedAt,
				CloudID:     cs.ID,
				IsPublished: cs.IsPublished == 1,
				ShareID:     cs.ShareID,
				Synced:      true,
			})
		}

		return cloudSyncMsg{slates: slates}
	}
}

func (m *Model) syncSlateToCloud(slate *store.Slate) tea.Cmd {
	return func() tea.Msg {
		if slate.CloudID > 0 {
			err := m.client.UpdateSlate(slate.CloudID, slate.Title, slate.Content)
			if err != nil {
				return cloudSaveMsg{slateID: slate.ID, err: err}
			}
			return cloudSaveMsg{slateID: slate.ID, cloudID: slate.CloudID}
		} else {
			cloudSlate, err := m.client.CreateSlate(slate.Title, slate.Content)
			if err != nil {
				return cloudSaveMsg{slateID: slate.ID, err: err}
			}
			return cloudSaveMsg{slateID: slate.ID, cloudID: cloudSlate.ID}
		}
	}
}

func (m *Model) syncSlates() tea.Cmd {
	return func() tea.Msg {
		// Push local unsynced slates
		for _, slate := range m.store.List() {
			if !slate.Synced && slate.CloudID == 0 {
				cloudSlate, err := m.client.CreateSlate(slate.Title, slate.Content)
				if err == nil {
					m.store.SetCloudID(slate.ID, cloudSlate.ID)
				}
			} else if !slate.Synced && slate.CloudID > 0 {
				m.client.UpdateSlate(slate.CloudID, slate.Title, slate.Content)
				m.store.SetCloudID(slate.ID, slate.CloudID)
			}
		}

		// Pull cloud slates
		cloudSlates, err := m.client.ListSlates()
		if err != nil {
			return cloudSyncMsg{err: err}
		}

		var slates []*store.Slate
		for _, cs := range cloudSlates {
			full, err := m.client.GetSlate(cs.ID)
			if err != nil {
				continue
			}

			createdAt, _ := time.Parse(time.RFC3339, cs.CreatedAt)
			updatedAt, _ := time.Parse(time.RFC3339, cs.UpdatedAt)

			slates = append(slates, &store.Slate{
				ID:          fmt.Sprintf("cloud-%d", cs.ID),
				Title:       full.Title,
				Content:     full.Content,
				WordCount:   full.WordCount,
				CreatedAt:   createdAt,
				UpdatedAt:   updatedAt,
				CloudID:     cs.ID,
				IsPublished: cs.IsPublished == 1,
				ShareID:     cs.ShareID,
				Synced:      true,
			})
		}

		return cloudSyncMsg{slates: slates}
	}
}

// ============================================================================
// HELPERS
// ============================================================================

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
			return "1 hour ago"
		}
		return fmt.Sprintf("%d hours ago", hours)
	}
	if diff < 48*time.Hour {
		return "yesterday"
	}
	days := int(diff.Hours() / 24)
	if days < 7 {
		return fmt.Sprintf("%d days ago", days)
	}
	return t.Format("Jan 2")
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
