import AppKit
import Sparkle

// Updates, by Sparkle: a release build carries its feed
// (justtype.io/mac/appcast.xml) and the key its updates are signed with
// (build.sh --release writes both into Info.plist). It looks once a day,
// fetches a new version quietly and puts it in place when the app quits.
// In the app menu, "check for updates…" looks now and "update
// automatically" turns the quiet part off; what it has to say it says in
// justtype's own window (UpdatePanel.swift). Builds without a feed (the
// everyday one, the site's pictures) never look.
enum Updates {
    private static let driver = UpdateDriver()
    private static var updater: SPUUpdater?
    private static let menu = UpdateMenu()

    static func start() {
        // The window alone, for its design: JUSTTYPE_UPDATE_PREVIEW=found|critical|latest
        if let kind = ProcessInfo.processInfo.environment["JUSTTYPE_UPDATE_PREVIEW"] {
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) { driver.preview(kind) }
        }
        guard updater == nil, !Profile.clean,
              Bundle.main.object(forInfoDictionaryKey: "SUFeedURL") != nil else { return }
        let made = SPUUpdater(hostBundle: .main, applicationBundle: .main, userDriver: driver, delegate: nil)
        do { try made.start() } catch { return }
        updater = made
        driver.resumeCritical(made)
    }

    static var menuItems: [NSMenuItem] {
        guard updater != nil else { return [] }
        let check = NSMenuItem(title: "check for updates…", action: #selector(UpdateMenu.check(_:)), keyEquivalent: "")
        let automatic = NSMenuItem(title: "update automatically", action: #selector(UpdateMenu.automatic(_:)), keyEquivalent: "")
        check.target = menu
        automatic.target = menu
        return [check, automatic]
    }

    final class UpdateMenu: NSObject, NSMenuItemValidation {
        @objc func check(_ sender: Any?) { updater?.checkForUpdates() }
        @objc func automatic(_ sender: Any?) {
            guard let updater else { return }
            updater.automaticallyDownloadsUpdates.toggle()
        }
        func validateMenuItem(_ item: NSMenuItem) -> Bool {
            if item.action == #selector(automatic(_:)) { item.state = updater?.automaticallyDownloadsUpdates == true ? .on : .off }
            if item.action == #selector(check(_:)) { return updater?.canCheckForUpdates ?? false }
            return true
        }
    }
}
