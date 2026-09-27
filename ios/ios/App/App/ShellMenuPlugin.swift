import UIKit
import Capacitor
import AuthenticationServices
import SafariServices

// ShellMenu.show({ items }) from the page: the phone's own action sheet with
// those words (danger in red), resolving with the id picked, or null when
// it is dismissed. Items: { id, label, danger?, disabled? }. Used where the
// page has no native control under the finger (a slate row's dots).
@objc(ShellMenuPlugin)
public class ShellMenuPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ShellMenuPlugin"
    public let jsName = "ShellMenu"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "show", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "exportText", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "exportFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "exportPDF", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "shareURL", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "signIn", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openURL", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "tags", returnType: CAPPluginReturnPromise)
    ]
    private var authSession: ASWebAuthenticationSession?

    // ShellMenu.signIn({ url, scheme }): the system's sign-in sheet (real
    // Safari, which Google allows and a web view it does not). It resolves
    // with the url the server sent back to `scheme://`, or { cancelled }.
    @objc func signIn(_ call: CAPPluginCall) {
        guard let string = call.getString("url"), let url = URL(string: string) else { call.reject("no url"); return }
        let scheme = call.getString("scheme") ?? "justtype"
        DispatchQueue.main.async {
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: scheme) { [weak self] callback, _ in
                self?.authSession = nil
                if let callback { call.resolve(["url": callback.absoluteString]) }
                else { call.resolve(["cancelled": true]) }
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            self.authSession = session
            if !session.start() { self.authSession = nil; call.resolve(["cancelled": true]) }
        }
    }

    // ShellMenu.tags({ title, subtitle, placeholder, tooMany, maxTags,
    // maxLength, tags, library }): a slate's tags in the phone's own sheet.
    // Resolves with { tags } once the sheet closes, however it closes: what
    // is ticked is what the slate keeps, so there is no save to miss.
    @objc func tags(_ call: CAPPluginCall) {
        let current = call.getArray("tags", String.self) ?? []
        let library = call.getArray("library", String.self) ?? []
        DispatchQueue.main.async {
            guard let host = self.bridge?.viewController else { call.reject("no view"); return }
            (host as? ShellViewController)?.closeWriterMenu?()
            let picker = ShellTagsSheet(
                title: call.getString("title") ?? "tags", subtitle: call.getString("subtitle") ?? "",
                placeholder: call.getString("placeholder") ?? "", tooMany: call.getString("tooMany") ?? "",
                maxTags: call.getInt("maxTags") ?? 20, maxLength: call.getInt("maxLength") ?? 24,
                current: current, library: library
            ) { picked in call.resolve(["tags": picked]) }
            let nav = UINavigationController(rootViewController: picker)
            nav.modalPresentationStyle = .pageSheet
            if let sheet = nav.sheetPresentationController {
                sheet.detents = [.medium(), .large()]
                sheet.prefersGrabberVisible = true
            }
            nav.presentationController?.delegate = picker
            (host.presentedViewController ?? host).present(nav, animated: true)
        }
    }

    // ShellMenu.openURL({ url }): a web page over the app, in Safari's own
    // sheet (a page that asked for a new window)
    @objc func openURL(_ call: CAPPluginCall) {
        guard let string = call.getString("url"), let url = URL(string: string),
              url.scheme == "https" || url.scheme == "http" else { call.reject("bad url"); return }
        DispatchQueue.main.async {
            guard let host = self.bridge?.viewController else { call.reject("no view"); return }
            let safari = SFSafariViewController(url: url)
            safari.dismissButtonStyle = .close
            host.present(safari, animated: true)
            call.resolve()
        }
    }

    @objc func exportText(_ call: CAPPluginCall) {
        let text = call.getString("text") ?? ""
        let filename = call.getString("filename") ?? "slate.txt"
        DispatchQueue.main.async { self.shareFile(Data(text.utf8), filename: filename, call: call) }
    }

    // Any file the page made (the export-all zip), as base64
    @objc func exportFile(_ call: CAPPluginCall) {
        guard let data = Data(base64Encoded: call.getString("base64") ?? "") else { call.reject("base64 required"); return }
        let filename = call.getString("filename") ?? "justtype-export"
        DispatchQueue.main.async { self.shareFile(data, filename: filename, call: call) }
    }

    @objc func exportPDF(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let web = self.bridge?.webView else { call.reject("no web view"); return }
            let pages = ShellPrintRenderer()
            pages.addPrintFormatter(web.viewPrintFormatter(), startingAtPageAt: 0)
            let data = UIGraphicsPDFRenderer(bounds: pages.paperRect).pdfData { context in
                for page in 0..<pages.numberOfPages {
                    context.beginPage()
                    pages.drawPage(at: page, in: pages.paperRect)
                }
            }
            self.shareFile(data, filename: call.getString("filename") ?? "slate.pdf", call: call)
        }
    }

    // A link handed to the phone's share sheet (messages, mail, copy, airdrop),
    // hung from the button that asked on an iPad. Resolves with whether it
    // went anywhere.
    @objc func shareURL(_ call: CAPPluginCall) {
        // A link, or plain text (a nearby device's code)
        let item: Any
        if let raw = call.getString("url"), let url = URL(string: raw) { item = url }
        else if let text = call.getString("text") { item = text }
        else { call.reject("url or text required"); return }
        DispatchQueue.main.async {
            guard let vc = self.bridge?.viewController, vc.presentedViewController == nil else {
                call.reject("close the current sheet first"); return
            }
            let sheet = UIActivityViewController(activityItems: [item], applicationActivities: nil)
            sheet.completionWithItemsHandler = { _, completed, _, _ in call.resolve(["shared": completed]) }
            if let pop = sheet.popoverPresentationController, let web = self.bridge?.webView {
                pop.sourceView = web
                pop.sourceRect = CGRect(x: call.getDouble("x") ?? web.bounds.midX, y: call.getDouble("y") ?? web.bounds.midY,
                                        width: call.getDouble("width") ?? 1, height: call.getDouble("height") ?? 1)
            }
            vc.present(sheet, animated: true)
        }
    }

    private func shareFile(_ data: Data, filename: String, call: CAPPluginCall) {
        guard let vc = bridge?.viewController, vc.presentedViewController == nil else {
            call.reject("close the current sheet first"); return
        }
        // Each export owns its temporary directory; dismissing the share sheet
        // removes it. Only a basename supplied by the page is used.
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let name = (filename as NSString).lastPathComponent
        let url = directory.appendingPathComponent(name.isEmpty ? "slate.txt" : name)
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try data.write(to: url)
        } catch { call.reject("could not prepare export", nil, error); return }
        let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        sheet.completionWithItemsHandler = { _, _, _, _ in
            try? FileManager.default.removeItem(at: directory)
        }
        if let pop = sheet.popoverPresentationController {
            pop.sourceView = vc.view
            pop.sourceRect = CGRect(x: vc.view.bounds.midX, y: vc.view.safeAreaLayoutGuide.layoutFrame.maxY - 60, width: 1, height: 1)
        }
        vc.present(sheet, animated: true) { call.resolve() }
    }

    // ShellMenu.show({ x, y, width, height, items }) from the page: a small
    // glass menu hung off that rectangle (a row's dots), the way iOS menus
    // look: a word per row, its symbol on the right, the red ones in a group
    // of their own at the bottom. Resolves with the id picked, or null when a
    // tap lands anywhere else. Items: { id, label, symbol?, danger?, disabled? }.
    @objc func show(_ call: CAPPluginCall) {
        let items = (call.options["items"] as? [[String: Any]]) ?? []
        let anchor = CGRect(x: call.getDouble("x") ?? 0, y: call.getDouble("y") ?? 0,
                            width: call.getDouble("width") ?? 1, height: call.getDouble("height") ?? 1)
        DispatchQueue.main.async {
            guard let host = self.bridge?.viewController?.view, let web = self.bridge?.webView else {
                call.reject("no view"); return
            }
            ShellPopMenu(items: items, anchor: web.convert(anchor, to: host), in: host) { id in
                call.resolve(["id": id as Any? ?? NSNull()])
            }.open()
        }
    }
}

