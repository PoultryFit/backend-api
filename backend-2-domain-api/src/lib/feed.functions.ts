import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { FEED_INGREDIENTS, type FeedIngredient } from "./poultry-data";

const InputSchema = z.object({
  county: z.string().min(1).max(100).optional(),
});

/**
 * Public-read merge of feed_ingredients (nutrition) with feed_prices (KES/kg).
 * Returns a list shaped like the legacy FEED_INGREDIENTS entries so
 * computeFeedPlan doesn't need to change its internal math.
 * Uses the lowest price_kes_per_kg when multiple brands sell the same
 * feed_type in the same county.
 */
export type FeedProduct = {
  id: string;
  poultryType: string;
  goal: string;
  stage: string;
  productName: string;
  category: string;
  brand: string | null;
  unitSize: string;
  priceKes: number;
  county: string | null;
  agrovetName: string | null;
  source: string | null;
  notes: string | null;
  fallbackFromChicken: boolean;
};

const ProductsInput = z.object({
  poultryType: z.string().min(1).max(50),
  goal: z.string().min(1).max(20).optional(),
  stage: z.string().min(1).max(20).optional(),
  county: z.string().min(1).max(100).optional(),
});

function makeClient() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY!;
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) {
          h.delete("Authorization");
        }
        h.set("apikey", key);
        return fetch(input, { ...init, headers: h });
      },
    },
  });
}

/**
 * Public-read list of commercial feed products for a given poultry type.
 * Falls back to poultry_type='chicken' when the requested type has no rows
 * (turkey, goose, quail, guinea-fowl are not yet stocked). Also falls back
 * from a county-specific price to the national baseline (county IS NULL)
 * when no county-specific row exists yet.
 */
export const getFeedProducts = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => ProductsInput.parse(input))
  .handler(async ({ data }): Promise<FeedProduct[]> => {
    const client = makeClient();

    const run = async (poultryType: string, county?: string) => {
      let q = client.from("feed_products").select("*").eq("poultry_type", poultryType);
      if (data.goal) q = q.eq("goal", data.goal);
      if (data.stage) q = q.eq("stage", data.stage);
      q = county ? q.eq("county", county) : q.is("county", null);
      const { data: rows } = await q;
      return rows ?? [];
    };

    // 1. requested poultry type + county-specific price, if any
    let rows = data.county ? await run(data.poultryType, data.county) : [];
    // 2. requested poultry type + national baseline (county IS NULL)
    if (rows.length === 0) rows = await run(data.poultryType);

    let fallback = false;
    // 3. chicken + county-specific price, if any
    if (rows.length === 0 && data.poultryType !== "chicken") {
      rows = data.county ? await run("chicken", data.county) : [];
      fallback = true;
    }
    // 4. chicken + national baseline
    if (rows.length === 0 && data.poultryType !== "chicken") {
      rows = await run("chicken");
      fallback = true;
    }

    return rows.map((r) => ({
      id: r.id,
      poultryType: r.poultry_type,
      goal: r.goal,
      stage: r.stage,
      productName: r.product_name,
      category: r.category,
      brand: r.brand,
      unitSize: r.unit_size,
      priceKes: Number(r.price_kes),
      county: r.county,
      agrovetName: r.agrovet_name,
      source: r.source,
      notes: r.notes,
      fallbackFromChicken: fallback,
    }));
  });

export const getFeedIngredients = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => InputSchema.parse(input ?? {}))
  .handler(async ({ data }): Promise<FeedIngredient[]> => {
    const url = process.env.SUPABASE_URL!;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY!;
    const client = createClient<Database>(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input, init) => {
          const h = new Headers(init?.headers);
          if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) {
            h.delete("Authorization");
          }
          h.set("apikey", key);
          return fetch(input, { ...init, headers: h });
        },
      },
    });

    const [ingredientsRes, pricesRes] = await Promise.all([
      client.from("feed_ingredients").select("*"),
      data.county
        ? client.from("feed_prices").select("*").eq("county", data.county)
        : client.from("feed_prices").select("*"),
    ]);

    const ingredients = ingredientsRes.data ?? [];
    const prices = pricesRes.data ?? [];

    // Lowest price per feed_type wins.
    const cheapestBySlug = new Map<string, number>();
    for (const p of prices) {
      const slug = p.feed_type;
      const price = Number(p.price_kes_per_kg);
      if (!Number.isFinite(price)) continue;
      const existing = cheapestBySlug.get(slug);
      if (existing === undefined || price < existing) {
        cheapestBySlug.set(slug, price);
      }
    }

    return ingredients.map((row) => {
      const fallback = FEED_INGREDIENTS.find((i) => i.id === row.slug);
      return {
        id: row.slug,
        name: row.name,
        energyKcal: Number(row.energy_kcal),
        proteinPct: Number(row.protein_pct),
        pricePerKg: cheapestBySlug.get(row.slug) ?? fallback?.pricePerKg ?? 0,
      };
    });
  });