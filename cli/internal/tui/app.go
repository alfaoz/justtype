package tui

import (
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/spinner"
	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"

	"github.com/justtype/cli/internal/api"
	"github.com/justtype/cli/internal/config"
	"github.com/justtype/cli/internal/store"
	"github.com/justtype/cli/internal/updater"
)

type View int

const (
	ViewWelcome View = iota
	ViewSetupEditor
	ViewHome
	ViewSlates
	ViewEditor
	ViewLogin
	ViewSettings
	ViewExport
	ViewConfirm
	ViewLoading
)

type Model struct {
	// Window
	width  int
	height int

	// Navigation
	view         View
	previousView View
	selected     int

	// Core data
	config *config.Config
	store  *store.Store
	client *api.Client
	slates []*store.Slate

	// Current slate
	currentSlate   *store.Slate
	editorTitle    string
	editorContent  string
	editorModified bool

	// Inputs
	usernameInput textinput.Model
	passwordInput textinput.Model
	searchInput   textinput.Model
	exportInput   textinput.Model
	inputFocus    int

	// Editor options for setup
	editors         []string
	editorSelection int

	// UI state
	spinner       spinner.Model
	loading       bool
	loadingMsg    string
	statusMsg     string
	statusTime    time.Time
	errorMsg      string
	searching     bool
	confirmMsg    string
	confirmAction func()

	// Login state
	loginError string

	// Update state
	updateAvailable bool
	latestVersion   string
	updating        bool
}

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

	// Setup text inputs
	userInput := textinput.New()
	userInput.Placeholder = "username or email"
	userInput.CharLimit = 100
	userInput.Width = 30

	passInput := textinput.New()
	passInput.Placeholder = "password"
	passInput.EchoMode = textinput.EchoPassword
	passInput.CharLimit = 100
	passInput.Width = 30

	searchInput := textinput.New()
	searchInput.Placeholder = "search slates..."
	searchInput.CharLimit = 50
	searchInput.Width = 30

	exportInput := textinput.New()
	exportInput.Placeholder = "~/Documents/justtype"
	exportInput.CharLimit = 200
	exportInput.Width = 40

	s := spinner.New()
	s.Spinner = spinner.Dot
	s.Style = SpinnerStyle

	// Available editors
	editors := []string{"nano", "vim", "nvim", "code", "subl", "micro", "emacs", "helix"}

	// Determine initial view
	initialView := ViewHome
	if cfg.IsFirstRun() {
		initialView = ViewWelcome
	}

	m := &Model{
		view:          initialView,
		config:        cfg,
		store:         st,
		client:        client,
		slates:        st.List(),
		usernameInput: userInput,
		passwordInput: passInput,
		searchInput:   searchInput,
		exportInput:   exportInput,
		spinner:       s,
		editors:       editors,
	}

	return m, nil
}

func (m Model) Init() tea.Cmd {
	return tea.Batch(
		tea.EnterAltScreen,
		textinput.Blink,
		m.spinner.Tick,
		checkForUpdate(),
	)
}

// Update check messages
type updateCheckMsg struct {
	available bool
	version   string
	err       error
}

type updateDoneMsg struct {
	err error
}

type cloudSyncMsg struct {
	slates []*store.Slate
	err    error
}

type cloudSaveMsg struct {
	slateID string
	cloudID int
	err     error
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
		return m, nil

	case tea.KeyMsg:
		// Global quit
		if msg.String() == "ctrl+c" {
			return m, tea.Quit
		}

		// Handle by view
		switch m.view {
		case ViewWelcome:
			return m.updateWelcome(msg)
		case ViewSetupEditor:
			return m.updateSetupEditor(msg)
		case ViewHome:
			return m.updateHome(msg)
		case ViewSlates:
			return m.updateSlates(msg)
		case ViewEditor:
			return m.updateEditor(msg)
		case ViewLogin:
			return m.updateLogin(msg)
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

	case editorDoneMsg:
		return m.handleEditorDone(msg)

	case loginResultMsg:
		return m.handleLoginResult(msg)

	case updateCheckMsg:
		if msg.err == nil && msg.available {
			m.updateAvailable = true
			m.latestVersion = msg.version
		}
		return m, nil

	case updateDoneMsg:
		m.updating = false
		if msg.err != nil {
			m.errorMsg = "update failed: " + msg.err.Error()
		} else {
			m.statusMsg = "updated! restart justtype to use v" + m.latestVersion
			m.statusTime = time.Now()
			m.updateAvailable = false
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
			count := len(msg.slates)
			if count > 0 {
				m.statusMsg = fmt.Sprintf("synced %d slates from cloud", count)
			} else {
				m.statusMsg = "cloud slates synced"
			}
			m.statusTime = time.Now()
		}
		return m, nil

	case cloudSaveMsg:
		if msg.err == nil && msg.cloudID > 0 {
			m.store.SetCloudID(msg.slateID, msg.cloudID)
			if m.currentSlate != nil && m.currentSlate.ID == msg.slateID {
				m.currentSlate = m.store.Get(msg.slateID)
			}
		}
		return m, nil
	}

	return m, tea.Batch(cmds...)
}

