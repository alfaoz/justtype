import UIKit
import SwiftUI
import Capacitor

// The writing menu's words (the word count, a save status) drawn on their own
// layer above the pill: they change without redrawing the glass, and counts
// roll digit by digit like the system's counters.
final class PillWords: ObservableObject {
    @Published var text = ""
    @Published var color = UIColor.label
    @Published var size: CGFloat = 14
    @Published var lift: CGFloat = 0
    @Published var countsDown = false
}

struct PillWordsView: View {
    @ObservedObject var words: PillWords
    var body: some View {
        let text = Text(words.text)
            .font(.custom("IBMPlexMono-Regular", fixedSize: words.size))
            .foregroundColor(Color(words.color))
            .lineLimit(1)
            .minimumScaleFactor(0.75)
        Group {
            if #available(iOS 16.0, *) { text.contentTransition(.numericText(countsDown: words.countsDown)) }
            else { text }
        }
        .offset(y: -words.lift)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}

// The pill keeps its own title (invisible) for sizing; the words layer sits
// exactly where that title is laid out, through every resize.
final class PillButton: UIButton {
    var wordsView: UIView?
    override func layoutSubviews() {
        super.layoutSubviews()
        guard let wordsView, let label = titleLabel else { return }
        wordsView.frame = CGRect(x: label.frame.minX, y: 0, width: max(label.frame.width, 1) + 6, height: bounds.height)
    }
}

// The same word-and-underline picker as the account accessibility settings.
// Its single underline stays mounted and slides between the text bounds.
private final class ShellTextSelector: UIView {
    var onSelect: ((Int) -> Void)?
    private let words = UIStackView()
    private let underline = UIView()
    private var buttons: [UIButton] = []
    private var selectedIndex = -1

    init(titles: [String]) {
        super.init(frame: .zero)
        words.translatesAutoresizingMaskIntoConstraints = false
        words.spacing = 4
        words.alignment = .fill
        addSubview(words)
        underline.backgroundColor = .label
        underline.isUserInteractionEnabled = false
        underline.isAccessibilityElement = false
        addSubview(underline)
        NSLayoutConstraint.activate([
            words.trailingAnchor.constraint(equalTo: trailingAnchor),
            words.leadingAnchor.constraint(greaterThanOrEqualTo: leadingAnchor),
            words.topAnchor.constraint(equalTo: topAnchor),
            words.bottomAnchor.constraint(equalTo: bottomAnchor),
            heightAnchor.constraint(equalToConstant: 40)
        ])
        for (index, title) in titles.enumerated() {
            let button = UIButton(type: .custom)
            button.setTitle(title, for: .normal)
            button.titleLabel?.font = shellFont(12)
            button.setTitleColor(.secondaryLabel, for: .normal)
            button.setTitleColor(.label, for: .selected)
            button.widthAnchor.constraint(equalToConstant: max(44, ceil((title as NSString).size(withAttributes: [.font: shellFont(12)]).width) + 8)).isActive = true
            button.addAction(UIAction { [weak self] _ in
                self?.select(index, animated: true)
                self?.onSelect?(index)
            }, for: .touchUpInside)
            words.addArrangedSubview(button)
            buttons.append(button)
        }
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func select(_ index: Int, animated: Bool) {
        guard selectedIndex != index else { return }
        layoutIfNeeded()
        selectedIndex = index
        for (i, button) in buttons.enumerated() {
            button.isSelected = i == index
            button.accessibilityTraits = i == index ? [.button, .selected] : [.button]
        }
        let changes = { self.placeUnderline() }
        if animated && !UIAccessibility.isReduceMotionEnabled && window != nil {
            UIView.animate(withDuration: 0.25, delay: 0,
                           options: [.beginFromCurrentState, .allowUserInteraction, .curveEaseInOut], animations: changes)
        } else { changes() }
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        words.layoutIfNeeded()
        placeUnderline()
    }

    private func placeUnderline() {
        guard buttons.indices.contains(selectedIndex) else {
            underline.isHidden = true
            return
        }
        underline.isHidden = false
        let button = buttons[selectedIndex]
        let font = button.titleLabel?.font ?? shellFont(12)
        let width = ceil(((button.currentTitle ?? "") as NSString).size(withAttributes: [.font: font]).width)
        let rect = button.convert(button.bounds, to: self)
        // UIButton may lay out its private title label after its parent.
        // Use the stable, centered word geometry rather than that stale frame.
        underline.frame = CGRect(x: rect.midX - width / 2, y: rect.midY + font.lineHeight / 2 + 2, width: width, height: 1)
    }
}

// A native dock button and an anchored, scrollable glass panel. The web
// app supplies the available choices and remains the source of truth.
// ShellPill.updates({ title, empty, unread, items: [{ id, title, message, date, link }] })
// keeps the account's updates: a tray beside export and about opens them in
// the panel, and a red dot beside the opener says something is unread. The
// tray sends `shell:nav` "updates"; picking one sends "update:<id>".
// ShellPill.action({ id, label, disabled? }) makes the button one word for a page with
// no writing menu (the list's `+ new slate`), sending `shell:nav` id when
// tapped; ShellPill.action({}) gives the button back to the writer.
@objc(ShellPillPlugin)
public class ShellPillPlugin: CAPPlugin, CAPBridgedPlugin, UIGestureRecognizerDelegate {
    public let identifier = "ShellPillPlugin"
    public let jsName = "ShellPill"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "hide", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "updates", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "action", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "settled", returnType: CAPPluginReturnPromise)
    ]
    private var button: UIButton?
    private var items: [[String: Any]] = []
    private var overlay: UIView?
    private var panelStack: UIStackView?
    private var scroll: UIScrollView?
    private var panelHeight: NSLayoutConstraint?
    private var settingsExpanded = false
    private var settingsWrapper: UIView?
    private var settingsHeight: NSLayoutConstraint?
    private var disclosure: UIButton?
    private var disclosureChevron: UIImageView?
    private weak var settingsButton: UIButton?
    private var expandedSettingsHeight: CGFloat = 0
    private var collapsedPanelHeight: CGFloat = 0
    private var selectors: [ShellTextSelector: [String]] = [:]
    private var themeButton: UIButton?
    private weak var saveButton: UIButton?
    private var status = ""
    private var displayKey = ""
    private var modelKey = ""
    private var menuAccessibilityLabel = "writing menu"
    private var updatesTitle = ""
    private var updatesEmpty = ""
    private var updateItems: [[String: Any]] = []
    private var updatesKey = ""
    private var showingUpdates = false
    private var unreadDot: UIView?
    private var unread = false
    private var pageAction: (id: String, label: String)?
    private let words = PillWords()
    private var wordsHost: UIHostingController<PillWordsView>?
    // What the pill shows now: a page's word, or the writing menu
    private var showingAction = false
    private var pendingHide: DispatchWorkItem?
    private var hiding = false
    private var dotTrailing: NSLayoutConstraint?
    private var dotLeading: NSLayoutConstraint?

    private struct PillState {
        let label: String
        let dirty: Bool
        let items: [[String: Any]]
        let status: String
        let color: [Double]
    }
    private var latestState: PillState?
    private var heldStatus = ""
    private var heldColor: [Double] = []
    private var statusVisibleUntil: TimeInterval = 0
    private var statusReset: DispatchWorkItem?
    // The status on show now, and one the owner tapped away (it stays away
    // until the page says something else)
    private var shownStatus = ""
    // Long press and slide up: a new slate, like a quick send. The word comes
    // from the page (empty while a new slate's unsaved words would be lost)
    private var quickLabel = ""
    private var quickBubble: UIView?
    private var quickOver = false
    private weak var quickHold: UILongPressGestureRecognizer?
    private weak var quickFlick: UIPanGestureRecognizer?
    private weak var slateCover: UIView?
    private var dismissedStatus = ""

