#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
    echo "Usage: $0 OUTPUT_FILE" >&2
    exit 2
fi

repository_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
version_file=${VERSION_FILE:-$repository_root/version.json}
output_file=$1
version=$(jq -er '.version' "$version_file")
target_abi=$(jq -er '.jellyfinTargetAbi' "$version_file")
auto_update=$(jq -r '
    if has("jellyfinPluginAutoUpdate") then
        .jellyfinPluginAutoUpdate
        | if type == "boolean" then . else error("jellyfinPluginAutoUpdate must be a boolean") end
    else false end
' "$version_file")
temporary_file=$(mktemp "${output_file}.tmp.XXXXXX")
trap 'rm -f -- "$temporary_file"' EXIT

jq -n \
   --arg version "${version}.0" \
   --arg target_abi "$target_abi" \
   --argjson auto_update "$auto_update" \
   '{
      category: "",
      changelog: "",
      description: "Watch movies together in sync with friends",
      guid: "0f2fd0fd-09ff-4f49-9f1c-4a8f421a4b7d",
      name: "OpenWatchParty",
      overview: "",
      owner: "",
      targetAbi: $target_abi,
      timestamp: "0001-01-01T00:00:00.0000000Z",
      version: $version,
      status: "Active",
      autoUpdate: $auto_update,
      assemblies: []
    }' > "$temporary_file"

mv -- "$temporary_file" "$output_file"
trap - EXIT
