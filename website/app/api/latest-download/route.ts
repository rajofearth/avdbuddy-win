import { NextResponse } from "next/server";

const owner = "alexstyl";
const repo = "avdbuddy";
const fallbackReleaseUrl = `https://github.com/${owner}/${repo}/releases/latest`;

type GithubRelease = {
  html_url?: string;
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
      },
    );

    if (!response.ok) {
      return NextResponse.redirect(fallbackReleaseUrl);
    }

    const release = (await response.json()) as GithubRelease;
    return NextResponse.redirect(release.html_url || fallbackReleaseUrl);
  } catch {
    return NextResponse.redirect(fallbackReleaseUrl);
  }
}
