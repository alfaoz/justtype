import UIKit
import Capacitor

// The words at the bottom left, drawn by the phone: a glass capsule holding
// the header's words (writer / my slates, account, or login; `done` while the
// keyboard is up). ShellBar.set({ words: [{ id, label, active }] }) from the
// page; a tap reaches the page as a `shell:nav` window event with the id.
@objc(ShellBarPlugin)
public class ShellBarPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ShellBarPlugin"
    public let jsName = "ShellBar"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "hide", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "appearance", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "overlay", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "haptic", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "haptics", returnType: CAPPluginReturnPromise)
    ]
    private var capsule: UIVisualEffectView?
    private var stack: UIStackView?
    private var capsuleWidth: NSLayoutConstraint?
    private var ids: [UIButton: String] = [:]
    private var buttons: [String: UIButton] = [:]
    private var labels: [String: String] = [:]
    private var companion: UIButton?
    private var companionID = ""

    @objc func set(_ call: CAPPluginCall) {
        let words = (call.options["words"] as? [[String: Any]]) ?? []
        let leftHanded = call.getBool("leftHanded") ?? false
        let beside = call.options["companion"] as? [String: Any]
        DispatchQueue.main.async {
            let stack = self.stack ?? self.make()
            defer { self.showCompanion(beside) }
            (self.bridge?.viewController as? ShellViewController)?.setLeftHanded(leftHanded)
            let visible = Set(words.compactMap { $0["id"] as? String })
            for (id, b) in self.buttons { b.isHidden = !visible.contains(id) }
            for w in words {
                let id = w["id"] as? String ?? ""
                let label = w["label"] as? String ?? ""
                let b: UIButton
                if let existing = self.buttons[id] { b = existing }
                else {
                    b = UIButton(type: .system)
                    b.titleLabel?.adjustsFontSizeToFitWidth = true
                    b.titleLabel?.minimumScaleFactor = 0.8
                    b.titleLabel?.clipsToBounds = true
                    b.contentHorizontalAlignment = .center
                    b.contentVerticalAlignment = .center
                    b.heightAnchor.constraint(equalToConstant: 40).isActive = true
                    if id == "toggle" {
                        let width = ("my slates" as NSString).size(withAttributes: [.font: shellFont(14)]).width + 12
                        let fixed = b.widthAnchor.constraint(equalToConstant: width)
                        fixed.priority = UILayoutPriority(999)
                        fixed.isActive = true
                    }
                    b.accessibilityIdentifier = "shell.nav." + id
                    b.addTarget(self, action: #selector(self.tapped(_:)), for: .touchUpInside)
                    self.ids[b] = id
                    self.buttons[id] = b
                    stack.addArrangedSubview(b)
                }
                b.isHidden = false
                var title = AttributedString(label)
                title.font = shellFont(14)
                title.foregroundColor = w["active"] as? Bool == true ? UIColor.label : UIColor.secondaryLabel
                var cfg = UIButton.Configuration.plain()
                cfg.attributedTitle = title
                cfg.contentInsets = .zero
                cfg.titleLineBreakMode = .byTruncatingTail
                let changed = self.labels[id] != nil && self.labels[id] != label
                shellSetTitle(b, configuration: cfg, in: self.bridge?.viewController?.view, animated: changed,
                              fadeOnly: true)
                b.titleLabel?.numberOfLines = 1
                b.titleLabel?.lineBreakMode = .byTruncatingTail
                b.titleLabel?.adjustsFontSizeToFitWidth = true
                self.labels[id] = label
            }
            // Keep the capsule in the order the page sends (lefty mirrors it)
            for (index, id) in words.compactMap({ $0["id"] as? String }).enumerated() {
                if let b = self.buttons[id], stack.arrangedSubviews.firstIndex(of: b) != index {
                    stack.insertArrangedSubview(b, at: index)
                }
            }
            let widths = words.map { word -> CGFloat in
                let text = word["id"] as? String == "toggle" ? "my slates" : (word["label"] as? String ?? "")
                return ceil((text as NSString).size(withAttributes: [.font: shellFont(14)]).width) + 12
            }
            self.capsuleWidth?.constant = widths.reduce(0, +) + CGFloat(max(0, words.count - 1)) * 12 + 24
            self.capsule?.isHidden = words.isEmpty
            UIView.performWithoutAnimation { self.bridge?.viewController?.view.layoutIfNeeded() }
            call.resolve()
        }
    }

    // A pill of its own beside the capsule, on its inner side: it springs out
    // from behind the capsule and tucks back behind it when it goes
    private func showCompanion(_ item: [String: Any]?) {
        guard let host = bridge?.viewController as? ShellViewController else { return }
        let id = item?["id"] as? String ?? ""
        let label = item?["label"] as? String ?? ""
        let b: UIButton
        if let companion { b = companion } else {
            b = UIButton(type: .system)
            if #available(iOS 26.0, *) { b.configuration = .glass() } else { b.configuration = .gray() }
            b.configuration?.cornerStyle = .capsule
            b.configuration?.baseForegroundColor = .label
            b.translatesAutoresizingMaskIntoConstraints = false
            b.heightAnchor.constraint(equalToConstant: 40).isActive = true
            b.widthAnchor.constraint(greaterThanOrEqualToConstant: 40).isActive = true
            b.setContentHuggingPriority(.required, for: .horizontal)
            b.setContentCompressionResistancePriority(.required, for: .horizontal)
            b.isHidden = true
            b.addAction(UIAction { [weak self] _ in
                guard let self, !self.companionID.isEmpty else { return }
                shellHaptic("light")
                self.bridge?.triggerWindowJSEvent(eventName: "shell:nav", data: "{\"id\":\"\(self.companionID)\"}")
            }, for: .touchUpInside)
            host.mountCompanion(b)
            companion = b
        }
        let show = !id.isEmpty
        let wasShown = !b.isHidden
        companionID = id
        if show {
            var title = AttributedString(label)
            title.font = shellFont(14)
            b.configuration?.attributedTitle = title
            b.configuration?.contentInsets = .init(top: 6, leading: 16, bottom: 6, trailing: 16)
            // One line: two words (my slates) would otherwise wrap
            b.configuration?.titleLineBreakMode = .byClipping
            b.titleLabel?.numberOfLines = 1
            b.accessibilityLabel = label
            b.accessibilityIdentifier = "shell.nav." + id
        }
        guard show != wasShown else { return }
        // From behind the capsule: its inner side is right, or left for lefty
        let tucked = CGAffineTransform(translationX: host.isLeftHanded ? 24 : -24, y: 0).scaledBy(x: 0.6, y: 0.6)
        guard !UIAccessibility.isReduceMotionEnabled, b.window != nil else {
            b.isHidden = !show
            host.view.layoutIfNeeded()
            return
        }
        host.view.layoutIfNeeded()
        if show {
            b.alpha = 0
            b.transform = tucked
            UIView.animate(withDuration: 0.5, delay: 0, usingSpringWithDamping: 0.72, initialSpringVelocity: 0,
                           options: [.beginFromCurrentState, .allowUserInteraction]) {
                b.isHidden = false
                b.alpha = 1
                b.transform = .identity
                host.view.layoutIfNeeded()
            }
        } else {
            UIView.animate(withDuration: 0.28, delay: 0, options: [.beginFromCurrentState, .curveEaseIn], animations: {
                b.alpha = 0
                b.transform = tucked
            }, completion: { _ in
                guard self.companionID.isEmpty else { return }
                b.isHidden = true
                b.transform = .identity
                host.view.layoutIfNeeded()
            })
        }
    }

    @objc func overlay(_ call: CAPPluginCall) {
        let visible = call.getBool("visible") ?? false
        DispatchQueue.main.async {
            (self.bridge?.viewController as? ShellViewController)?.setChromeObscured(visible)
            call.resolve()
        }
    }

    @objc func haptic(_ call: CAPPluginCall) {
        let kind = call.getString("kind") ?? "light"
        DispatchQueue.main.async { shellHaptic(kind); call.resolve() }
    }

    @objc func haptics(_ call: CAPPluginCall) {
        let on = call.getBool("on") ?? true
        DispatchQueue.main.async { shellHapticsOn = on; call.resolve() }
    }

    @objc func hide(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.capsule?.isHidden = true; call.resolve() }
    }

    // Light or dark for everything the phone draws (menus, sheets, keyboard),
    // following the theme's ground
    @objc func appearance(_ call: CAPPluginCall) {
        let dark = call.getBool("dark") ?? true
        DispatchQueue.main.async {
            let style: UIUserInterfaceStyle = dark ? .dark : .light
            self.bridge?.viewController?.overrideUserInterfaceStyle = style
            self.bridge?.viewController?.view.window?.overrideUserInterfaceStyle = style
            call.resolve()
        }
    }

    @objc private func tapped(_ b: UIButton) {
        guard let id = ids[b] else { return }
        shellHaptic(id == "done" ? "soft" : "light")
        if id == "done" { bridge?.webView?.endEditing(true) }
        (bridge?.viewController as? ShellViewController)?.closeWriterMenu?()
        bridge?.triggerWindowJSEvent(eventName: "shell:nav", data: "{\"id\":\"\(id)\"}")
    }

    private func make() -> UIStackView {
        let effect: UIVisualEffect
        if #available(iOS 26.0, *) { effect = UIGlassEffect() } else { effect = UIBlurEffect(style: .systemMaterial) }
        let capsule = UIVisualEffectView(effect: effect)
        capsule.translatesAutoresizingMaskIntoConstraints = false
        capsule.layer.cornerRadius = 20
        capsule.clipsToBounds = true
        let stack = UIStackView()
        stack.axis = .horizontal
        stack.spacing = 12
        stack.alignment = .center
        stack.translatesAutoresizingMaskIntoConstraints = false
        capsule.contentView.addSubview(stack)
        guard let host = bridge?.viewController as? ShellViewController else { return stack }
        host.mountChrome(capsule, leading: true)
        capsuleWidth = capsule.widthAnchor.constraint(equalToConstant: 180)
        capsuleWidth?.isActive = true
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: capsule.contentView.leadingAnchor, constant: 12),
            stack.trailingAnchor.constraint(equalTo: capsule.contentView.trailingAnchor, constant: -12),
            stack.topAnchor.constraint(equalTo: capsule.contentView.topAnchor),
            stack.bottomAnchor.constraint(equalTo: capsule.contentView.bottomAnchor),
            capsule.heightAnchor.constraint(equalToConstant: 40)
        ])
        self.capsule = capsule
        self.stack = stack
        return stack
    }
}
