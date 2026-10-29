import type { CollateralExportFilter } from '../types/export.js';

export const DEFAULT_COLLATERAL_EXPORT_FILTER: CollateralExportFilter = {
  residentialOnly: true,
  collateralTypeIncludes: 'Residential',
  requireAddress: true,
};

export function resolveCollateralExportFilter(
  partial?: Partial<CollateralExportFilter>,
): CollateralExportFilter {
  return {
    residentialOnly: partial?.residentialOnly ?? DEFAULT_COLLATERAL_EXPORT_FILTER.residentialOnly,
    collateralTypeIncludes:
      partial?.collateralTypeIncludes ?? DEFAULT_COLLATERAL_EXPORT_FILTER.collateralTypeIncludes,
    requireAddress: partial?.requireAddress ?? DEFAULT_COLLATERAL_EXPORT_FILTER.requireAddress,
  };
}

const NO_ADDRESS_MARKERS = ['no address provided', 'n/a', 'none', 'tbd'];

export function collateralAddressFromFields(fields: {
  fullAddress?: string | null;
  streetAddress?: string | null;
  city?: string | null;
  zipCode?: string | null;
}): string | null {
  const full = fields.fullAddress?.trim();
  if (full && !NO_ADDRESS_MARKERS.includes(full.toLowerCase())) {
    return full;
  }
  const parts = [fields.streetAddress, fields.city, fields.zipCode]
    .map((p) => p?.trim())
    .filter(Boolean);
  if (!parts.length) return null;
  const joined = parts.join(', ');
  if (NO_ADDRESS_MARKERS.includes(joined.toLowerCase())) return null;
  return joined;
}

export function hasUsableCollateralAddress(address: string | null): boolean {
  if (!address?.trim()) return false;
  return !NO_ADDRESS_MARKERS.includes(address.trim().toLowerCase());
}

export function isResidentialCollateralType(
  typeName: string | null | undefined,
  filter: CollateralExportFilter,
): boolean {
  if (!filter.residentialOnly) return true;
  if (!typeName) return false;
  return typeName.toLowerCase().includes(filter.collateralTypeIncludes.toLowerCase());
}
