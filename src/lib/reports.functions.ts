import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const SaveFeasibilityInput = z.object({
  farm_id: z.string().uuid().nullable().optional(),
  inputs: z.record(z.string(), z.unknown()),
  results: z.record(z.string(), z.unknown()),
});

export const saveFeasibilityReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SaveFeasibilityInput.parse(input))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("feasibility_reports")
      .insert({
        user_id: context.userId,
        farm_id: data.farm_id ?? null,
        inputs: data.inputs as never,
        results: data.results as never,
      })
      .select("id, created_at")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });
