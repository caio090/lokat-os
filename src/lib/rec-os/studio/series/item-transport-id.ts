/**
 * Prompt 26 (Dedicated Series Workspace Completion) — FASE 01/09/19:
 * "ABRIR NO EDITOR OS" precisa ser uma ação MÍNIMA disponível pra
 * qualquer item ready, independente de a série ter nascido a partir do
 * Criar (com um `contentId` real) ou standalone (Studio root, sem
 * nenhum conteúdo associado). O mecanismo de transporte já existente
 * (rec-os-workflow/visual-import-session.ts, reaproveitado por
 * FASE 09/19 -- "não criar EditorHandoffV2") é uma sessionStorage key
 * derivada de `(clientId, contentId)`; ele nunca valida `contentId`
 * contra nenhuma tabela de conteúdo real (confirmado lendo
 * CanvasEditor.tsx/EditorOSWorkspace.tsx -- é usado só como uma chave
 * opaca de correspondência entre quem escreve e quem lê).
 *
 * Por isso, quando não existe um `contentId` real (série standalone),
 * usamos um identificador SINTÉTICO derivado do próprio item de série
 * só pra essa chave de transporte -- nunca um `content_items` real,
 * nunca usado em nenhuma outra checagem de autorização/associação de
 * conteúdo (essas continuam exigindo um `contentId` genuíno, ver
 * FASE 15-22/36). É pura reutilização do MESMO mecanismo existente com
 * uma chave só, nunca um protocolo novo.
 */
export function seriesItemTransportContentId(seriesId: string, seriesItemId: string): string {
  return `series-item:${seriesId}:${seriesItemId}`;
}
