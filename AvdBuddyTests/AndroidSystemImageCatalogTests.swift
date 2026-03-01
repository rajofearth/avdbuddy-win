import Foundation
import Testing
@testable import AvdBuddy

struct AndroidSystemImageCatalogTests {
    @Test
    func groupsVersionFamiliesByDeviceTypeAndSortsNewestFirst() {
        let images = AndroidSystemImageCatalog.parse(from: sdkManagerCatalogFixture)

        let handheldFamilies = AndroidSystemImageCatalog.versionFamilies(from: images, for: .phone)
        let tvFamilies = AndroidSystemImageCatalog.versionFamilies(from: images, for: .tv)
        let desktopFamilies = AndroidSystemImageCatalog.versionFamilies(from: images, for: .desktop)
        let automotiveFamilies = AndroidSystemImageCatalog.versionFamilies(from: images, for: .automotive)
        let xrFamilies = AndroidSystemImageCatalog.versionFamilies(from: images, for: .xr)

        #expect(handheldFamilies.first?.id == "api-36")
        #expect(handheldFamilies.contains(where: { $0.id == "api-35" }))
        #expect(tvFamilies.count == 1)
        #expect(tvFamilies.first?.id == "api-34")
        #expect(desktopFamilies.first?.id == "api-34")
        #expect(automotiveFamilies.first?.id == "api-34")
        #expect(xrFamilies.first?.id == "api-34")
    }

    @Test
    func resolvesProductSelectionsToConcretePackage() {
        let images = AndroidSystemImageCatalog.parse(from: sdkManagerCatalogFixture)
        var selection = CreateAVDSelection()
        selection.deviceType = .phone
        selection.avdName = "Pixel_36"
        selection.selectedVersionIdentifier = "android-36"
        selection.googleServices = .googlePlay
        selection.architecture = "arm64"
        selection.deviceProfile = .init(id: "pixel_9", name: "Pixel 9")
        selection.ramPreset = .gb4
        selection.storagePreset = .gb32
        selection.sdCardPreset = .gb4

        let resolved = AndroidSystemImageCatalog.resolve(selection: selection, images: images)

        #expect(resolved?.packagePath == "system-images;android-36;google_apis_playstore;arm64-v8a")
        #expect(resolved?.deviceProfileID == "pixel_9")
        #expect(resolved?.ramMB == 4096)
        #expect(resolved?.storage == "32GB")
        #expect(resolved?.sdCard == "4096M")
    }

    @Test
    func prefersInstalledTvVariantForDefaults() {
        let images = AndroidSystemImageCatalog.parse(from: sdkManagerCatalogFixture)
        let tvRelease = AndroidSystemImageCatalog
            .versionFamilies(from: images, for: .tv)
            .first?
            .releases
            .first

        let preferredServices = AndroidSystemImageCatalog.preferredGoogleServicesOption(
            for: tvRelease,
            deviceType: .tv
        )
        let preferredArchitecture = AndroidSystemImageCatalog.preferredArchitecture(
            for: tvRelease,
            deviceType: .tv,
            googleServices: preferredServices ?? .none
        )

        #expect(preferredServices == GoogleServicesOption.none)
        #expect(preferredArchitecture == "arm64")
    }

    @Test
    func resolvesDesktopAutomotiveAndXrSelections() {
        let images = AndroidSystemImageCatalog.parse(from: sdkManagerCatalogFixture)

        var desktopSelection = CreateAVDSelection()
        desktopSelection.deviceType = .desktop
        desktopSelection.avdName = "Desktop_34"
        desktopSelection.selectedVersionIdentifier = "android-34"
        desktopSelection.googleServices = .none
        desktopSelection.architecture = "arm64"
        desktopSelection.deviceProfile = .init(id: "desktop_medium", name: "Medium Desktop")

        let desktopResolved = AndroidSystemImageCatalog.resolve(selection: desktopSelection, images: images)
        #expect(desktopResolved?.packagePath == "system-images;android-34;android-desktop;arm64-v8a")

        var automotiveSelection = CreateAVDSelection()
        automotiveSelection.deviceType = .automotive
        automotiveSelection.avdName = "Auto_34"
        automotiveSelection.selectedVersionIdentifier = "android-34-ext9"
        automotiveSelection.googleServices = .googlePlay
        automotiveSelection.architecture = "x86_64"
        automotiveSelection.deviceProfile = .init(id: "automotive_1408p_landscape_with_play", name: "1408p Landscape with Google Play")

        let automotiveResolved = AndroidSystemImageCatalog.resolve(selection: automotiveSelection, images: images)
        #expect(automotiveResolved?.packagePath == "system-images;android-34-ext9;android-automotive-playstore;x86_64")

        var xrSelection = CreateAVDSelection()
        xrSelection.deviceType = .xr
        xrSelection.avdName = "XR_34"
        xrSelection.selectedVersionIdentifier = "android-34"
        xrSelection.googleServices = .googlePlay
        xrSelection.architecture = "arm64"
        xrSelection.deviceProfile = .init(id: "xr_headset_device", name: "XR Headset")

        let xrResolved = AndroidSystemImageCatalog.resolve(selection: xrSelection, images: images)
        #expect(xrResolved?.packagePath == "system-images;android-34;google-xr;arm64-v8a")
    }
}

private let sdkManagerCatalogFixture = """
Installed packages:
  Path                                                                               | Version | Description                                                     | Location
  system-images;android-35;google_apis;arm64-v8a                                     | 9       | Google APIs ARM 64 v8a System Image                             | system-images/android-35/google_apis/arm64-v8a

Available Packages:
  Path                                                                               | Version | Description                                                     | Location
  system-images;android-35;google_apis;arm64-v8a                                     | 9       | Google APIs ARM 64 v8a System Image                             | system-images/android-35/google_apis/arm64-v8a
  system-images;android-35;google_apis_playstore;x86_64                              | 9       | Google Play Intel x86_64 Atom System Image                      | system-images/android-35/google_apis_playstore/x86_64
  system-images;android-36;google_apis;arm64-v8a                                     | 7       | Google APIs ARM 64 v8a System Image                             | system-images/android-36/google_apis/arm64-v8a
  system-images;android-36;google_apis_playstore;arm64-v8a                           | 7       | Google Play ARM 64 v8a System Image                             | system-images/android-36/google_apis_playstore/arm64-v8a
  system-images;android-34;android-desktop;arm64-v8a                                 | 1       | Desktop ARM 64 v8a System Image                                 | system-images/android-34/android-desktop/arm64-v8a
  system-images;android-34;android-tv;arm64-v8a                                      | 3       | Android TV ARM 64 v8a System Image                              | system-images/android-34/android-tv/arm64-v8a
  system-images;android-34-ext9;android-automotive-playstore;x86_64                  | 4       | Android Automotive with Google Play x86_64 System Image         | system-images/android-34-ext9/android-automotive-playstore/x86_64
  system-images;android-34-ext9;android-automotive;arm64-v8a                         | 5       | Android Automotive with Google APIs arm64-v8a System Image      | system-images/android-34-ext9/android-automotive/arm64-v8a
  system-images;android-34;google-xr;arm64-v8a                                       | 7       | Google Play XR ARM 64 v8a System Image (Developer Preview)      | system-images/android-34/google-xr/arm64-v8a
"""
