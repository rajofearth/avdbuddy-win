# AvdBuddy Website

This directory contains the marketing website for `AvdBuddy`.

The site is built with Next.js and is separate from the desktop app in the repository root.

## Purpose

The website is used for:

- presenting AvdBuddy publicly
- linking users to the latest GitHub release
- showing product messaging, screenshots, and demo media
- exposing lightweight server routes for release and GitHub metadata

## Tech Stack

- Next.js
- React
- TypeScript
- Tailwind CSS
- Framer Motion

## Directory Notes

- `app/` — routes, layouts, pages, and server endpoints
- `components/` — reusable UI components
- `public/` — static assets like screenshots, icons, and demo media
- `lib/` — small shared helpers

## Development

Install dependencies and run the site locally:

```bash
bun install
bun dev
```

Then open `http://localhost:3000`.

## Build

To create a production build:

```bash
bun run build
```

To run the production server locally:

```bash
bun start
```

## Content Notes

If repo structure, platform support, or release conventions change, update the website copy to match. In particular, keep these aligned:

- homepage messaging
- metadata in `app/layout.tsx`
- download logic in `app/api/latest-download/route.ts`

## Release Notes

The website currently expects releases to be published on the main GitHub repository. If asset naming or distribution targets change, update the release redirect logic accordingly.