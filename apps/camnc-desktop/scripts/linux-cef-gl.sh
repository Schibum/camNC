#!/usr/bin/env bash
# The Linux bundlers of tauri-cli 3.0.0-alpha.5 copy CEF's libEGL.so and libGLESv2.so, which CEF 154 no longer ships.
# Chromium then uses the system's EGL, so the bundle gets the system's GL dispatch libraries under those names.
# Runs as Tauri's beforeBundleCommand, after cargo has downloaded CEF.
set -euo pipefail
libdir=/usr/lib/x86_64-linux-gnu
for cef in "${CEF_PATH:-$HOME/.cache/tauri-cef}"/*/cef_linux_x86_64 "${CEF_PATH:-/nonexistent}"; do
  [ -d "$cef" ] || continue
  [ -e "$cef/libEGL.so" ] || cp "$libdir/libEGL.so.1" "$cef/libEGL.so"
  [ -e "$cef/libGLESv2.so" ] || cp "$libdir/libGLESv2.so.2" "$cef/libGLESv2.so"
  echo "CEF GL libraries in $cef:"
  ls -la "$cef"/libEGL.so "$cef"/libGLESv2.so
done