    @objc func set(_ call: CAPPluginCall) {
        let label = call.getString("label") ?? ""
        let dirty = call.getBool("dirty") ?? false
        let items = (call.options["items"] as? [[String: Any]]) ?? []
        let status = call.getString("status") ?? ""
        let color = call.getArray("statusColor", Double.self) ?? [0, 201, 81]
        let quick = call.getString("quick") ?? ""
        DispatchQueue.main.async {
            self.quickLabel = quick
            // Off, a long press stays an ordinary tap
            self.quickHold?.isEnabled = !quick.isEmpty
            self.quickFlick?.isEnabled = !quick.isEmpty
            let state = PillState(label: label, dirty: dirty, items: items, status: status, color: color)
            let previousStatus = self.latestState?.status
            self.latestState = state
            if status != self.dismissedStatus { self.dismissedStatus = "" }
            self.statusReset?.cancel()
            self.statusReset = nil
            if !status.isEmpty && status != previousStatus {
                self.heldStatus = status
                self.heldColor = color
                // Give longer messages enough reading time even when the web
                // status clears earlier. A newer message always supersedes it.
                self.statusVisibleUntil = status.count > 18
                    ? ProcessInfo.processInfo.systemUptime + min(8, max(4, 2 + Double(status.count) / 16)) : 0
            }
            self.applyState(state)
            if status.isEmpty && !self.heldStatus.isEmpty {
                let remaining = self.statusVisibleUntil - ProcessInfo.processInfo.systemUptime
                if remaining > 0 {
                    let reset = DispatchWorkItem { [weak self] in
                        guard let self, let latest = self.latestState else { return }
                        self.heldStatus = ""
                        self.statusReset = nil
                        self.applyState(latest)
                    }
                    self.statusReset = reset
                    DispatchQueue.main.asyncAfter(deadline: .now() + remaining, execute: reset)
                }
            }
            call.resolve()
        }
    }

    @objc func action(_ call: CAPPluginCall) {
        let id = call.getString("id") ?? ""
        let label = call.getString("label") ?? ""
        let disabled = call.getBool("disabled") ?? false
        DispatchQueue.main.async {
            if id.isEmpty {
                guard self.pageAction != nil else { call.resolve(); return }
                self.pageAction = nil
                self.displayKey = ""
                self.button?.isEnabled = true
                self.unreadDot?.isHidden = true
                if let state = self.latestState { self.applyState(state) } else { self.hideSoon() }
                call.resolve()
                return
            }
            // A word changing to another word fades; the writer's menu
            // handing over the button morphs (a fade would show the old one)
            let wasAction = self.showingAction
            self.pageAction = (id, label)
            self.closePanel()
            let b = self.button ?? self.makeButton()
            var cfg = shellConfiguration(b) ?? .plain()
            var title = AttributedString(label)
            title.font = shellFont(14)
            title.foregroundColor = UIColor.label
            cfg.attributedTitle = title
            cfg.image = nil
            cfg.imagePadding = 0
            cfg.contentInsets = .init(top: 6, leading: 16, bottom: 6, trailing: 16)
            let host = self.bridge?.viewController as? ShellViewController
            let layout: () -> Void = { host?.setStatusMessageWidth(0) }
            // The page's word is the button's own title; the menu's words go
            if let wordsView = self.wordsHost?.view {
                if !wasAction && self.isShown(b) && !UIAccessibility.isReduceMotionEnabled {
                    UIView.animate(withDuration: 0.1) { wordsView.alpha = 0 }
                } else { wordsView.alpha = 0 }
            }
            if !wasAction && self.isShown(b) {
                shellMorph(b, configuration: cfg, in: host?.view, layoutChanges: layout)
            } else {
                let changed = wasAction && self.isShown(b) && self.displayKey != label
                shellSetTitle(b, configuration: cfg, in: host?.view, animated: changed, fadeOnly: true, layoutChanges: layout)
            }
            self.showingAction = true
            self.displayKey = label
            self.unreadDot?.isHidden = true
            b.accessibilityLabel = label
            b.isEnabled = !disabled
            self.present(b)
            call.resolve()
        }
    }

    private func applyState(_ state: PillState) {
        // A page's own word holds the button until the page gives it back
        guard pageAction == nil else { return }
        let label = state.label
        let dirty = state.dirty
        let items = state.items
        let holding = state.status.isEmpty && ProcessInfo.processInfo.systemUptime < statusVisibleUntil
        let offered = holding ? heldStatus : state.status
        let status = !dismissedStatus.isEmpty && offered == dismissedStatus ? "" : offered
        shownStatus = status
        let color = holding ? heldColor : state.color
        let b = self.button ?? self.makeButton()
        var cfg = shellConfiguration(b) ?? .plain()
        let displayed = status.isEmpty ? label : status
        let requiredWidth = status.isEmpty ? 0 : ceil((status as NSString).size(withAttributes: [.font: shellFont(14)]).width) + 52
        var title = AttributedString(displayed.isEmpty ? "\u{200B}" : displayed)
        // One size for counts and statuses, so trading one for the other
        // changes only the words, never their height
        title.font = shellFont(14)
        title.foregroundColor = status.isEmpty ? UIColor.label : UIColor(red: CGFloat(color.first ?? 0) / 255, green: CGFloat(color.dropFirst().first ?? 201) / 255, blue: CGFloat(color.dropFirst(2).first ?? 81) / 255, alpha: 1)
        cfg.attributedTitle = title
        cfg.image = UIImage(systemName: self.overlay == nil ? "line.3.horizontal" : "xmark")
        // Lefty: the lines lead and the words follow, mirroring the dock
        let lefty = (self.bridge?.viewController as? ShellViewController)?.isLeftHanded ?? false
        cfg.imagePlacement = lefty ? .leading : .trailing
        self.dotTrailing?.isActive = !lefty
        self.dotLeading?.isActive = lefty
        cfg.titleLineBreakMode = .byTruncatingTail
        cfg.imagePadding = displayed.isEmpty ? 0 : 8
        cfg.contentInsets = .init(top: 6, leading: 12, bottom: 6, trailing: 12)
        b.titleLabel?.numberOfLines = 1
        let displayKey = displayed + String(describing: color)
        let host = self.bridge?.viewController as? ShellViewController
        let layout: () -> Void = { host?.setStatusMessageWidth(requiredWidth) }
        let wordsColor = status.isEmpty ? UIColor.label : UIColor(red: CGFloat(color.first ?? 0) / 255, green: CGFloat(color.dropFirst().first ?? 201) / 255, blue: CGFloat(color.dropFirst(2).first ?? 81) / 255, alpha: 1)
        if shellMorphing(b) || (self.showingAction && self.isShown(b)) {
            // Taking the pill over from a page's word: the glass morphs, and
            // the words layer takes over from the stand-in once it lands
            self.setWords(displayed, color: wordsColor, status: !status.isEmpty, animated: false)
            if !shellMorphing(b) { self.wordsHost?.view.alpha = 0 }
            shellMorph(b, configuration: cfg, in: host?.view, layoutChanges: layout, apply: { [weak self] in self?.settleMenu($0) })
        } else {
            // The words change on their own layer; the glass only resizes
            let animated = self.isShown(b) && !self.displayKey.isEmpty && self.displayKey != displayKey && !UIAccessibility.isReduceMotionEnabled
            self.setWords(displayed, color: wordsColor, status: !status.isEmpty, animated: animated)
            layout()
            UIView.performWithoutAnimation { self.settleMenu(cfg) }
            if animated {
                UIView.animate(withDuration: 0.4, delay: 0, usingSpringWithDamping: 0.85, initialSpringVelocity: 0,
                               options: [.beginFromCurrentState, .allowUserInteraction]) { host?.view.layoutIfNeeded() }
            } else { host?.view.layoutIfNeeded() }
        }
        self.showingAction = false
        b.titleLabel?.numberOfLines = 1
        b.titleLabel?.adjustsFontSizeToFitWidth = true
        b.titleLabel?.minimumScaleFactor = 0.75
        b.titleLabel?.baselineAdjustment = .alignCenters
        b.titleLabel?.clipsToBounds = true
        self.displayKey = displayKey
        self.menuAccessibilityLabel = "writing menu, \(displayed)\(dirty ? ", unsaved changes" : "")"
        b.accessibilityLabel = self.overlay == nil ? self.menuAccessibilityLabel : "close writing menu"
        self.present(b)
        self.items = items
        if self.status != status && !status.isEmpty { UIAccessibility.post(notification: .announcement, argument: status) }
        self.status = status
        let key = String(data: (try? JSONSerialization.data(withJSONObject: items.map { self.structure($0) }, options: [.sortedKeys])) ?? Data(), encoding: .utf8) ?? ""
        if self.overlay != nil {
            if key != self.modelKey { self.renderPanel() }
            else { self.updateSelections() }
        }
        self.modelKey = key
    }

