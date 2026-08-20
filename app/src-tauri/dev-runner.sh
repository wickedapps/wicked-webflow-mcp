#!/bin/sh
# Stands in for `cargo` during `tauri dev` (build.runner in tauri.conf.json).
#
# macOS names the Dock tile of an *unbundled* binary after the executable's
# filename, and nothing else. Not NSProcessInfo, not an embedded __info_plist,
# not tauri's mainBinaryName. Cargo refuses spaces in a target name, so
# `cargo run` can only ever launch `wicked-webflow-app`. So build the way cargo
# would, then launch the binary under a name that matches the .app bundle.
#
# Only `run` is special-cased. `tauri build` bundles the .app itself and its
# Info.plist already carries the product name, so that path just passes through.
set -e

if [ "$1" != "run" ]; then
    exec cargo "$@"
fi
shift

# tauri invokes us as `run <cargo flags...> -- <app args...>`.
flags=""
while [ "$#" -gt 0 ] && [ "$1" != "--" ]; do
    flags="$flags $1"
    shift
done
if [ "$#" -gt 0 ]; then
    shift
fi

# shellcheck disable=SC2086  # cargo flags are single words; splitting is the point
cargo build $flags

target="$(cargo metadata --format-version 1 --no-deps |
    sed -n 's/.*"target_directory":"\([^"]*\)".*/\1/p')/debug"
# A hard link, not a copy: the binary is ~30MB and this runs on every reload.
ln -f "$target/wicked-webflow-app" "$target/Wicked Webflow MCP Manager"
exec "$target/Wicked Webflow MCP Manager" "$@"
