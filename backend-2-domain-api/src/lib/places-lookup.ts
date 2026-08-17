// Server-side only. Calls Google's Places API (New) to find nearby vets or
// agrovets when the curated `vets` table has nothing for the area. Requires
// GOOGLE_PLACES_API_KEY to be set as a server env var, never expose this
// key with a VITE_ prefix, it must not reach the browser bundle.

import { haversineKm } from "@/lib/poultry-calc";

interface GooglePlace {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
}

export interface GoogleVetResult {
  id: string;
  name: string;
  kind: "vet" | "agrovet";
  county: string;
  phone: string;
  lat: number;
  lng: number;
  services: string[];
  distanceKm: number;
  source: "google";
}

const FIELD_MASK =
  "places.id,places.displayName,places.formattedAddress,places.location,places.nationalPhoneNumber,places.internationalPhoneNumber";

async function callPlaces(
  endpoint: "searchNearby" | "searchText",
  body: Record<string, unknown>,
  apiKey: string,
): Promise<GooglePlace[]> {
  const res = await fetch(`https://places.googleapis.com/v1/places:${endpoint}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Google Places ${endpoint} failed (${res.status}): ${text}`);
  }
  const json = (await res.json()) as { places?: GooglePlace[] };
  return json.places ?? [];
}

function toResult(
  place: GooglePlace,
  kind: "vet" | "agrovet",
  county: string,
  origin: { lat: number; lng: number },
): GoogleVetResult | null {
  const phone = place.internationalPhoneNumber ?? place.nationalPhoneNumber;
  if (!place.location || !phone) return null; // skip entries we can't let a farmer call
  const point = { lat: place.location.latitude, lng: place.location.longitude };
  return {
    id: `google:${place.id}`,
    name: place.displayName?.text ?? "Unnamed",
    kind,
    county,
    phone,
    lat: point.lat,
    lng: point.lng,
    services: [],
    distanceKm: haversineKm(origin, point),
    source: "google",
  };
}

/**
 * Looks up vets and/or agrovets near a point via Google Places, used as a
 * fallback when the curated Supabase `vets` table returns nothing for the
 * area. Returns [] (never throws to the caller) if the API key is missing
 * or the request fails, so a Google outage never breaks Find Help.
 */
export async function fetchVetsFromGoogle(opts: {
  lat: number;
  lng: number;
  county: string;
  kind?: "vet" | "agrovet";
  radiusMeters?: number;
  maxResults?: number;
}): Promise<GoogleVetResult[]> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return [];

  const origin = { lat: opts.lat, lng: opts.lng };
  const radius = Math.min(Math.max(opts.radiusMeters ?? 30000, 1000), 50000);
  const maxResultCount = Math.min(opts.maxResults ?? 10, 20);
  const kinds: Array<"vet" | "agrovet"> = opts.kind ? [opts.kind] : ["vet", "agrovet"];

  const results: GoogleVetResult[] = [];

  try {
    if (kinds.includes("vet")) {
      const places = await callPlaces(
        "searchNearby",
        {
          includedTypes: ["veterinary_care"],
          maxResultCount,
          locationRestriction: {
            circle: { center: { latitude: origin.lat, longitude: origin.lng }, radius },
          },
        },
        apiKey,
      );
      for (const p of places) {
        const r = toResult(p, "vet", opts.county, origin);
        if (r) results.push(r);
      }
    }

    if (kinds.includes("agrovet")) {
      const places = await callPlaces(
        "searchText",
        {
          textQuery: "agrovet",
          maxResultCount,
          locationBias: {
            circle: { center: { latitude: origin.lat, longitude: origin.lng }, radius },
          },
        },
        apiKey,
      );
      for (const p of places) {
        const r = toResult(p, "agrovet", opts.county, origin);
        if (r) results.push(r);
      }
    }
  } catch (err) {
    console.error("Google Places lookup failed:", err);
    return results; // return whatever we got before the failure, if anything
  }

  return results.sort((a, b) => a.distanceKm - b.distanceKm);
}