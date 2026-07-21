import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handle } from "../_shared/handler.ts";
import { admin } from "../_shared/supabase.ts";
import { assertAdmin } from "../_shared/auth.ts";

serve(handle({
  auth: true,
  run: async ({ context }) => {
    await assertAdmin(context.userId!);
    const db = admin();
    const { data: roles } = await db
      .from("user_roles")
      .select("user_id, created_at")
      .eq("role", "admin");
    const ids = (roles ?? []).map((r: any) => r.user_id);
    const { data: usersList } = await db.auth.admin.listUsers({ perPage: 200 });
    const map = new Map(usersList.users.map((u: any) => [u.id, u]));
    return {
      admins: ids.map((id: string) => ({
        id,
        email: map.get(id)?.email ?? "",
        created_at: roles?.find((r: any) => r.user_id === id)?.created_at,
      })),
    };
  },
}));
