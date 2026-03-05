import { NextResponse } from "next/server";

const owner = "alexstyl";
const repo = "avdbuddy";

type RepoResponse = {
  stargazers_count?: number;
};

export async function GET() {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "avdbuddy-website",
        },
        next: { revalidate: 3600 },
      }
    );

    if (!response.ok) {
      return NextResponse.json({ stars: null }, { status: 200 });
    }

    const data = (await response.json()) as RepoResponse;
    return NextResponse.json({ stars: data.stargazers_count ?? null });
  } catch {
    return NextResponse.json({ stars: null }, { status: 200 });
  }
}
