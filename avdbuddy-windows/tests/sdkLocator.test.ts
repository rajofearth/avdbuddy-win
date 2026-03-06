import { describe, expect, test } from "bun:test";
import { platformDefaultSDKPaths } from "../src/bun/services/sdkLocator.ts";

describe("platformDefaultSDKPaths", () => {
  test("uses Android/Sdk on Linux", () => {
    expect(platformDefaultSDKPaths("linux", "/home/tester")).toEqual([
      "/home/tester/Android/Sdk",
      "/home/tester/Android/sdk",
    ]);
  });

  test("uses AppData Android SDK on Windows", () => {
    expect(platformDefaultSDKPaths("win32", "C:\\Users\\tester")).toEqual([
      "C:\\Users\\tester/AppData/Local/Android/Sdk",
    ]);
  });
});
