import AppKit

final class AppDelegate: NSObject, NSApplicationDelegate {
    // Before launch finishes, so a service or a file that opened the app is heard
    func applicationWillFinishLaunching(_ notification: Notification) {
        NSApp.servicesProvider = ServiceProvider.shared
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        Updates.start()
        NSApp.mainMenu = AppMenu.build()
        if !Profile.clean { QuickCapture.start() }
        NSUpdateDynamicServices()
        MainWindow.open()
        NSApp.activate(ignoringOtherApps: true)
    }

    // The last window is kept alive when closed: the dock icon brings it back as it was
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { MainWindow.current?.show() }
        return true
    }

    // Every tab's text goes to the device's queue before the app goes away
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard !MainWindow.all.isEmpty else { return .terminateNow }
        let all = DispatchGroup()
        for window in MainWindow.all {
            all.enter()
            window.flush { all.leave() }
        }
        all.notify(queue: .main) { NSApp.reply(toApplicationShouldTerminate: true) }
        return .terminateLater
    }

    // Text files dropped on the Dock icon or opened with the app
    func application(_ application: NSApplication, open urls: [URL]) {
        QuickCapture.importFiles(urls)
    }

    @objc func quickSlate(_ sender: Any?) { QuickCapture.open(with: nil) }
    @objc func glassTuning(_ sender: Any?) { GlassTuningPanel.shared.show() }
    @objc func reload(_ sender: Any?) { MainWindow.current?.reload() }
    @objc func zoomIn(_ sender: Any?) { MainWindow.current?.zoom(by: 0.1) }
    @objc func zoomOut(_ sender: Any?) { MainWindow.current?.zoom(by: -0.1) }
    @objc func actualSize(_ sender: Any?) { MainWindow.current?.zoom(by: 0) }

    @objc func pageCommand(_ sender: NSMenuItem) {
        guard let command = sender.representedObject as? [String], command.count == 2 else { return }
        MainWindow.current?.run(command[0], payload: command[1])
    }
    @objc func selectTab(_ sender: NSMenuItem) {
        guard let group = NSApp.keyWindow?.tabGroup, !group.windows.isEmpty else { return }
        let tabs = group.windows
        guard sender.tag == 9 || sender.tag <= tabs.count else { return }
        let tab = sender.tag == 9 ? tabs[tabs.count - 1] : tabs[sender.tag - 1]
        tab.makeKeyAndOrderFront(nil)
    }
}
