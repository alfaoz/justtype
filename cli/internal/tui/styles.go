package tui

import "github.com/charmbracelet/lipgloss"

var (
	// Brand colors
	purple     = lipgloss.Color("#8B5CF6")
	purpleDim  = lipgloss.Color("#6D28D9")
	green      = lipgloss.Color("#10B981")
	red        = lipgloss.Color("#EF4444")
	yellow     = lipgloss.Color("#F59E0B")
	white      = lipgloss.Color("#FFFFFF")
	gray       = lipgloss.Color("#9CA3AF")
	darkGray   = lipgloss.Color("#4B5563")
	darkerGray = lipgloss.Color("#374151")
	darkest    = lipgloss.Color("#1F2937")
	black      = lipgloss.Color("#111827")

	// Logo style
	LogoStyle = lipgloss.NewStyle().
			Foreground(purple).
			Bold(true)

	// App container
	AppStyle = lipgloss.NewStyle().
			Padding(1, 2)

	// Title bar
	TitleStyle = lipgloss.NewStyle().
			Foreground(white).
			Background(purple).
			Bold(true).
			Padding(0, 2).
			MarginBottom(1)

	// Subtitle / description
	SubtitleStyle = lipgloss.NewStyle().
			Foreground(gray).
			MarginBottom(1)

	// Menu item (not selected)
	MenuItemStyle = lipgloss.NewStyle().
			Foreground(gray).
			PaddingLeft(2)

	// Menu item (selected)
	SelectedStyle = lipgloss.NewStyle().
			Foreground(white).
			Background(purpleDim).
			Bold(true).
			PaddingLeft(1).
			PaddingRight(1)

	// List item style
	ListItemStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("#E5E7EB")).
			PaddingLeft(2)

	// Selected list item
	SelectedListStyle = lipgloss.NewStyle().
				Foreground(white).
				Background(darkerGray).
				PaddingLeft(1).
				PaddingRight(1)

	// Input field
	InputStyle = lipgloss.NewStyle().
			Foreground(white).
			Background(darkest).
			Padding(0, 1).
			MarginTop(0).
			MarginBottom(1)

	// Focused input
	FocusedInputStyle = lipgloss.NewStyle().
				Foreground(white).
				Background(darkest).
				BorderStyle(lipgloss.RoundedBorder()).
				BorderForeground(purple).
				Padding(0, 1)

	// Label for inputs
	LabelStyle = lipgloss.NewStyle().
			Foreground(gray).
			MarginBottom(0)

	// Help text at bottom
	HelpStyle = lipgloss.NewStyle().
			Foreground(darkGray).
			MarginTop(1)

	// Success message
	SuccessStyle = lipgloss.NewStyle().
			Foreground(green)

	// Error message
	ErrorStyle = lipgloss.NewStyle().
			Foreground(red)

	// Warning
	WarningStyle = lipgloss.NewStyle().
			Foreground(yellow)

	// Dim text
	DimStyle = lipgloss.NewStyle().
			Foreground(darkGray)

	// Badge styles
	BadgeStyle = lipgloss.NewStyle().
			Foreground(white).
			Background(darkGray).
			Padding(0, 1)

	PublishedBadgeStyle = lipgloss.NewStyle().
				Foreground(white).
				Background(green).
				Padding(0, 1)

	SyncedBadgeStyle = lipgloss.NewStyle().
				Foreground(white).
				Background(purple).
				Padding(0, 1)

	// Preview box for content
	PreviewStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("#D1D5DB")).
			Background(darkest).
			Padding(1, 2).
			BorderStyle(lipgloss.RoundedBorder()).
			BorderForeground(darkerGray)

	// Dialog box
	DialogStyle = lipgloss.NewStyle().
			Background(darkest).
			BorderStyle(lipgloss.RoundedBorder()).
			BorderForeground(purple).
			Padding(1, 2).
			Width(50)

	// Status bar
	StatusBarStyle = lipgloss.NewStyle().
			Foreground(gray).
			Background(black).
			Padding(0, 1)

	// Box for sections
	BoxStyle = lipgloss.NewStyle().
			BorderStyle(lipgloss.RoundedBorder()).
			BorderForeground(darkerGray).
			Padding(1, 2)

	// Welcome screen specific
	WelcomeBoxStyle = lipgloss.NewStyle().
			BorderStyle(lipgloss.RoundedBorder()).
			BorderForeground(purple).
			Padding(2, 4).
			Width(60)

	// Button style
	ButtonStyle = lipgloss.NewStyle().
			Foreground(white).
			Background(purple).
			Padding(0, 2).
			MarginRight(1)

	ButtonDimStyle = lipgloss.NewStyle().
			Foreground(gray).
			Background(darkerGray).
			Padding(0, 2).
			MarginRight(1)

	// Cursor
	CursorStyle = lipgloss.NewStyle().
			Foreground(purple).
			Bold(true)

	// Word count
	WordCountStyle = lipgloss.NewStyle().
			Foreground(darkGray)

	// Spinner
	SpinnerStyle = lipgloss.NewStyle().
			Foreground(purple)
)

// Centered places content in the center of the screen
func Centered(width, height int, content string) string {
	return lipgloss.Place(width, height, lipgloss.Center, lipgloss.Center, content)
}

// VerticalCenter centers content vertically
func VerticalCenter(height int, content string) string {
	return lipgloss.PlaceVertical(height, lipgloss.Center, content)
}
