import UIKit
import Capacitor
import LocalAuthentication
import Security

// A locked slate's secret, kept on this phone so face id (or touch id) can
// type it. The secret is still what opens the slate; the phone only holds it
// behind the owner's face.
//
// Items live in the keychain, readable only after a biometric match with the
// faces or fingers enrolled right now (a new one added later makes them
// unreadable), only on this device, never in a backup.
//
// ShellKeychain.biometry()                  { kind: 'face' | 'touch' | 'none' }
// ShellKeychain.save({ account, secret })
// ShellKeychain.has({ account })            { has } without asking for a face
// ShellKeychain.read({ account, reason })   { secret } or { secret: null } when
//                                           dismissed or no longer readable
// ShellKeychain.forget({ account })
// ShellKeychain.forgetAll()                 every copy on this phone
// ShellKeychain.confirm({ reason })         { ok } after a biometric match
//
// The account's slate key (src/keyStore.js) lives here too, in its own
// service without a biometric gate: readable once the phone has been
// unlocked since it started, on this device only, never in a backup.
// ShellKeychain.keySet({ account, value })   value is base64
// ShellKeychain.keyGet({ account })          { value } or { value: null }
// ShellKeychain.keyDelete({ account })
@objc(ShellKeychainPlugin)
public class ShellKeychainPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ShellKeychainPlugin"
    public let jsName = "ShellKeychain"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "biometry", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "save", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "has", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "forget", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "forgetAll", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "confirm", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "keySet", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "keyGet", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "keyDelete", returnType: CAPPluginReturnPromise)
    ]
    private let service = "io.justtype.locks"
    private let keyService = "io.justtype.keys"

    private func keyBase(_ account: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: keyService,
         kSecAttrAccount as String: account]
    }

    private func base(_ account: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: account]
    }

    @objc func biometry(_ call: CAPPluginCall) {
        let context = LAContext()
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) else {
            call.resolve(["kind": "none"]); return
        }
        switch context.biometryType {
        case .faceID: call.resolve(["kind": "face"])
        case .touchID: call.resolve(["kind": "touch"])
        default: call.resolve(["kind": "none"])
        }
    }

    @objc func save(_ call: CAPPluginCall) {
        guard let account = call.getString("account"), let secret = call.getString("secret") else {
            call.reject("account and secret required"); return
        }
        var flagsError: Unmanaged<CFError>?
        guard let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly,
                                                           .biometryCurrentSet, &flagsError) else {
            call.reject("no biometric access on this phone"); return
        }
        SecItemDelete(base(account) as CFDictionary)
        var item = base(account)
        item[kSecValueData as String] = Data(secret.utf8)
        item[kSecAttrAccessControl as String] = access
        let status = SecItemAdd(item as CFDictionary, nil)
        status == errSecSuccess ? call.resolve() : call.reject("keychain save failed (\(status))")
    }

    @objc func has(_ call: CAPPluginCall) {
        guard let account = call.getString("account") else { call.reject("account required"); return }
        let context = LAContext()
        context.interactionNotAllowed = true
        var query = base(account)
        query[kSecUseAuthenticationContext as String] = context
        let status = SecItemCopyMatching(query as CFDictionary, nil)
        // A protected item answers "interaction not allowed" instead of its
        // value: it is there, and reading it would ask for a face
        call.resolve(["has": status == errSecSuccess || status == errSecInteractionNotAllowed])
    }

    @objc func read(_ call: CAPPluginCall) {
        guard let account = call.getString("account") else { call.reject("account required"); return }
        let context = LAContext()
        context.localizedReason = call.getString("reason") ?? "open this slate"
        context.localizedFallbackTitle = ""
        var query = base(account)
        query[kSecReturnData as String] = true
        query[kSecUseAuthenticationContext as String] = context
        // The match blocks while iOS shows its own face id sheet
        DispatchQueue.global(qos: .userInitiated).async {
            var result: CFTypeRef?
            let status = SecItemCopyMatching(query as CFDictionary, &result)
            if status == errSecSuccess, let data = result as? Data, let secret = String(data: data, encoding: .utf8) {
                call.resolve(["secret": secret])
            } else {
                call.resolve(["secret": NSNull()])
            }
        }
    }

    @objc func forget(_ call: CAPPluginCall) {
        guard let account = call.getString("account") else { call.reject("account required"); return }
        SecItemDelete(base(account) as CFDictionary)
        call.resolve()
    }

    @objc func forgetAll(_ call: CAPPluginCall) {
        SecItemDelete([kSecClass as String: kSecClassGenericPassword,
                       kSecAttrService as String: service] as CFDictionary)
        call.resolve()
    }

    // Turning it on is the owner's face saying yes
    @objc func confirm(_ call: CAPPluginCall) {
        let context = LAContext()
        context.localizedFallbackTitle = ""
        context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics,
                               localizedReason: call.getString("reason") ?? "open your locked slates") { ok, _ in
            call.resolve(["ok": ok])
        }
    }

    @objc func keySet(_ call: CAPPluginCall) {
        guard let account = call.getString("account"), let value = call.getString("value") else {
            call.reject("account and value required"); return
        }
        SecItemDelete(keyBase(account) as CFDictionary)
        var item = keyBase(account)
        item[kSecValueData as String] = Data(value.utf8)
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(item as CFDictionary, nil)
        status == errSecSuccess ? call.resolve() : call.reject("keychain save failed (\(status))")
    }

    @objc func keyGet(_ call: CAPPluginCall) {
        guard let account = call.getString("account") else { call.reject("account required"); return }
        var query = keyBase(account)
        query[kSecReturnData as String] = true
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecSuccess, let data = result as? Data, let value = String(data: data, encoding: .utf8) {
            call.resolve(["value": value])
        } else {
            call.resolve(["value": NSNull()])
        }
    }

    @objc func keyDelete(_ call: CAPPluginCall) {
        guard let account = call.getString("account") else { call.reject("account required"); return }
        SecItemDelete(keyBase(account) as CFDictionary)
        call.resolve()
    }
}
