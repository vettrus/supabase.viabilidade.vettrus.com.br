import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { z } from "https://esm.sh/zod@3.24.1";
import { handle } from "../_shared/handler.ts";
import { assertAdmin } from "../_shared/auth.ts";
import { pushLeadToKommoInternal } from "../_shared/kommo.ts";

serve(handle({
  auth: true,
  validate: (d) => z.object({ leadId: z.string().uuid() }).parse(d),
  run: async ({ data, context }) => {
    await assertAdmin(context.userId!);
    await pushLeadToKommoInternal(data.leadId);
    return { ok: true };
  },
}));
