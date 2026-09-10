/**
 * Executar com: node --experimental-test-module-mocks --import ./.tmp/preload-ts-loader.mjs --test src/lib/rec-os/studio/__tests__/aspect-ratio-contract.structural.test.ts
 * FASE 31H.2 (Image Benchmark Infra Fix) — contrato black-box, sem
 * duplicar nenhuma tabela interna: pra cada ImageAspectRatio/DesignFormat
 * relevante, confirma (1) o `size` real que a OpenAI recebe
 * (buildOpenAIImageRequest, openai-image-compat.ts) e (2) a proporção
 * FINAL real do canvas do Studio (buildStudioRenderPlan, render-plan.ts)
 * -- que nunca depende do `size` do provider (o compositor sempre
 * corta/cobre pro canvas exato, `fit:"cover"`, nunca distorce).
 * Prova em especial que "4:5" nunca mais mapeia pro provider como
 * quadrado (bug real confirmado em Production, corrigido nesta fase).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOpenAIImageRequest } from "@/lib/ai/image-providers/openai-image-compat";
import { buildStudioRenderPlan } from "../render/render-plan";

test("[providerSize] cada ImageAspectRatio recebe o size GPT Image numericamente mais próximo -- 4:5 NUNCA vira quadrado", () => {
  const cases = [
    { ar: "1:1", expectedSize: "1024x1024" },
    { ar: "9:16", expectedSize: "1024x1536" },
    { ar: "16:9", expectedSize: "1536x1024" },
    { ar: "4:5", expectedSize: "1024x1536" },
    { ar: "1.91:1", expectedSize: "1536x1024" },
  ] as const;
  for (const { ar, expectedSize } of cases) {
    const result = buildOpenAIImageRequest({ model: "gpt-image-2", prompt: "x", aspectRatio: ar });
    assert.ok(result.ok, `${ar}: build ok`);
    if (result.ok) assert.equal(result.request.size, expectedSize, `${ar} -> ${expectedSize} (nunca ${ar === "4:5" ? "1024x1024, o bug real confirmado em Production" : "outro valor"})`);
  }
});

test("[finalCanvasRatio] cada DesignFormat produz um canvas final com a proporção EXATA esperada, independente do size do provider", () => {
  const cases = [
    { format: "feed_square", expectedWidth: 1080, expectedHeight: 1080 },
    { format: "carousel", expectedWidth: 1080, expectedHeight: 1350 }, // 4:5 exato (1080/1350 = 0.8)
    { format: "story_vertical", expectedWidth: 1080, expectedHeight: 1920 }, // 9:16 exato
    { format: "banner", expectedWidth: 1080, expectedHeight: 565 },
    { format: "ad", expectedWidth: 1080, expectedHeight: 565 },
    { format: "thumbnail", expectedWidth: 1080, expectedHeight: 608 },
    { format: "outdoor", expectedWidth: 1080, expectedHeight: 608 },
    { format: "presentation", expectedWidth: 1080, expectedHeight: 608 },
  ] as const;
  for (const { format, expectedWidth, expectedHeight } of cases) {
    const plan = buildStudioRenderPlan({ format, headline: "x", cta: null, protectedAssetRoles: [] });
    assert.equal(plan.canvas.width, expectedWidth, `${format}: canvas.width`);
    assert.equal(plan.canvas.height, expectedHeight, `${format}: canvas.height`);
  }
  // Confirma numericamente que carousel É 4:5 (não só "mais alto que largo"), o formato citado explicitamente nesta fase.
  const carousel = buildStudioRenderPlan({ format: "carousel", headline: "x", cta: null, protectedAssetRoles: [] });
  assert.equal(carousel.canvas.width / carousel.canvas.height, 4 / 5, "carousel é EXATAMENTE 4:5, independente de qualquer size que o provider de imagem tenha devolvido pro background");
});
