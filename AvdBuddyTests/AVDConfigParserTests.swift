import Testing
@testable import AvdBuddy

struct AVDConfigParserTests {
    @Test
    func extractsApiLevelFromTarget() {
        let config = """
        avd.ini.encoding=UTF-8
        target=android-35
        """

        #expect(AVDConfigParser.apiLevel(from: config) == 35)
    }

    @Test
    func extractsApiLevelFromImageSysdir() {
        let config = """
        image.sysdir.1=system-images/android-24/google_apis/x86/
        """

        #expect(AVDConfigParser.apiLevel(from: config) == 24)
    }

    @Test
    func resolvesAndroidDisplayName() {
        #expect(AndroidVersionCatalog.displayName(forAPI: 35) == "Android 15")
        #expect(AndroidVersionCatalog.displayName(forAPI: 14) == "Android 4.0 Ice Cream Sandwich")
    }

    @Test
    func classifiesPhoneFromTallAspectRatio() {
        let config = """
        hw.lcd.width=1080
        hw.lcd.height=2400
        """

        #expect(AVDConfigParser.deviceType(from: config) == .phone)
    }

    @Test
    func classifiesTabletFromWideAspectRatio() {
        let config = """
        hw.lcd.width=1600
        hw.lcd.height=2560
        """

        #expect(AVDConfigParser.deviceType(from: config) == .tablet)
    }

    @Test
    func classifiesTvFromTagAndDeviceName() {
        let config = """
        tag.id=google-tv
        hw.device.name=tv_1080p
        hw.lcd.width=1920
        hw.lcd.height=1080
        """

        #expect(AVDConfigParser.deviceType(from: config) == .tv)
    }

    @Test
    func classifiesFoldableFromHingeAndDeviceName() {
        let config = """
        hw.sensor.hinge=yes
        hw.device.name=pixel_9_pro_fold
        hw.lcd.width=2076
        hw.lcd.height=2152
        """

        #expect(AVDConfigParser.deviceType(from: config) == .foldable)
    }

    @Test
    func classifiesWearDesktopAutomotiveAndXrFromTags() {
        let wearConfig = """
        tag.id=android-wear
        hw.device.name=wearos_large_round
        """
        #expect(AVDConfigParser.deviceType(from: wearConfig) == .wearOS)

        let desktopConfig = """
        tag.id=android-desktop
        hw.device.name=desktop_medium
        """
        #expect(AVDConfigParser.deviceType(from: desktopConfig) == .desktop)

        let automotiveConfig = """
        tag.id=android-automotive-playstore
        hw.device.name=automotive_1024p_landscape
        """
        #expect(AVDConfigParser.deviceType(from: automotiveConfig) == .automotive)

        let xrConfig = """
        tag.id=android-xr
        hw.device.name=xr_headset_device
        """
        #expect(AVDConfigParser.deviceType(from: xrConfig) == .xr)
    }

    @Test
    func extractsPersistedColorSeed() {
        let config = """
        avdbuddy.color.seed=1f2e3d4c
        """

        #expect(AVDConfigParser.colorSeed(from: config) == "1f2e3d4c")
    }
}
