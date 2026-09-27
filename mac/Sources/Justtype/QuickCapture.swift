import AppKit
import Carbon.HIToolbox

// Writing from anywhere on the Mac: ⌃⌥⌘N in any app brings justtype
// forward with the caret in a blank slate; text selected in another app
// goes into one through the Services menu (and the right-click menu); text
// files dropped on the Dock icon, or opened with the app, are imported
// into my slates. The page does the rest (App.jsx QUICK_SLATE, IMPORT_TEXT).
enum QuickCapture {
    // The shortcut, as the File menu shows it
    static let keyEquivalent = "n"
    static let modifiers: NSEvent.ModifierFlags = [.control, .option, .command]
    private static var hotKey: EventHotKeyRef?

    // Carbon's hot keys reach the app from any app, and need no permission
    static func start() {
        var pressed = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(GetApplicationEventTarget(), { _, _, _ in
            DispatchQueue.main.async { QuickCapture.open(with: nil) }
            return noErr
        }, 1, &pressed, nil, nil)
        let id = EventHotKeyID(signature: OSType(0x6A74_7970), id: 1) // "jtyp"
        RegisterEventHotKey(UInt32(kVK_ANSI_N), UInt32(controlKey | optionKey | cmdKey), id, GetApplicationEventTarget(), 0, &hotKey)
    }

    // A blank slate in the front window, or `text` in one, the app forward
    static func open(with text: String?) {
        NSApp.activate(ignoringOtherApps: true)
        let main = MainWindow.current ?? MainWindow.open()
        if main.window.isMiniaturized { main.window.deminiaturize(nil) }
        main.show()
        main.run("QUICK_SLATE", payload: text ?? "")
    }

    // Text files, by name and words, for the page's import
    static func importFiles(_ urls: [URL]) {
        let files: [[String: String]] = urls.compactMap { url in
            guard let data = try? Data(contentsOf: url), let text = String(data: data, encoding: .utf8) else { return nil }
            return ["name": url.lastPathComponent, "text": text]
        }
        guard !files.isEmpty, let json = try? JSONSerialization.data(withJSONObject: files),
              let payload = String(data: json, encoding: .utf8) else { return }
        NSApp.activate(ignoringOtherApps: true)
        let main = MainWindow.current ?? MainWindow.open()
        if main.window.isMiniaturized { main.window.deminiaturize(nil) }
        main.show()
        main.run("IMPORT_TEXT", payload: payload)
    }
}

// The Services menu's "new justtype slate with selection" (Info.plist NSServices)
final class ServiceProvider: NSObject {
    static let shared = ServiceProvider()

    @objc func newSlateWithSelection(_ pasteboard: NSPasteboard, userData: String, error: AutoreleasingUnsafeMutablePointer<NSString>) {
        guard let text = pasteboard.string(forType: .string), !text.isEmpty else { return }
        QuickCapture.open(with: text)
    }
}
