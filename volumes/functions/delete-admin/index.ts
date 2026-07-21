import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { z } from "https://esm.sh/zod@3.24.1";
import { handle } from "../_shared/handler.ts";
import { admin } from "../_shared/supabase.ts";
import { assertAdmin, HttpError } from "../_shared/auth.ts";

// Remove um admin: apaga o usuário no GoTrue (cascade limpa user_roles).
serve(handle({
  auth: true,
  validate: (d) => z.object({ userId: z.string().uuid() }).parse(d),
  run: async ({ data, context }) => {
    await assertAdmin(context.userId!);
    if (data.userId === context.userId) {
      throw new HttpError("Você não pode remover a própria conta.", 400);
    }
    const db = admin();
    // Garante que não fique nenhum admin órfão sem ninguém.
    const { count } = await db
      .from("user_roles")
      .select("user_id", { count: "exact", head: true })
      .eq("role", "admin");
    if ((count ?? 0) <= 1) {
      throw new HttpError("Não é possível remover o último administrador.", 400);
    }
    const { error } = await db.auth.admin.deleteUser(data.userId);
    if (error) throw new Error(error.message);
    await db.from("user_roles").delete().eq("user_id", data.userId);
    return { ok: true };
  },
}));
