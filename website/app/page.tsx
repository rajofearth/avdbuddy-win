"use client";

import { motion } from "framer-motion";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";

const workflow = [
  "Discover all AVDs instantly",
  "Create new devices with guided presets",
  "Launch emulators without opening Android Studio",
];

export default function Home() {
  const [stars, setStars] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const brewCommand = "brew install --cask alexstyl/tap/avdbuddy";

  useEffect(() => {
    let active = true;

    const loadStars = async () => {
      try {
        const response = await fetch("/api/github-stars", { cache: "no-store" });
        if (!response.ok) {
          return;
        }

        const data = (await response.json()) as { stars: number | null };
        if (active) {
          setStars(data.stars);
        }
      } catch {
        // Keep fallback label when stars cannot be loaded.
      }
    };

    void loadStars();

    return () => {
      active = false;
    };
  }, []);

  const githubLabel = useMemo(() => {
    if (stars === null) {
      return "GitHub";
    }

    const formatted = new Intl.NumberFormat("en-US", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(stars);

    return `GitHub ★ ${formatted}`;
  }, [stars]);

  const copyBrewCommand = async () => {
    try {
      await navigator.clipboard.writeText(brewCommand);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <main className="relative min-h-screen">
      <header className="sticky top-4 z-50 px-4">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between rounded-2xl border border-white/10 bg-[#0c0e18]/90 px-4 py-3 shadow-[0_18px_60px_rgba(0,0,0,0.5)] backdrop-blur-xl md:px-5">
          <a href="#" className="flex items-center gap-2.5">
            <p className="text-sm font-semibold">AvdBuddy</p>
          </a>

          <nav className="hidden items-center gap-5 text-sm text-[var(--ink-muted)] md:flex">
            <a href="https://github.com/alexstyl/avdbuddy" target="_blank" rel="noreferrer" className="hover:text-white">
              {githubLabel}
            </a>
          </nav>

          <div className="flex items-center gap-2">
            <a href="/api/latest-download">
              <button className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-black transition hover:bg-white/90">
                <Image
                  src="/apple-logo-black.svg"
                  alt=""
                  width={14}
                  height={16}
                  aria-hidden="true"
                />
                Download
              </button>
            </a>
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-6xl px-6 py-8 md:px-10 md:py-10">
        <motion.section
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
          className="relative overflow-hidden rounded-3xl border border-white/10 bg-[var(--surface)] p-7 shadow-[0_32px_80px_rgba(0,0,0,0.4)] md:p-10"
        >
          <div className="absolute -top-20 right-10 h-64 w-64 rounded-full bg-[var(--brand)]/25 blur-3xl" />
          <div className="absolute inset-0 bg-[repeating-linear-gradient(130deg,transparent_0,transparent_56px,rgba(255,255,255,0.04)_57px,transparent_96px)] opacity-50" />

          <div className="relative grid gap-8 md:grid-cols-[1fr_0.95fr] md:items-center">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.22em] text-[#7fd5ff]">for android developers</p>
              <h1 className="mt-4 text-4xl font-bold leading-tight md:text-6xl">
                Manage AVDs from
                <br />
                a proper desktop app.
              </h1>
              <p className="mt-5 max-w-xl text-lg text-[var(--ink-muted)]">
                AvdBuddy is a native macOS tool for emulator-heavy workflows.
                Build, launch, duplicate, and clean up virtual devices with less friction.
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <a href="/api/latest-download">
                  <Button size="lg">Download for Mac</Button>
                </a>
                <a href="#brew">
                  <Button size="lg" variant="secondary">Install with Homebrew</Button>
                </a>
              </div>
            </div>

            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.55, delay: 0.1 }}
              className="rounded-2xl border border-white/10 bg-[var(--surface-strong)] p-3"
            >
              <Image
                src="/avdbuddy.jpg"
                alt="AvdBuddy app screenshot"
                width={1200}
                height={750}
                className="h-auto w-full rounded-xl"
                priority
              />
            </motion.div>
          </div>
        </motion.section>

        <section className="mt-8 grid gap-4 md:grid-cols-3">
          {workflow.map((item, index) => (
            <motion.article
              key={item}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 + index * 0.08, duration: 0.4 }}
              className="rounded-2xl border border-white/10 bg-[var(--surface)]/80 p-5"
            >
              <p className="font-mono text-xs text-[#7fd5ff]">0{index + 1}</p>
              <p className="mt-2 text-lg font-semibold">{item}</p>
            </motion.article>
          ))}
        </section>

        <section className="mt-8 rounded-3xl border border-white/10 bg-[var(--surface)]/90 p-7 md:p-10">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold md:text-3xl">Watch AvdBuddy in action</h2>
              <p className="mt-2 text-[var(--ink-muted)]">
                Watch how simple you can create emulators for any form factor using AvdBuddy
              </p>
            </div>
            <p className="rounded-full border border-white/15 px-3 py-1 font-mono text-xs text-[var(--ink-muted)]">
              70s Demo
            </p>
          </div>

          <div className="mt-5 overflow-hidden rounded-2xl border border-white/10 bg-black">
            <video
              autoPlay
              muted
              loop
              playsInline
              controls
              preload="metadata"
              poster="/media/avdbuddy-showcase-poster.jpg"
              className="h-auto w-full"
            >
              <source src="/media/avdbuddy-showcase.mp4" type="video/mp4" />
              Your browser does not support video playback.
            </video>
          </div>
        </section>

        <section
          id="brew"
          className="mt-8 rounded-3xl border border-white/10 bg-[var(--surface)]/90 p-7 md:p-10"
        >
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold md:text-3xl">Install via Homebrew</h2>
              <p className="mt-2 text-[var(--ink-muted)]">
                Best for developers who want updates through CLI tooling.
              </p>
            </div>
            <button
              onClick={() => {
                void copyBrewCommand();
              }}
              className="inline-flex h-10 items-center justify-center rounded-xl border border-white/15 bg-white/5 px-4 text-sm font-semibold text-white transition hover:bg-white/10"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <pre className="mt-4 overflow-auto rounded-xl border border-white/15 bg-black/70 p-4 font-mono text-sm text-[#d3d7ff]">
            <code>{brewCommand}</code>
          </pre>
        </section>
      </div>
    </main>
  );
}
