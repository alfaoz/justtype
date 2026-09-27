import UIKit
import Capacitor

// The app's own plugins are registered here; everything else is Capacitor's
class ShellViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(ShellMenuPlugin())
        bridge?.registerPluginInstance(ShellPillPlugin())
        bridge?.registerPluginInstance(ShellBarPlugin())
    }
}
