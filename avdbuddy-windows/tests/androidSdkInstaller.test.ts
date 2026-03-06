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
</sdk-repository>
`;

describe("parseRepositoryArchive", () => {
  test("selects the newest stable Linux archive", () => {
    const archive = __sdkInstallerTestUtils.parseRepositoryArchive(
      repositoryFixture,
      "linux"
    );

    expect(archive.packagePath).toBe("cmdline-tools;20.0");
    expect(archive.url).toBe("commandlinetools-linux-14742923_latest.zip");
    expect(archive.checksum).toBe("linux20");
  });

  test("selects the newest stable Windows archive", () => {
    const archive = __sdkInstallerTestUtils.parseRepositoryArchive(
      repositoryFixture,
      "windows"
    );

    expect(archive.packagePath).toBe("cmdline-tools;20.0");
    expect(archive.url).toBe("commandlinetools-win-14742923_latest.zip");
    expect(archive.checksum).toBe("windows20");
  });
});
