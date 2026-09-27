import Foundation
import Capacitor

// The app's own storage for the offline copies (src/offlineStore.js), in
// place of the web view's IndexedDB, which is the web view's to manage. One
// JSON file per record under Application Support/offline/<store>/, written
// atomically on one serial queue. The records are what the server holds
// (ciphertext) plus bookkeeping; the key that opens them is in the keychain,
// so the folder is left out of backups: a restored copy could not be read.
//
// ShellStore.get({ store, key })           { value } (JSON text) or { value: null }
// ShellStore.put({ store, key, value })
// ShellStore.remove({ store, key })
// ShellStore.all({ store })                { values: [JSON text] }
// ShellStore.putMany({ store, records: [{ key, value }] })   one call, many files
@objc(ShellStorePlugin)
public class ShellStorePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ShellStorePlugin"
    public let jsName = "ShellStore"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "get", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "put", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "all", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "putMany", returnType: CAPPluginReturnPromise)
    ]
    private let queue = DispatchQueue(label: "io.justtype.store")
    private let stores: Set<String> = ["slates", "lists", "pending", "history"]

    private lazy var root: URL? = {
        guard var url = try? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                                     appropriateFor: nil, create: true) else { return nil }
        url.appendPathComponent("offline", isDirectory: true)
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

    // Keys carry ':' and user text-free ids; hex keeps every one a safe name
    private func file(_ store: String, _ key: String) -> URL? {
        let name = key.utf8.map { String(format: "%02x", $0) }.joined()
        return folder(store)?.appendingPathComponent(name + ".json")
    }

    private func write(_ store: String, _ key: String, _ value: String) -> Bool {
        guard let url = file(store, key) else { return false }
        do { try Data(value.utf8).write(to: url, options: .atomic); return true } catch { return false }
    }

    @objc func get(_ call: CAPPluginCall) {
        guard let store = call.getString("store"), let key = call.getString("key") else { call.reject("store and key required"); return }
        queue.async {
            guard let url = self.file(store, key), let data = try? Data(contentsOf: url),
                  let value = String(data: data, encoding: .utf8) else { call.resolve(["value": NSNull()]); return }
            call.resolve(["value": value])
        }
    }

    @objc func put(_ call: CAPPluginCall) {
        guard let store = call.getString("store"), let key = call.getString("key"), let value = call.getString("value") else {
            call.reject("store, key and value required"); return
        }
        queue.async { self.write(store, key, value) ? call.resolve() : call.reject("write failed") }
    }

    @objc func putMany(_ call: CAPPluginCall) {
        guard let store = call.getString("store"), let records = call.getArray("records") as? [[String: Any]] else {
            call.reject("store and records required"); return
        }
        queue.async {
            for record in records {
                guard let key = record["key"] as? String, let value = record["value"] as? String,
                      self.write(store, key, value) else { call.reject("write failed"); return }
            }
            call.resolve()
        }
    }

    @objc func remove(_ call: CAPPluginCall) {
        guard let store = call.getString("store"), let key = call.getString("key") else { call.reject("store and key required"); return }
        queue.async {
            if let url = self.file(store, key) { try? FileManager.default.removeItem(at: url) }
            call.resolve()
        }
    }

    @objc func all(_ call: CAPPluginCall) {
        guard let store = call.getString("store") else { call.reject("store required"); return }
        queue.async {
            guard let dir = self.folder(store),
                  let names = try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil) else {
                call.resolve(["values": []]); return
            }
            let values = names.filter { $0.pathExtension == "json" }.compactMap { url -> String? in
                guard let data = try? Data(contentsOf: url) else { return nil }
                return String(data: data, encoding: .utf8)
            }
            call.resolve(["values": values])
        }
    }
}
