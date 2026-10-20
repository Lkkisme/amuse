#!/usr/bin/env bash
# Compile the generated Kotlin with kotlinx.serialization and round-trip the fixtures.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
gen="$here/../.generated"
version=1.12.0
cache="${XDG_CACHE_HOME:-$HOME/.cache}/remuse/kotlinx-serialization-$version"
mkdir -p "$cache"
for artifact in kotlinx-serialization-core-jvm kotlinx-serialization-json-jvm; do
  jar="$cache/$artifact.jar"
  [[ -f $jar ]] || curl -fsSL -o "$jar" "https://repo1.maven.org/maven2/org/jetbrains/kotlinx/$artifact/$version/$artifact-$version.jar"
done
cp="$cache/kotlinx-serialization-core-jvm.jar:$cache/kotlinx-serialization-json-jvm.jar"
plugin="$(dirname "$(command -v kotlinc)")/../lib/kotlinx-serialization-compiler-plugin.jar"
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT
kotlinc -nowarn -Werror -Xplugin="$plugin" -cp "$cp" -d "$out" "$gen/kotlin/Protocol.kt" "$here/Check.kt" 2>&1
kotlin -cp "$out:$cp" CheckKt "$gen/fixtures.json"
