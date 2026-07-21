import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { z } from "https://esm.sh/zod@3.24.1";
import { handle } from "../_shared/handler.ts";
import { assertAdmin } from "../_shared/auth.ts";
import {
  getKommoConfig,
  fetchAllLeadCustomFields,
  fetchLeadCustomFieldsPage,
} from "../_shared/kommo.ts";

// Integração: custom fields do Kommo (precisa do token — secret).
// - Sem query: retorna 1 página (infinite scroll no admin).
// - Com query: busca em TODOS os campos (Kommo não tem filtro de texto na API,
//   então paginamos tudo — cache de 5min — e filtramos aqui).
const input = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    query: z.string().trim().max(100).optional(),
  })
  .default({ page: 1 });

const min = (f: { id: number; name: string; code: string | null; type: string }) => ({
  id: f.id,
  name: f.name,
  code: f.code,
  type: f.type,
});

serve(handle({
  auth: true,
  validate: (d) => input.parse(d ?? {}),
  run: async ({ data, context }) => {
    await assertAdmin(context.userId!);
    const cfg = await getKommoConfig();
    if (!cfg.configured || !cfg.base || !cfg.token) {
      throw new Error("Kommo não configurado. Salve subdomínio e token primeiro.");
    }

    const query = data.query?.toLowerCase();
    if (query) {
      const all = await fetchAllLeadCustomFields(cfg.base, cfg.token);
      const filtered = all.filter((f) =>
        [f.name, f.code, String(f.id), f.type]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(query)),
      );
      return { fields: filtered.map(min), page: 1, hasMore: false, total: filtered.length };
    }

    const { items, hasMore } = await fetchLeadCustomFieldsPage(cfg.base, cfg.token, data.page);
    return { fields: items.map(min), page: data.page, hasMore };
  },
}));
