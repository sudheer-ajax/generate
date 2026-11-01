# ONS geography bulk data (local, not in git)

Used later to enrich collateral **postcode** → ITL and other stats geographies.

## NSPL (National Statistics Postcode Lookup)

**Source:** ONS Geography — [NSPL February 2026 (CSV)](https://www.data.gov.uk/dataset/9fae15ba-3a3b-4889-bd08-36bd869b5480/national-statistics-postcode-lookup-february-2026-for-the-uk-hosted-table)

**Licence:** [ONS geography licences](https://www.ons.gov.uk/methodology/geography/licences) (includes Royal Mail / OS terms for postcode products).

### Download / refresh

```bash
npm run geography:download-nspl
```

Writes:

- `data/geography/NSPL_FEB_2026.zip` — archive from ONS ArcGIS (~180–190 MB)
- `data/geography/nspl-feb-2026/` — extracted CSV parts
  - **Full UK file:** `Data/NSPL_FEB_2026_UK.csv`
  - **Split by outward area:** `Data/multi_csv/NSPL_FEB_2026_UK_*.csv`
  - **ITL names/codes lookup:** `Documents/ITL125_ITL225_ITL325_LAU125_LAD25_UK_LU.csv`

Key NSPL columns: postcode (`pcds`, `pcd7`), **`itl25cd`** (ITL 2025 code).

After download, wire lookup in app code when ready (no runtime integration yet).
