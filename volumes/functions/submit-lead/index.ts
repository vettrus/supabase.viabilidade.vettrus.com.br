import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { z } from "https://esm.sh/zod@3.24.1";
import { handle } from "../_shared/handler.ts";
import { admin } from "../_shared/supabase.ts";
import { pushLeadToKommoInternal } from "../_shared/kommo.ts";

// Submit público de lead: insere (service role) + sincroniza pro Kommo com a
// lógica atual da LP (pushLeadToKommoInternal). Front invoca via
// supabase.functions.invoke('submit-lead', { body: { data } }).

const leadInput = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  email: z.string().trim().email().max(255).optional(),
  phone: z.string().trim().max(40).optional(),
  company: z.string().trim().max(160).optional(),
  message: z.string().trim().max(2000).optional(),
  source_section: z.string().trim().max(64).optional(),
  ab_assignments: z.record(z.string(), z.string()).optional(),
  utm: z.record(z.string(), z.string()).optional(),
});

const TRACKING_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "gclid", "fbclid"];

function getTrackingFromReferer(headers: Headers) {
  const out: Record<string, string> = {};
  const referer = headers.get("referer");
  if (!referer) return out;
  try {
    const url = new URL(referer);
    for (const key of TRACKING_KEYS) {
      const value = url.searchParams.get(key) ?? url.searchParams.get(key.toUpperCase());
      if (value?.trim()) out[key] = value.trim().slice(0, 500);
    }
    if (Object.keys(out).length) out.referrer = referer.slice(0, 500);
  } catch {
    // ignore
  }
  return out;
}

serve(handle({
  auth: false,
  validate: (d) => leadInput.parse(d),
  run: async ({ data, context }) => {
    if (!data.email && !data.phone) {
      throw new Error("Informe e-mail ou telefone");
    }
    const db = admin();
    const payload = {
      name: data.name,
      email: data.email,
      phone: data.phone,
      company: data.company,
      message: data.message,
      source_section: data.source_section,
      ab_assignments: data.ab_assignments ?? {},
      utm: { ...getTrackingFromReferer(context.headers), ...(data.utm ?? {}) },
    };
    const { data: row, error } = await db.from("leads").insert(payload).select("id").single();
    if (error) throw new Error(error.message);

    if (row?.id) {
      try {
        await pushLeadToKommoInternal(row.id);
      } catch (e) {
        console.error("[kommo] sync failed:", e);
      }
    }
    return { ok: true, id: row?.id ?? null };
  },
}));
