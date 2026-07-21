import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { z } from "https://esm.sh/zod@3.24.1";
import { handle } from "../_shared/handler.ts";
import { admin } from "../_shared/supabase.ts";
import { assertAdmin } from "../_shared/auth.ts";

serve(handle({
  auth: true,
  validate: (d) =>
    z.object({
      email: z.string().email().max(255),
      password: z.string().min(8).max(72),
    }).parse(d),
  run: async ({ data, context }) => {
    await assertAdmin(context.userId!);
    const db = admin();
    const { data: created, error } = await db.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
    });
    if (error) throw new Error(error.message);
    await db.from("user_roles").insert({ user_id: created.user!.id, role: "admin" });
    return { ok: true, id: created.user!.id };
  },
}));
