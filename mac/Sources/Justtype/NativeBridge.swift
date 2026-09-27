import AppKit
import AuthenticationServices
import UniformTypeIdentifiers
import WebKit

// What the page can ask the Mac for, under the same plugin and method names
// the iOS shell answers (src/shell.js nativeHost): the page calls
// window.justtypeMac.nativePromise(plugin, method, args) and gets a promise.
// Only the plugins below are claimed, so everything else in the web app
// takes its browser path (the phone's menus, Face ID, the keychain).
//
// ShellStore  get / put / putMany / remove / all  the offline copies, as files
// ShellMenu   signIn                              Google through the Mac's sign-in sheet
//             show                                the phone's menus (src/shellMenu.js nativeMenu) as the Mac's own
// ShellHaptic tap                                 the trackpad's alignment tap (src/cues.js snapTap)
// ShellAlert  confirm                             a yes-or-no question as the Mac's alert (useMacConfirm)
// ShellGlass  update, backdrop, peek                        the page's glass, drawn by the system (macOS 26, src/macGlass.js)
//             pill, pillUpdates                          the writer's pill's panel in a narrow window (PillPanel.swift)
final class NativeBridge: NSObject, WKScriptMessageHandlerWithReply, ASWebAuthenticationPresentationContextProviding {
    static var claimed: [String] {
        if #available(macOS 26.0, *), MainWindow.glass { return ["ShellStore", "ShellGlass"] }
        return ["ShellStore"]
    }

    // Injected before the page's own scripts
    static var script: String {
        let list = claimed.map { "'\($0)'" }.joined(separator: ",")
        return """
        (() => {
          const claimed = new Set([\(list)]);
          window.justtypeMac = {
            platform: 'mac',
            isPluginAvailable: (name) => claimed.has(name),
            nativePromise: (plugin, method, args) =>
              window.webkit.messageHandlers.native.postMessage({ plugin, method, args: args || {} }),
          };
          document.documentElement.dataset.mac = '';
        })();
        """
    }

