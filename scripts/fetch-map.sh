#!/usr/bin/env bash
# fetch-map.sh — plan.md §5.7 / M29
#
# Downloads everything the map needs, once, while online:
#   1. data/maps/sweden.pmtiles  — PMTiles vector tile archive for Sweden
#      (zooms 0–14), extracted remotely from the latest Protomaps planet
#      build. Only the Swedish bbox tile ranges are fetched.
#   2. data/maps/map-assets/     — glyphs (Noto Sans) and the light sprite,
#      from the protomaps/basemaps-assets repository.
#
# After this, the map works with no internet at all: the API serves both
# directories (see apps/api/src/app.ts) and the web app points MapLibre at
# same-origin URLs only.
#
# Re-runnable: already-downloaded files are skipped.
#
# Sizes: the pmtiles file is on the order of a few GB (full pyramid 0–14 for
# the Swedish bbox); expect a long download on a slow link. The assets
# tarball is ~6 MB and the extracted fonts ~14 MB.
#
# Override any of these via environment:
#   MAPS_DIR  (default: data/maps, relative to the repo root)
#   BUILD_KEY (default: resolved automatically from the Protomaps build list)
#   BBOX      (default: 10.9,55.3,24.2,69.1 = min_lon,min_lat,max_lon,max_lat)
#   MAX_ZOOM  (default: 14)

set -eu

# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------

log() { echo "[fetch-map] $*"; }
err() { echo "[fetch-map] ERROR: $*" >&2; exit 1; }

command -v curl >/dev/null 2>&1 || err "curl is required"
command -v tar >/dev/null 2>&1 || err "tar is required"

# Repo root = parent of the scripts/ directory this file lives in.
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
cd "$REPO_ROOT"

MAPS_DIR="${MAPS_DIR:-data/maps}"
BBOX="${BBOX:-10.9,55.3,24.2,69.1}"
MAX_ZOOM="${MAX_ZOOM:-14}"
ASSETS_TARBALL_URL="https://github.com/protomaps/basemaps-assets/archive/refs/heads/main.tar.gz"
BUILD_METADATA_URL="https://build-metadata.protomaps.dev/builds.json"

mkdir -p "$MAPS_DIR/map-assets/fonts" "$MAPS_DIR/map-assets/sprites"

# ---------------------------------------------------------------------------
# 1. PMTiles archive for Sweden
# ---------------------------------------------------------------------------

PM_TILES_FILE="$MAPS_DIR/sweden.pmtiles"

# Find (or download) the go-pmtiles CLI.
CLI_VERSION="v1.31.2"
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

if command -v pmtiles >/dev/null 2>&1; then
  PMTILES_CLI=$(command -v pmtiles)
  log "Using pmtiles CLI from PATH: $PMTILES_CLI"
else
  OS=$(uname -s)
  ARCH=$(uname -m)
  case "$OS-$ARCH" in
    Linux-x86_64)   CLI_URL="https://github.com/protomaps/go-pmtiles/releases/download/$CLI_VERSION/go-pmtiles_${CLI_VERSION#v}_Linux_x86_64.tar.gz" ;;
    Linux-arm64)    CLI_URL="https://github.com/protomaps/go-pmtiles/releases/download/$CLI_VERSION/go-pmtiles_${CLI_VERSION#v}_Linux_arm64.tar.gz" ;;
    Darwin-x86_64)  CLI_URL="https://github.com/protomaps/go-pmtiles/releases/download/$CLI_VERSION/go-pmtiles-${CLI_VERSION#v}_Darwin_x86_64.zip" ;;
    Darwin-arm64)   CLI_URL="https://github.com/protomaps/go-pmtiles/releases/download/$CLI_VERSION/go-pmtiles-${CLI_VERSION#v}_Darwin_arm64.zip" ;;
    *) err "Unsupported platform for the go-pmtiles CLI: $OS-$ARCH (install the CLI from https://github.com/protomaps/go-pmtiles/releases and re-run)" ;;
  esac
  case "$CLI_URL" in
    *.tar.gz)
      log "Downloading go-pmtiles CLI ($OS $ARCH)…"
      curl -sfL -o "$TMP_DIR/cli.tar.gz" "$CLI_URL" || err "Failed to download the pmtiles CLI from $CLI_URL"
      tar xzf "$TMP_DIR/cli.tar.gz" -C "$TMP_DIR" pmtiles
      ;;
    *.zip)
      log "Downloading go-pmtiles CLI ($OS $ARCH)…"
      command -v unzip >/dev/null 2>&1 || err "unzip is required to install the pmtiles CLI on macOS"
      curl -sfL -o "$TMP_DIR/cli.zip" "$CLI_URL" || err "Failed to download the pmtiles CLI from $CLI_URL"
      unzip -q "$TMP_DIR/cli.zip" pmtiles -d "$TMP_DIR"
      ;;
  esac
  chmod +x "$TMP_DIR/pmtiles"
  PMTILES_CLI="$TMP_DIR/pmtiles"