func (m Model) View() string {
	if m.width == 0 {
		return ""
	}

	var content string

	switch m.view {
	case ViewWelcome:
		content = m.viewWelcome()
	case ViewSetupEditor:
		content = m.viewSetupEditor()
	case ViewHome:
		content = m.viewHome()
	case ViewSlates:
		content = m.viewSlates()
	case ViewEditor:
		content = m.viewEditor()
	case ViewLogin:
		content = m.viewLogin()
	case ViewSettings:
		content = m.viewSettings()
	case ViewExport:
		content = m.viewExport()
	case ViewConfirm:
		content = m.viewConfirm()
	case ViewLoading:
		content = m.viewLoading()
	}

	return content
}

// ============================================================================
// WELCOME VIEW
// ============================================================================

func (m Model) viewWelcome() string {
	logo := `
     ╦╦ ╦╔═╗╔╦╗╔╦╗╦ ╦╔═╗╔═╗
     ║║ ║╚═╗ ║  ║ ╚╦╝╠═╝║╣
    ╚╝╚═╝╚═╝ ╩  ╩  ╩ ╩  ╚═╝`

	content := LogoStyle.Render(logo) + "\n"
	content += DimStyle.Render("        v" + updater.GetVersion()) + "\n\n"
	content += SubtitleStyle.Render("distraction-free writing for your terminal") + "\n\n"
	content += DimStyle.Render("your notes are stored locally in ~/.justtype") + "\n"
	content += DimStyle.Render("login to sync across devices") + "\n\n"
	content += ButtonStyle.Render("press enter to get started") + "\n\n"
	content += HelpStyle.Render("q to quit")

	box := WelcomeBoxStyle.Render(content)
	return Centered(m.width, m.height, box)
}

func (m *Model) updateWelcome(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "enter", " ":
		m.view = ViewSetupEditor
		return m, nil
	case "q", "esc":
		return m, tea.Quit
	}
	return m, nil
}

// ============================================================================
// SETUP EDITOR VIEW
// ============================================================================

func (m Model) viewSetupEditor() string {
	content := TitleStyle.Render(" choose your editor ") + "\n\n"
	content += SubtitleStyle.Render("select your preferred text editor:") + "\n\n"

	for i, editor := range m.editors {
		cursor := "  "
		style := MenuItemStyle
		if i == m.editorSelection {
			cursor = CursorStyle.Render("▸ ")
			style = SelectedStyle
		}

		desc := getEditorDescription(editor)
		line := fmt.Sprintf("%-8s %s", editor, DimStyle.Render(desc))
		content += cursor + style.Render(line) + "\n"
	}

	content += "\n" + HelpStyle.Render("↑/↓ select • enter confirm • you can change this later in settings")

	box := WelcomeBoxStyle.Width(55).Render(content)
	return Centered(m.width, m.height, box)
}

func (m *Model) updateSetupEditor(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "up", "k":
		if m.editorSelection > 0 {
			m.editorSelection--
		}
	case "down", "j":
		if m.editorSelection < len(m.editors)-1 {
			m.editorSelection++
		}
	case "enter":
		editor := m.editors[m.editorSelection]
		m.config.SetEditor(editor)
		m.config.CompleteFirstRun()
		m.view = ViewHome
		m.statusMsg = fmt.Sprintf("editor set to %s", editor)
		m.statusTime = time.Now()
	case "q", "esc":
		return m, tea.Quit
	}
	return m, nil
}

