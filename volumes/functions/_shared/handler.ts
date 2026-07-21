import { corsHeaders, jsonResponse, errorResponse } from "./cors.ts";
import { requireAuth, HttpError, type AuthContext } from "./auth.ts";

export type HandlerContext = Partial<AuthContext> & { headers: Headers };

type RunArgs = { data: any; req: Request; context: HandlerContext };

type HandleOpts = {
  /** Exige Bearer token válido (equivalente a entry.auth no dispatcher Next). */
  auth?: boolean;
  /** Valida/parseia o payload cru (zod .parse). */
  validate?: (data: unknown) => unknown;
  run: (args: RunArgs) => Promise<unknown>;
};

// Wrapper único das Edge Functions portadas. Replica o dispatcher Next
// (app/api/rpc/[fn]): trata preflight, desembrulha `{ data }`, injeta auth e
// converte erros em JSON com status. Cada function vira um arquivo fino.
export function handle(opts: HandleOpts): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }
    try {
      const context: HandlerContext = { headers: req.headers };
      if (opts.auth) {
        Object.assign(context, await requireAuth(req));
      }
      const body = (await req.json().catch(() => ({}))) as { data?: unknown };
      const raw = body?.data ?? null;
      const data = opts.validate ? opts.validate(raw) : raw;

      const result = await opts.run({ data, req, context });
      return jsonResponse(result ?? null);
    } catch (e: unknown) {
      if (e instanceof HttpError) {
        return errorResponse(e.message, e.status);
      }
      // ZodError → 400 com mensagem legível.
      if (e && typeof e === "object" && "issues" in e) {
        const issues = (e as any).issues ?? [];
        const msg = issues.map((i: any) => i.message).join("; ") || "Dados inválidos";
        return errorResponse(msg, 400);
      }
      const message = e instanceof Error ? e.message : "Internal error";
      console.error("[edge:handler]", e);
      return errorResponse(message, 500);
    }
  };
}
