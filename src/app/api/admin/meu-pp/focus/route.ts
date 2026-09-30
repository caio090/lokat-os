import type { NextRequest } from "next/server";
import { withMutationProtection } from "@/lib/workspaces/assert-not-preview";
import { dbFail, done, fail, personalSession, readBody, uuid } from "@/lib/meu-pp/server";
import { REL } from "@/lib/meu-pp/entity-links";

/**
 * Meu PP — "Continuar": UM projeto em foco, escolhido pelo dono.
 * Guardado como personal_entity_links operator → in_focus → client_project
 * (só o id; nada é copiado). Acesso ao projeto = regra Company existente
 * (RLS de client_projects lida com a sessão) — nunca confiar só no id salvo.
 */
export async function GET() {
  const s = await personalSession();
  if (!("userId" in s)) return s;
  const { data, error } = await s.supabase.from("client_projects").select("id,title,status").order("updated_at", { ascending: false }).limit(30);
  if (error) return dbFail(error);
  return done({ projects: data ?? [] });
}

export const PUT = withMutationProtection(async function PUT(req: NextRequest) {
  const s = await personalSession();
  if (!("userId" in s)) return s;
  const body = await readBody(req);
  const projectId = body?.projectId === null ? null : uuid(body?.projectId);
  if (body?.projectId !== null && !projectId) return fail("invalid", 400);

  if (projectId) {
    const { data: project, error } = await s.supabase.from("client_projects").select("id").eq("id", projectId).maybeSingle();
    if (error) return dbFail(error);
    if (!project) return fail("not_found", 404, "Projeto indisponível.");
  }

  const { error: delErr } = await s.supabase
    .from("personal_entity_links")
    .delete()
    .eq("user_id", s.userId)
    .eq("source_type", "operator")
    .eq("source_id", s.userId)
    .eq("relation_type", REL.inFocus);
  if (delErr) return dbFail(delErr);

  if (projectId) {
    const { error } = await s.supabase
      .from("personal_entity_links")
      .insert({ user_id: s.userId, source_type: "operator", source_id: s.userId, target_type: "client_project", target_id: projectId, relation_type: REL.inFocus });
    if (error) return dbFail(error);
  }
  return done();
});
