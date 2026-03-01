# Homebrew Tap Setup

Use a shared tap repo named `alexstyl/homebrew-tap`.

Homebrew will expose that repo as the tap `alexstyl/tap`.

## User Install

Users can install AvdBuddy with:

```bash
brew install --cask alexstyl/tap/avdbuddy
```

Or by tapping first:

```bash
brew tap alexstyl/tap
brew install --cask avdbuddy
```

## Tap Repo Layout

The tap repo should contain:

```text
homebrew-tap/
  Casks/
    avdbuddy.rb
```

Copy [`avdbuddy.rb`](./avdbuddy.rb) into `Casks/avdbuddy.rb` in the tap repo.

## Release Update Flow

For each AvdBuddy release:

1. Run `./scripts/releaseMac`
2. Confirm the GitHub Release contains `AvdBuddy-<version>.dmg`
3. Compute the checksum:

```bash
shasum -a 256 AvdBuddy-<version>.dmg
```

4. Update `version` and `sha256` in `Casks/avdbuddy.rb`
5. Commit and push the tap repo

After that, Homebrew users can install the new version from `alexstyl/tap`.
