import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { fetchVetsFromGoogle } from "@/lib/places-lookup";
import { COUNTY_CENTROIDS } from "@/lib/county-centroids";

const InputSchema = z.object({
  county: z.string().min(1).max(100).optional(),
  kind: z.enum(["vet", "agrovet"]).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  maxKm: z.number().min(1).max(500).default(100).optional(),
});

export interface VetRow {
  id: string;
  name: string;
  kind: "vet" | "agrovet";
  county: string;
  phone: string;
  lat: number;
  lng: number;
  services: string[];
  distanceKm: number | null;
  source: "curated" | "google";
}

function resolveOrigin(data: { lat?: number; lng?: number; county?: string }): { lat: number; lng: number } | null {
  if (data.lat != null && data.lng != null) return { lat: data.lat, lng: data.lng };
  if (data.county && data.county in COUNTY_CENTROIDS) {
    return COUNTY_CENTROIDS[data.county as keyof typeof COUNTY_CENTROIDS];
  }
  return null;
}

export const listVetsFn = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => InputSchema.parse(input ?? {}))
  .handler(async ({ data }): Promise<VetRow[]> => {
    const key = process.env.SUPABASE_PUBLISHABLE_KEY!;
    const url = process.env.SUPABASE_URL!;
    const client = createClient<Database>(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input, init) => {
          const h = new Headers(init?.headers);
          if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization");
          h.set("apikey", key);
          return fetch(input, { ...init, headers: h });
        },
      },
    });

    let curated: VetRow[] = [];

    // When we know the farmer's location, let PostGIS do the nearest-neighbor
    // sort in the database instead of pulling every row and sorting in JS.
    if (data.lat != null && data.lng != null) {
      const { data: rows, error } = await client.rpc("nearest_vets" as never, {
        user_lat: data.lat,
        user_lng: data.lng,
        filter_county: data.county ?? null,
        filter_kind: data.kind ?? null,
        max_km: data.maxKm ?? 100,
        max_results: 20,
      } as never);
      if (error) throw new Error(error.message);
      curated = ((rows ?? []) as unknown as Array<{
        id: string; name: string; kind: "vet" | "agrovet"; county: string | null;
        phone: string | null; lat: number; lng: number; services: string[]; distance_km: number;
      }>).map((r) => ({
        id: r.id,
        name: r.name,
        kind: r.kind,
        county: r.county ?? "",
        phone: r.phone ?? "",
        lat: Number(r.lat),
        lng: Number(r.lng),
        services: r.services ?? [],
        distanceKm: r.distance_km,
        source: "curated" as const,
      }));
    } else {
      let q = client.from("vets").select("id, name, kind, county, phone, lat, lng, services");
      if (data.county) q = q.eq("county", data.county);
      if (data.kind) q = q.eq("kind", data.kind);

      const { data: rows, error } = await q;
      if (error) throw new Error(error.message);
      curated = (rows ?? [])
        .filter((r) => r.lat != null && r.lng != null && r.phone != null)
        .map((r) => ({
          id: r.id,
          name: r.name,
          kind: r.kind as "vet" | "agrovet",
          county: r.county ?? "",
          phone: r.phone ?? "",
          lat: Number(r.lat),
          lng: Number(r.lng),
          services: r.services ?? [],
          distanceKm: null as number | null,
          source: "curated" as const,
        }));
    }

    if (curated.length > 0) return curated;

    // Nothing curated for this area, fall back to a live Google Places
    // lookup so the farmer still sees something instead of an empty map.
    const origin = resolveOrigin(data);
    if (!origin) return curated;

    const googleResults = await fetchVetsFromGoogle({
      lat: origin.lat,
      lng: origin.lng,
      county: data.county ?? "",
      kind: data.kind,
    });
    return googleResults;
  });