import { admin } from "./supabase.ts";

// Port Deno de lp/src/lib/kommo.server.ts. Mudanças vs original: supabaseAdmin
// -> admin(); process.env.KOMMO_* -> Deno.env.get. Config resolve DB primeiro
// (site_content/kommo_config, escrito pelo form admin) com fallback env.

export type KommoConfig = {
  base?: string;
  token?: string;
  pipelineId?: number;
  responsibleUserId?: number;
  fieldIds?: Partial<Record<KommoFieldKey, number>>;
  configured: boolean;
  source: "db" | "env" | "none";
};

function buildBase(raw?: string, subdomain?: string): string | undefined {
  const explicit = raw?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const sub = subdomain?.trim();
  if (!sub) return undefined;
  const clean = sub.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/\.kommo\.com$/i, "");
  return `https://${clean}.kommo.com`;
}

export async function getKommoConfig(): Promise<KommoConfig> {
  // 1) Config do DB (form admin) tem precedência.
  try {
    const { data } = await admin()
      .from("site_content")
      .select("data")
      .eq("section", "kommo_config")
      .maybeSingle();
    const d: any = data?.data ?? null;
    if (d) {
      const base = buildBase(d.base_url, d.subdomain);
      const token = (d.access_token ?? "").trim();
      if (base && token) {
        const fieldIds: Partial<Record<KommoFieldKey, number>> = {};
        for (const key of KOMMO_FIELD_KEYS) {
          const n = Number(d?.field_ids?.[key]);
          if (Number.isFinite(n) && n > 0) fieldIds[key] = n;
        }
        return {
          base,
          token,
          pipelineId: d.pipeline_id ? Number(d.pipeline_id) : undefined,
          responsibleUserId: d.responsible_user_id ? Number(d.responsible_user_id) : undefined,
          fieldIds,
          configured: true,
          source: "db",
        };
      }
    }
  } catch {
    // ignore — cai pro env
  }

  // 2) Env vars (legacy).
  const base = buildBase(Deno.env.get("KOMMO_BASE_URL"), Deno.env.get("KOMMO_SUBDOMAIN"));
  const token = (Deno.env.get("KOMMO_LONG_LIVED_TOKEN") || Deno.env.get("KOMMO_ACCESS_TOKEN") || "").trim();
  if (base && token) {
    return {
      base,
      token,
      pipelineId: Deno.env.get("KOMMO_PIPELINE_ID") ? Number(Deno.env.get("KOMMO_PIPELINE_ID")) : undefined,
      responsibleUserId: Deno.env.get("KOMMO_RESPONSIBLE_USER_ID")
        ? Number(Deno.env.get("KOMMO_RESPONSIBLE_USER_ID"))
        : undefined,
      configured: true,
      source: "env",
    };
  }
  return { configured: false, source: "none" };
}

type PipelineTarget = { pipelineId: number; statusId: number | null };
let targetCache: { value: PipelineTarget | null; at: number } | null = null;
const TARGET_TTL_MS = 5 * 60 * 1000;

const norm = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

// IDs explícitos fornecidos pelo cliente: Funil CADASTRO / Etapa SDR.
const DEFAULT_PIPELINE_ID = 10464607;
const DEFAULT_STATUS_ID = 82964507;

