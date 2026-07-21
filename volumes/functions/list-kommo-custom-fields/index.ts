import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handle } from "../_shared/handler.ts";
import { assertAdmin } from "../_shared/auth.ts";
import { getKommoConfig, fetchAllLeadCustomFields } from "../_shared/kommo.ts";

// Integração: busca custom fields do Kommo (precisa do token — secret). Fica
// como Edge Function, igual kommo-get-field.
serve(handle({
  auth: true,
  run: async ({ context }) => {
    await assertAdmin(context.userId!);
    const cfg = await getKommoConfig();
    if (!cfg.configured || !cfg.base || !cfg.token) {
      throw new Error("Kommo não configurado. Salve subdomínio e token primeiro.");
    }
    const fields = await fetchAllLeadCustomFields(cfg.base, cfg.token);
    return {
      fields: fields.map((f) => ({ id: f.id, name: f.name, code: f.code, type: f.type })),
    };
  },
}));
