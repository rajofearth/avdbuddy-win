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
