import AppKit

// The Mac's menus: the system's own items in the system's words, justtype's
// commands in justtype's lowercase. Edit's items are what make the usual
// shortcuts (copy, paste, undo, select all) reach the web view at all.
// The app's own commands run the command palette's (App.jsx
// handleCommandExecute through window.__jtMenu); the page answers a shortcut
// it knows first (⌘S, ⌘E, ⌘P, ⌘K), so a menu item only acts when the page
// did not.
enum AppMenu {
    static func build() -> NSMenu {
        let bar = NSMenu()
        let name = "justtype"

        let app = NSMenu(title: name)
        app.addItem(withTitle: "About \(name)", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        Updates.menuItems.forEach(app.addItem)
        app.addItem(.separator())
        app.addItem(command("Settings…", "NAVIGATE_ACCOUNT", key: ","))
        app.addItem(.separator())
        app.addItem(withTitle: "Hide \(name)", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let others = app.addItem(withTitle: "Hide Others", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        others.keyEquivalentModifierMask = [.command, .option]
        app.addItem(withTitle: "Show All", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        app.addItem(.separator())
        app.addItem(withTitle: "Quit \(name)", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        add(app, to: bar)

        let file = NSMenu(title: "File")
        file.addItem(command("new slate", "NEW_SLATE", key: "n"))
        // Works from any app (QuickCapture.swift); shown here to be found
        let quick = file.addItem(withTitle: "new slate from anywhere", action: #selector(AppDelegate.quickSlate(_:)),
                                 keyEquivalent: QuickCapture.keyEquivalent)
        quick.keyEquivalentModifierMask = QuickCapture.modifiers
        file.addItem(command("open my slates", "NAVIGATE_SLATES", key: "o"))
        file.addItem(command("today's slate", "TODAY", key: "t"))
        file.addItem(.separator())
        file.addItem(command("import…", "IMPORT", key: "i", modifiers: [.command, .shift]))
        file.addItem(.separator())
        file.addItem(command("save", "SAVE", key: "s"))
        file.addItem(command("share…", "SHARE"))
        file.addItem(command("export…", "EXPORT_MENU", key: "e"))
        file.addItem(command("export as pdf…", "EXPORT", payload: "pdf", key: "p"))
        file.addItem(.separator())
        file.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        add(file, to: bar)

        let edit = NSMenu(title: "Edit")
        edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        let redo = edit.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        edit.addItem(.separator())
        edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        edit.addItem(.separator())
        edit.addItem(command("select slates", "SELECT_SLATES"))
        add(edit, to: bar)

        let view = NSMenu(title: "View")
        view.addItem(command("command palette…", "PALETTE", key: "k"))
        view.addItem(.separator())
        let tuning = view.addItem(withTitle: "palette glass…", action: #selector(AppDelegate.glassTuning(_:)), keyEquivalent: "g")
        tuning.keyEquivalentModifierMask = [.command, .option]
        view.addItem(command("rich or plain editor", "TOGGLE_EDITOR"))
        view.addItem(command("zen mode", "TOGGLE_ZEN"))
        let focus = NSMenu(title: "focus")
        focus.addItem(command("off", "SET_FOCUS", payload: "off"))
        focus.addItem(command("on", "SET_FOCUS", payload: "on"))
        focus.addItem(command("smart", "SET_FOCUS", payload: "auto"))
        let focusItem = view.addItem(withTitle: "focus", action: nil, keyEquivalent: "")
        focusItem.submenu = focus
        view.addItem(.separator())
        view.addItem(withTitle: "Reload", action: #selector(AppDelegate.reload(_:)), keyEquivalent: "r")
        view.addItem(.separator())
        view.addItem(withTitle: "Actual Size", action: #selector(AppDelegate.actualSize(_:)), keyEquivalent: "0")
        view.addItem(withTitle: "Zoom In", action: #selector(AppDelegate.zoomIn(_:)), keyEquivalent: "+")
        view.addItem(withTitle: "Zoom Out", action: #selector(AppDelegate.zoomOut(_:)), keyEquivalent: "-")
        view.addItem(.separator())
        let full = view.addItem(withTitle: "Enter Full Screen", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        full.keyEquivalentModifierMask = [.command, .control]
        add(view, to: bar)

        let window = NSMenu(title: "Window")
        window.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        window.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        // ⌘1 to ⌘8 pick that tab, ⌘9 the last, as in Safari; the menu lists
        // the windows and tabs itself
        for n in 1...9 {
            let item = window.addItem(withTitle: n == 9 ? "Select Last Tab" : "Select Tab \(n)",
                                      action: #selector(AppDelegate.selectTab(_:)), keyEquivalent: "\(n)")
            item.tag = n
            item.isHidden = true
            item.allowsKeyEquivalentWhenHidden = true
        }
        add(window, to: bar)
        NSApp.windowsMenu = window

        return bar
    }

    // An item that runs one of the page's commands in the front window
    private static func command(_ title: String, _ action: String, payload: String? = nil,
                                key: String = "", modifiers: NSEvent.ModifierFlags = .command) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: #selector(AppDelegate.pageCommand(_:)), keyEquivalent: key)
        item.keyEquivalentModifierMask = modifiers
        item.representedObject = [action, payload ?? ""]
        return item
    }

    private static func add(_ menu: NSMenu, to bar: NSMenu) {
        let item = NSMenuItem()
        item.submenu = menu
        bar.addItem(item)
    }
}
