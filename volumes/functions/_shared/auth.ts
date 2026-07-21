import { type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { admin, userClient } from "./supabase.ts";

// Erro com status HTTP — o wrapper `handle()` converte em resposta JSON.
export class HttpError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export type AuthContext = {
  supabase: SupabaseClient;
  userId: string;
  claims: unknown;
};

// Port de requireAuth (Next). Lê o Bearer token, valida contra o Supabase e
// devolve um client escopado ao usuário. Lança HttpError 401 em falha.
export async function requireAuth(req: Request): Promise<AuthContext> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    throw new HttpError("Unauthorized: No authorization header provided", 401);
  }
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const supabase = userClient(token);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    throw new HttpError("Unauthorized: Invalid session", 401);
  }
  return { supabase, userId: data.user.id, claims: data.user };
}

// Exige role admin em user_roles. Usa service role (bypassa RLS) — equivalente
// ao fallback supabaseAdmin dos handlers Next. Lança HttpError 403.
export async function assertAdmin(userId: string): Promise<void> {
  const { data } = await admin()
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new HttpError("Forbidden: admin role required", 403);
}
