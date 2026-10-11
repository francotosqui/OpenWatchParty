#!/usr/bin/env bash
set -euo pipefail

repository_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)
temporary_dir=$(mktemp -d)
trap 'rm -rf -- "$temporary_dir"' EXIT
output_file="$temporary_dir/meta.json"

"$repository_root/infra/scripts/write-plugin-meta.sh" "$output_file"

expected_version="$(jq -er '.version' "$repository_root/version.json").0"
expected_abi=$(jq -er '.jellyfinTargetAbi' "$repository_root/version.json")
[[ $(jq -er '.version' "$output_file") == "$expected_version" ]]
[[ $(jq -er '.targetAbi' "$output_file") == "$expected_abi" ]]
[[ $(jq -er '.guid' "$output_file") == '0f2fd0fd-09ff-4f49-9f1c-4a8f421a4b7d' ]]
[[ $(jq -r '.autoUpdate' "$output_file") == false ]]

fixture="$temporary_dir/version.json"
printf '%s\n' '{"version":"1.2.3","jellyfinTargetAbi":"12.0.0.0"}' > "$fixture"
VERSION_FILE="$fixture" "$repository_root/infra/scripts/write-plugin-meta.sh" "$output_file"
[[ $(jq -r '.autoUpdate' "$output_file") == false ]]

for enabled in true false; do
    jq --argjson enabled "$enabled" '.jellyfinPluginAutoUpdate = $enabled' "$fixture" > "$fixture.next"
    mv "$fixture.next" "$fixture"
    VERSION_FILE="$fixture" "$repository_root/infra/scripts/write-plugin-meta.sh" "$output_file"
    [[ $(jq -r '.autoUpdate' "$output_file") == "$enabled" ]]
done

# Invalid opt-ins fail before replacing an existing metadata file.
cp "$output_file" "$temporary_dir/original.json"
for invalid in '"true"' '"false"' null 0 1 '[]' '{}'; do
    jq --argjson invalid "$invalid" '.jellyfinPluginAutoUpdate = $invalid' "$fixture" > "$fixture.next"
    mv "$fixture.next" "$fixture"
    if VERSION_FILE="$fixture" "$repository_root/infra/scripts/write-plugin-meta.sh" "$output_file" >/dev/null 2>&1; then
        echo "Metadata writer accepted non-boolean auto-update: $invalid" >&2
        exit 1
    fi
    cmp "$output_file" "$temporary_dir/original.json"
done
