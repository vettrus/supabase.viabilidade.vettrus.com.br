import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handle } from "../_shared/handler.ts";
import { assertAdmin } from "../_shared/auth.ts";
import { admin } from "../_shared/supabase.ts";
import { getKommoConfig } from "../_shared/kommo.ts";

// Devolve a config do Kommo para o form admin. NUNCA retorna o token cru —
// apenas `has_token`. Faz um ping best-effort pra sinalizar "Conectado".
serve(handle({
  auth: true,
  run: async ({ context }) => {
    await assertAdmin(context.userId!);

    // Valores brutos salvos (subdomínio, ids etc.) — sem o token.
    const { data: row } = await admin()
      .from("site_content")
      .select("data")
      .eq("section", "kommo_config")
      .maybeSingle();
    const raw: any = row?.data ?? {};

    const cfg = await getKommoConfig();

    let connected = false;
    if (cfg.configured && cfg.base && cfg.token) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 4000);
        const res = await fetch(`${cfg.base.replace(/\/$/, "")}/api/v4/account`, {
          headers: { Authorization: `Bearer ${cfg.token}` },
          signal: ctrl.signal,
        });
        clearTimeout(t);
        connected = res.ok;
      } catch {
        connected = false;
      }
    }

    return {
      subdomain: raw.subdomain ?? "",
      base_url: raw.base_url ?? "",
      pipeline_id: raw.pipeline_id ?? "",
      responsible_user_id: raw.responsible_user_id ?? "",
      field_ids: raw.field_ids ?? {},
      has_token: Boolean(cfg.token),
      configured: cfg.configured,
      source: cfg.source,
      connected,
    };
  },
}));
