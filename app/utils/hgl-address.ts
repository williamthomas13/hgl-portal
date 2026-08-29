import { cityFromLocation } from './dates'

// PL-399: HGL's HQ street address — ONE source, shared by the email footer
// fallback (email.ts), the class-page maps link + JSON-LD, the collateral
// letterhead, and the wizard's at-HGL location preset, so they can't
// diverge. Zip CONFIRMED 84101 by Scarlett (Aug 19, 2026) — the collateral
// letterhead had been printing 84109.
export const HGL_HQ_ADDRESS = '380 W. Pierpont Avenue, Salt Lake City, UT 84101 USA'

/** PL-305's postal-shape test, as a boolean: does this location string END
 *  like a US postal address ("…, Salt Lake City, UT" / "…, UT 84101")?
 *  Room strings ("Room 204"), buildings, and meeting links never pass. */
export function isAddressShaped(location: string | null | undefined): boolean {
  return cityFromLocation(location) !== null
}

/** PL-399: what a Google-Maps link for an AT-HGL class may search for. The
 *  visible location text stays whatever staff wrote ("Room 204") — this is
 *  only the maps QUERY: an address-shaped location verbatim, anything else
 *  (room-only, blank) resolves to the HQ address. School classes have no
 *  address on record (schools has no address column) and OMIT their maps
 *  link rather than search garbage; online classes have none at all — both
 *  gated at the call site. */
export function hglMapsQuery(location: string | null | undefined): string {
  return isAddressShaped(location) ? String(location).trim() : HGL_HQ_ADDRESS
}
