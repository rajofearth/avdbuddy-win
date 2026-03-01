import Foundation

enum EmulatorDeviceType: Equatable {
    case phone
    case tablet
    case foldable
    case wearOS
    case desktop
    case tv
    case automotive
    case xr
    case unknown

    var label: String {
        switch self {
        case .phone: return "Phone"
        case .tablet: return "Tablet"
        case .foldable: return "Foldable"
        case .wearOS: return "Wear OS"
        case .desktop: return "Desktop"
        case .tv: return "TV"
        case .automotive: return "Automotive"
        case .xr: return "XR"
        case .unknown: return "Unknown"
        }
    }

    var symbolName: String {
        switch self {
        case .phone: return "iphone"
        case .tablet: return "ipad"
        case .foldable: return "rectangle.split.2x1"
        case .wearOS: return "applewatch"
        case .desktop: return "desktopcomputer"
        case .tv: return "tv"
        case .automotive: return "car"
        case .xr: return "visionpro"
        case .unknown: return "questionmark.square.dashed"
        }
    }
}