fi

# Resolve the latest Protomaps planet build.
if [ -z "${BUILD_KEY:-}" ]; then
  log "Resolving latest Protomaps build from $BUILD_METADATA_URL …"
  BUILD_KEY=$(curl -sfL "$BUILD_METADATA_URL" \
    | grep -o '"key":"[0-9]*\.pmtiles"' | tail -1 | cut -d'"' -f4) \
    || err "Could not download the Protomaps build list from $BUILD_METADATA_URL"
  [ -n "$BUILD_KEY" ] || err "Could not parse a build key from the Protomaps build list"
fi
log "Using Protomaps build: $BUILD_KEY"

if [ -s "$PM_TILES_FILE" ]; then
  log "PMTiles file already exists: $PM_TILES_FILE ($(du -h "$PM_TILES_FILE" | cut -f1)) — skipping. (Delete it to re-fetch.)"
else
  log "Extracting Sweden (bbox $BBOX, maxzoom $MAX_ZOOM) from https://build.protomaps.com/$BUILD_KEY …"
  log "This downloads only the Swedish tile ranges, but the full pyramid is several GB — be patient."
  "$PMTILES_CLI" extract "https://build.protomaps.com/$BUILD_KEY" "$PM_TILES_FILE.part" \
    --bbox="$BBOX" --maxzoom="$MAX_ZOOM" \
    || { rm -f "$PM_TILES_FILE.part"; err "pmtiles extract failed"; }
  mv "$PM_TILES_FILE.part" "$PM_TILES_FILE"
  log "PMTiles file saved: $PM_TILES_FILE ($(du -h "$PM_TILES_FILE" | cut -f1))"
fi

# ---------------------------------------------------------------------------
# 2. Glyphs (fonts) and sprite from protomaps/basemaps-assets
# ---------------------------------------------------------------------------

# The three font stacks protomaps-themes-base references (LIGHT theme):
# "Noto Sans Regular", "Noto Sans Italic", "Noto Sans Medium".
FONT_STACKS=("Noto Sans Regular" "Noto Sans Italic" "Noto Sans Medium")
SPRITE_FILES=("light.json" "light.png" "light@2x.json" "light@2x.png")

assets_present() {
  local stack file
  for stack in "${FONT_STACKS[@]}"; do
    [ -d "$MAPS_DIR/map-assets/fonts/$stack" ] || return 1
    [ "$(find "$MAPS_DIR/map-assets/fonts/$stack" -name '*.pbf' | wc -l)" -gt 0 ] || return 1
  done
  for file in "${SPRITE_FILES[@]}"; do
    [ -s "$MAPS_DIR/map-assets/sprites/$file" ] || return 1
  done
  return 0
}

if assets_present; then
  log "Map assets (fonts + sprite) already present — skipping."
else
  log "Downloading basemaps-assets (glyphs + sprite) from $ASSETS_TARBALL_URL …"
  curl -sfL -o "$TMP_DIR/assets.tar.gz" "$ASSETS_TARBALL_URL" \
    || err "Failed to download basemaps-assets from $ASSETS_TARBALL_URL"
  tar xzf "$TMP_DIR/assets.tar.gz" -C "$TMP_DIR"
  ASSETS_ROOT=$(find "$TMP_DIR" -maxdepth 1 -mindepth 1 -type d -name 'basemaps-assets-*' | head -1)
  [ -n "$ASSETS_ROOT" ] || err "Unexpected basemaps-assets tarball layout (no basemaps-assets-* directory)"

  for stack in "${FONT_STACKS[@]}"; do
    [ -d "$ASSETS_ROOT/fonts/$stack" ] || err "Font stack '$stack' not found in basemaps-assets"
    mkdir -p "$MAPS_DIR/map-assets/fonts/$stack"
    cp -f "$ASSETS_ROOT/fonts/$stack"/*.pbf "$MAPS_DIR/map-assets/fonts/$stack/"
  done
  for file in "${SPRITE_FILES[@]}"; do
    [ -f "$ASSETS_ROOT/sprites/v4/$file" ] || err "Sprite '$file' not found in basemaps-assets"
    cp -f "$ASSETS_ROOT/sprites/v4/$file" "$MAPS_DIR/map-assets/sprites/$file"
  done
  log "Map assets saved to $MAPS_DIR/map-assets/"
fi

log "Done. The map is self-contained in $MAPS_DIR:"
du -sh "$PM_TILES_FILE" "$MAPS_DIR/map-assets" 2>/dev/null | sed 's/^/  /'
log "Next: restart the stack (docker compose up -d) so the API serves the new files."