    // One store for every tab: its queue is what keeps writes in order
    private let store = FileStore.shared
    private var authSession: ASWebAuthenticationSession?
    weak var window: NSWindow?
    weak var webView: WKWebView?
    // Where the page's glass goes (MainWindow sets it up on macOS 26)
    var onGlass: (([String: Any]) -> Void)?
    var onBackdrop: (([String: Any]) -> Void)?
    var onPeek: (([String: Any]) -> Void)?
    var onPill: ((String, [String: Any]) -> Void)?

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard let body = message.body as? [String: Any],
              let plugin = body["plugin"] as? String, let method = body["method"] as? String else {
            replyHandler(nil, "bad call"); return
        }
        let args = body["args"] as? [String: Any] ?? [:]
        switch (plugin, method) {
        case ("ShellStore", _):
            store.handle(method, args) { result, error in replyHandler(result, error) }
        case ("ShellMenu", "signIn"):
            signIn(args, replyHandler)
        case ("ShellGlass", "update"):
            onGlass?(args["changes"] as? [String: Any] ?? [:])
            replyHandler(nil, nil)
        case ("ShellHaptic", "tap"):
            // The trackpad's click-into-place, felt while the finger is down
            NSHapticFeedbackManager.defaultPerformer.perform(.alignment, performanceTime: .now)
            replyHandler(nil, nil)
        case ("ShellGlass", "tuning"):
            GlassTuningPanel.shared.show()
            replyHandler(nil, nil)
        case ("ShellGlass", "peek"):
            onPeek?(args)
            replyHandler(nil, nil)
        case ("ShellGlass", "backdrop"):
            onBackdrop?(args)
            replyHandler(nil, nil)
        case ("ShellGlass", "pill"), ("ShellGlass", "pillUpdates"):
            onPill?(method, args)
            replyHandler(nil, nil)
        case ("ShellAlert", "confirm"):
            confirm(args, replyHandler)
        case ("ShellMenu", "openText"):
            openText(args, replyHandler)
        case ("ShellMenu", "show"):
            // After this call returns: the menu runs its own loop until it closes
            DispatchQueue.main.async { self.showMenu(args, replyHandler) }
        default:
            replyHandler(nil, "\(plugin).\(method) is not available on the Mac")
        }
    }

    // The system's sign-in sheet (Google refuses web views). Resolves with
    // the url the server sent back to justtype://, or { cancelled }.
    private func signIn(_ args: [String: Any], _ reply: @escaping (Any?, String?) -> Void) {
        guard let string = args["url"] as? String, let url = URL(string: string) else { reply(nil, "no url"); return }
        let scheme = args["scheme"] as? String ?? "justtype"
        let session = ASWebAuthenticationSession(url: url, callbackURLScheme: scheme) { [weak self] callback, _ in
            self?.authSession = nil
            if let callback { reply(["url": callback.absoluteString], nil) } else { reply(["cancelled": true], nil) }
        }
        session.presentationContextProvider = self
        session.prefersEphemeralWebBrowserSession = false
        authSession = session
        if !session.start() { authSession = nil; reply(["cancelled": true], nil) }
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        window ?? NSApp.keyWindow ?? NSWindow()
    }

    // A sheet on the window with the page's words, in justtype's own panel
    // (Panel.swift): yes is the lit capsule (return), red when it destroys,
    // no answers escape, and a third answer (`other`, as Don't Save is) sits
    // at the left. Resolves with { confirmed, other }.
    private var sheet: JustPanel?
    private func confirm(_ args: [String: Any], _ reply: @escaping (Any?, String?) -> Void) {
        let panel = JustPanel()
        sheet = panel
        let answer = { [weak self] (confirmed: Bool, other: Bool) in
            panel.end()
            self?.sheet = nil
            reply(["confirmed": confirmed, "other": other], nil)
        }
        var actions: [JustPanel.Action] = []
        if let other = args["other"] as? String { actions.append(.other(other) { answer(false, true) }) }
        actions.append(.space)
        actions.append(.cancel(args["cancel"] as? String ?? "cancel") { answer(false, false) })
        let yes = args["confirm"] as? String ?? "ok"
        actions.append(args["danger"] as? Bool == true ? .danger(yes) { answer(true, false) } : .main(yes) { answer(true, false) })
        let title = args["title"] as? String ?? "", message = args["message"] as? String
        if let window {
            panel.sheet(on: window, page: webView, title: title, detail: message, actions: actions)
        } else {
            panel.show(title: title, detail: message, closable: false, actions: actions)
        }
    }

    // A menu hanging from the element that opened it (x, y, width, height in
    // the page's pixels): under it, or over it when it sits low in the
    // window, lined up with its right edge when it sits on the right. A point
    // (no size) is a right click: the menu opens there. Resolves with the id
    // picked, or null. With `preview`, the page hears which row is lit as
    // the pointer moves (window.__jtMenuPreview(id), null when it closes),
    // as the theme menu does to show a theme before it is picked.
    private func showMenu(_ args: [String: Any], _ reply: @escaping (Any?, String?) -> Void) {
        guard let webView, let items = args["items"] as? [[String: Any]] else { reply(nil, "no menu"); return }
        let picker = MenuPicker()
        if args["preview"] as? Bool == true {
            picker.onHighlight = { [weak webView] id in
                let value = id.flatMap { String(data: try! JSONSerialization.data(withJSONObject: [$0]), encoding: .utf8) }.map { "\($0)[0]" } ?? "null"
                webView?.evaluateJavaScript("window.__jtMenuPreview && window.__jtMenuPreview(\(value)); 0")
            }
        }
        let menu = NSMenu()
        menu.autoenablesItems = false
        picker.fill(menu, items)
        let zoom = webView.pageZoom
        let value = { (key: String) in CGFloat(args[key] as? Double ?? 0) * zoom }
        let x = value("x"), top = value("y"), width = value("width"), height = value("height")
        var point = NSPoint(x: x, y: top)
        if width > 0 || height > 0 {
            let size = menu.size
            let low = top + height + size.height > webView.bounds.height && top > size.height
            point.y = low ? top - size.height - 4 : top + height + 4
            if x + width / 2 > webView.bounds.width / 2 { point.x = x + width - size.width }
        }
        if !webView.isFlipped { point.y = webView.bounds.height - point.y }
        menu.popUp(positioning: nil, at: point, in: webView)
        picker.onHighlight?(nil)
        reply(["id": picker.picked.map { $0 as Any } ?? NSNull()], nil)
    }

    // A text file the person picks (the theme menu's "import json"): the
    // Mac's open panel as a sheet on the window, as a file input would show,
    // which a press in a menu cannot open. Resolves with { name, text }, or
    // { cancelled }.
    private func openText(_ args: [String: Any], _ reply: @escaping (Any?, String?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        let types = (args["types"] as? [String] ?? []).compactMap { UTType(filenameExtension: $0) }
        if !types.isEmpty { panel.allowedContentTypes = types }
        let answer = { (response: NSApplication.ModalResponse) in
            guard response == .OK, let url = panel.url,
                  let text = try? String(contentsOf: url, encoding: .utf8) else { return reply(["cancelled": true], nil) }
            reply(["name": url.lastPathComponent, "text": text], nil)
        }
        if let window { panel.beginSheetModal(for: window, completionHandler: answer) } else { answer(panel.runModal()) }
    }
}

// Builds an NSMenu from the page's items ({ id, label, checked, disabled,
// danger, symbol, hint, children, inline, selector }): children make a
// submenu, inline makes a section between separators, a selector's title
// carries its current choice ("theme: dark")
final class MenuPicker: NSObject, NSMenuDelegate {
    private(set) var picked: String?
    var onHighlight: ((String?) -> Void)?

