import { describe, expect, test } from "bun:test";
import { __sdkInstallerTestUtils } from "../src/bun/services/androidSdkInstaller.ts";

const repositoryFixture = `
<sdk-repository>
  <remotePackage path="cmdline-tools;20.0">
    <revision>
      <major>20</major>
      <minor>0</minor>
    </revision>
    <archives>
      <archive>
        <complete>
          <size>172789259</size>
          <checksum>linux20</checksum>
          <url>commandlinetools-linux-14742923_latest.zip</url>
        </complete>
        <host-os>linux</host-os>
      </archive>
      <archive>
        <complete>
          <size>150532528</size>
          <checksum>windows20</checksum>
          <url>commandlinetools-win-14742923_latest.zip</url>
        </complete>
        <host-os>windows</host-os>
      </archive>
    </archives>
  </remotePackage>
  <remotePackage path="cmdline-tools;19.0-alpha01">
    <revision>
      <major>19</major>
      <minor>0</minor>
      <preview>1</preview>
    </revision>
    <archives>
      <archive>
        <complete>
          <size>1</size>
          <checksum>ignored</checksum>
          <url>commandlinetools-linux-preview.zip</url>
        </complete>
        <host-os>linux</host-os>
      </archive>
    </archives>
  </remotePackage>
  <remotePackage path="cmdline-tools;19.0">
    <revision>
      <major>19</major>
      <minor>0</minor>
    </revision>
    <archives>
      <archive>
        <complete>
          <size>164760899</size>
          <checksum>linux19</checksum>
          <url>commandlinetools-linux-13114758_latest.zip</url>
        </complete>
        <host-os>linux</host-os>
      </archive>
      <archive>
        <complete>
          <size>143040480</size>
          <checksum>windows19</checksum>
          <url>commandlinetools-win-13114758_latest.zip</url>
        </complete>
        <host-os>windows</host-os>
      </archive>
    </archives>
  </remotePackage>
  <remotePackage path="emulator">
    <revision>
      <major>36</major>
      <minor>5</minor>
      <micro>6</micro>
    </revision>
    <channelRef ref="channel-2"/>
    <archives>
      <archive>
        <complete>
          <size>419985746</size>
          <checksum>windows-preview</checksum>
          <url>emulator-windows_x64-14945876.zip</url>
        </complete>
        <host-os>windows</host-os>
      </archive>
    </archives>
  </remotePackage>
  <remotePackage path="emulator">
    <revision>
      <major>36</major>
      <minor>4</minor>
      <micro>9</micro>
    </revision>
    <channelRef ref="channel-0"/>
    <archives>
      <archive>
        <complete>
          <size>419394474</size>
          <checksum>windows-stable</checksum>
          <url>emulator-windows_x64-14788078.zip</url>
        </complete>
        <host-os>windows</host-os>
      </archive>
    </archives>
  </remotePackage>
</sdk-repository>
`;

describe("parseRepositoryArchive", () => {
  test("selects the newest stable Linux archive", () => {
    const archive = __sdkInstallerTestUtils.parseRepositoryArchive(
      repositoryFixture,
      "linux",
      /^cmdline-tools;[^"]+$/,
      "Android command-line tools"
    );

    expect(archive.packagePath).toBe("cmdline-tools;20.0");
    expect(archive.url).toBe("commandlinetools-linux-14742923_latest.zip");
    expect(archive.checksum).toBe("linux20");
  });

  test("selects the newest stable Windows archive", () => {
    const archive = __sdkInstallerTestUtils.parseRepositoryArchive(
      repositoryFixture,
      "windows",
      /^cmdline-tools;[^"]+$/,
      "Android command-line tools"
    );

    expect(archive.packagePath).toBe("cmdline-tools;20.0");
    expect(archive.url).toBe("commandlinetools-win-14742923_latest.zip");
    expect(archive.checksum).toBe("windows20");
  });

  test("prefers the stable emulator archive over a newer preview build", () => {
    const archive = __sdkInstallerTestUtils.parseRepositoryArchive(
      repositoryFixture,
      "windows",
      /^emulator$/,
      "Android emulator"
    );

    expect(archive.packagePath).toBe("emulator");
    expect(archive.url).toBe("emulator-windows_x64-14788078.zip");
    expect(archive.checksum).toBe("windows-stable");
    expect(archive.channel).toBe(0);
  });
});

describe("buildInstallPlan", () => {
  test("uses sdkmanager for emulator on Windows x64", () => {
    const plan = __sdkInstallerTestUtils.buildInstallPlan({
      platform: "win32",
      arch: "x64",
    });

    expect(plan.sdkManagerPackages).toEqual([
      "platform-tools",
      "emulator",
      "platforms;android-36",
    ]);
    expect(plan.requiresDirectEmulatorInstall).toBe(false);
  });

  test("uses a direct emulator archive install on Windows arm64", () => {
    const plan = __sdkInstallerTestUtils.buildInstallPlan({
      platform: "win32",
      arch: "arm64",
    });

    expect(plan.sdkManagerPackages).toEqual([
      "platform-tools",
      "platforms;android-36",
    ]);
    expect(plan.requiresDirectEmulatorInstall).toBe(true);
  });
});

describe("resolveHostArchitecture", () => {
  test("normalizes Windows architecture names", () => {
    expect(__sdkInstallerTestUtils.normalizeArchitectureName("AMD64")).toBe("x64");
    expect(__sdkInstallerTestUtils.normalizeArchitectureName("Arm64")).toBe("arm64");
    expect(__sdkInstallerTestUtils.normalizeArchitectureName("x86_64")).toBe("x64");
  });

  test("prefers the native Windows OS architecture over an emulated process architecture", () => {
    const arch = __sdkInstallerTestUtils.resolveHostArchitecture(
      "win32",
      "x64",
      "ARM64"
    );

    expect(arch).toBe("arm64");
  });

  test("falls back to process architecture when no native Windows architecture is detected", () => {
    const arch = __sdkInstallerTestUtils.resolveHostArchitecture(
      "win32",
      "x64",
      null
    );

    expect(arch).toBe("x64");
  });
});

describe("emulator local metadata", () => {
  test("parses emulator source.properties into local package metadata", () => {
    const metadata =
      __sdkInstallerTestUtils.emulatorLocalMetadataFromSourceProperties(`
Pkg.UserSrc=false
Pkg.Revision=36.4.9
Pkg.Path=emulator
Pkg.Desc=Android Emulator
Pkg.BuildId=14788078
`);

    expect(metadata).toEqual({
      packagePath: "emulator",
      displayName: "Android Emulator",
      revision: {
        major: 36,
        minor: 4,
        micro: 9,
      },
    });
  });

  test("builds a minimal local package.xml for emulator", () => {
    const packageXML = __sdkInstallerTestUtils.localPackageXML({
      packagePath: "emulator",
      displayName: "Android Emulator",
      revision: {
        major: 36,
        minor: 4,
        micro: 9,
      },
    });

    expect(packageXML).toContain('<localPackage path="emulator" obsolete="false">');
    expect(packageXML).toContain("<display-name>Android Emulator</display-name>");
    expect(packageXML).toContain(
      "<revision><major>36</major><minor>4</minor><micro>9</micro></revision>"
    );
  });
});