async function findCadastroSdrTarget(base: string, token: string): Promise<PipelineTarget | null> {
  if (targetCache && Date.now() - targetCache.at < TARGET_TTL_MS) {
    return targetCache.value;
  }
  let result: PipelineTarget = { pipelineId: DEFAULT_PIPELINE_ID, statusId: DEFAULT_STATUS_ID };
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/api/v4/leads/pipelines`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data: any = await res.json();
      const pipelines: any[] = data?._embedded?.pipelines ?? [];
      const cadastro = pipelines.find((p) => Number(p?.id) === DEFAULT_PIPELINE_ID)
        ?? pipelines.find((p) => norm(String(p?.name ?? "")) === "cadastro")
        ?? pipelines.find((p) => norm(String(p?.name ?? "")).includes("cadastro"));
      if (cadastro) {
        const statuses: any[] = cadastro?._embedded?.statuses ?? [];
        const sdr = statuses.find((s) => Number(s?.id) === DEFAULT_STATUS_ID)
          ?? statuses.find((s) => norm(String(s?.name ?? "")) === "sdr")
          ?? statuses.find((s) => norm(String(s?.name ?? "")).includes("sdr"));
        result = {
          pipelineId: Number(cadastro.id),
          statusId: sdr ? Number(sdr.id) : DEFAULT_STATUS_ID,
        };
      }
    }
  } catch {
    // mantém defaults
  }

  targetCache = { value: result, at: Date.now() };
  return result;
}

// ---------- Custom fields catalog (cached) ----------
type KommoCustomField = {
  id: number;
  name: string;
  code: string | null;
  type: string;
  enums?: { id: number; value: string }[];
};
let fieldsCache: { leads: KommoCustomField[]; at: number } | null = null;
const FIELDS_TTL_MS = 5 * 60 * 1000;

export type KommoFieldKey =
  | "origem_lead"
  | "investimento"
  | "faturamento_texto"
  | "utm_source"
  | "utm_medium"
  | "utm_campaign"
  | "utm_content";

const KOMMO_FIELD_KEYS: KommoFieldKey[] = [
  "origem_lead",
  "investimento",
  "faturamento_texto",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
];

export async function getKommoFieldOverrides(): Promise<Partial<Record<KommoFieldKey, number>>> {
  try {
    const { data } = await admin()
      .from("site_content")
      .select("data")
      .eq("section", "kommo_config")
      .maybeSingle();
    const ids: any = (data?.data as any)?.field_ids ?? {};
    const out: Partial<Record<KommoFieldKey, number>> = {};
    for (const k of KOMMO_FIELD_KEYS) {
      const n = Number(ids?.[k]);
      if (Number.isFinite(n) && n > 0) out[k] = n;
    }
    return out;
  } catch {
    return {};
  }
}

export async function fetchAllLeadCustomFields(base: string, token: string): Promise<KommoCustomField[]> {
  if (fieldsCache && Date.now() - fieldsCache.at < FIELDS_TTL_MS) return fieldsCache.leads;
  const all: KommoCustomField[] = [];
  let page = 1;
  while (page < 20) {
    const res = await fetch(
      `${base.replace(/\/$/, "")}/api/v4/leads/custom_fields?limit=250&page=${page}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) break;
    const data: any = await res.json();
    const items: any[] = data?._embedded?.custom_fields ?? [];
    if (!items.length) break;
    for (const f of items) {
      all.push({
        id: Number(f.id),
        name: String(f.name ?? ""),
        code: f.code ?? null,
        type: String(f.type ?? ""),
        enums: Array.isArray(f.enums)
          ? f.enums.map((e: any) => ({ id: Number(e.id), value: String(e.value ?? "") }))
          : undefined,
      });
    }
    if (items.length < 250) break;
    page++;
  }
  if (all.length) fieldsCache = { leads: all, at: Date.now() };
  return all;
}

function findField(fields: KommoCustomField[], names: string[], code?: string): KommoCustomField | undefined {
  if (code) {
    const byCode = fields.find((f) => (f.code ?? "").toUpperCase() === code.toUpperCase());
    if (byCode) return byCode;
  }
  const normalized = names.map(norm);
  return fields.find((f) => normalized.includes(norm(f.name)));
}

function parseMessageExtras(message?: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!message) return out;
  const parts = message.split(/\s·\s|\s\|\s|\n/).map((p) => p.trim()).filter(Boolean);
  for (const part of parts) {
    const m = part.match(/^([^:]+):\s*(.+)$/);
    if (m) out[norm(m[1])] = m[2].trim();
  }
  return out;
}

function normalizePhone(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return undefined;
  // Garante prefixo do Brasil (Kommo aceita formato internacional consistente).
  if (digits.length === 10 || digits.length === 11) return `+55${digits}`;
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) return `+${digits}`;
  return `+${digits}`;
}

function rejectedCustomFieldIndexes(body: string): number[] {
  try {
    const parsed = JSON.parse(body);
    const validationErrors: any[] = parsed?.["validation-errors"] ?? [];
    const indexes = new Set<number>();
    for (const group of validationErrors) {
      for (const err of group?.errors ?? []) {
        const match = String(err?.path ?? "").match(/^custom_fields_values\.(\d+)\./);
        if (match) indexes.add(Number(match[1]));
      }
    }
    return [...indexes].filter(Number.isFinite);
  } catch {
    return [];
  }
}