func getEditorDescription(editor string) string {
	switch editor {
	case "nano":
		return "simple, beginner-friendly"
	case "vim":
		return "powerful, modal editing"
	case "nvim":
		return "modern vim"
	case "code":
		return "vs code"
	case "subl":
		return "sublime text"
	case "micro":
		return "modern terminal editor"
	case "emacs":
		return "extensible editor"
	case "helix":
		return "modern modal editor"
	default:
		return ""
	}
}

// ============================================================================
// HOME VIEW
// ============================================================================

func (m Model) viewHome() string {
	var b strings.Builder

	// Header with version
	logo := LogoStyle.Render("justtype")
	version := DimStyle.Render(" v" + updater.GetVersion())
	b.WriteString(logo + version)
	b.WriteString("\n\n")

	// Update notification
	if m.updateAvailable {
		b.WriteString(WarningStyle.Render("⬆ update available: v"+m.latestVersion) + "\n\n")
	}

	// Status line
	if m.config.IsLoggedIn() {
		b.WriteString(SuccessStyle.Render("●") + " " + DimStyle.Render("logged in as ") + m.config.Username)
	} else {
		b.WriteString(DimStyle.Render("○ local mode"))
	}
	b.WriteString("\n\n")

	// Menu
	menuItems := []menuItem{
		{label: "new slate", key: "n", desc: "create a new note"},
		{label: "my slates", key: "s", desc: fmt.Sprintf("%d notes", len(m.slates))},
	}

	if m.config.IsLoggedIn() {
		menuItems = append(menuItems,
			menuItem{label: "sync", key: "y", desc: "upload to cloud"},
			menuItem{label: "logout", key: "l", desc: ""},
		)
	} else {
		menuItems = append(menuItems,
			menuItem{label: "login", key: "l", desc: "sync to cloud"},
		)
	}

	menuItems = append(menuItems,
		menuItem{label: "settings", key: ",", desc: "editor, export"},
		menuItem{label: "quit", key: "q", desc: ""},
	)

	for i, item := range menuItems {
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

	// Status message
	if m.statusMsg != "" && time.Since(m.statusTime) < 3*time.Second {
		b.WriteString("\n" + SuccessStyle.Render("✓ "+m.statusMsg))
	}
	if m.errorMsg != "" {
		b.WriteString("\n" + ErrorStyle.Render("✗ "+m.errorMsg))
		m.errorMsg = "" // Clear after showing
	}

	// Help
	b.WriteString("\n\n")
	b.WriteString(HelpStyle.Render("↑/↓ navigate • enter select • q quit"))

	return AppStyle.Render(b.String())
}

type menuItem struct {
	label string
	key   string
	desc  string
}

func (m *Model) updateHome(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	menuLen := 5
	if m.config.IsLoggedIn() {
		menuLen = 6
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
		return m.handleHomeSelect()
	case "n":
		return m.createNewSlate()
	case "s":
		m.view = ViewSlates
		m.selected = 0
		m.slates = m.store.List()
	case "l":
		if m.config.IsLoggedIn() {
			m.config.ClearCredentials()
			m.statusMsg = "logged out"
			m.statusTime = time.Now()
		} else {
			m.view = ViewLogin
			m.usernameInput.Focus()
			m.inputFocus = 0
			return m, textinput.Blink
		}
	case "y":
		if m.config.IsLoggedIn() {
			return m.syncSlates()
		}
	case ",":
		m.view = ViewSettings
		m.selected = 0
	case "q":
		return m, tea.Quit
	}
	return m, nil
}

func (m *Model) handleHomeSelect() (tea.Model, tea.Cmd) {
	isLoggedIn := m.config.IsLoggedIn()
	idx := m.selected

	// Menu order differs based on login status
	if !isLoggedIn {
		// new, slates, login, settings, quit
		switch idx {
		case 0:
			return m.createNewSlate()
		case 1:
			m.view = ViewSlates
			m.selected = 0
			m.slates = m.store.List()
		case 2:
			m.view = ViewLogin
			m.usernameInput.Focus()
			m.inputFocus = 0
			return m, textinput.Blink
		case 3:
			m.view = ViewSettings
			m.selected = 0
		case 4:
			return m, tea.Quit
		}
	} else {
		// new, slates, sync, logout, settings, quit
		switch idx {
		case 0:
			return m.createNewSlate()
		case 1:
			m.view = ViewSlates
			m.selected = 0
			m.slates = m.store.List()
		case 2:
			return m.syncSlates()
		case 3:
			m.config.ClearCredentials()
			m.statusMsg = "logged out"
			m.statusTime = time.Now()
			m.selected = 0
		case 4:
			m.view = ViewSettings
			m.selected = 0
		case 5:
			return m, tea.Quit
		}
	}
	return m, nil
}

// ============================================================================
// SLATES VIEW
// ============================================================================

func (m Model) viewSlates() string {
	var b strings.Builder

	b.WriteString(TitleStyle.Render(" my slates ") + "\n\n")

	if m.searching {
		b.WriteString(FocusedInputStyle.Render(m.searchInput.View()) + "\n\n")
	}

	if len(m.slates) == 0 {
		b.WriteString(DimStyle.Render("no slates yet\n"))
		b.WriteString(DimStyle.Render("press 'n' to create your first note"))
	} else {
		visible := m.height - 12
		if visible < 5 {
			visible = 5
		}
		if visible > len(m.slates) {
			visible = len(m.slates)
		}

		start := 0
		if m.selected >= visible {
			start = m.selected - visible + 1
		}

		for i := start; i < len(m.slates) && i < start+visible; i++ {
			slate := m.slates[i]

			cursor := "  "
			style := ListItemStyle
			if i == m.selected {
				cursor = CursorStyle.Render("▸ ")
				style = SelectedListStyle
			}

			title := slate.Title
			if len(title) > 35 {
				title = title[:32] + "..."
			}

			// Badges
			var badges string
			if slate.IsPublished {
				badges = PublishedBadgeStyle.Render("published")
			} else if slate.Synced {
				badges = SyncedBadgeStyle.Render("synced")
			} else {
				badges = BadgeStyle.Render(fmt.Sprintf("%d words", slate.WordCount))
			}

			timeAgo := formatTimeAgo(slate.UpdatedAt)

			line := fmt.Sprintf("%-36s %s  %s", title, badges, DimStyle.Render(timeAgo))
			b.WriteString(cursor + style.Render(line) + "\n")
		}

		if len(m.slates) > visible {
			b.WriteString(DimStyle.Render(fmt.Sprintf("\n... and %d more", len(m.slates)-visible)))
		}
	}

	b.WriteString("\n\n")
	b.WriteString(HelpStyle.Render("↑/↓ select • enter edit • n new • d delete • / search • esc back"))

	return AppStyle.Render(b.String())
}

func (m *Model) updateSlates(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	if m.searching {
		switch msg.String() {
		case "esc":
			m.searching = false
			m.searchInput.SetValue("")
			m.slates = m.store.List()
			m.selected = 0
			return m, nil
		case "enter":
			m.searching = false
			return m, nil
		default:
			var cmd tea.Cmd
			m.searchInput, cmd = m.searchInput.Update(msg)
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
		if len(m.slates) > 0 {
			return m.editSlate(m.slates[m.selected])
		}
	case "n":
		return m.createNewSlate()
	case "d":
		if len(m.slates) > 0 {
			slate := m.slates[m.selected]
			m.confirmMsg = fmt.Sprintf("delete \"%s\"?", slate.Title)
			m.confirmAction = func() {
				m.store.Delete(slate.ID)
				m.slates = m.store.List()
				if m.selected >= len(m.slates) && m.selected > 0 {
					m.selected--
				}
				m.statusMsg = "slate deleted"
				m.statusTime = time.Now()
			}
			m.view = ViewConfirm
		}
	case "/":
		m.searching = true
		m.searchInput.Focus()
		return m, textinput.Blink
	case "esc", "q":
		m.view = ViewHome
		m.selected = 0
	}
	return m, nil
}

// ============================================================================
// EDITOR VIEW
// ============================================================================

func (m Model) viewEditor() string {
	var b strings.Builder

	// Title
	title := m.editorTitle
	if title == "" {
		title = "untitled"
	}
	titleDisplay := TitleStyle.Render(" " + title + " ")
	if m.editorModified {
		titleDisplay += " " + WarningStyle.Render("(modified)")
	}
	b.WriteString(titleDisplay + "\n\n")

	// Preview
	preview := m.editorContent
	maxPreview := (m.height - 12) * (m.width - 10) / 50 // rough char estimate
	if maxPreview < 200 {
		maxPreview = 200
	}
	if len(preview) > maxPreview {
		preview = preview[:maxPreview] + "..."
	}
	if preview == "" {
		preview = DimStyle.Render("(empty - press 'e' to edit)")
	}

	previewBox := PreviewStyle.
		Width(m.width - 8).
		Height(m.height - 12).
		Render(preview)
	b.WriteString(previewBox + "\n\n")

	// Stats
	words := len(strings.Fields(m.editorContent))
	chars := len(m.editorContent)
	b.WriteString(WordCountStyle.Render(fmt.Sprintf("%d words • %d characters", words, chars)))

	b.WriteString("\n\n")
	editor := m.config.GetEditor()
	if editor == "" {
		editor = "your editor"
	}
	b.WriteString(HelpStyle.Render(fmt.Sprintf("e open in %s • s save • esc back", editor)))

	return AppStyle.Render(b.String())
}

func (m *Model) updateEditor(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "e":
		return m.openEditor()
	case "s":
		return m.saveSlate()
	case "esc", "q":
		m.view = ViewSlates
		m.slates = m.store.List()
	}
	return m, nil
}

// ============================================================================
// LOGIN VIEW
// ============================================================================

func (m Model) viewLogin() string {
	var b strings.Builder

	b.WriteString(TitleStyle.Render(" login ") + "\n\n")
	b.WriteString(SubtitleStyle.Render("login to sync your slates to justtype.io") + "\n\n")

	// Username
	b.WriteString(LabelStyle.Render("username or email") + "\n")
	if m.inputFocus == 0 {
		b.WriteString(FocusedInputStyle.Render(m.usernameInput.View()))
	} else {
		b.WriteString(InputStyle.Render(m.usernameInput.View()))
	}
	b.WriteString("\n\n")

	// Password
	b.WriteString(LabelStyle.Render("password") + "\n")
	if m.inputFocus == 1 {
		b.WriteString(FocusedInputStyle.Render(m.passwordInput.View()))
	} else {
		b.WriteString(InputStyle.Render(m.passwordInput.View()))
	}
	b.WriteString("\n\n")

	if m.loginError != "" {
		b.WriteString(ErrorStyle.Render("✗ "+m.loginError) + "\n\n")
	}

	if m.loading {
		b.WriteString(m.spinner.View() + " logging in...")
	}

	b.WriteString("\n\n")
	b.WriteString(HelpStyle.Render("tab switch • enter login • esc cancel"))

	content := WelcomeBoxStyle.Width(50).Render(b.String())
	return Centered(m.width, m.height, content)
}

func (m *Model) updateLogin(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "tab", "down":
		m.inputFocus = (m.inputFocus + 1) % 2
		if m.inputFocus == 0 {
			m.passwordInput.Blur()
			m.usernameInput.Focus()
		} else {
			m.usernameInput.Blur()
			m.passwordInput.Focus()
		}
		return m, textinput.Blink
	case "shift+tab", "up":
		m.inputFocus = (m.inputFocus + 1) % 2
		if m.inputFocus == 0 {
			m.passwordInput.Blur()
			m.usernameInput.Focus()
		} else {
			m.usernameInput.Blur()
			m.passwordInput.Focus()
		}
		return m, textinput.Blink
	case "enter":
		return m.doLogin()
	case "esc":
		m.view = ViewHome
		m.usernameInput.SetValue("")
		m.passwordInput.SetValue("")
		m.loginError = ""
		m.selected = 0
	default:
		var cmd tea.Cmd
		if m.inputFocus == 0 {
			m.usernameInput, cmd = m.usernameInput.Update(msg)
		} else {
			m.passwordInput, cmd = m.passwordInput.Update(msg)
		}
		return m, cmd
	}
	return m, nil
}

