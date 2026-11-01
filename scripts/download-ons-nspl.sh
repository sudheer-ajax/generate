#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GEO="$ROOT/data/geography"
ITEM_ID="36b718ad00de49afb9ad364f8b815b9e"
URL="https://www.arcgis.com/sharing/rest/content/items/${ITEM_ID}/data"
ZIP="$GEO/NSPL_FEB_2026.zip"
OUT="$GEO/nspl-feb-2026"

mkdir -p "$GEO"

if [[ -f "$ZIP" ]]; then
  echo "Zip already exists: $ZIP"
  echo "Delete it to re-download."
else
  echo "Downloading NSPL February 2026 (~187 MB) from ONS ArcGIS…"
  curl -fL "$URL" -o "$ZIP"
  echo "Saved: $ZIP"
fi

mkdir -p "$OUT"
echo "Extracting to $OUT …"
unzip -o "$ZIP" -d "$OUT"

cat > "$GEO/nspl-manifest.json" <<EOF
{
  "product": "National Statistics Postcode Lookup",
  "vintage": "February 2026",
  "downloadedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "sourceUrl": "$URL",
  "dataGovUk": "https://www.data.gov.uk/dataset/9fae15ba-3a3b-4889-bd08-36bd869b5480/national-statistics-postcode-lookup-february-2026-for-the-uk-hosted-table",
  "licence": "https://www.ons.gov.uk/methodology/geography/licences",
  "zipPath": "data/geography/NSPL_FEB_2026.zip",
  "extractDir": "data/geography/nspl-feb-2026",
  "itlCodeColumn": "itl25cd",
  "postcodeColumns": ["pcds", "pcd7", "pcd8"]
}
EOF

echo "Done. Manifest: $GEO/nspl-manifest.json"
find "$OUT" -name '*.csv' | head -5
