import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { z } from "https://esm.sh/zod@3.24.1";
import { handle } from "../_shared/handler.ts";
import { admin } from "../_shared/supabase.ts";
import { assertAdmin } from "../_shared/auth.ts";

// Decodifica base64 -> bytes sem depender de Buffer (Node) — Deno usa atob.
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

serve(handle({
  auth: true,
  validate: (d) =>
    z.object({
      filename: z.string().min(1).max(180),
      contentType: z.string().min(1).max(120),
      base64: z.string().min(1),
    }).parse(d),
  run: async ({ data, context }) => {
    await assertAdmin(context.userId!);
    const bytes = base64ToBytes(data.base64);
    if (bytes.length > 8 * 1024 * 1024) throw new Error("Imagem acima de 8MB");
    const safe = data.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${Date.now()}-${safe}`;
    const db = admin();
    const { error } = await db.storage
      .from("cms-images")
      .upload(path, bytes, { contentType: data.contentType, upsert: false });
    if (error) throw new Error(error.message);
    const { data: pub } = db.storage.from("cms-images").getPublicUrl(path);
    return { url: pub.publicUrl, path };
  },
}));
