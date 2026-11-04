import ExpoModulesCore

/// Reads the managed app configuration an MDM pushed for this app
/// (`com.apple.configuration.managed` in the standard user defaults). Strings pass through;
/// booleans and numbers become their text; any other type becomes nil so JavaScript can refuse
/// it by key. Read-only.
public class ManagedConfigModule: Module {
  public func definition() -> ModuleDefinition {
    Name("TortoiseManagedConfig")

    Function("read") { () -> [String: String?] in
      let managed =
        UserDefaults.standard.dictionary(forKey: "com.apple.configuration.managed") ?? [:]
      var values: [String: String?] = [:]
      for (key, value) in managed {
        switch value {
        case let text as String: values[key] = text
        case let flag as Bool: values[key] = flag ? "true" : "false"
        case let number as NSNumber: values[key] = number.stringValue
        default: values[key] = .some(nil)
        }
      }
      return values
    }
  }
}
