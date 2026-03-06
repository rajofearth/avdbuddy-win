import { describe, expect, test } from "bun:test";
import { __emulatorManagerTestUtils } from "../src/bun/services/emulatorManager.ts";

describe("sdkmanager warning handling", () => {
  test("detects recoverable emulator dependency warnings", () => {
    const output = `
Loading package information...
Warning: Dependant package with key emulator not found!
Warning: Unable to compute a complete list of dependencies.
`;

    expect(__emulatorManagerTestUtils.hasRecoverableSdkManagerWarning(output)).toBe(
      true
    );
  });

  test("does not mark unrelated failures as recoverable", () => {
    const output = "Failed to load package list due to SSL handshake failure.";
    expect(__emulatorManagerTestUtils.hasRecoverableSdkManagerWarning(output)).toBe(
      false
    );
  });
});

describe("parseInstalledPackages", () => {
  test("collects installed SDK package paths from sdkmanager output", () => {
    const output = `
Installed packages:
  Path                              | Version | Description
  -------                           | ------- | -------
  emulator                          | 36.4.9  | Android Emulator
  platform-tools                    | 36.0.0  | Android SDK Platform-Tools
  system-images;android-36;google_apis_playstore;x86_64 | 7 | Google Play Intel x86_64 Atom System Image

Available Packages:
  something-else | 1 | Whatever
`;

    expect(
      [...__emulatorManagerTestUtils.parseInstalledPackages(output)].sort()
    ).toEqual([
      "emulator",
      "platform-tools",
      "system-images;android-36;google_apis_playstore;x86_64",
    ]);
  });
});

describe("normalizeSystemImagePackagePathWithAvailablePackages", () => {
  test("maps unofficial android-36.1 requests to the newest published extension image", () => {
    const normalized =
      __emulatorManagerTestUtils.normalizeSystemImagePackagePathWithAvailablePackages(
        "system-images;android-36.1;google_apis_playstore;x86_64",
        [
          "system-images;android-36;google_apis_playstore;x86_64",
          "system-images;android-36-ext19;google_apis_playstore;x86_64",
          "system-images;android-36.0-Baklava;google_apis_playstore;x86_64",
        ]
      );

    expect(normalized).toBe(
      "system-images;android-36-ext19;google_apis_playstore;x86_64"
    );
  });

  test("keeps an already-installed exact package path even if it is not in the official feed", () => {
    const requested = "system-images;android-36.1;google_apis_playstore;x86_64";
    const normalized =
      __emulatorManagerTestUtils.normalizeSystemImagePackagePathWithAvailablePackages(
        requested,
        [
          "system-images;android-36;google_apis_playstore;x86_64",
          "system-images;android-36-ext19;google_apis_playstore;x86_64",
        ],
        [requested]
      );

    expect(normalized).toBe(requested);
  });

  test("returns the requested package when no compatible official image exists", () => {
    const requested = "system-images;android-99.1;google_apis_playstore;x86_64";
    const normalized =
      __emulatorManagerTestUtils.normalizeSystemImagePackagePathWithAvailablePackages(
        requested,
        ["system-images;android-36-ext19;google_apis_playstore;x86_64"]
      );

    expect(normalized).toBe(requested);
  });
});
