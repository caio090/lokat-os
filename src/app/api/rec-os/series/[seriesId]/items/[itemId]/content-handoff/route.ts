import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCreativeSeriesWithItems } from "@/lib/rec-os/studio/series/repository";
import { resolveAssetSignedUrl } from "@/lib/rec-os/studio/series/asset-persistence";
import { prepareSeriesItemContentHandoff } from "@/lib/rec-os/studio/series/content-handoff";

/**
 * Prompt 28 (Content Handoff Authorization & Recent Series Repair) —
 * rota DEDICADA de "Usar no conteúdo" (FASE 06/07: separada do endpoint
 * de asset genérico -- Download/EditorOS nunca precisaram de
 * autorização de conteúdo, e o acoplamento anterior era exatamente o
 * que causava o 403 num caso legítimo). Rota de LEITURA (GET, sem
 * `withMutationProtection` -- não cria/publica/anexa nada permanente,
 * só autoriza e transporta o ativo já existente).
 *
 * `content_id` é OBRIGATÓRIO aqui (nunca opcional como no antigo
 * endpoint de asset) -- ver `content-handoff.ts` pra toda a decisão
 * real (por que a autorização deriva de `creative_series.content_id`,
 * nunca de uma query em `content_items`).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ seriesId: string; itemId: string }> }) {
  const { seriesId, itemId } = await params;
  const contentId = new URL(request.url).searchParams.get("content_id");
  if (!contentId) {
    return NextResponse.json({ ok: false, error: "content_id obrigatório.", code: "CONTENT_HANDOFF_INVALID_INPUT" }, { status: 400 });
  }
  const db = await createServerSupabaseClient();

  const result = await prepareSeriesItemContentHandoff(
    {
      fetchSeriesById: (id) => getCreativeSeriesWithItems(db, id),
      fetchAssetRow: async (assetId) => {
        const { data, error } = await db.from("client_visual_assets").select("storage_path, metadata").eq("id", assetId).maybeSingle();
        if (error || !data) return null;
        const mime = (data.metadata as { mime?: string } | null)?.mime ?? null;
        return { storagePath: data.storage_path as string, mime };
      },
      resolveSignedUrl: (storagePath) => resolveAssetSignedUrl(db, storagePath),
    },
    { seriesId, itemId, contentId },
  );

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error, code: result.code }, { status: result.status });
  }
  return NextResponse.json({
    ok: true, signedUrl: result.signedUrl, mimeType: result.mimeType, fileName: result.fileName,
    width: result.width, height: result.height, contentId: result.contentId,
  });
}