// The menu itself: a clear layer over the page that takes the tap outside,
// and the glass card on it, grown from the corner nearest the dots.
private final class ShellPopMenu {
    private let overlay = UIControl()
    private let card: UIVisualEffectView
    private var finish: ((String?) -> Void)?
    private let fromTop: Bool
    private let anchor: CGRect
    private var retainSelf: ShellPopMenu?

    init(items: [[String: Any]], anchor: CGRect, in host: UIView, finish: @escaping (String?) -> Void) {
        self.finish = finish
        self.anchor = anchor
        let effect: UIVisualEffect
        if #available(iOS 26.0, *) { effect = UIGlassEffect() } else { effect = UIBlurEffect(style: .systemMaterial) }
        card = UIVisualEffectView(effect: effect)
        card.layer.cornerRadius = 22
        card.layer.cornerCurve = .continuous
        card.clipsToBounds = true

        let stack = UIStackView()
        stack.axis = .vertical
        stack.translatesAutoresizingMaskIntoConstraints = false
        card.contentView.addSubview(stack)
        // Plain first, then the red ones behind a gap, the way iOS groups them
        let plain = items.filter { $0["danger"] as? Bool != true }
        let red = items.filter { $0["danger"] as? Bool == true }
        var rows: [UIView] = plain.map { ShellPopMenu.row($0) }
        if !plain.isEmpty && !red.isEmpty {
            let gap = UIView()
            gap.backgroundColor = UIColor.separator.withAlphaComponent(0.35)
            gap.heightAnchor.constraint(equalToConstant: 6).isActive = true
            rows.append(gap)
        }
        rows += red.map { ShellPopMenu.row($0) }
        rows.forEach { stack.addArrangedSubview($0) }
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: card.contentView.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: card.contentView.trailingAnchor),
            stack.topAnchor.constraint(equalTo: card.contentView.topAnchor, constant: 6),
            stack.bottomAnchor.constraint(equalTo: card.contentView.bottomAnchor, constant: -6)
        ])

        // As wide as its longest word needs, within reason; under the dots,
        // or over them when there is no room below
        let widest = items.map { (($0["label"] as? String ?? "") as NSString).size(withAttributes: [.font: shellFont(14)]).width }.max() ?? 0
        let width = min(max(widest + 76, 200), 300)
        let height = stack.systemLayoutSizeFitting(CGSize(width: width, height: 0), withHorizontalFittingPriority: .required, verticalFittingPriority: .fittingSizeLevel).height + 12
        let safe = host.safeAreaLayoutGuide.layoutFrame.insetBy(dx: 8, dy: 8)
        fromTop = anchor.maxY + 6 + height <= safe.maxY || anchor.minY - 6 - height < safe.minY
        let x = min(max(anchor.maxX - width, safe.minX), safe.maxX - width)
        let y = fromTop ? anchor.maxY + 6 : anchor.minY - 6 - height
        card.frame = CGRect(x: x, y: y, width: width, height: height)

        overlay.frame = host.bounds
        overlay.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        overlay.addAction(UIAction { [weak self] _ in self?.close(nil) }, for: .touchUpInside)
        overlay.addSubview(card)
        host.addSubview(overlay)
        (host.next as? ShellViewController)?.closeWriterMenu?()

        for case let control as UIControl in stack.arrangedSubviews {
            control.addAction(UIAction { [weak self] _ in
                guard let id = control.accessibilityIdentifier else { return }
                shellHaptic("selection")
                self?.close(id)
            }, for: .touchUpInside)
        }
        retainSelf = self
    }

    // One row: the word on the left, its symbol on the right, a press shade
    private static func row(_ item: [String: Any]) -> UIControl {
        let danger = item["danger"] as? Bool == true
        let disabled = item["disabled"] as? Bool == true
        let tint: UIColor = danger ? .systemRed : .label
        let control = ShellMenuRow()
        control.accessibilityIdentifier = item["id"] as? String
        control.isEnabled = !disabled
        control.alpha = disabled ? 0.4 : 1
        control.isAccessibilityElement = true
        control.accessibilityLabel = item["label"] as? String
        control.accessibilityTraits = .button
        let label = UILabel()
        label.text = item["label"] as? String
        label.font = shellFont(14)
        label.textColor = tint
        label.translatesAutoresizingMaskIntoConstraints = false
        control.addSubview(label)
        let icon = UIImageView(image: (item["symbol"] as? String).flatMap { UIImage(systemName: $0) })
        icon.tintColor = tint
        icon.preferredSymbolConfiguration = UIImage.SymbolConfiguration(pointSize: 15, weight: .regular)
        icon.contentMode = .center
        icon.translatesAutoresizingMaskIntoConstraints = false
        control.addSubview(icon)
        NSLayoutConstraint.activate([
            control.heightAnchor.constraint(equalToConstant: 44),
            label.leadingAnchor.constraint(equalTo: control.leadingAnchor, constant: 18),
            label.centerYAnchor.constraint(equalTo: control.centerYAnchor),
            label.trailingAnchor.constraint(lessThanOrEqualTo: icon.leadingAnchor, constant: -12),
            icon.trailingAnchor.constraint(equalTo: control.trailingAnchor, constant: -18),
            icon.centerYAnchor.constraint(equalTo: control.centerYAnchor),
            icon.widthAnchor.constraint(equalToConstant: 22)
        ])
        return control
    }

    func open() {
        // Grow from the corner nearest the dots: the anchor point moves there,
        // the position with it, so the card stays where it was placed
        let frame = card.frame
        let corner = CGPoint(x: anchor.midX > frame.midX ? 1 : 0, y: fromTop ? 0 : 1)
        card.layer.anchorPoint = corner
        card.layer.position = CGPoint(x: frame.minX + frame.width * corner.x, y: frame.minY + frame.height * corner.y)
        if UIAccessibility.isReduceMotionEnabled { UIAccessibility.post(notification: .screenChanged, argument: card); return }
        card.alpha = 0
        card.transform = CGAffineTransform(scaleX: 0.6, y: 0.6)
        UIView.animate(withDuration: 0.38, delay: 0, usingSpringWithDamping: 0.82, initialSpringVelocity: 0.4, options: [.allowUserInteraction]) {
            self.card.alpha = 1
            self.card.transform = .identity
        }
        UIAccessibility.post(notification: .screenChanged, argument: card)
    }

    private func close(_ id: String?) {
        guard let finish else { return }
        self.finish = nil
        overlay.isUserInteractionEnabled = false
        let done = { self.overlay.removeFromSuperview(); self.retainSelf = nil }
        if UIAccessibility.isReduceMotionEnabled { done() }
        else {
            UIView.animate(withDuration: 0.16, animations: {
                self.card.alpha = 0
                self.card.transform = CGAffineTransform(scaleX: 0.9, y: 0.9)
            }, completion: { _ in done() })
        }
        finish(id)
    }
}

