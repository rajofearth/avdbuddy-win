import { describe, expect, test } from "bun:test";
import { __javaRuntimeTestUtils } from "../src/bun/services/javaRuntime.ts";

describe("parseJavaFeatureVersion", () => {
  test("parses modern Java feature versions", () => {
    expect(
      __javaRuntimeTestUtils.parseJavaFeatureVersion(
        'openjdk version "17.0.18" 2026-01-20'
      )
    ).toBe(17);
  });

  test("parses legacy 1.x Java versions", () => {
    expect(
      __javaRuntimeTestUtils.parseJavaFeatureVersion(
        'java version "1.8.0_442"'
      )
    ).toBe(8);
  });

  test("returns null when version output is unrecognized", () => {
    expect(__javaRuntimeTestUtils.parseJavaFeatureVersion("not java")).toBeNull();
  });
});
