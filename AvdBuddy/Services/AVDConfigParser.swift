import Foundation

enum AVDConfigParser {
    static func apiLevel(from config: String) -> Int? {
        let patterns = [
            #"target=android-(\d+)"#,
            #"image\.sysdir\.1=.*android-(\d+)(?:/|;)"#
        ]

        for pattern in patterns {
            if let apiLevel = firstMatch(in: config, pattern: pattern) {
                return apiLevel
            }
        }

        return nil
    }

    static func screenDimensions(from config: String) -> (width: Int, height: Int)? {
        guard let width = firstMatch(in: config, pattern: #"^hw\.lcd\.width=(\d+)$"#, options: [.anchorsMatchLines]),
              let height = firstMatch(in: config, pattern: #"^hw\.lcd\.height=(\d+)$"#, options: [.anchorsMatchLines]) else {
            return nil
        }

        return (width, height)
    }

    static func deviceType(from config: String) -> EmulatorDeviceType {
        if let hingeSensor = value(forKey: "hw.sensor.hinge", in: config)?.lowercased(),
           hingeSensor == "yes" {
            return .foldable
        }

        if let deviceName = value(forKey: "hw.device.name", in: config)?.lowercased(),
           deviceName.contains("fold") {
            return .foldable
        }

        if let tagID = value(forKey: "tag.id", in: config)?.lowercased(),
           tagID.contains("tv") {
            return .tv
        }

        if let tagID = value(forKey: "tag.id", in: config)?.lowercased(),
           tagID.contains("wear") {
            return .wearOS
        }

        if let tagID = value(forKey: "tag.id", in: config)?.lowercased(),
           tagID.contains("desktop") {
            return .desktop
        }

        if let tagID = value(forKey: "tag.id", in: config)?.lowercased(),
           tagID.contains("automotive") {
            return .automotive
        }

        if let tagID = value(forKey: "tag.id", in: config)?.lowercased(),
           tagID.contains("xr") || tagID.contains("glasses") {
            return .xr
        }

        if let deviceName = value(forKey: "hw.device.name", in: config)?.lowercased(),
           deviceName.hasPrefix("tv_") {
            return .tv
        }

        if let deviceName = value(forKey: "hw.device.name", in: config)?.lowercased(),
           deviceName.hasPrefix("wearos_") {
            return .wearOS
        }

        if let deviceName = value(forKey: "hw.device.name", in: config)?.lowercased(),
           deviceName.hasPrefix("desktop_") {
            return .desktop
        }

        if let deviceName = value(forKey: "hw.device.name", in: config)?.lowercased(),
           deviceName.hasPrefix("automotive_") {
            return .automotive
        }

        if let deviceName = value(forKey: "hw.device.name", in: config)?.lowercased(),
           deviceName.hasPrefix("xr_") || deviceName.hasPrefix("ai_glasses_") {
            return .xr
        }

        guard let dimensions = screenDimensions(from: config) else { return .unknown }
        let ratio = Double(max(dimensions.width, dimensions.height)) / Double(min(dimensions.width, dimensions.height))
        return ratio <= 1.7 ? .tablet : .phone
    }

    static func colorSeed(from config: String) -> String? {
        value(forKey: "avdbuddy.color.seed", in: config)
    }

    static func deviceName(from config: String) -> String? {
        value(forKey: "hw.device.name", in: config)
    }

    static func skinName(from config: String) -> String? {
        value(forKey: "skin.name", in: config)
    }

    static func skinPath(from config: String) -> String? {
        value(forKey: "skin.path", in: config)
    }

    static func showDeviceFrame(from config: String) -> Bool? {
        guard let value = value(forKey: "showDeviceFrame", in: config)?.lowercased() else { return nil }
        switch value {
        case "yes", "true", "1":
            return true
        case "no", "false", "0":
            return false
        default:
            return nil
        }
    }

    private static func value(forKey key: String, in config: String) -> String? {
        config
            .split(whereSeparator: \.isNewline)
            .compactMap { line -> String? in
                let parts = line.split(separator: "=", maxSplits: 1).map(String.init)
                guard parts.count == 2, parts[0] == key else { return nil }
                return parts[1]
            }
            .first
    }

    private static func firstMatch(
        in text: String,
        pattern: String,
        options: NSRegularExpression.Options = []
    ) -> Int? {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: options) else { return nil }
        let range = NSRange(text.startIndex..., in: text)
        guard let match = regex.firstMatch(in: text, range: range),
              let captureRange = Range(match.range(at: 1), in: text) else {
            return nil
        }

        return Int(text[captureRange])
    }
}
