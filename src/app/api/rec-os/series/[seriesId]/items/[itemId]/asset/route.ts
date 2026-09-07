import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCreativeSeriesWithItems } from "@/lib/rec-os/studio/series/repository";
import { resolveAssetSignedUrl } from "@/lib/rec-os/studio/series/asset-persistence";
import { resolveSeriesItemAsset } from "@/lib/rec-os/studio/series/asset-resolution";

/**
 * Prompt 26 (Dedicated Series Workspace Completion) — resolve o ATIVO
 * CANÔNICO de um item de série pra as três portas de saída do
 * workspace: Download, Abrir no EditorOS, Usar no conteúdo. Rota de
 * LEITURA (GET, sem `withMutationProtection` -- mesma convenção de
 * `/api/rec-os/series/[seriesId]/route.ts`, que também só lê).
 *
 * FASE 34/35 -- nunca aceita `visual_asset_id` do cliente: o único
 * input é `seriesId`/`itemId` (route params) e um `content_id`
 * opcional (query, usado só por "Usar no conteúdo"). Toda a decisão
 * real (série existe? item ready? conteúdo autorizado?) mora em
 * `resolveSeriesItemAsset` (módulo `.ts` puro, testado com fakes) --
 * esta rota só amarra os deps reais ao client Supabase da SESSÃO (RLS
 * real, nunca admin/service role).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ seriesId: string; itemId: string }> }) {
  const { seriesId, itemId } = await params;
  const contentId = new URL(request.url).searchParams.get("content_id");
  const db = await createServerSupabaseClient();

  const result = await resolveSeriesItemAsset(
    {
      fetchSeriesById: (id) => getCreativeSeriesWithItems(db, id),
      fetchAssetRow: async (assetId) => {
        const { data, error } = await db.from("client_visual_assets").select("storage_path, metadata").eq("id", assetId).maybeSingle();
        if (error || !data) return null;
        const mime = (data.metadata as { mime?: string } | null)?.mime ?? null;
        return { storagePath: data.storage_path as string, mime };
      },
      resolveSignedUrl: (storagePath) => resolveAssetSignedUrl(db, storagePath),
      // FASE 36 -- só autoriza um content_id que pertence à MESMA Company da série (nunca confia no UUID sozinho).
      checkContentAccessible: async (cId, clientId) => {
        if (!clientId) return false;
        const { data, error } = await db.from("content_items").select("id").eq("id", cId).eq("client_id", clientId).maybeSingle();
        return !error && !!data;
      },
    },
    { seriesId, itemId, contentId },
  );

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error, code: result.code }, { status: result.status });
  }
  return NextResponse.json({
    ok: true, signedUrl: result.signedUrl, mimeType: result.mimeType, fileName: result.fileName,
    width: result.width, height: result.height,
  });
}
