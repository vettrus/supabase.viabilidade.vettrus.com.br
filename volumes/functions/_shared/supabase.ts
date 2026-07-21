import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

// Secrets de plataforma — sempre via Deno.env (auto-injetados pelo runtime das
// Edge Functions). NÃO seguem o padrão banco-primeiro dos tokens de integração.
const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

export const hasAdminConfig = Boolean(SUPABASE_URL && SERVICE_ROLE_KEY);

let _admin: SupabaseClient | null = null;

// Client com service role — bypassa RLS. Usado pela maioria dos handlers
// (equivalente ao supabaseAdmin do Next).
export function admin(): SupabaseClient {
  if (!_admin) {
    if (!hasAdminConfig) {
      throw new Error("Cliente admin não configurado: faltam SUPABASE_URL / SERVICE_ROLE_KEY");
    }
    _admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _admin;
}

// Client escopado ao token do usuário — respeita RLS. Usado para validar sessão
// e para queries que devem rodar como o próprio usuário.
export function userClient(token: string): SupabaseClient {
  return createClient(SUPABASE_URL || "http://localhost", ANON_KEY || "missing", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

export { SUPABASE_URL };