// A menu row that shades while pressed, the way iOS menus do
private final class ShellMenuRow: UIControl {
    override var isHighlighted: Bool {
        didSet { backgroundColor = isHighlighted ? UIColor.label.withAlphaComponent(0.08) : .clear }
    }
}

// The tags sheet: a field for a new tag, then every tag with a check on the
// slate's. Typing narrows the list and offers the typed word as a new tag;
// return, a space or a comma adds it. The field only takes what a tag may
// be (a-z, 0-9, lowercased as typed), so it never has to say no.
private final class ShellTagsSheet: UITableViewController, UITextFieldDelegate, UIAdaptivePresentationControllerDelegate {
    private var order: [String]        // every tag the list shows, new ones first
    private var picks: [String]        // the slate's tags, in the order they were given
    private let maxTags: Int
    private let maxLength: Int
    private let tooMany: String
    private let placeholder: String
    private let subtitle: String
    private var finish: (([String]) -> Void)?
    private let field = UITextField()
    private let footer = UITableViewHeaderFooterView()

    private var typed: String { field.text ?? "" }
    private var shown: [String] { typed.isEmpty ? order : order.filter { $0.contains(typed) } }
    private var offersNew: Bool { !typed.isEmpty && !order.contains(typed) }

    init(title: String, subtitle: String, placeholder: String, tooMany: String, maxTags: Int, maxLength: Int,
         current: [String], library: [String], finish: @escaping ([String]) -> Void) {
        order = current + library.filter { !current.contains($0) }
        picks = current
        self.maxTags = maxTags
        self.maxLength = maxLength
        self.tooMany = tooMany
        self.placeholder = placeholder
        self.subtitle = subtitle
        self.finish = finish
        super.init(style: .insetGrouped)
        self.title = title
    }
    required init?(coder: NSCoder) { fatalError() }

