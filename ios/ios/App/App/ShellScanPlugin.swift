import UIKit
import AVFoundation
import Capacitor

// The phone's own QR reader for the nearby tab: a sheet with the camera, the
// way every app reads a code. ShellScan.scan({ prompt }) resolves with the
// first code it sees, { text }, or { text: null } when the sheet is closed or
// there is no camera to use.
@objc(ShellScanPlugin)
public class ShellScanPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ShellScanPlugin"
    public let jsName = "ShellScan"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "scan", returnType: CAPPluginReturnPromise)
    ]

    @objc func scan(_ call: CAPPluginCall) {
        let prompt = call.getString("prompt") ?? ""
        let present = {
            DispatchQueue.main.async {
                guard let vc = self.bridge?.viewController, vc.presentedViewController == nil,
                      AVCaptureDevice.default(for: .video) != nil else { call.resolve(["text": NSNull()]); return }
                let scanner = ShellScanner(prompt: prompt) { text in
                    call.resolve(["text": text as Any? ?? NSNull()])
                }
                vc.present(scanner, animated: true)
            }
        }
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: present()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { granted in
                if granted { present() } else { call.resolve(["text": NSNull()]) }
            }
        default: call.resolve(["text": NSNull()])
        }
    }
}

private final class ShellScanner: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    private let session = AVCaptureSession()
    private let prompt: String
    private var finish: ((String?) -> Void)?

    init(prompt: String, finish: @escaping (String?) -> Void) {
        self.prompt = prompt
        self.finish = finish
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .pageSheet
        sheetPresentationController?.prefersGrabberVisible = true
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        if let camera = AVCaptureDevice.default(for: .video), let input = try? AVCaptureDeviceInput(device: camera),
           session.canAddInput(input) {
            session.addInput(input)
            let output = AVCaptureMetadataOutput()
            if session.canAddOutput(output) {
                session.addOutput(output)
                output.setMetadataObjectsDelegate(self, queue: .main)
                output.metadataObjectTypes = [.qr]
            }
        }
        let preview = AVCaptureVideoPreviewLayer(session: session)
        preview.videoGravity = .resizeAspectFill
        preview.frame = view.bounds
        view.layer.addSublayer(preview)

        // The square the code goes in, and what to point at
        let frame = UIView()
        frame.translatesAutoresizingMaskIntoConstraints = false
        frame.layer.borderColor = UIColor.white.withAlphaComponent(0.9).cgColor
        frame.layer.borderWidth = 2
        frame.layer.cornerRadius = 24
        frame.layer.cornerCurve = .continuous
        view.addSubview(frame)
        let label = UILabel()
        label.translatesAutoresizingMaskIntoConstraints = false
        label.text = prompt
        label.font = shellFont(13)
        label.textColor = .white
        label.textAlignment = .center
        label.numberOfLines = 0
        view.addSubview(label)
        let close = UIButton(type: .system)
        close.translatesAutoresizingMaskIntoConstraints = false
        if #available(iOS 26.0, *) { close.configuration = .glass() } else { close.configuration = .gray() }
        close.configuration?.image = UIImage(systemName: "xmark")
        close.configuration?.cornerStyle = .capsule
        close.configuration?.baseForegroundColor = .white
        close.accessibilityLabel = "close"
        close.addAction(UIAction { [weak self] _ in self?.end(nil) }, for: .touchUpInside)
        view.addSubview(close)
        NSLayoutConstraint.activate([
            frame.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            frame.centerYAnchor.constraint(equalTo: view.centerYAnchor, constant: -20),
            frame.widthAnchor.constraint(equalTo: view.widthAnchor, multiplier: 0.62),
            frame.heightAnchor.constraint(equalTo: frame.widthAnchor),
            label.topAnchor.constraint(equalTo: frame.bottomAnchor, constant: 24),
            label.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 32),
            label.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -32),
            close.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 16),
            close.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -16),
            close.widthAnchor.constraint(equalToConstant: 44),
            close.heightAnchor.constraint(equalToConstant: 44)
        ])
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        view.layer.sublayers?.compactMap { $0 as? AVCaptureVideoPreviewLayer }.forEach { $0.frame = view.bounds }
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        let session = self.session
        DispatchQueue.global(qos: .userInitiated).async { session.startRunning() }
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        session.stopRunning()
        // Swiped down: the sheet is gone without a code
        finish?(nil)
        finish = nil
    }

    func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput objects: [AVMetadataObject], from connection: AVCaptureConnection) {
        guard let text = (objects.first as? AVMetadataMachineReadableCodeObject)?.stringValue else { return }
        shellHaptic("success")
        end(text)
    }

    private func end(_ text: String?) {
        guard let finish else { return }
        self.finish = nil
        session.stopRunning()
        finish(text)
        dismiss(animated: true)
    }
}
