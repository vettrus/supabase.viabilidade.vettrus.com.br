import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { z } from "https://esm.sh/zod@3.24.1";
import { handle } from "../_shared/handler.ts";
import { assertAdmin } from "../_shared/auth.ts";
import { admin } from "../_shared/supabase.ts";

const FIELD_KEYS = [
  "origem_lead",
  "investimento",
  "faturamento_texto",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
] as const;

const optStr = z.string().trim().max(500).optional();

const input = z.object({
  subdomain: optStr,
  base_url: optStr,
  // Só sobrescreve o token quando enviado não-vazio (mantém o oculto atual).
  access_token: z.string().max(4000).optional(),
  pipeline_id: optStr,
  responsible_user_id: optStr,
  field_ids: z
    .record(z.enum(FIELD_KEYS), z.union([z.string(), z.number()]))
    .optional(),
});

serve(handle({
  auth: true,
  validate: (d) => input.parse(d),
  run: async ({ data, context }) => {
    await assertAdmin(context.userId!);
    const db = admin();

    const { data: existing } = await db
      .from("site_content")
      .select("data")
      .eq("section", "kommo_config")
      .maybeSingle();
    const prev: any = existing?.data ?? {};

    // field_ids: strings vazias => auto (omite). Guarda como número quando válido.
    const fieldIds: Record<string, number> = {};
    const incomingFields = data.field_ids ?? {};
    for (const key of FIELD_KEYS) {
      const v = (incomingFields as any)[key];
      const n = Number(String(v ?? "").trim());
      if (Number.isFinite(n) && n > 0) fieldIds[key] = n;
    }

    const token = (data.access_token ?? "").trim();

    const merged = {
      subdomain: (data.subdomain ?? "").trim(),
      base_url: (data.base_url ?? "").trim(),
      access_token: token ? token : (prev.access_token ?? ""),
      pipeline_id: (data.pipeline_id ?? "").trim(),
      responsible_user_id: (data.responsible_user_id ?? "").trim(),
      field_ids: fieldIds,
    };

    const { error } = await db
      .from("site_content")
      .upsert(
        { section: "kommo_config", data: merged, updated_at: new Date().toISOString() },
        { onConflict: "section" },
      );
    if (error) throw new Error(error.message);

    return { ok: true, has_token: Boolean(merged.access_token) };
  },
}));