    override func viewDidLoad() {
        super.viewDidLoad()
        tableView.register(UITableViewCell.self, forCellReuseIdentifier: "tag")
        tableView.keyboardDismissMode = .interactive
        navigationController?.navigationBar.titleTextAttributes = [.font: shellFont(16, weight: .medium)]
        if #available(iOS 26.0, *), !subtitle.isEmpty { navigationItem.subtitle = subtitle }
        navigationItem.rightBarButtonItem = UIBarButtonItem(systemItem: .done, primaryAction: UIAction { [weak self] _ in
            self?.close(dismissing: true)
        })
        field.font = shellFont(16)
        field.placeholder = placeholder
        field.autocapitalizationType = .none
        field.autocorrectionType = .no
        field.spellCheckingType = .no
        field.smartInsertDeleteType = .no
        field.keyboardType = .asciiCapable
        field.returnKeyType = .default
        field.clearButtonMode = .whileEditing
        field.delegate = self
        field.addTarget(self, action: #selector(typedChanged), for: .editingChanged)
        setError(nil)
    }

    // With nothing to tick, the field is the only thing to do
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        if order.isEmpty { field.becomeFirstResponder() }
    }

    private lazy var fieldCell: UITableViewCell = {
        let cell = UITableViewCell(style: .default, reuseIdentifier: nil)
        cell.selectionStyle = .none
        let icon = UIImageView(image: UIImage(systemName: "tag"))
        icon.tintColor = .secondaryLabel
        icon.preferredSymbolConfiguration = UIImage.SymbolConfiguration(pointSize: 15, weight: .regular)
        icon.contentMode = .center
        icon.translatesAutoresizingMaskIntoConstraints = false
        field.translatesAutoresizingMaskIntoConstraints = false
        cell.contentView.addSubview(icon)
        cell.contentView.addSubview(field)
        let margins = cell.contentView.layoutMarginsGuide
        NSLayoutConstraint.activate([
            icon.leadingAnchor.constraint(equalTo: margins.leadingAnchor),
            icon.centerYAnchor.constraint(equalTo: cell.contentView.centerYAnchor),
            icon.widthAnchor.constraint(equalToConstant: 22),
            field.leadingAnchor.constraint(equalTo: icon.trailingAnchor, constant: 12),
            field.trailingAnchor.constraint(equalTo: margins.trailingAnchor),
            field.topAnchor.constraint(equalTo: cell.contentView.topAnchor),
            field.bottomAnchor.constraint(equalTo: cell.contentView.bottomAnchor),
            field.heightAnchor.constraint(greaterThanOrEqualToConstant: 48)
        ])
        return cell
    }()

    // The field's footer carries the one thing it can refuse: one tag too
    // many. Only sets it; `refresh` lays it out.
    private func setError(_ text: String?) {
        var c = UIListContentConfiguration.groupedFooter()
        c.text = text ?? ""
        c.textProperties.font = shellFont(12)
        c.textProperties.color = .systemRed
        footer.contentConfiguration = c
    }

    // The list again, and the footer's height with it, in one update: the
    // rows are counted from the typed word, so a relayout alone after it
    // changed would find the counts off and throw
    private func refresh(_ list: UITableView.RowAnimation?) {
        guard isViewLoaded else { return }
        tableView.performBatchUpdates {
            if let list { tableView.reloadSections([1], with: list) }
        }
    }

    @objc private func typedChanged() {
        setError(nil)
        UIView.performWithoutAnimation { refresh(.none) }
    }

    private func pick(_ tag: String) -> Bool {
        if picks.contains(tag) { return true }
        guard picks.count < maxTags else { setError(tooMany); refresh(nil); return false }
        picks.append(tag)
        return true
    }

    // The typed word becomes a tag, ticked, at the top of the list
    @discardableResult private func addTyped() -> Bool {
        let tag = typed
        guard !tag.isEmpty else { return true }
        guard pick(tag) else { return false }
        if !order.contains(tag) { order.insert(tag, at: 0) }
        field.text = ""
        setError(nil)
        shellHaptic("selection")
        refresh(.automatic)
        return true
    }

