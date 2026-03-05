import { NextResponse } from "next/server";

const owner = "alexstyl";
const repo = "avdbuddy";
const fallbackReleaseUrl = `https://github.com/${owner}/${repo}/releases/latest`;

type GithubAsset = {
  name: string;
  browser_download_url: string;
};

type GithubRelease = {
  assets: GithubAsset[];
};

export async function GET() {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/releases/latest`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "avdbuddy-website",
        },
        next: { revalidate: 300 },
      }
    );

    if (!response.ok) {
      return NextResponse.redirect(fallbackReleaseUrl);
    }

    const release = (await response.json()) as GithubRelease;
    const dmgAsset = release.assets.find((asset) =>
      asset.name.toLowerCase().endsWith(".dmg")
    );

    if (!dmgAsset) {
      return NextResponse.redirect(fallbackReleaseUrl);
    }

    return NextResponse.redirect(dmgAsset.browser_download_url);
  } catch {
    return NextResponse.redirect(fallbackReleaseUrl);
  }
}
