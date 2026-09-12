/**
 * FASE 31O.2 — bug comprovado em Production (Company DNA, FASE 31O.1): os
 * botões "Link"/"Upload" (alternância de aba) e "Remover" dentro de
 * AttachmentUploader não tinham type="button", então dentro de um <form>
 * real (a nova tela /admin/empresa/dna) o navegador tratava o clique como
 * type="submit" implícito -- selecionar "Upload" salvava o formulário
 * ANTES da logo ser escolhida. Este teste monta o componente REAL dentro
 * de um <form> real (mesma estrutura de _company-dna-form.tsx) e prova,
 * via DOM de verdade (jsdom), que nenhum controle interno do uploader
 * dispara submit -- só o botão de submit real da tela deve.
 *
 * Executar com: node .tmp/run-tsx-dom-test.cjs src/components/__tests__/attachment-uploader-submit-guard.dom.test.tsx
 */
import * as React from "react";
import { act } from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { AttachmentUploader, type AttachmentValue } from "../attachment-uploader";

let passed = 0; let failed = 0;
const assert = (condition: boolean, label: string) => { if (condition) { passed++; console.log(`  ok - ${label}`); } else { failed++; console.error(`  FAIL - ${label}`); } };

function Harness({ initialValue }: { initialValue?: AttachmentValue | null }) {
  const [value, setValue] = React.useState<AttachmentValue | null>(initialValue ?? null);
  const [submitCount, setSubmitCount] = React.useState(0);
  return (
    <form onSubmit={(e) => { e.preventDefault(); setSubmitCount((n) => n + 1); }} data-testid="dna-form">
      <AttachmentUploader value={value} onChange={setValue} label="Logo oficial" />
      <p data-testid="submit-count">{submitCount}</p>
      <button type="submit">Salvar Company DNA</button>
    </form>
  );
}

async function run() {
  console.log("\n[dom] clicar em 'Upload' NÃO dispara submit do form pai");
  {
    render(<Harness />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /upload/i })); });
    assert(screen.getByTestId("submit-count").textContent === "0", "submitCount permanece 0 após clicar em Upload");
    assert(screen.getByText(/arraste o arquivo aqui/i) !== null, "aba Upload realmente abriu (arraste o arquivo aqui visível)");
    cleanup();
  }

  console.log("\n[dom] clicar em 'Link' NÃO dispara submit do form pai");
  {
    render(<Harness />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /upload/i })); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^link$/i })); });
    assert(screen.getByTestId("submit-count").textContent === "0", "submitCount permanece 0 após alternar Upload -> Link");
    assert(screen.getByPlaceholderText(/cole o link do arquivo/i) !== null, "aba Link realmente reabriu (input de link visível)");
    cleanup();
  }

  console.log("\n[dom] alternância Link <-> Upload continua funcionando (só a aba muda, nunca o form)");
  {
    render(<Harness />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /upload/i })); });
    assert(screen.queryByPlaceholderText(/cole o link do arquivo/i) === null, "input de link some ao entrar em Upload");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^link$/i })); });
    assert(screen.getByPlaceholderText(/cole o link do arquivo/i) !== null, "input de link volta ao entrar em Link");
    assert(screen.getByTestId("submit-count").textContent === "0", "nenhum submit disparado pela alternância de abas");
    cleanup();
  }

  console.log("\n[dom] seleção de arquivo (upload) continua funcionando -- handler roda, sem submeter o form");
  {
    render(<Harness />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /upload/i })); });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    assert(fileInput !== null, "input[type=file] presente na aba Upload");
    const file = new File(["fake-bytes"], "logo.png", { type: "image/png" });
    await act(async () => { fireEvent.change(fileInput, { target: { files: [file] } }); });
    // Ambiente de teste roda sem NEXT_PUBLIC_SUPABASE_URL/ANON_KEY -- isSupabaseConfigured é
    // sempre false aqui, então o caminho determinístico e sem rede é o erro explícito abaixo
    // (prova que handleFileChange -> uploadFile realmente executou, sem precisar de um Supabase real).
    assert(screen.getByText(/storage não configurado/i) !== null, "seleção de arquivo chega até uploadFile() -- mensagem de storage não configurado aparece");
    assert(screen.getByTestId("submit-count").textContent === "0", "selecionar um arquivo nunca submete o form pai");
    cleanup();
  }

  console.log("\n[dom] remover/cancelar (X) não submete o form");
  {
    const existing: AttachmentValue = { url: "https://cdn.example.com/logo.png", name: "logo.png", type: "image/png", size: 1234, source: "external_link" };
    render(<Harness initialValue={existing} />);
    const removeBtn = screen.getByTitle("Remover");
    await act(async () => { fireEvent.click(removeBtn); });
    assert(screen.getByTestId("submit-count").textContent === "0", "clicar em Remover não submete o form");
    assert(screen.queryByText("logo.png") === null, "valor foi removido de fato (onChange(null) aplicado)");
    cleanup();
  }

  console.log("\n[dom] submit real do formulário continua funcionando");
  {
    render(<Harness />);
    const form = screen.getByTestId("dna-form") as HTMLFormElement;
    await act(async () => { fireEvent.submit(form); });
    assert(screen.getByTestId("submit-count").textContent === "1", "botão de submit real da tela ainda funciona normalmente");
    cleanup();
  }

  console.log(`\n[dom result] ${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
}

run();
