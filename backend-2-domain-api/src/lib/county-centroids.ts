// Approximate town/city centre for each county this app supports.
// Used only as a search anchor for the Google Places fallback when we
// don't have the farmer's actual location, not for anything precise.

import type { CountyName } from "@/lib/poultry-data";

export const COUNTY_CENTROIDS: Record<CountyName, { lat: number; lng: number }> = {
  Nairobi: { lat: -1.286389, lng: 36.817223 },
  Kiambu: { lat: -1.1714, lng: 36.8356 },
  Machakos: { lat: -1.5177, lng: 37.2634 },
  Kajiado: { lat: -1.8524, lng: 36.782 },
  Nakuru: { lat: -0.3031, lng: 36.08 },
  Mombasa: { lat: -4.0435, lng: 39.6682 },
  Kisumu: { lat: -0.0917, lng: 34.768 },
  "Uasin Gishu": { lat: 0.5143, lng: 35.2698 },
  Nyeri: { lat: -0.4197, lng: 36.9489 },
  Meru: { lat: 0.047, lng: 37.6559 },
  "Murang'a": { lat: -0.7839, lng: 37.0402 },
  Kakamega: { lat: 0.2827, lng: 34.7519 },
};