export async function pushLeadToKommoInternal(leadId: string) {
  const db = admin();
  const cfg = await getKommoConfig();
  if (!cfg.configured) {
    await db.from("leads").update({ kommo_error: "Kommo not configured" }).eq("id", leadId);
    return;
  }
  const { base, token, pipelineId: cfgPipelineId } = cfg;
  const { data: lead, error } = await db.from("leads").select("*").eq("id", leadId).single();
  if (error || !lead) throw new Error(error?.message ?? "Lead not found");

  const phoneNormalized = normalizePhone(lead.phone);

  const contactCustomFields: any[] = [];
  if (phoneNormalized)
    contactCustomFields.push({ field_code: "PHONE", values: [{ value: phoneNormalized, enum_code: "WORK" }] });
  if (lead.email)
    contactCustomFields.push({ field_code: "EMAIL", values: [{ value: lead.email, enum_code: "WORK" }] });

  const extras = parseMessageExtras(lead.message);
  const faturamento = extras[norm("Faturamento")] ?? "";
  const investimento = extras[norm("Investimento")] ?? "";
  const utm = (lead.utm ?? {}) as Record<string, string>;

  // Resolve fields: 1) override do admin, 2) auto via API (nome/code), 3) fallback hardcoded.
  const overrides = cfg.fieldIds ?? await getKommoFieldOverrides();
  const allFields = await fetchAllLeadCustomFields(base!, token!).catch(() => [] as KommoCustomField[]);
  const resolveField = (key: KommoFieldKey, fallback: number, names: string[], code?: string) => {
    if (overrides[key]) return { id: overrides[key]!, code, source: "admin" as const };
    const field = findField(allFields, names, code);
    return { id: field?.id ?? fallback, code: field?.code ?? code, source: field ? "api" as const : "fallback" as const };
  };

  const FIELD = {
    ORIGEM_LEAD: resolveField("origem_lead", 188364, ["Origem do Lead", "Origem"]),
    INVESTIMENTO: resolveField("investimento", 848356, ["Qual valor para investimento?", "Investimento"]),
    FATURAMENTO_TEXTO: resolveField("faturamento_texto", 854005, ["Qual o faturamento da sua loja? (Texto)", "Qual o faturamento da sua loja?", "Faturamento"]),
    UTM_CONTENT: resolveField("utm_content", 185084, ["utm_content"], "UTM_CONTENT"),
    UTM_MEDIUM: resolveField("utm_medium", 185086, ["utm_medium"], "UTM_MEDIUM"),
    UTM_CAMPAIGN: resolveField("utm_campaign", 185088, ["utm_campaign"], "UTM_CAMPAIGN"),
    UTM_SOURCE: resolveField("utm_source", 185090, ["utm_source"], "UTM_SOURCE"),
  };

  const leadCustomFields: any[] = [];
  const utmCustomFieldsById: any[] = [];
  const pushTextById = (field: { id: number }, value?: string) => {
    if (!value) return;
    leadCustomFields.push({ field_id: field.id, values: [{ value }] });
  };
  const pushTextByCodeOrId = (field: { id: number; code?: string | null; source: string }, value?: string) => {
    if (!value) return;
    const code = field.code?.toUpperCase();
    utmCustomFieldsById.push({ field_id: field.id, values: [{ value }] });
    leadCustomFields.push(
      code && field.source !== "admin"
        ? { field_code: code, values: [{ value }] }
        : { field_id: field.id, values: [{ value }] },
    );
  };

  // Aba Principal — Origem do Lead
  pushTextById(
    FIELD.ORIGEM_LEAD,
    lead.source_section ? `LP Vettrus — ${lead.source_section}` : "LP Vettrus",
  );
  // Aba Agendamento — Qual valor para investimento?
  pushTextById(FIELD.INVESTIMENTO, investimento);
  // Aba Qualificação — Qual o faturamento da sua loja? (Texto)
  pushTextById(FIELD.FATURAMENTO_TEXTO, faturamento);
  // Aba Estatísticas — UTMs
  pushTextByCodeOrId(FIELD.UTM_SOURCE, utm.utm_source);
  pushTextByCodeOrId(FIELD.UTM_MEDIUM, utm.utm_medium);
  pushTextByCodeOrId(FIELD.UTM_CAMPAIGN, utm.utm_campaign);
  pushTextByCodeOrId(FIELD.UTM_CONTENT, utm.utm_content);

  console.log("[kommo] field resolution", {
    leadId,
    resolved: FIELD,
    utm,
    customFieldsCount: leadCustomFields.length,
  });

  const target = await findCadastroSdrTarget(base!, token!).catch(() => null);
  const pipelineId = target?.pipelineId ?? cfgPipelineId;
  const statusId = target?.statusId ?? undefined;

  const payload = [
    {
      name: `LP — ${lead.name ?? lead.email ?? lead.phone ?? "Sem nome"}`,
      ...(pipelineId && { pipeline_id: pipelineId }),
      ...(statusId && { status_id: statusId }),
      ...(leadCustomFields.length && { custom_fields_values: leadCustomFields }),
      _embedded: {
        contacts: [
          {
            name: lead.name ?? "Lead LP",
            ...(lead.company && { company_name: lead.company }),
            custom_fields_values: contactCustomFields,
          },
        ],
        tags: [
          { name: "LP Vettrus" },
          ...(lead.source_section ? [{ name: lead.source_section }] : []),
        ],
      },
    },
  ];

  try {
    let postSyncError: string | null = null;
    const res = await fetch(`${base!.replace(/\/$/, "")}/api/v4/leads/complex`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    let body = await res.text();
    if (!res.ok) {
      const rejectedIndexes = res.status === 400 ? rejectedCustomFieldIndexes(body) : [];
      if (rejectedIndexes.length && rejectedIndexes.length < leadCustomFields.length) {
        const rejected = new Set(rejectedIndexes);
        const retryPayload = [{
          ...payload[0],
          custom_fields_values: leadCustomFields.filter((_, index) => !rejected.has(index)),
        }];
        const retryRes = await fetch(`${base!.replace(/\/$/, "")}/api/v4/leads/complex`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(retryPayload),
        });
        const retryBody = await retryRes.text();
        if (retryRes.ok) {
          body = retryBody;
        } else {
          await db.from("leads")
            .update({ kommo_error: `HTTP ${retryRes.status}: ${retryBody.slice(0, 500)}` })
            .eq("id", leadId);
          return;
        }
      } else {
        await db.from("leads")
          .update({ kommo_error: `HTTP ${res.status}: ${body.slice(0, 500)}` })
          .eq("id", leadId);
        return;
      }
    }
    let kommoId: string | null = null;
    try {
      const parsed = JSON.parse(body);
      kommoId = String(parsed?.[0]?.id ?? parsed?.id ?? "") || null;
    } catch {
      // corpo não-JSON
    }

    if (kommoId && utmCustomFieldsById.length) {
      try {
        const updateRes = await fetch(`${base!.replace(/\/$/, "")}/api/v4/leads/${kommoId}`, {
          method: "PATCH",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ custom_fields_values: utmCustomFieldsById }),
        });
        if (!updateRes.ok) {
          const updateBody = await updateRes.text();
          postSyncError = `UTM PATCH HTTP ${updateRes.status}: ${updateBody.slice(0, 500)}`;
          console.error("[kommo] utm patch failed:", postSyncError);
        }
      } catch (e: any) {
        postSyncError = `UTM PATCH failed: ${String(e?.message ?? e).slice(0, 500)}`;
        console.error("[kommo] utm patch failed:", e);
      }
    }

    // Nota com todos os dados do formulário (visibilidade no lead).
    if (kommoId) {
      const lines: string[] = ["📝 Lead recebido pela Landing Page Vettrus", ""];
      if (lead.name) lines.push(`• Nome: ${lead.name}`);
      if (lead.email) lines.push(`• E-mail: ${lead.email}`);
      if (lead.phone) lines.push(`• Telefone: ${lead.phone}`);
      if (lead.company) lines.push(`• Empresa: ${lead.company}`);
      if (lead.source_section) lines.push(`• Seção de origem: ${lead.source_section}`);
      if (lead.message) {
        lines.push("", "💬 Mensagem:", lead.message);
      }
      const utmKeys = Object.keys(utm).filter((k) => utm[k]);
      if (utmKeys.length) {
        lines.push("", "🔗 UTM / origem:");
        utmKeys.forEach((k) => lines.push(`• ${k}: ${utm[k]}`));
      }
      const ab = (lead.ab_assignments ?? {}) as Record<string, string>;
      const abKeys = Object.keys(ab).filter((k) => ab[k]);
      if (abKeys.length) {
        lines.push("", "🧪 A/B:");
        abKeys.forEach((k) => lines.push(`• ${k}: ${ab[k]}`));
      }
      lines.push("", `🆔 Lead ID interno: ${leadId}`);

      try {
        await fetch(`${base!.replace(/\/$/, "")}/api/v4/leads/${kommoId}/notes`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify([
            { note_type: "common", params: { text: lines.join("\n") } },
          ]),
        });
      } catch (e) {
        console.error("[kommo] note creation failed:", e);
      }
    }

    await db.from("leads")
      .update({
        kommo_lead_id: kommoId,
        kommo_synced_at: new Date().toISOString(),
        kommo_error: postSyncError,
      })
      .eq("id", leadId);
  } catch (e: any) {
    await db.from("leads")
      .update({ kommo_error: String(e?.message ?? e).slice(0, 500) })
      .eq("id", leadId);
  }
}