    func fill(_ menu: NSMenu, _ items: [[String: Any]]) {
        menu.delegate = self
        // The system's glass, the page's type
        menu.font = .justtype(13)
        for item in items {
            let children = item["children"] as? [[String: Any]]
            if item["inline"] as? Bool == true {
                menu.addItem(.separator())
                fill(menu, children ?? [])
                menu.addItem(.separator())
                continue
            }
            let label = item["label"] as? String ?? ""
            let entry = NSMenuItem(title: label, action: nil, keyEquivalent: "")
            // A row that opens more is lit by its id too
            entry.representedObject = item["id"] as? String
            if let children {
                let sub = NSMenu(title: label)
                sub.autoenablesItems = false
                fill(sub, children)
                entry.submenu = sub
                if item["selector"] as? Bool == true,
                   let chosen = children.first(where: { $0["checked"] as? Bool == true })?["label"] as? String {
                    entry.title = "\(label): \(chosen)"
                }
            } else {
                entry.target = self
                entry.action = #selector(pick(_:))
            }
            entry.state = item["checked"] as? Bool == true ? .on : .off
            entry.isEnabled = !(item["disabled"] as? Bool ?? false)
            entry.toolTip = item["hint"] as? String
            if let symbol = item["symbol"] as? String { entry.image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil) }
            if item["danger"] as? Bool == true {
                entry.attributedTitle = NSAttributedString(string: entry.title, attributes: [.font: NSFont.justtype(13), .foregroundColor: NSColor.systemRed])
            }
            menu.addItem(entry)
        }
        // No separator at either end or twice in a row
        var previousWasSeparator = true
        for entry in menu.items {
            if entry.isSeparatorItem && previousWasSeparator { menu.removeItem(entry) } else { previousWasSeparator = entry.isSeparatorItem }
        }
        if let last = menu.items.last, last.isSeparatorItem { menu.removeItem(last) }
    }

    @objc private func pick(_ sender: NSMenuItem) { picked = sender.representedObject as? String }

    func menu(_ menu: NSMenu, willHighlight item: NSMenuItem?) {
        if let id = item?.representedObject as? String { onHighlight?(id) }
    }
}

// The offline copies (src/offlineStore.js) as one JSON file per record under
// Application Support/justtype/offline/<store>/, written atomically on one
// serial queue: the same layout and calls as the iOS app's ShellStorePlugin.
// The records are ciphertext plus bookkeeping; the folder is left out of
// backups, since a restored copy could not be opened without the key.
final class FileStore {
    static let shared = FileStore()
    private let queue = DispatchQueue(label: "io.justtype.store")
    private let stores: Set<String> = ["slates", "lists", "pending", "history"]

    private lazy var root: URL? = {
        guard var url = Profile.clean ? FileManager.default.temporaryDirectory.appendingPathComponent("justtype-clean")
                : try? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        else { return nil }
        url.appendPathComponent("justtype/offline", isDirectory: true)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? url.setResourceValues(values)
        return url
    }()

    private func folder(_ store: String) -> URL? {
        guard stores.contains(store), let root else { return nil }
        let url = root.appendingPathComponent(store, isDirectory: true)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    // Keys carry ':' and ids; hex keeps every one a safe file name
    private func file(_ store: String, _ key: String) -> URL? {
        let name = key.utf8.map { String(format: "%02x", $0) }.joined()
        return folder(store)?.appendingPathComponent(name + ".json")
    }

    private func write(_ store: String, _ key: String, _ value: String) -> Bool {
        guard let url = file(store, key) else { return false }
        do { try Data(value.utf8).write(to: url, options: .atomic); return true } catch { return false }
    }

    func handle(_ method: String, _ args: [String: Any], _ done: @escaping (Any?, String?) -> Void) {
        let answer: (Any?, String?) -> Void = { result, error in DispatchQueue.main.async { done(result, error) } }
        guard let store = args["store"] as? String else { done(nil, "store required"); return }
        queue.async {
            switch method {
            case "get":
                guard let key = args["key"] as? String else { return answer(nil, "key required") }
                guard let url = self.file(store, key), let data = try? Data(contentsOf: url),
                      let value = String(data: data, encoding: .utf8) else { return answer(["value": NSNull()], nil) }
                answer(["value": value], nil)
            case "put":
                guard let key = args["key"] as? String, let value = args["value"] as? String else { return answer(nil, "key and value required") }
                self.write(store, key, value) ? answer([:], nil) : answer(nil, "write failed")
            case "putMany":
                guard let records = args["records"] as? [[String: Any]] else { return answer(nil, "records required") }
                for record in records {
                    guard let key = record["key"] as? String, let value = record["value"] as? String,
                          self.write(store, key, value) else { return answer(nil, "write failed") }
                }
                answer([:], nil)
            case "remove":
                guard let key = args["key"] as? String else { return answer(nil, "key required") }
                if let url = self.file(store, key) { try? FileManager.default.removeItem(at: url) }
                answer([:], nil)
            case "all":
                guard let dir = self.folder(store),
                      let names = try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil) else {
                    return answer(["values": []], nil)
                }
                let values = names.filter { $0.pathExtension == "json" }.compactMap { url -> String? in
                    guard let data = try? Data(contentsOf: url) else { return nil }
                    return String(data: data, encoding: .utf8)
                }
                answer(["values": values], nil)
            default:
                answer(nil, "unknown method \(method)")
            }
        }
    }
}

