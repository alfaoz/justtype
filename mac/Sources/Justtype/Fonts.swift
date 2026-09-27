import AppKit

// justtype's type for everything the app draws itself (menus, sheets, the
// update window, the bars): IBM Plex Mono, carried in the app
// (Resources/Fonts), the page's own face
extension NSFont {
    static func justtype(_ size: CGFloat, medium: Bool = false) -> NSFont {
        NSFontManager.shared.font(withFamily: "IBM Plex Mono", traits: [], weight: medium ? 6 : 5, size: size)
            ?? .monospacedSystemFont(ofSize: size, weight: medium ? .medium : .regular)
    }
}