    func textField(_ textField: UITextField, shouldChangeCharactersIn range: NSRange, replacementString string: String) -> Bool {
        if string == " " || string == "," { addTyped(); return false }
        let current = textField.text ?? ""
        guard let r = Range(range, in: current) else { return false }
        let clean = String(string.lowercased().filter { $0.isASCII && ($0.isLetter || $0.isNumber) })
        let next = String(current.replacingCharacters(in: r, with: clean).prefix(maxLength))
        if next == current.replacingCharacters(in: r, with: string) { return true }
        textField.text = next
        typedChanged()
        return false
    }

    func textFieldShouldReturn(_ textField: UITextField) -> Bool {
        if typed.isEmpty { textField.resignFirstResponder() } else { addTyped() }
        return false
    }

    // Typing wants the room the keyboard leaves
    func textFieldDidBeginEditing(_ textField: UITextField) {
        guard let sheet = navigationController?.sheetPresentationController else { return }
        sheet.animateChanges { sheet.selectedDetentIdentifier = .large }
    }

    override func numberOfSections(in tableView: UITableView) -> Int { 2 }

    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        section == 0 ? 1 : shown.count + (offersNew ? 1 : 0)
    }

    override func tableView(_ tableView: UITableView, viewForFooterInSection section: Int) -> UIView? {
        section == 0 ? footer : nil
    }

    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        if indexPath.section == 0 { return fieldCell }
        let cell = tableView.dequeueReusableCell(withIdentifier: "tag", for: indexPath)
        var c = cell.defaultContentConfiguration()
        c.textProperties.font = shellFont(16)
        c.imageProperties.tintColor = .label
        if offersNew && indexPath.row == 0 {
            c.text = typed
            c.image = UIImage(systemName: "plus.circle")
            cell.accessoryType = .none
            cell.accessibilityHint = nil
        } else {
            let tag = shown[indexPath.row - (offersNew ? 1 : 0)]
            c.text = tag
            c.image = nil
            cell.accessoryType = picks.contains(tag) ? .checkmark : .none
        }
        cell.contentConfiguration = c
        cell.tintColor = .label
        return cell
    }

    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        guard indexPath.section == 1 else { return }
        if offersNew && indexPath.row == 0 { addTyped(); return }
        let tag = shown[indexPath.row - (offersNew ? 1 : 0)]
        if let i = picks.firstIndex(of: tag) { picks.remove(at: i) }
        else if !pick(tag) { return }
        setError(nil)
        shellHaptic("selection")
        // A tag picked from what was typed ends the typing
        if !typed.isEmpty {
            field.text = ""
            refresh(.automatic)
        } else {
            tableView.performBatchUpdates { tableView.reloadRows(at: [indexPath], with: .none) }
        }
    }

    private func close(dismissing: Bool) {
        guard let finish else { return }
        self.finish = nil
        addTyped()   // a word left in the field counts, as if added
        finish(picks)
        if dismissing { dismiss(animated: true) }
    }

    func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
        close(dismissing: false)
    }
}

private final class ShellPrintRenderer: UIPrintPageRenderer {
    override var paperRect: CGRect { CGRect(x: 0, y: 0, width: 595.2, height: 841.8) }
    override var printableRect: CGRect { paperRect.insetBy(dx: 51, dy: 51) }
}

extension ShellMenuPlugin: ASWebAuthenticationPresentationContextProviding {
    public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        bridge?.viewController?.view.window ?? ASPresentationAnchor()
    }
}
