# Packaged Mode (Packaged Cloe.app) GIF Generation Fix

## Problem

In the packaged Cloe.app, AI-generated action GIFs are forever stuck at "starting". Root cause: asar is a read-only archive.

## 9 asar Traps

1. Python scripts not in asar → add extraResources in package.json
2. Python can't read reference images inside asar → resolveReferenceForPython() copies to temp
3. Python can't write to asar output directory → getGifsDataDir() returns userData/gifs/
4. spawn cwd can't be asar path → use getGifsDataDir() instead
5. renderer file:// can't load userData GIF → change BASE to bridge HTTP
6. Admin UI ASSET_BASE also needs changing → use bridge HTTP
7. action-sets.json writes to asar are lost → return userData/action-sets.json
8. WS connection doesn't broadcast set-config → send immediately on connection
9. Static file routes split three ways: GIFs (userData→asar), refs (userData/assets→asar), audio (asar only)

## Path System

| Function | Packaged Mode | Development Mode |
|------|---------|---------|
| getScriptsDir() | Resources/scripts/ | __dirname/scripts/ |
| getGifsDataDir() | userData/gifs/ | public/gifs/ |
| getActionSetsPath() | userData/action-sets.json | public/action-sets.json |
| getPublicAssetsRoot() | __dirname/dist (read-only) | __dirname/public |
| getWritableAssetsRoot() | userData/assets/ | __dirname/public |

## Lessons Learned

- Never delete data in userData for debugging
- Works in dev ≠ works after packaging
- asar is not transparent to child processes; Electron fs patch only works at the Node.js level
- Renderer hardcoded + WS set-config dual-track must be kept in sync