    @objc func hide(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.statusReset?.cancel()
            self.statusReset = nil
            self.latestState = nil
            self.heldStatus = ""
            self.statusVisibleUntil = 0
            (self.bridge?.viewController as? ShellViewController)?.setStatusMessageWidth(0)
            self.closePanel()
            if self.pageAction == nil { self.hideSoon() }
            call.resolve()
        }
    }

    @objc func updates(_ call: CAPPluginCall) {
        let title = call.getString("title") ?? ""
        let empty = call.getString("empty") ?? ""
        let unread = call.getBool("unread") ?? false
        let items = (call.options["items"] as? [[String: Any]]) ?? []
        DispatchQueue.main.async {
            let key = String(data: (try? JSONSerialization.data(withJSONObject: [title, empty, items, unread], options: [.sortedKeys])) ?? Data(), encoding: .utf8) ?? ""
            let changed = key != self.updatesKey
            self.updatesTitle = title
            self.updatesEmpty = empty
            self.updateItems = items
            self.updatesKey = key
            self.unread = unread
            // Unread shows on the updates tray inside the menu, not on the pill
            self.unreadDot?.isHidden = true
            self.unreadDot?.accessibilityElementsHidden = true
            if changed && self.overlay != nil { self.renderPanel() }
            call.resolve()
        }
    }

    // The menu's configuration on the button with its title invisible (it
    // still sizes the pill); the words layer shows the words
    private func settleMenu(_ cfg: UIButton.Configuration) {
        guard let b = button else { return }
        var quiet = cfg
        if var title = quiet.attributedTitle {
            title.foregroundColor = UIColor.clear
            quiet.attributedTitle = title
        }
        b.configuration = quiet
        b.layoutIfNeeded()
        wordsHost?.view.alpha = 1
    }

    private func setWords(_ text: String, color: UIColor, status: Bool, animated: Bool) {
        let update = {
            let old = Int(self.words.text.prefix { $0.isNumber }) ?? 0
            let new = Int(text.prefix { $0.isNumber }) ?? 0
            self.words.countsDown = new < old
            self.words.text = text
            self.words.color = color
            self.words.size = 14
            self.words.lift = 0
        }
        if animated { withAnimation(.spring(response: 0.35, dampingFraction: 0.85)) { update() } }
        else {
            var t = Transaction()
            t.disablesAnimations = true
            withTransaction(t) { update() }
        }
    }

    // On screen (a hide still waiting counts: the next page takes it over)
    private func isShown(_ b: UIButton) -> Bool { !b.isHidden && !hiding && b.window != nil }

    private func present(_ b: UIButton) {
        pendingHide?.cancel()
        pendingHide = nil
        let motion = !UIAccessibility.isReduceMotionEnabled && b.window != nil
        if hiding {
            hiding = false
            UIView.animate(withDuration: 0.3, delay: 0, usingSpringWithDamping: 0.85, initialSpringVelocity: 0,
                           options: [.beginFromCurrentState, .allowUserInteraction]) { b.alpha = 1; b.transform = .identity }
            return
        }
        guard b.isHidden else { return }
        b.isHidden = false
        guard motion else { return }
        b.alpha = 0
        b.transform = CGAffineTransform(scaleX: 0.85, y: 0.85)
        UIView.animate(withDuration: 0.4, delay: 0, usingSpringWithDamping: 0.8, initialSpringVelocity: 0,
                       options: [.beginFromCurrentState, .allowUserInteraction]) { b.alpha = 1; b.transform = .identity }
    }

    // Pages hand the pill over (the writer leaving, my slates arriving), so a
    // hide waits a beat: if another page claims the pill it morphs instead of
    // vanishing and popping back.
    private func hideSoon() {
        pendingHide?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self, let b = self.button, self.pageAction == nil, !b.isHidden else { return }
            self.pendingHide = nil
            self.showingAction = false
            guard !UIAccessibility.isReduceMotionEnabled, b.window != nil else { b.isHidden = true; return }
            self.hiding = true
            UIView.animate(withDuration: 0.18, delay: 0, options: [.beginFromCurrentState], animations: {
                b.alpha = 0
                b.transform = CGAffineTransform(scaleX: 0.85, y: 0.85)
            }, completion: { _ in
                guard self.hiding else { return }
                self.hiding = false
                b.isHidden = true
                b.alpha = 1
                b.transform = .identity
            })
        }
        pendingHide = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15, execute: work)
    }

    private func makeButton() -> UIButton {
        let b = PillButton(type: .system)
        let host = UIHostingController(rootView: PillWordsView(words: words))
        host.view.backgroundColor = .clear
        host.view.isUserInteractionEnabled = false
        host.view.accessibilityElementsHidden = true
        if #available(iOS 16.4, *) { host.safeAreaRegions = [] }
        host.view.alpha = 0
        b.addSubview(host.view)
        b.wordsView = host.view
        wordsHost = host
        b.translatesAutoresizingMaskIntoConstraints = false
        if #available(iOS 26.0, *) { b.configuration = .glass() }
        else { b.configuration = .gray() }
        b.configuration?.cornerStyle = .capsule
        b.configuration?.contentInsets = .init(top: 8, leading: 12, bottom: 8, trailing: 12)
        b.configuration?.imagePlacement = .trailing
        b.configuration?.imagePadding = 8
        b.configuration?.baseForegroundColor = .label
        b.configuration?.preferredSymbolConfigurationForImage = UIImage.SymbolConfiguration(pointSize: 13, weight: .medium)
        b.titleLabel?.lineBreakMode = .byTruncatingTail
        b.titleLabel?.adjustsFontSizeToFitWidth = true
        b.titleLabel?.minimumScaleFactor = 0.75
        b.accessibilityIdentifier = "shell.settings"
        b.addTarget(self, action: #selector(togglePanel), for: .touchUpInside)
        let hold = UILongPressGestureRecognizer(target: self, action: #selector(quickNew(_:)))
        hold.minimumPressDuration = 0.35
        hold.isEnabled = !quickLabel.isEmpty
        hold.delegate = self
        b.addGestureRecognizer(hold)
        quickHold = hold
        // Most people swipe up rather than hold: the swipe raises it too
        let flick = UIPanGestureRecognizer(target: self, action: #selector(quickFlicked(_:)))
        flick.isEnabled = !quickLabel.isEmpty
        flick.delegate = self
        b.addGestureRecognizer(flick)
        quickFlick = flick
        guard let host = bridge?.viewController as? ShellViewController else { return b }
        host.mountChrome(b, leading: false)
        b.heightAnchor.constraint(equalToConstant: 40).isActive = true
        b.widthAnchor.constraint(greaterThanOrEqualToConstant: 40).isActive = true
        // Counts may truncate on very narrow screens; navigation stays usable.
        b.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        host.closeWriterMenu = { [weak self] in self?.closePanel() }
        // Something unread: the header's red dot, just right of the opener
        let dot = UIView()
        dot.translatesAutoresizingMaskIntoConstraints = false
        dot.backgroundColor = .systemRed
        dot.layer.cornerRadius = 3
        dot.isUserInteractionEnabled = false
        dot.isHidden = true
        b.addSubview(dot)
        dotTrailing = dot.trailingAnchor.constraint(equalTo: b.trailingAnchor, constant: -4)
        dotLeading = dot.leadingAnchor.constraint(equalTo: b.leadingAnchor, constant: 4)
        NSLayoutConstraint.activate([
            dot.widthAnchor.constraint(equalToConstant: 6),
            dot.heightAnchor.constraint(equalToConstant: 6),
            host.isLeftHanded ? dotLeading! : dotTrailing!,
            dot.centerYAnchor.constraint(equalTo: b.centerYAnchor)
        ])
        host.handednessChanged = { [weak self] in
            guard let self, let state = self.latestState else { return }
            self.applyState(state)
        }
        self.unreadDot = dot
        self.button = b
        return b
    }

    // Held, or swiped up straight away: a bubble rises above the pill.
    // Slid onto and let go (or flicked up fast), it makes a new slate; let go
    // anywhere else, nothing happens.
    @objc private func quickNew(_ hold: UILongPressGestureRecognizer) {
        switch hold.state {
        case .began:
            // A swipe already raised it; the hold just joins in
            guard quickBubble == nil else { return }
            guard raiseQuickBubble() else { hold.state = .cancelled; return }
        case .changed:
            trackQuick(hold.location(in: bridge?.viewController?.view))
        case .ended, .cancelled, .failed:
            // The swipe, when there is one, decides on letting go
            guard quickFlick?.state != .changed, quickFlick?.state != .began else { return }
            finishQuick(hold.state == .ended && quickOver)
        default: break
        }
    }

    @objc private func quickFlicked(_ flick: UIPanGestureRecognizer) {
        guard let root = bridge?.viewController?.view else { return }
        switch flick.state {
        case .began:
            if quickBubble == nil, !raiseQuickBubble() { flick.state = .cancelled }
        case .changed:
            trackQuick(flick.location(in: root))
        case .ended:
            let moved = flick.translation(in: root)
            let speed = flick.velocity(in: root)
            let flung = moved.y < -20 && speed.y < -300 && abs(speed.x) < abs(speed.y)
            finishQuick(quickOver || flung)
        case .cancelled, .failed:
            finishQuick(false)
        default: break
        }
    }

    // Only a swipe that sets off upwards is the quick new; the rest stays a tap
    public func gestureRecognizerShouldBegin(_ recognizer: UIGestureRecognizer) -> Bool {
        guard let pan = recognizer as? UIPanGestureRecognizer, pan === quickFlick else { return true }
        let v = pan.velocity(in: pan.view)
        return v.y < 0 && abs(v.y) > abs(v.x)
    }

    public func gestureRecognizer(_ a: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith b: UIGestureRecognizer) -> Bool {
        (a === quickHold && b === quickFlick) || (a === quickFlick && b === quickHold)
    }

    // Felt as the bubble rises, again as the finger reaches it (and a lighter
    // one leaving it), and the success buzz on letting go there
    private func raiseQuickBubble() -> Bool {
        guard let button, let root = bridge?.viewController?.view,
              !quickLabel.isEmpty, pageAction == nil, overlay == nil else { return false }
        shellHaptic("heavy")
        let bubble = makeQuickBubble(quickLabel)
        root.addSubview(bubble)
        let pill = button.convert(button.bounds, to: root)
        let size = bubble.systemLayoutSizeFitting(UIView.layoutFittingCompressedSize)
        let width = max(size.width, 44)
        let x = min(max(pill.midX - width / 2, root.safeAreaInsets.left + 16), root.bounds.width - root.safeAreaInsets.right - 16 - width)
        bubble.frame = CGRect(x: x, y: pill.minY - 12 - 44, width: width, height: 44)
        bubble.alpha = 0
        bubble.transform = CGAffineTransform(translationX: 0, y: 24).scaledBy(x: 0.6, y: 0.6)
        quickBubble = bubble
        quickOver = false
        UIView.animate(withDuration: 0.3, delay: 0, usingSpringWithDamping: 0.75, initialSpringVelocity: 0, options: [.allowUserInteraction, .beginFromCurrentState]) {
            bubble.alpha = 1
            bubble.transform = .identity
        }
        return true
    }

    private func trackQuick(_ point: CGPoint?) {
        guard let bubble = quickBubble, let point else { return }
        let over = bubble.frame.insetBy(dx: -24, dy: -24).contains(point)
            || (point.y < bubble.frame.maxY && abs(point.x - bubble.frame.midX) < bubble.frame.width)
        guard over != quickOver else { return }
        quickOver = over
        shellHaptic(over ? "medium" : "light")
        UIView.animate(withDuration: 0.25, delay: 0, usingSpringWithDamping: 0.7, initialSpringVelocity: 0, options: [.allowUserInteraction, .beginFromCurrentState]) {
            bubble.transform = over ? CGAffineTransform(scaleX: 1.12, y: 1.12) : .identity
        }
    }

    private func finishQuick(_ chosen: Bool) {
        guard let bubble = quickBubble else { return }
        quickBubble = nil
        quickOver = false
        if chosen {
            shellHaptic("success")
            sendSlateAway()
            bridge?.triggerWindowJSEvent(eventName: "shell:nav", data: "{\"id\":\"new\"}")
        }
        UIView.animate(withDuration: 0.22, delay: 0, options: [.curveEaseIn, .beginFromCurrentState]) {
            bubble.alpha = 0
            bubble.transform = chosen ? CGAffineTransform(scaleX: 1.2, y: 1.2) : CGAffineTransform(translationX: 0, y: 16).scaledBy(x: 0.7, y: 0.7)
        } completion: { _ in bubble.removeFromSuperview() }
    }

    // The slate being left flies up and away, into justtype, while a cover in
    // the page's own colour keeps the old words hidden until the page says
    // the new slate is up (settled), or two and a half seconds pass
    private func sendSlateAway() {
        guard let web = bridge?.webView, let host = bridge?.viewController as? ShellViewController,
              let snap = web.scrollView.snapshotView(afterScreenUpdates: false) else { return }
        slateCover?.removeFromSuperview()
        let cover = UIView(frame: web.bounds)
        cover.backgroundColor = web.underPageBackgroundColor ?? web.backgroundColor ?? .systemBackground
        cover.isUserInteractionEnabled = false
        snap.frame = web.scrollView.frame
        snap.isUserInteractionEnabled = false
        host.insertBelowChrome(cover)
        host.insertBelowChrome(snap)
        slateCover = cover
        let away = CGAffineTransform(translationX: 0, y: -web.bounds.height * 0.55).scaledBy(x: 0.82, y: 0.82)
        if UIAccessibility.isReduceMotionEnabled {
            UIView.animate(withDuration: 0.25) { snap.alpha = 0 } completion: { _ in snap.removeFromSuperview() }
        } else {
            UIView.animate(withDuration: 0.5, delay: 0, usingSpringWithDamping: 0.92, initialSpringVelocity: 0.4, options: []) {
                snap.transform = away
                snap.alpha = 0
            } completion: { _ in snap.removeFromSuperview() }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { [weak self, weak cover] in self?.liftCover(cover) }
    }

    private func liftCover(_ cover: UIView?) {
        guard let cover, cover.superview != nil else { return }
        UIView.animate(withDuration: 0.2) { cover.alpha = 0 } completion: { _ in cover.removeFromSuperview() }
    }

    // The page has its new slate up: the cover can go
    @objc func settled(_ call: CAPPluginCall) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.08) {
            self.liftCover(self.slateCover)
            call.resolve()
        }
    }

    private func makeQuickBubble(_ label: String) -> UIView {
        let b = UIButton(type: .system)
        var cfg: UIButton.Configuration
        if #available(iOS 26.0, *) { cfg = .glass() } else { cfg = .gray() }
        cfg.cornerStyle = .capsule
        var title = AttributedString(label)
        title.font = shellFont(14)
        title.foregroundColor = UIColor.label
        cfg.attributedTitle = title
        cfg.contentInsets = .init(top: 10, leading: 16, bottom: 10, trailing: 16)
        b.configuration = cfg
        b.isUserInteractionEnabled = false
        b.accessibilityElementsHidden = true
        return b
    }

    @objc private func togglePanel() {
        // A long status over the words beside it: the tap puts it away, so
        // what it covered can be reached
        if pageAction == nil, overlay == nil, !shownStatus.isEmpty,
           (bridge?.viewController as? ShellViewController)?.statusCoversNavigation == true {
            shellHaptic("light")
            dismissedStatus = shownStatus
            heldStatus = ""
            statusVisibleUntil = 0
            statusReset?.cancel()
            statusReset = nil
            if let latestState { applyState(latestState) }
            return
        }
        shellHaptic(pageAction != nil ? "light" : "soft")
        if let pageAction {
            bridge?.triggerWindowJSEvent(eventName: "shell:nav", data: "{\"id\":\"\(pageAction.id)\"}")
            return
        }
        if overlay != nil { closePanel(); return }
        guard let host = bridge?.viewController as? ShellViewController, let button else { return }
        let overlay = UIView()
        overlay.translatesAutoresizingMaskIntoConstraints = false
        let dismiss = UIControl()
        dismiss.translatesAutoresizingMaskIntoConstraints = false
        dismiss.backgroundColor = UIColor.black.withAlphaComponent(0.12)
        dismiss.addTarget(self, action: #selector(closePanel), for: .touchUpInside)
        overlay.addSubview(dismiss)
        let effect: UIVisualEffect
        if #available(iOS 26.0, *) { effect = UIGlassEffect() }
        else { effect = UIBlurEffect(style: .systemMaterial) }
        let panel = UIVisualEffectView(effect: effect)
        panel.translatesAutoresizingMaskIntoConstraints = false
        panel.layer.cornerRadius = 28
        panel.clipsToBounds = true
        overlay.addSubview(panel)
        let scroll = UIScrollView()
        scroll.translatesAutoresizingMaskIntoConstraints = false
        scroll.alwaysBounceVertical = false
        panel.contentView.addSubview(scroll)
        let stack = UIStackView()
        stack.translatesAutoresizingMaskIntoConstraints = false
        stack.axis = .vertical
        stack.spacing = 8
        scroll.addSubview(stack)
        host.view.addSubview(overlay)
        let preferredHeight = panel.heightAnchor.constraint(equalToConstant: 280)
        preferredHeight.priority = .defaultHigh
        let preferredWidth = panel.widthAnchor.constraint(equalToConstant: 320)
        preferredWidth.priority = .defaultHigh
        NSLayoutConstraint.activate([
            overlay.leadingAnchor.constraint(equalTo: host.view.leadingAnchor),
            overlay.trailingAnchor.constraint(equalTo: host.view.trailingAnchor),
            overlay.topAnchor.constraint(equalTo: host.view.topAnchor),
            overlay.bottomAnchor.constraint(equalTo: host.view.bottomAnchor),
            dismiss.leadingAnchor.constraint(equalTo: overlay.leadingAnchor),
            dismiss.trailingAnchor.constraint(equalTo: overlay.trailingAnchor),
            dismiss.topAnchor.constraint(equalTo: overlay.topAnchor),
            dismiss.bottomAnchor.constraint(equalTo: overlay.bottomAnchor),
            host.isLeftHanded ? panel.leadingAnchor.constraint(equalTo: button.leadingAnchor) : panel.trailingAnchor.constraint(equalTo: button.trailingAnchor),
            panel.leadingAnchor.constraint(greaterThanOrEqualTo: host.view.safeAreaLayoutGuide.leadingAnchor, constant: 16),
            panel.trailingAnchor.constraint(lessThanOrEqualTo: host.view.safeAreaLayoutGuide.trailingAnchor, constant: -16),
            panel.bottomAnchor.constraint(equalTo: button.topAnchor, constant: -12),
            panel.topAnchor.constraint(greaterThanOrEqualTo: host.view.safeAreaLayoutGuide.topAnchor, constant: 8),
            preferredWidth, preferredHeight,
            scroll.leadingAnchor.constraint(equalTo: panel.contentView.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: panel.contentView.trailingAnchor),
            scroll.topAnchor.constraint(equalTo: panel.contentView.topAnchor),
            scroll.bottomAnchor.constraint(equalTo: panel.contentView.bottomAnchor),
            stack.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor, constant: -16),
            stack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor, constant: 14),
            stack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor, constant: -16),
            stack.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor, constant: -32)
        ])
        self.panelHeight = preferredHeight
        self.overlay = overlay
        self.panelStack = stack
        self.scroll = scroll
        host.bringChromeForward()
        shellEditConfiguration(button) { $0.image = UIImage(systemName: "xmark") }
        button.accessibilityLabel = "close writing menu"
        renderPanel()
        if !UIAccessibility.isReduceMotionEnabled {
            panel.alpha = 0
            panel.transform = CGAffineTransform(translationX: 0, y: 8)
            UIView.animate(withDuration: 0.2) { panel.alpha = 1; panel.transform = .identity }
        }
        UIAccessibility.post(notification: .layoutChanged, argument: stack)
    }

    @objc private func closePanel() {
        let closing = overlay
        closing?.isUserInteractionEnabled = false
        overlay = nil
        if UIAccessibility.isReduceMotionEnabled { closing?.removeFromSuperview() }
        else {
            UIView.animate(withDuration: 0.16, animations: { closing?.alpha = 0 }, completion: { _ in closing?.removeFromSuperview() })
        }
        panelStack = nil
        panelHeight = nil
        settingsExpanded = false
        showingUpdates = false
        settingsWrapper = nil
        settingsHeight = nil
        disclosure = nil
        disclosureChevron = nil
        selectors.removeAll()
        themeButton = nil
        scroll = nil
        if pageAction == nil {
            if let button { shellEditConfiguration(button) { $0.image = UIImage(systemName: "line.3.horizontal") } }
            button?.accessibilityLabel = menuAccessibilityLabel
        }
        button?.alpha = 1
        button?.isUserInteractionEnabled = true
        button?.accessibilityElementsHidden = false
    }

    private func send(_ item: [String: Any], dismiss: Bool = true) {
        guard let id = item["id"] as? String else { return }
        // Selectors already ticked as they moved
        if dismiss { shellHaptic("light") }
        if id == "about" { bridge?.webView?.endEditing(true) }
        if dismiss { closePanel() }
        let data = (try? JSONSerialization.data(withJSONObject: ["id": id])) ?? Data()
        guard let json = String(data: data, encoding: .utf8) else { return }
        bridge?.triggerWindowJSEvent(eventName: "shell:pick", data: json)
    }

    // Selection changes must not replace the text controls while their
    // underline animation is in flight. Only changes to available actions or
    // choices require a new layout.
    private func structure(_ item: [String: Any]) -> [String: Any] {
        var result = item
        result.removeValue(forKey: "checked")
        if let kids = item["children"] as? [[String: Any]] { result["children"] = kids.map { structure($0) } }
        return result
    }

    private func updateSelections() {
        func descendants(_ items: [[String: Any]]) -> [[String: Any]] {
            items.flatMap { [$0] + descendants($0["children"] as? [[String: Any]] ?? []) }
        }
        refreshSaveContrast()
        let all = descendants(items)
        let checked = Set(all.filter { $0["checked"] as? Bool == true }.compactMap { $0["id"] as? String })
        for (selector, ids) in selectors {
            let selected = ids.firstIndex { checked.contains($0) } ?? -1
            selector.select(selected, animated: true)
        }
        if let theme = all.first(where: { $0["id"] as? String == "set:theme" }), let b = themeButton {
            let kids = theme["children"] as? [[String: Any]] ?? []
            let selected = kids.first { $0["checked"] as? Bool == true }?["label"] as? String ?? ""
            var title = AttributedString(selected)
            title.font = shellFont(12)
            b.configuration?.attributedTitle = title
            b.accessibilityLabel = "theme: " + selected
            b.menu = UIMenu(children: kids.map { kid in
                UIAction(title: kid["label"] as? String ?? "", state: kid["checked"] as? Bool == true ? .on : .off) { [weak self] _ in
                    self?.send(kid, dismiss: false)
                }
            })
        }
    }

    private func renderPanel() {
        guard let stack = panelStack else { return }
        let offset = scroll?.contentOffset ?? .zero
        stack.arrangedSubviews.forEach { $0.removeFromSuperview() }
        selectors.removeAll()
        themeButton = nil
        saveButton = nil
        if showingUpdates { renderUpdates(in: stack); return }
        let flat = items.flatMap { ($0["inline"] as? Bool == true) ? ($0["children"] as? [[String: Any]] ?? []) : [$0] }
        let primary = UIStackView()
        primary.spacing = 8
        if let save = flat.first(where: { $0["id"] as? String == "save" }) {
            let b = actionButton(save, prominent: true)
            saveButton = b
            primary.addArrangedSubview(b)
        }
        for (id, symbol) in [("export", "square.and.arrow.up"), ("about", "info.circle")] {
            if let item = flat.first(where: { $0["id"] as? String == id }) {
                let b = actionButton(item, symbol: symbol, iconOnly: true)
                b.widthAnchor.constraint(equalToConstant: 44).isActive = true
                primary.addArrangedSubview(b)
            }
        }
        if !updatesTitle.isEmpty {
            let b = actionButton(["id": "updates", "label": updatesTitle], symbol: "tray", iconOnly: true) { [weak self] in
                self?.switchUpdates(true)
                self?.bridge?.triggerWindowJSEvent(eventName: "shell:nav", data: "{\"id\":\"updates\"}")
            }
            b.widthAnchor.constraint(equalToConstant: 44).isActive = true
            // Something unread: a red dot on the tray's corner
            if unread {
                let dot = UIView()
                dot.translatesAutoresizingMaskIntoConstraints = false
                dot.backgroundColor = .systemRed
                dot.layer.cornerRadius = 4
                dot.isUserInteractionEnabled = false
                b.addSubview(dot)
                NSLayoutConstraint.activate([
                    dot.widthAnchor.constraint(equalToConstant: 8),
                    dot.heightAnchor.constraint(equalToConstant: 8),
                    dot.topAnchor.constraint(equalTo: b.topAnchor, constant: 7),
                    dot.trailingAnchor.constraint(equalTo: b.trailingAnchor, constant: -7)
                ])
                b.accessibilityLabel = "\(updatesTitle), unread"
            }
            primary.addArrangedSubview(b)
        }
        stack.addArrangedSubview(primary)
        let actions = flat.filter {
            let id = $0["id"] as? String ?? ""
            return id.hasPrefix("act:") || id.hasPrefix("share:")
        }.sorted { ($0["id"] as? String ?? "") < ($1["id"] as? String ?? "") }
        // Two to a row; a `wide` action (collab & history) takes a row alone
        var rows: [[[String: Any]]] = []
        for item in actions.filter({ $0["wide"] as? Bool == true }) { rows.append([item]) }
        let narrow = actions.filter { $0["wide"] as? Bool != true }
        for start in stride(from: 0, to: narrow.count, by: 2) { rows.append(Array(narrow[start..<min(start + 2, narrow.count)])) }
        // An odd action out leaves a slot: settings becomes the button there
        // instead of a row of its own under a line
        let slot = rows.last.map { $0.count == 1 && $0[0]["wide"] as? Bool != true } ?? false
        for (index, items) in rows.enumerated() {
            let row = UIStackView()
            row.spacing = 8
            row.distribution = .fillEqually
            for item in items {
                let b = actionButton(item)
                b.contentHorizontalAlignment = .center
                b.configuration?.background.backgroundColor = .tertiarySystemFill
                // On (share with a link out): outlined and worded in blue
                if item["on"] as? Bool == true {
                    b.configuration?.background.strokeColor = .systemBlue
                    b.configuration?.background.strokeWidth = 1.5
                    b.configuration?.baseForegroundColor = .systemBlue
                    if var title = b.configuration?.attributedTitle {
                        title.foregroundColor = UIColor.systemBlue
                        b.configuration?.attributedTitle = title
                    }
                }
                row.addArrangedSubview(b)
            }
            if slot && index == rows.count - 1 { row.addArrangedSubview(settingsSlotButton()) }
            stack.addArrangedSubview(row)
        }
        if !slot {
            addDivider(to: stack)
            let (disclosure, chevron) = disclosureRow("settings", open: settingsExpanded)
            disclosure.accessibilityValue = settingsExpanded ? "expanded" : "collapsed"
            disclosure.accessibilityHint = "Show or hide editor, counter, and theme options"
            self.disclosureChevron = chevron
            disclosure.addTarget(self, action: #selector(toggleSettings), for: .touchUpInside)
            self.disclosure = disclosure
            stack.addArrangedSubview(disclosure)
            stack.setCustomSpacing(0, after: disclosure)
        }

        // Keep the settings alive inside a clipped wrapper. Animating its
        // height reveals the existing controls instead of tearing them down.
        let wrapper = UIView()
        wrapper.clipsToBounds = true
        let settings = UIStackView()
        settings.translatesAutoresizingMaskIntoConstraints = false
        settings.axis = .vertical
        settings.spacing = 4
        wrapper.addSubview(settings)
        NSLayoutConstraint.activate([
            settings.leadingAnchor.constraint(equalTo: wrapper.leadingAnchor),
            settings.trailingAnchor.constraint(equalTo: wrapper.trailingAnchor),
            settings.topAnchor.constraint(equalTo: wrapper.topAnchor, constant: 8)
        ])
        for id in ["set:editor", "set:counter", "set:lefty"] {
            if let item = flat.first(where: { $0["id"] as? String == id }) { addSelector(item, to: settings) }
        }
        if let theme = flat.first(where: { $0["id"] as? String == "set:theme" }) {
            let row = UIStackView()
            row.alignment = .center
            row.spacing = 10
            let label = UILabel()
            label.text = "theme"
            label.font = shellFont(12)
            label.textColor = .secondaryLabel
            label.widthAnchor.constraint(equalToConstant: 58).isActive = true
            row.addArrangedSubview(label)
            let kids = theme["children"] as? [[String: Any]] ?? []
            let selected = kids.first { $0["checked"] as? Bool == true }?["label"] as? String ?? ""
            var item = theme
            item["label"] = selected
            let b = actionButton(item, compact: true)
            b.contentHorizontalAlignment = .trailing
            b.configuration?.image = UIImage(systemName: "chevron.down")
            b.configuration?.imagePlacement = .trailing
            b.configuration?.imagePadding = 8
            b.configuration?.preferredSymbolConfigurationForImage = UIImage.SymbolConfiguration(pointSize: 10, weight: .medium)
            b.configuration?.contentInsets = .init(top: 6, leading: 8, bottom: 6, trailing: 8)
            b.accessibilityLabel = "theme: " + selected
            b.accessibilityHint = "Open theme menu"
            themeButton = b
            row.addArrangedSubview(b)
            row.heightAnchor.constraint(equalToConstant: 40).isActive = true
            settings.addArrangedSubview(row)
        }
        let safeWidth = bridge?.viewController?.view.safeAreaLayoutGuide.layoutFrame.width ?? 393
        let width = min(320, safeWidth - 32) - 32
        expandedSettingsHeight = settings.systemLayoutSizeFitting(CGSize(width: width, height: 0), withHorizontalFittingPriority: .required, verticalFittingPriority: .fittingSizeLevel).height + 8
        let height = wrapper.heightAnchor.constraint(equalToConstant: 0)
        height.isActive = true
        self.settingsHeight = height
        self.settingsWrapper = wrapper
        stack.addArrangedSubview(wrapper)
        collapsedPanelHeight = stack.systemLayoutSizeFitting(CGSize(width: width, height: 0), withHorizontalFittingPriority: .required, verticalFittingPriority: .fittingSizeLevel).height + 30
        height.constant = settingsExpanded ? expandedSettingsHeight : 0
        wrapper.alpha = settingsExpanded ? 1 : 0
        wrapper.accessibilityElementsHidden = !settingsExpanded
        panelHeight?.constant = collapsedPanelHeight + height.constant
        scroll?.setContentOffset(offset, animated: false)
    }

    @objc private func toggleSettings() {
        guard let parent = bridge?.viewController?.view else { return }
        shellHaptic("selection")
        parent.layoutIfNeeded()
        settingsExpanded.toggle()
        disclosure?.accessibilityValue = settingsExpanded ? "expanded" : "collapsed"
        settingsButton?.configuration?.image = UIImage(systemName: settingsExpanded ? "chevron.up" : "chevron.down")
        settingsWrapper?.accessibilityElementsHidden = !settingsExpanded
        settingsHeight?.constant = settingsExpanded ? expandedSettingsHeight : 0
        panelHeight?.constant = collapsedPanelHeight + (settingsExpanded ? expandedSettingsHeight : 0)
        let changes: () -> Void = {
            self.disclosureChevron?.transform = self.settingsExpanded ? CGAffineTransform(rotationAngle: .pi) : .identity
            self.settingsWrapper?.alpha = self.settingsExpanded ? 1 : 0
            self.scroll?.contentOffset = .zero
            parent.layoutIfNeeded()
        }
        if UIAccessibility.isReduceMotionEnabled { changes() }
        else { UIView.animate(withDuration: 0.28, delay: 0, options: [.beginFromCurrentState, .allowUserInteraction, .curveEaseInOut], animations: changes) }
    }

    // The panel's contents swap between the writing menu and the updates;
    // its height follows, the way settings open and close
    private func switchUpdates(_ on: Bool) {
        guard let parent = bridge?.viewController?.view, let stack = panelStack else { return }
        shellHaptic("selection")
        parent.layoutIfNeeded()
        showingUpdates = on
        if UIAccessibility.isReduceMotionEnabled {
            renderPanel()
            UIAccessibility.post(notification: .layoutChanged, argument: stack.arrangedSubviews.first)
            return
        }
        UIView.animate(withDuration: 0.12, animations: { stack.alpha = 0 }, completion: { _ in
            self.renderPanel()
            self.scroll?.contentOffset = .zero
            UIView.animate(withDuration: 0.28, delay: 0, options: [.beginFromCurrentState, .allowUserInteraction, .curveEaseInOut]) {
                stack.alpha = 1
                parent.layoutIfNeeded()
            }
            UIAccessibility.post(notification: .layoutChanged, argument: stack.arrangedSubviews.first)
        })
    }

    // Titled like the settings row, its chevron pointing up: back to the menu
    private func renderUpdates(in stack: UIStackView) {
        let (head, _) = disclosureRow(updatesTitle, open: true)
        head.accessibilityTraits = [.button, .header]
        head.accessibilityHint = "Back to the writing menu"
        head.addAction(UIAction { [weak self] _ in self?.switchUpdates(false) }, for: .touchUpInside)
        stack.addArrangedSubview(head)
        stack.setCustomSpacing(0, after: head)
        if updateItems.isEmpty {
            let empty = UILabel()
            empty.text = updatesEmpty
            empty.font = shellFont(12)
            empty.textColor = .tertiaryLabel
            let pad = UIView()
            empty.translatesAutoresizingMaskIntoConstraints = false
            pad.addSubview(empty)
            NSLayoutConstraint.activate([
                empty.leadingAnchor.constraint(equalTo: pad.leadingAnchor, constant: 8),
                empty.trailingAnchor.constraint(equalTo: pad.trailingAnchor),
                empty.topAnchor.constraint(equalTo: pad.topAnchor, constant: 6),
                empty.bottomAnchor.constraint(equalTo: pad.bottomAnchor, constant: -8)
            ])
            stack.addArrangedSubview(pad)
        }
        for (index, item) in updateItems.enumerated() {
            if index > 0 { addDivider(to: stack) }
            stack.addArrangedSubview(updateRow(item))
        }
        let safeWidth = bridge?.viewController?.view.safeAreaLayoutGuide.layoutFrame.width ?? 393
        let width = min(320, safeWidth - 32) - 32
        panelHeight?.constant = stack.systemLayoutSizeFitting(CGSize(width: width, height: 0), withHorizontalFittingPriority: .required, verticalFittingPriority: .fittingSizeLevel).height + 30
    }

    // Title, message, and the date (with the header's arrow when it goes somewhere)
    private func updateRow(_ item: [String: Any]) -> UIView {
        let id = item["id"].map { "\($0)" } ?? ""
        let hasLink = !((item["link"] as? String) ?? "").isEmpty
        let control = UIControl()
        let words = UIStackView()
        words.translatesAutoresizingMaskIntoConstraints = false
        words.axis = .vertical
        words.spacing = 4
        words.isUserInteractionEnabled = false
        control.addSubview(words)
        NSLayoutConstraint.activate([
            words.leadingAnchor.constraint(equalTo: control.leadingAnchor, constant: 8),
            words.trailingAnchor.constraint(equalTo: control.trailingAnchor, constant: -8),
            words.topAnchor.constraint(equalTo: control.topAnchor, constant: 10),
            words.bottomAnchor.constraint(equalTo: control.bottomAnchor, constant: -10)
        ])
        let parts: [(String, CGFloat, UIColor)] = [
            (item["title"] as? String ?? "", 13, .label),
            (item["message"] as? String ?? "", 12, .secondaryLabel),
            ((item["date"] as? String ?? "") + (hasLink ? "  →" : ""), 11, .tertiaryLabel)
        ]
        let safeWidth = bridge?.viewController?.view.safeAreaLayoutGuide.layoutFrame.width ?? 393
        for (text, size, color) in parts where !text.isEmpty {
            let label = UILabel()
            label.text = text
            label.font = shellFont(size)
            label.textColor = color
            label.numberOfLines = 0
            label.setContentCompressionResistancePriority(.required, for: .vertical)
            // Measured before the panel has a width: wrap at the panel's text width
            label.preferredMaxLayoutWidth = min(320, safeWidth - 32) - 48
            words.addArrangedSubview(label)
        }
        control.isAccessibilityElement = true
        control.accessibilityLabel = parts.map { $0.0 }.filter { !$0.isEmpty }.joined(separator: ", ")
        control.accessibilityTraits = hasLink ? .button : .staticText
        if hasLink {
            control.addAction(UIAction { [weak self] _ in
                self?.closePanel()
                self?.bridge?.triggerWindowJSEvent(eventName: "shell:nav", data: "{\"id\":\"update:\(id)\"}")
            }, for: .touchUpInside)
            control.addAction(UIAction { _ in words.alpha = 0.5 }, for: [.touchDown, .touchDragEnter])
            control.addAction(UIAction { _ in UIView.animate(withDuration: 0.16) { words.alpha = 1 } }, for: [.touchUpInside, .touchUpOutside, .touchCancel, .touchDragExit])
        }
        return control
    }

    // Settings as one of the action buttons, its chevron saying open or not
    private func settingsSlotButton() -> UIButton {
        let b = UIButton(type: .system)
        var cfg = UIButton.Configuration.plain()
        var title = AttributedString("settings")
        title.font = shellFont(14)
        cfg.attributedTitle = title
        cfg.image = UIImage(systemName: settingsExpanded ? "chevron.up" : "chevron.down")
        cfg.preferredSymbolConfigurationForImage = UIImage.SymbolConfiguration(pointSize: 10, weight: .medium)
        cfg.imagePlacement = .trailing
        cfg.imagePadding = 8
        cfg.baseForegroundColor = .label
        cfg.cornerStyle = .capsule
        cfg.background.backgroundColor = .tertiarySystemFill
        cfg.contentInsets = .init(top: 8, leading: 10, bottom: 8, trailing: 10)
        b.configuration = cfg
        b.heightAnchor.constraint(equalToConstant: 44).isActive = true
        b.accessibilityLabel = "settings"
        b.accessibilityValue = settingsExpanded ? "expanded" : "collapsed"
        b.accessibilityHint = "Show or hide editor, counter, and theme options"
        b.addTarget(self, action: #selector(toggleSettings), for: .touchUpInside)
        settingsButton = b
        disclosure = b
        return b
    }

    // A word on the left, a chevron on the right: down to open, up when open
    private func disclosureRow(_ title: String, open: Bool) -> (UIButton, UIImageView) {
        let row = UIButton(type: .system)
        var cfg = UIButton.Configuration.plain()
        cfg.baseForegroundColor = .label
        cfg.title = title
        cfg.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { incoming in
            var result = incoming; result.font = shellFont(13); return result
        }
        cfg.contentInsets = .init(top: 8, leading: 8, bottom: 8, trailing: 36)
        row.configuration = cfg
        row.contentHorizontalAlignment = .leading
        row.heightAnchor.constraint(equalToConstant: 44).isActive = true
        row.accessibilityLabel = title
        let chevron = UIImageView(image: UIImage(systemName: "chevron.down", withConfiguration: UIImage.SymbolConfiguration(pointSize: 11, weight: .medium)))
        chevron.translatesAutoresizingMaskIntoConstraints = false
        chevron.tintColor = .secondaryLabel
        chevron.isAccessibilityElement = false
        chevron.transform = open ? CGAffineTransform(rotationAngle: .pi) : .identity
        row.addSubview(chevron)
        NSLayoutConstraint.activate([
            chevron.trailingAnchor.constraint(equalTo: row.trailingAnchor, constant: -10),
            chevron.centerYAnchor.constraint(equalTo: row.centerYAnchor)
        ])
        return (row, chevron)
    }

    private func addDivider(to stack: UIStackView) {
        let line = UIView()
        line.backgroundColor = .separator
        line.heightAnchor.constraint(equalToConstant: 0.5).isActive = true
        stack.addArrangedSubview(line)
    }

    private func addSelector(_ item: [String: Any], to stack: UIStackView) {
        let kids = item["children"] as? [[String: Any]] ?? []
        let group = UIStackView()
        group.axis = .vertical
        group.spacing = 6
        for start in stride(from: 0, to: kids.count, by: 3) {
            let choices = Array(kids[start..<min(start + 3, kids.count)])
            let row = UIStackView()
            row.alignment = .center
            row.spacing = 10
            let label = UILabel()
            label.text = start == 0 ? item["label"] as? String : ""
            label.font = shellFont(12)
            label.textColor = .secondaryLabel
            label.widthAnchor.constraint(equalToConstant: 58).isActive = true
            row.addArrangedSubview(label)
            let selector = ShellTextSelector(titles: choices.map { $0["label"] as? String ?? "" })
            selector.select(choices.firstIndex { $0["checked"] as? Bool == true } ?? -1, animated: false)
            selector.accessibilityLabel = item["label"] as? String
            selector.accessibilityIdentifier = item["id"] as? String
            selectors[selector] = choices.map { $0["id"] as? String ?? "" }
            selector.onSelect = { [weak self] index in
                guard choices.indices.contains(index) else { return }
                shellHaptic("selection")
                self?.send(choices[index], dismiss: false)
            }
            row.heightAnchor.constraint(equalToConstant: 40).isActive = true
            row.addArrangedSubview(selector)
            group.addArrangedSubview(row)
        }
        stack.addArrangedSubview(group)
    }

    private func actionButton(_ item: [String: Any], symbol: String? = nil, iconOnly: Bool = false, prominent: Bool = false, compact: Bool = false, onTap: (() -> Void)? = nil) -> UIButton {
        let b = UIButton(type: .system)
        var cfg: UIButton.Configuration = .plain()
        if prominent {
            if #available(iOS 26.0, *) { cfg = .prominentGlass() }
            else { cfg = .filled() }
            cfg.baseBackgroundColor = .label
        } else if iconOnly {
            if #available(iOS 26.0, *) { cfg = .glass() }
            else { cfg = .gray() }
        }
        cfg.cornerStyle = .capsule
        cfg.baseForegroundColor = item["danger"] as? Bool == true ? .systemRed : (prominent ? .systemBackground : .label)
        let label = item["label"] as? String ?? ""
        if !iconOnly {
            var title = AttributedString(label)
            title.font = shellFont(compact ? 12 : 14, weight: prominent ? .medium : .regular)
            cfg.attributedTitle = title
        }
        if let symbol { cfg.image = UIImage(systemName: symbol) }
        cfg.preferredSymbolConfigurationForImage = UIImage.SymbolConfiguration(pointSize: 15, weight: .regular)
        cfg.imagePadding = 12
        cfg.contentInsets = .init(top: 8, leading: 10, bottom: 8, trailing: 10)
        b.configuration = cfg
        b.contentHorizontalAlignment = prominent || iconOnly ? .center : .leading
        b.heightAnchor.constraint(equalToConstant: compact ? 32 : 44).isActive = true
        b.isEnabled = item["disabled"] as? Bool != true
        b.accessibilityHint = item["hint"] as? String
        b.accessibilityIdentifier = item["id"] as? String
        b.accessibilityLabel = label
        if let kids = item["children"] as? [[String: Any]] {
            b.showsMenuAsPrimaryAction = true
            let isSetting = item["selector"] as? Bool == true
            b.menu = UIMenu(children: kids.map { kid in
                UIAction(title: kid["label"] as? String ?? "", state: kid["checked"] as? Bool == true ? .on : .off) { [weak self] _ in
                    self?.send(kid, dismiss: !isSetting)
                }
            })
        } else if let onTap { b.addAction(UIAction { _ in onTap() }, for: .touchUpInside) }
        else { b.addAction(UIAction { [weak self] _ in self?.send(item) }, for: .touchUpInside) }
        if prominent { applySaveContrast(b) }
        return b
    }

    private func applySaveContrast(_ b: UIButton) {
        let dark = bridge?.viewController?.traitCollection.userInterfaceStyle == .dark
        let foreground: UIColor = dark ? .black : .white
        var cfg = b.configuration ?? .filled()
        cfg.baseBackgroundColor = dark ? .white : .black
        cfg.baseForegroundColor = foreground
        if var title = cfg.attributedTitle { title.foregroundColor = foreground; cfg.attributedTitle = title }
        cfg.imageColorTransformer = UIConfigurationColorTransformer { _ in foreground }
        b.configuration = cfg
    }

    private func refreshSaveContrast() {
        if let saveButton { applySaveContrast(saveButton) }
    }

}
