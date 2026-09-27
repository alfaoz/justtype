import AppKit
import Sparkle

// The update window, in justtype's words, type and theme, in place of
// Sparkle's own: this is Sparkle's user driver, so Sparkle still finds,
// fetches, checks and installs; this only asks and tells. Quiet automatic
// updates never show it. It answers "check for updates…", and comes up by
// itself for a critical update (release.sh --critical), which offers no
// skip, no later and no close, and asks again at every launch until it is in.
final class UpdateDriver: NSObject, SPUUserDriver {
    private var panel: JustPanel?
    private var expected: UInt64 = 0
    private var received: UInt64 = 0
    // A choice Sparkle waits on; closing the window answers it as "later"
    private var pending: ((SPUUserUpdateChoice) -> Void)?
    private var newVersion = ""

    private static let criticalKey = "JTCriticalBuild"
    private var current: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "" }
    private var build: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "" }

    // At launch: a critical update seen and not yet in is asked for again
    func resumeCritical(_ updater: SPUUpdater) {
        guard let wanted = UserDefaults.standard.string(forKey: Self.criticalKey) else { return }
        if build.compare(wanted, options: .numeric) != .orderedAscending {
            UserDefaults.standard.removeObject(forKey: Self.criticalKey)
        } else {
            updater.checkForUpdatesInBackground()
        }
    }

    // MARK: asking

    func show(_ request: SPUUpdatePermissionRequest, reply: @escaping (SUUpdatePermissionResponse) -> Void) {
        // Automatic checks are on from the start (Info.plist), so never asked
        reply(SUUpdatePermissionResponse(automaticUpdateChecks: true, sendSystemProfile: false))
    }

    func showUserInitiatedUpdateCheck(cancellation: @escaping () -> Void) {
        present(title: "checking for updates…", detail: nil, closable: true,
                actions: [.space, .other("cancel") { [weak self] in cancellation(); self?.close() }]) { cancellation() }
    }

    func showUpdateFound(with appcastItem: SUAppcastItem, state: SPUUserUpdateState, reply: @escaping (SPUUserUpdateChoice) -> Void) {
        let critical = appcastItem.isCriticalUpdate
        if critical { UserDefaults.standard.set(appcastItem.versionString, forKey: Self.criticalKey) }
        newVersion = appcastItem.displayVersionString
        pending = reply
        let answer = { [weak self] (choice: SPUUserUpdateChoice) in
            self?.pending = nil
            reply(choice)
            if choice != .install { self?.close() }
        }
        let title = state.stage == .notDownloaded ? "justtype \(newVersion) is here" : "justtype \(newVersion) is ready"
        let yours = newVersion == current ? "a newer build of the version you have." : "you have \(current)."
        // A release that says what changed (release.sh --whats-new) links to it
        var actions: [JustPanel.Action] = []
        if let notes = appcastItem.fullReleaseNotesURL ?? appcastItem.releaseNotesURL {
            actions.append(.other("what's new") { NSWorkspace.shared.open(notes) })
        }
        if critical {
            present(title: title, detail: "\(yours) this one can't be skipped.", closable: false,
                    actions: actions + [.space, .main("install and restart") { answer(.install) }], later: nil)
        } else {
            present(title: title, detail: yours, closable: true,
                    actions: actions + [.other("skip this version") { answer(.skip) }, .space,
                                        .other("later") { answer(.dismiss) },
                                        .main(state.stage == .notDownloaded ? "install" : "restart") { answer(.install) }]) { answer(.dismiss) }
        }
    }

    func showUpdateReleaseNotes(with downloadData: SPUDownloadData) {}
    func showUpdateReleaseNotesFailedToDownloadWithError(_ error: Error) {}

    func showUpdateNotFoundWithError(_ error: Error, acknowledgement: @escaping () -> Void) {
        let done = { [weak self] in acknowledgement(); self?.close() }
        present(title: "justtype is up to date", detail: "you have \(current).", closable: true,
                actions: [.space, .main("ok") { done() }]) { acknowledgement() }
    }

    func showUpdaterError(_ error: Error, acknowledgement: @escaping () -> Void) {
        let done = { [weak self] in acknowledgement(); self?.close() }
        present(title: "couldn't update", detail: error.localizedDescription, closable: true,
                actions: [.space, .main("ok") { done() }]) { acknowledgement() }
    }

    // MARK: telling

    func showDownloadInitiated(cancellation: @escaping () -> Void) {
        expected = 0
        received = 0
        let critical = UserDefaults.standard.string(forKey: Self.criticalKey) != nil
        present(title: "getting justtype \(newVersion)", detail: "downloading…", closable: !critical,
                actions: critical ? [] : [.space, .other("cancel") { [weak self] in cancellation(); self?.close() }]) { cancellation() }
    }

    func showDownloadDidReceiveExpectedContentLength(_ expectedContentLength: UInt64) { expected = expectedContentLength }

    func showDownloadDidReceiveData(ofLength length: UInt64) {
        received += length
        guard expected > 0 else { return }
        panel?.detail("downloading… \(min(100, Int(Double(received) / Double(expected) * 100)))%")
    }

    func showDownloadDidStartExtractingUpdate() { panel?.detail("getting it ready…") }
    func showExtractionReceivedProgress(_ progress: Double) {}

    // The install was already asked for: straight on to the restart
    func showReady(toInstallAndRelaunch reply: @escaping (SPUUserUpdateChoice) -> Void) {
        panel?.detail("restarting…")
        reply(.install)
    }

    func showInstallingUpdate(withApplicationTerminated applicationTerminated: Bool, retryTerminatingApplication: @escaping () -> Void) {
        panel?.detail("installing…")
    }

    func showUpdateInstalledAndRelaunched(_ relaunched: Bool, acknowledgement: @escaping () -> Void) {
        UserDefaults.standard.removeObject(forKey: Self.criticalKey)
        acknowledgement()
    }

    func showUpdateInFocus() { panel?.front() }
    func dismissUpdateInstallation() { close() }

    // MARK: the window

    private func present(title: String, detail: String?, closable: Bool, actions: [JustPanel.Action], later: (() -> Void)?) {
        let panel = self.panel ?? JustPanel()
        self.panel = panel
        panel.onClose = later
        panel.show(title: title, detail: detail, closable: closable, actions: actions)
    }

    private func close() {
        panel?.onClose = nil
        panel?.window.orderOut(nil)
    }

    // A look at the window without an update, for its design:
    // JUSTTYPE_UPDATE_PREVIEW=found|critical|latest|checking
    func preview(_ kind: String) {
        newVersion = "4.2.2"
        switch kind {
        case "critical":
            present(title: "justtype 4.2.2 is here", detail: "you have \(current). this one can't be skipped.", closable: false,
                    actions: [.other("what's new") {}, .space, .main("install and restart") { [weak self] in self?.panel?.detail("downloading… 42%") }], later: nil)
        case "checking":
            present(title: "checking for updates…", detail: nil, closable: true,
                    actions: [.space, .other("cancel") { [weak self] in self?.close() }], later: nil)
        case "latest":
            present(title: "justtype is up to date", detail: "you have \(current).", closable: true,
                    actions: [.space, .main("ok") { [weak self] in self?.close() }], later: nil)
        default:
            present(title: "justtype 4.2.2 is here", detail: "you have \(current).", closable: true,
                    actions: [.other("what's new") {}, .other("skip this version") { [weak self] in self?.close() }, .space,
                              .other("later") { [weak self] in self?.close() },
                              .main("install") { [weak self] in self?.panel?.detail("downloading… 42%") }], later: nil)
        }
    }
}
