import UIKit
import Capacitor

// The writer's pill, drawn by the phone: a glass capsule at the bottom right
// with the word count, a dot while the slate has unsaved changes, and the
// menu glyph. A tap opens the phone's own menu tree, built from the items the
// page last sent (`children` make a submenu, `inline` a divided section,
// `checked` the current option). A pick reaches the page as a `shell:pick`
// window event carrying the id. The page keeps it current with
// ShellPill.set({ label, dirty, items }) and takes it away with hide().
// It sits on the safe-area line and rides up onto the keyboard.
@objc(ShellPillPlugin)
public class ShellPillPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ShellPillPlugin"
    public let jsName = "ShellPill"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "hide", returnType: CAPPluginReturnPromise)
    ]
    private var button: UIButton?
    private var dock: ShellDock?

    @objc func set(_ call: CAPPluginCall) {
        let label = call.getString("label") ?? ""
        let dirty = call.getBool("dirty") ?? false
        let items = (call.options["items"] as? [[String: Any]]) ?? []
        DispatchQueue.main.async {
            let b = self.button ?? self.makeButton()
            self.style(b, label: label, dirty: dirty)
            b.menu = UIMenu(children: items.map { self.element($0) })
            b.isHidden = false
            call.resolve()
        }
    }

    @objc func hide(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.button?.isHidden = true; call.resolve() }
    }

    private func makeButton() -> UIButton {
        let b = UIButton(type: .system)
        b.translatesAutoresizingMaskIntoConstraints = false
        b.showsMenuAsPrimaryAction = true
        if #available(iOS 26.0, *) {
            b.configuration = UIButton.Configuration.glass()
        } else {
            b.configuration = UIButton.Configuration.gray()
            b.configuration?.cornerStyle = .capsule
        }
        b.configuration?.contentInsets = NSDirectionalEdgeInsets(top: 12, leading: 16, bottom: 12, trailing: 16)
        b.configuration?.imagePlacement = .trailing
        b.configuration?.imagePadding = 8
        guard let parent = bridge?.viewController?.view else { return b }
        parent.addSubview(b)
        NSLayoutConstraint.activate([
            b.trailingAnchor.constraint(equalTo: parent.trailingAnchor, constant: -16),
            b.heightAnchor.constraint(equalToConstant: 44)
        ])
        dock = ShellDock(b, in: parent)
        self.button = b
        return b
    }

    private func style(_ b: UIButton, label: String, dirty: Bool) {
        var cfg = b.configuration ?? UIButton.Configuration.plain()
        var title = AttributedString(label)
        title.font = shellFont(15)
        title.foregroundColor = UIColor.label
        if dirty {
            var dot = AttributedString("  •")
            dot.foregroundColor = UIColor.systemOrange
            dot.font = shellFont(15, weight: .medium)
            title.append(dot)
        }
        cfg.attributedTitle = title
        cfg.image = UIImage(systemName: "line.3.horizontal", withConfiguration: UIImage.SymbolConfiguration(pointSize: 13, weight: .medium))
        cfg.baseForegroundColor = UIColor.label
        b.configuration = cfg
    }

    private func element(_ it: [String: Any]) -> UIMenuElement {
        let label = it["label"] as? String ?? ""
        let inline = it["inline"] as? Bool ?? false
        if let kids = it["children"] as? [[String: Any]] {
            return UIMenu(title: inline ? "" : label, options: inline ? [.displayInline] : [], children: kids.map { element($0) })
        }
        let id = it["id"] as? String ?? label
        var attrs: UIMenuElement.Attributes = []
        if it["danger"] as? Bool ?? false { attrs.insert(.destructive) }
        if it["disabled"] as? Bool ?? false { attrs.insert(.disabled) }
        let on = it["checked"] as? Bool ?? false
        return UIAction(title: label, attributes: attrs, state: on ? .on : .off) { [weak self] _ in
            self?.bridge?.triggerWindowJSEvent(eventName: "shell:pick", data: "{\"id\":\"\(id)\"}")
        }
    }

}
