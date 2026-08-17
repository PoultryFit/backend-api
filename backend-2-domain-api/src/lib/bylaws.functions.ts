import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const InputSchema = z.object({
  county: z.string().min(1).max(100),
  sub_county: z.string().min(1).max(100).optional(),
});

export type CountyBylawRow = Database["public"]["Tables"]["county_bylaws"]["Row"];
export type NationalRegulationRow =
  Database["public"]["Tables"]["national_poultry_regulations"]["Row"];

export type CountyBylawResult = {
  countyBylaw: CountyBylawRow | null;
  nationalRegulations: NationalRegulationRow[];
};

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
 * Public-read lookup of county bylaw data, plus the national baseline
 * regulations that always apply regardless of whether a county-specific
 * bylaw was located. Prefers an exact (county, sub_county) match, falls
 * back to a county-only row. If no row exists at all for the county,
 * countyBylaw is null and the caller should show "not stated in law,
 * national regulations apply" using nationalRegulations.
 */
export const getCountyBylaw = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }): Promise<CountyBylawResult> => {
    const client = makeClient();
    const { county, sub_county } = data;

    const findCountyBylaw = async (): Promise<CountyBylawRow | null> => {
      if (sub_county) {
        const { data: exact } = await client
          .from("county_bylaws")
          .select("*")
          .eq("county", county)
          .eq("sub_county", sub_county)
          .maybeSingle();
        if (exact) return exact;
      }

      const { data: countyOnly } = await client
        .from("county_bylaws")
        .select("*")
        .eq("county", county)
        .is("sub_county", null)
        .maybeSingle();
      if (countyOnly) return countyOnly;

      // Last resort: any row for the county
      const { data: any } = await client
        .from("county_bylaws")
        .select("*")
        .eq("county", county)
        .limit(1)
        .maybeSingle();
      return any ?? null;
    };

    const [countyBylaw, nationalRegs] = await Promise.all([
      findCountyBylaw(),
      client.from("national_poultry_regulations").select("*"),
    ]);

    return {
      countyBylaw,
      nationalRegulations: nationalRegs.data ?? [],
    };
  });