type loginResultMsg struct {
	success  bool
	username string
	token    string
	err      error
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
	m.client.SetToken(msg.token)
	m.statusMsg = fmt.Sprintf("welcome, %s! syncing slates...", msg.username)
	m.statusTime = time.Now()
	m.view = ViewHome
	m.selected = 0
	m.usernameInput.SetValue("")
	m.passwordInput.SetValue("")
	m.loading = true
	m.loadingMsg = "syncing slates..."

	// Pull cloud slates after login
	return m, m.pullCloudSlates()
}

func (m *Model) pullCloudSlates() tea.Cmd {
	return func() tea.Msg {
		// Get list of all slates
		cloudSlates, err := m.client.ListSlates()
		if err != nil {
			return cloudSyncMsg{err: err}
		}

		var slates []*store.Slate
		for _, cs := range cloudSlates {
			// Fetch full content for each slate
			full, err := m.client.GetSlate(cs.ID)
			if err != nil {
				continue // Skip slates we can't fetch
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
// SETTINGS VIEW
// ============================================================================

func (m Model) viewSettings() string {
	var b strings.Builder

	b.WriteString(TitleStyle.Render(" settings ") + "\n\n")

	items := []struct {
		label string
		value string
	}{
		{"editor", m.config.GetEditor()},
		{"export all slates", ""},
	}

	// Add update option
	if m.updateAvailable {
		items = append(items, struct{ label, value string }{"update", "v" + m.latestVersion + " available"})
	} else {
		items = append(items, struct{ label, value string }{"check for updates", "v" + updater.GetVersion()})
	}

	items = append(items, struct{ label, value string }{"back", ""})

	if items[0].value == "" {
		items[0].value = "(not set)"
	}

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

	if m.updating {
		b.WriteString("\n" + m.spinner.View() + " updating...")
	}

	b.WriteString("\n")
	b.WriteString(HelpStyle.Render("↑/↓ select • enter choose • esc back"))

	return AppStyle.Render(b.String())
}

func (m *Model) updateSettings(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "up", "k":
		if m.selected > 0 {
			m.selected--
		}
	case "down", "j":
		if m.selected < 3 {
			m.selected++
		}
	case "enter":
		switch m.selected {
		case 0: // editor
			m.view = ViewSetupEditor
			m.editorSelection = 0
			// Find current editor in list
			current := m.config.GetEditor()
			for i, e := range m.editors {
				if e == current {
					m.editorSelection = i
					break
				}
			}
		case 1: // export
			m.view = ViewExport
			m.exportInput.SetValue("~/Documents/justtype")
			m.exportInput.Focus()
			return m, textinput.Blink
		case 2: // update
			if m.updateAvailable {
				m.updating = true
				return m, func() tea.Msg {
					err := updater.Update()
					return updateDoneMsg{err: err}
				}
			} else {
				// Check for updates
				return m, checkForUpdate()
			}
		case 3: // back
			m.view = ViewHome
			m.selected = 0
		}
	case "esc", "q":
		m.view = ViewHome
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
	b.WriteString(SubtitleStyle.Render("export all slates as .txt files") + "\n\n")

	b.WriteString(LabelStyle.Render("export path") + "\n")
	b.WriteString(FocusedInputStyle.Render(m.exportInput.View()) + "\n\n")

	b.WriteString(DimStyle.Render(fmt.Sprintf("%d slates will be exported", len(m.store.List()))) + "\n\n")

	if m.errorMsg != "" {
		b.WriteString(ErrorStyle.Render(m.errorMsg) + "\n\n")
	}

	b.WriteString(HelpStyle.Render("enter export • esc cancel"))

	content := WelcomeBoxStyle.Width(55).Render(b.String())
	return Centered(m.width, m.height, content)
}

func (m *Model) updateExport(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "enter":
		path := m.exportInput.Value()
		if strings.HasPrefix(path, "~/") {
			home, _ := os.UserHomeDir()
			path = home + path[1:]
		}

		err := m.store.ExportAll(path)
		if err != nil {
			m.errorMsg = err.Error()
			return m, nil
		}

		m.statusMsg = fmt.Sprintf("exported %d slates to %s", len(m.store.List()), path)
		m.statusTime = time.Now()
		m.view = ViewSettings
		m.errorMsg = ""
	case "esc":
		m.view = ViewSettings
		m.errorMsg = ""
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
	content := m.confirmMsg + "\n\n"
	content += ButtonStyle.Render("y yes") + "  " + ButtonDimStyle.Render("n no")

	box := DialogStyle.Render(content)
	return Centered(m.width, m.height, box)
}

func (m *Model) updateConfirm(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "y", "Y", "enter":
		if m.confirmAction != nil {
			m.confirmAction()
		}
		m.view = ViewSlates
		m.confirmAction = nil
	case "n", "N", "esc":
		m.view = ViewSlates
		m.confirmAction = nil
	}
	return m, nil
}

// ============================================================================
// LOADING VIEW
// ============================================================================

func (m Model) viewLoading() string {
	content := m.spinner.View() + " " + m.loadingMsg
	return Centered(m.width, m.height, content)
}

// ============================================================================
// HELPERS
// ============================================================================

func (m *Model) createNewSlate() (tea.Model, tea.Cmd) {
	slate := m.store.Create("untitled", "")
	m.currentSlate = slate
	m.editorTitle = slate.Title
	m.editorContent = slate.Content
	m.editorModified = false
	m.view = ViewEditor
	return m, nil
}

func (m *Model) editSlate(slate *store.Slate) (tea.Model, tea.Cmd) {
	m.currentSlate = slate
	m.editorTitle = slate.Title
	m.editorContent = slate.Content
	m.editorModified = false
	m.view = ViewEditor
	return m, nil
}

type editorDoneMsg struct {
	path string
	err  error
}

func (m *Model) openEditor() (tea.Model, tea.Cmd) {
	editor := m.config.GetEditor()
	if editor == "" {
		m.errorMsg = "no editor configured - go to settings"
		return m, nil
	}

	// Create temp file
	tmpFile, err := os.CreateTemp("", "justtype-*.md")
	if err != nil {
		m.errorMsg = err.Error()
		return m, nil
	}

	// Write content
	content := m.editorTitle + "\n\n" + m.editorContent
	tmpFile.WriteString(content)
	tmpFile.Close()

	c := exec.Command(editor, tmpFile.Name())
	return m, tea.ExecProcess(c, func(err error) tea.Msg {
		return editorDoneMsg{path: tmpFile.Name(), err: err}
	})
}

func (m *Model) handleEditorDone(msg editorDoneMsg) (tea.Model, tea.Cmd) {
	if msg.err != nil {
		m.errorMsg = msg.err.Error()
		os.Remove(msg.path)
		return m, nil
	}

	data, err := os.ReadFile(msg.path)
	os.Remove(msg.path)

	if err != nil {
		m.errorMsg = err.Error()
		return m, nil
	}

	content := string(data)
	lines := strings.SplitN(content, "\n", 2)

	if len(lines) > 0 {
		m.editorTitle = strings.TrimSpace(lines[0])
	}
	if len(lines) > 1 {
		m.editorContent = strings.TrimSpace(lines[1])
	}
	m.editorModified = true

	return m, nil
}

func (m *Model) saveSlate() (tea.Model, tea.Cmd) {
	if m.currentSlate == nil {
		return m, nil
	}

	m.store.Update(m.currentSlate.ID, m.editorTitle, m.editorContent)
	m.currentSlate = m.store.Get(m.currentSlate.ID)
	m.editorModified = false
	m.statusMsg = "saved"
	m.statusTime = time.Now()

	// Auto-sync to cloud if logged in
	if m.config.IsLoggedIn() {
		return m, m.syncSlateToCloud(m.currentSlate)
	}

	return m, nil
}

func (m *Model) syncSlateToCloud(slate *store.Slate) tea.Cmd {
	return func() tea.Msg {
		if slate.CloudID > 0 {
			// Update existing cloud slate
			err := m.client.UpdateSlate(slate.CloudID, slate.Title, slate.Content)
			if err != nil {
				return cloudSaveMsg{slateID: slate.ID, err: err}
			}
			return cloudSaveMsg{slateID: slate.ID, cloudID: slate.CloudID}
		} else {
			// Create new cloud slate
			cloudSlate, err := m.client.CreateSlate(slate.Title, slate.Content)
			if err != nil {
				return cloudSaveMsg{slateID: slate.ID, err: err}
			}
			return cloudSaveMsg{slateID: slate.ID, cloudID: cloudSlate.ID}
		}
	}
}

func (m *Model) syncSlates() (tea.Model, tea.Cmd) {
	if !m.config.IsLoggedIn() {
		m.errorMsg = "please login first"
		return m, nil
	}

	m.loading = true
	m.loadingMsg = "syncing..."

	return m, func() tea.Msg {
		// First, push local unsynced slates
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

		// Then, pull cloud slates
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

func formatTimeAgo(t time.Time) string {
	diff := time.Since(t)

	switch {
	case diff < time.Minute:
		return "now"
	case diff < time.Hour:
		return fmt.Sprintf("%dm", int(diff.Minutes()))
	case diff < 24*time.Hour:
		return fmt.Sprintf("%dh", int(diff.Hours()))
	case diff < 7*24*time.Hour:
		return fmt.Sprintf("%dd", int(diff.Hours()/24))
	default:
		return t.Format("Jan 2")
	}
}
