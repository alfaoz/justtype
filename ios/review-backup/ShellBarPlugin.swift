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
        CAPPluginMethod(name: "appearance", returnType: CAPPluginReturnPromise)
    ]
    private var capsule: UIVisualEffectView?
    private var stack: UIStackView?
    private var dock: ShellDock?
    private var ids: [UIButton: String] = [:]

    @objc func set(_ call: CAPPluginCall) {
        let words = (call.options["words"] as? [[String: Any]]) ?? []
        DispatchQueue.main.async {
            let stack = self.stack ?? self.make()
            stack.arrangedSubviews.forEach { $0.removeFromSuperview() }
            self.ids.removeAll()
            for w in words {
                let b = UIButton(type: .system)
                let active = w["active"] as? Bool ?? false
                var title = AttributedString(w["label"] as? String ?? "")
                title.font = shellFont(15)
                title.foregroundColor = active ? UIColor.label : UIColor.secondaryLabel
                var cfg = UIButton.Configuration.plain()
                cfg.attributedTitle = title
                cfg.contentInsets = .zero
                b.configuration = cfg
                b.addTarget(self, action: #selector(self.tapped(_:)), for: .touchUpInside)
                self.ids[b] = w["id"] as? String ?? ""
                stack.addArrangedSubview(b)
            }
            self.capsule?.isHidden = words.isEmpty
            call.resolve()
        }
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
        bridge?.triggerWindowJSEvent(eventName: "shell:nav", data: "{\"id\":\"\(id)\"}")
    }

    private func make() -> UIStackView {
        let effect: UIVisualEffect
        if #available(iOS 26.0, *) { effect = UIGlassEffect() } else { effect = UIBlurEffect(style: .systemMaterial) }
        let capsule = UIVisualEffectView(effect: effect)
        capsule.translatesAutoresizingMaskIntoConstraints = false
        capsule.layer.cornerRadius = 22
        capsule.clipsToBounds = true
        let stack = UIStackView()
        stack.axis = .horizontal
        stack.spacing = 16
        stack.alignment = .center
        stack.translatesAutoresizingMaskIntoConstraints = false
        capsule.contentView.addSubview(stack)
        guard let parent = bridge?.viewController?.view else { return stack }
        parent.addSubview(capsule)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: capsule.contentView.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: capsule.contentView.trailingAnchor, constant: -16),
            stack.topAnchor.constraint(equalTo: capsule.contentView.topAnchor),
            stack.bottomAnchor.constraint(equalTo: capsule.contentView.bottomAnchor),
            capsule.leadingAnchor.constraint(equalTo: parent.leadingAnchor, constant: 16),
            capsule.heightAnchor.constraint(equalToConstant: 44)
        ])
        dock = ShellDock(capsule, in: parent)
        self.capsule = capsule
        self.stack = stack
        return stack
    }
}
