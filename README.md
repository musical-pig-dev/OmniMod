# OmniMod

Local-first Chrome extension for publishing mods to multiple hosts (Nexus, CurseForge, Modrinth, etc.) from a single form.

## Install & run locally

```bash
npm ci
npm run dev
```

Open the preview. For the Chrome extension build:

```bash
npm run build:chrome
```

Load `dist/chrome` as an unpacked extension.

## CI

Tests run on PRs to `develop`. On push to `main`, if the tree matches `develop` and tests passed, the extension is built and the git SHA is stamped.
