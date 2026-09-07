/**
 * Executar com: node .tmp/run-ts-test.cjs src/lib/rec-os/studio/series/__tests__/list-recent-series.structural.test.ts
 * Prompt 26 (Dedicated Series Workspace Completion) -- [TEST 09/11]
 * listRecentCreativeSeries: lista limitada, Company scope correto,
 * sem hidratar assets full-resolution.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { listRecentCreativeSeries } from "../repository";

let passed = 0; let failed = 0;
const assert = (condition: boolean, label: string) => { if (condition) { passed++; console.log(`  ok - ${label}`); } else { failed++; console.error(`  FAIL - ${label}`); } };

interface SeriesRow { id: string; client_id: string | null; content_id: string | null; count: number; format: string | null; status: string; created_at: string; created_by: string | null; campaign_id: string | null; title: string | null; placement: string | null; creative_direction: string | null; updated_at: string; }
interface ItemRow { series_id: string; status: string; }

function fakeDb(seriesRows: SeriesRow[], itemRows: ItemRow[], recordedFilters: { table: string; op: string; args: unknown[] }[]) {
  function seriesChain() {
    const chain = {
      order: () => chain,
      limit: (n: number) => { recordedFilters.push({ table: "creative_series", op: "limit", args: [n] }); return chain; },
      eq: (col: string, val: unknown) => { recordedFilters.push({ table: "creative_series", op: "eq", args: [col, val] }); return chain; },
      is: (col: string, val: unknown) => { recordedFilters.push({ table: "creative_series", op: "is", args: [col, val] }); return chain; },
      then: (resolve: (v: { data: SeriesRow[]; error: null }) => void) => resolve({ data: seriesRows, error: null }),
    };
    return chain;
  }
  function itemsChain() {
    const chain = {
      in: (col: string, vals: unknown[]) => { recordedFilters.push({ table: "creative_series_items", op: "in", args: [col, vals] }); return chain; },
      then: (resolve: (v: { data: ItemRow[]; error: null }) => void) => resolve({ data: itemRows, error: null }),
    };
    return chain;
  }
  return {
    from: (table: string) => {
      if (table === "creative_series") return { select: () => seriesChain() };
      if (table === "creative_series_items") return { select: () => itemsChain() };
      throw new Error(`tabela inesperada: ${table}`);
    },
  } as unknown as SupabaseClient;
}

function seriesRow(id: string, overrides: Partial<SeriesRow> = {}): SeriesRow {
  return { id, client_id: "company-a", content_id: null, count: 6, format: "carousel", status: "generating", created_at: "2026-01-01T00:00:00Z", created_by: "user-1", campaign_id: null, title: null, placement: null, creative_direction: null, updated_at: "2026-01-01T00:00:00Z", ...overrides };
}

async function main() {
  console.log("[test] [TEST 09] retorna resumos leves com progresso (readyCount/totalCount), nunca items/imagens");
  {
    const filters: { table: string; op: string; args: unknown[] }[] = [];
    const db = fakeDb(
      [seriesRow("series-1")],
      [{ series_id: "series-1", status: "ready" }, { series_id: "series-1", status: "ready" }, { series_id: "series-1", status: "planned" }],
      filters,
    );
    const result = await listRecentCreativeSeries(db, { clientId: "company-a", contentId: null }, 6);
    assert(result.length === 1, "uma série resumida devolvida");
    assert(result[0].id === "series-1", "id correto");
    assert(result[0].readyCount === 2 && result[0].totalCount === 3, "progresso agregado correto (2/3 prontas)");
    assert(!("items" in result[0]) && !("image" in (result[0] as unknown as Record<string, unknown>)), "nunca inclui items/imagens no resumo -- FASE 28 (no full-res load)");
  }

  console.log("[test] [TEST 11] limite aplicado à query -- nunca busca tudo pra depois cortar em memória");
  {
    const filters: { table: string; op: string; args: unknown[] }[] = [];
    const db = fakeDb([seriesRow("series-1"), seriesRow("series-2")], [], filters);
    await listRecentCreativeSeries(db, { clientId: "company-a", contentId: null }, 6);
    const limitCall = filters.find((f) => f.op === "limit");
    assert(limitCall?.args[0] === 6, "LIMIT 6 aplicado na própria query SQL");
  }

  console.log("[test] Company scope -- filtra por client_id explícito quando presente");
  {
    const filters: { table: string; op: string; args: unknown[] }[] = [];
    const db = fakeDb([], [], filters);
    await listRecentCreativeSeries(db, { clientId: "company-a", contentId: null }, 6);
    const eqCall = filters.find((f) => f.table === "creative_series" && f.op === "eq" && f.args[0] === "client_id");
    assert(eqCall?.args[1] === "company-a", "filtra client_id = company-a na query, nunca em memória depois");
  }

  console.log("[test] Free Mode -- filtra client_id IS NULL (owner-scoped via RLS), nunca mistura com séries de Company");
  {
    const filters: { table: string; op: string; args: unknown[] }[] = [];
    const db = fakeDb([], [], filters);
    await listRecentCreativeSeries(db, { clientId: null, contentId: null }, 6);
    const isCall = filters.find((f) => f.table === "creative_series" && f.op === "is" && f.args[0] === "client_id");
    assert(isCall?.args[1] === null, "Free Mode filtra client_id IS NULL");
  }

  console.log("[test] série sem nenhum item -- nunca lança, devolve 0/0");
  {
    const filters: { table: string; op: string; args: unknown[] }[] = [];
    const db = fakeDb([seriesRow("series-1")], [], filters);
    const result = await listRecentCreativeSeries(db, { clientId: "company-a", contentId: null }, 6);
    assert(result[0].readyCount === 0, "readyCount 0 quando não há items ready");
  }

  console.log("[test] lista vazia -- nunca lança, nunca consulta creative_series_items à toa");
  {
    const filters: { table: string; op: string; args: unknown[] }[] = [];
    const db = fakeDb([], [], filters);
    const result = await listRecentCreativeSeries(db, { clientId: "company-a", contentId: null }, 6);
    assert(Array.isArray(result) && result.length === 0, "lista vazia, nunca lança");
  }

  console.log(`\n[result] ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
