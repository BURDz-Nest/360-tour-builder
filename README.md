# ATLAS Explore — Dev stage

The 360-tour authoring tool + player. This is the **`Dev/`** stage of the
three-stage `ATLAS-Explore/` pipeline (`Dev → Staged → Prod`). Edit here,
test locally, then promote. See `../AGENTS.md` for the full workflow and
`ARCHITECTURE.md` for how the app itself works.

## Quick start (local, no deploy needed)

```bash
./scripts/launch.sh            # serves on port 5173, opens the builder
./scripts/launch.sh 5199       # use a different port if 5173 is busy
```

Then the builder is at `http://localhost:5173/builder/index.html`. Stop with
**Ctrl+C**.

> Browsers treat `http://localhost` as a secure context, so the File System
> Access API (save-to-disk) works locally exactly like the deployed `https`
> site — no certificates or deploy required to iterate.
>
> The script serves from this stage's root on purpose — the builder loads
> vendor libs and the player via `../player-template/` relative paths, so
> serving from any deeper folder would 404 those files.

**Prerequisites:** python3, and Google Chrome or Microsoft Edge
(Safari/Firefox don't support the folder-save API, even on localhost).

## What's inside

| Path | What |
|------|------|
| `builder/` | the authoring tool (open `builder/index.html`) |
| `player-template/` | the learner runtime (open `player-template/player.html`) |
| `templates/` | starter interaction-block templates authors can insert |
| `scripts/launch.sh` | one-command local dev server (see Quick start) |
| root | `ARCHITECTURE.md` · `DEPLOY-INSTRUCTIONS.md` (workflow/promotion rules live one level up in `../AGENTS.md`, shared by the whole pipeline) |

## The iterate loop

1. Edit any file in `builder/` or `player-template/`.
2. **Refresh the browser** — your change is live locally.
3. Repeat. Only bump cache-bust tags / promote once it's ready.

### Beat the cache while developing

The app uses `?v=NN` version tags on its JS/CSS. Locally that can serve a
stale cached file after you edit. Fix it either way:

- **Recommended:** open DevTools (F12) → **Network** tab → tick **"Disable
  cache"**, and keep DevTools open while you work. Plain refresh now always
  reloads fresh.
- Or hard-refresh: **Cmd + Shift + R**.

You do **not** need to bump the `?v=` numbers while developing locally in
`Dev/` — only at promotion time (see `../AGENTS.md`).

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Port 5173 already in use" | `lsof -ti:5173 \| xargs kill`, or `./scripts/launch.sh 5199` |
| Builder loads but icons/player 404 | You're serving from the wrong folder — use `./scripts/launch.sh` (serves from this stage's root) |
| "Can't open this folder / system files" | Pick a normal sub-folder (e.g. `~/ATLAS-Explore/my-tour`), not Desktop/Documents/Downloads/drive-root |
| Builder says "Saved" but disk file doesn't change | The tour folder is inside **OneDrive/iCloud** — those swallow File-System-Access writes. Move the tour to a plain local folder. |
| Empty builder, dead buttons | You're not in Chrome/Edge — switch browsers |
| Edited a file but nothing changed | Cache — enable "Disable cache" in DevTools or Cmd+Shift+R |
