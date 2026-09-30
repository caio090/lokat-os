"use client";

import { useCallback, useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Meu PP — primitivas de UI (sem biblioteca nova, sem design system paralelo):
 * tokens Tailwind da própria página (stone), <dialog> nativo, chamadas às
 * rotas /api/admin/meu-pp/* e refresh do server component depois de gravar.
 */

export const cls = {
  card: "rounded-xl border border-stone-300/70 bg-[#fbfaf7]",
  label: "text-[11px] font-medium uppercase tracking-[0.18em] text-stone-500",
  input:
    "w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-base text-stone-900 placeholder:text-stone-400 focus:border-stone-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-400/60 sm:text-[15px]",
  primary:
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-stone-900 px-4 text-[13px] font-semibold tracking-wide text-stone-50 transition-[transform,background-color] duration-100 hover:bg-stone-800 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-500 focus-visible:ring-offset-2 motion-reduce:active:scale-100",
  secondary:
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-stone-300 bg-white px-4 text-[13px] font-medium text-stone-800 transition-[transform,border-color] duration-100 hover:border-stone-500 active:scale-[0.98] disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-500 motion-reduce:active:scale-100",
  ghost:
    "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-3 text-[13px] text-stone-600 underline-offset-4 hover:text-stone-900 hover:underline disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-500",
  icon:
    "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-stone-500 transition-colors hover:bg-stone-200/60 hover:text-stone-900 disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-500",
};

type ApiResult = { ok: boolean; code?: string; message?: string; [k: string]: unknown };

const FRIENDLY: Record<string, string> = {
  unauthenticated: "Sua sessão expirou. Entre novamente.",
  forbidden: "Sem permissão para isso.",
  not_found: "Isso não está mais disponível.",
  limit: "Limite atingido.",
  invalid: "Confira os campos e tente de novo.",
  history_locked: "Decisões antigas não são reescritas — registre uma nova decisão.",
  unavailable: "Não foi possível salvar agora. Tente de novo em instantes.",
  db_error: "Não foi possível salvar agora. Tente de novo em instantes.",
};

/** Chama uma rota do Meu PP e atualiza HOJE (router.refresh) em caso de sucesso. */
export function useMeuPpAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (path: string, method: "POST" | "PATCH" | "PUT", body: unknown): Promise<ApiResult | null> => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(`/api/admin/meu-pp/${path}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const data = (await res.json().catch(() => ({ ok: false, code: "unavailable" }))) as ApiResult;
        if (!res.ok || !data.ok) {
          setError(data.message ?? FRIENDLY[data.code ?? ""] ?? FRIENDLY.unavailable);
          return null;
        }
        startTransition(() => router.refresh());
        return data;
      } catch {
        setError(FRIENDLY.unavailable);
        return null;
      } finally {
        setBusy(false);
      }
    },
    [router],
  );
  return { run, busy: busy || pending, error, setError };
}

export function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="mt-2 text-[13px] text-red-700">
      {error}
    </p>
  );
}

/** Seção do HOJE: título curto + ação opcional; nunca um "card de dashboard" carregado. */
export function Section({ title, action, children, id }: { title: string; action?: React.ReactNode; children: React.ReactNode; id?: string }) {
  const hid = useId();
  return (
    <section aria-labelledby={hid} id={id} className="scroll-mt-24">
      <div className="mb-2 flex min-h-11 items-center justify-between gap-3">
        <h2 id={hid} className={cls.label}>
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg border border-dashed border-stone-300 px-4 py-3 text-[14px] text-stone-500">{children}</p>;
}

/**
 * Painel modal acessível sobre <dialog> nativo (foco preso, Esc fecha,
 * aria-labelledby). No celular abre como folha inferior; no desktop, centrado.
 */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const hid = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={hid}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className="m-0 mt-auto w-full max-w-none rounded-t-2xl bg-[#fbfaf7] p-0 text-stone-900 backdrop:bg-stone-900/40 sm:m-auto sm:max-w-lg sm:rounded-2xl"
    >
      <div className="max-h-[88dvh] overflow-y-auto px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4 sm:px-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id={hid} className="font-serif text-xl text-stone-900">
            {title}
          </h2>
          <button type="button" onClick={onClose} className={cls.icon} aria-label="Fechar">
            <span aria-hidden className="text-lg">×</span>
          </button>
        </div>
        {open ? children : null}
      </div>
    </dialog>
  );
}

export function Field({ label, children, hint }: { label: string; children: (id: string) => React.ReactNode; hint?: string }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[13px] font-medium text-stone-700">
        {label}
      </label>
      {children(id)}
      {hint ? <p className="mt-1 text-[12px] text-stone-500">{hint}</p> : null}
    </div>
  );
}
