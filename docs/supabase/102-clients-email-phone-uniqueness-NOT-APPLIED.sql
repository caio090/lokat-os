-- ============================================================
-- LOKAT OS — SQL 102 · Unicidade normalizada de clients.email/phone
-- + conversão atômica lead->cliente (RPC)
-- STATUS: DB MIGRATION PENDING -- NÃO APLICADA. Preparada/revisada na
-- missão PROMPT 04, NUNCA executada -- fora de escopo aplicar em
-- Production/banco compartilhado nesta missão.
--
-- REVISÃO (PROMPT 04) em relação à primeira versão deste arquivo:
--
-- 1. NORMALIZAÇÃO REAL, não só lower(): e-mail usa lower(btrim(email))
--    (espaço nunca conta como diferença); telefone usa
--    regexp_replace(phone, '\D', '', 'g') (dígitos puros -- "(89)
--    99421-7181" e "89994217181" são o MESMO telefone). Confirmado nos
--    dados reais: `O Pedreirão` tem phone='' e email='' (string vazia,
--    não NULL) -- os dois índices excluem string vazia explicitamente,
--    não só NULL.
--
-- 2. ESCOPO POR AGÊNCIA, não mais global. `clients.agency_id`/
--    `parent_agency_id` NÃO são colunas mortas -- usadas ativamente em
--    src/lib/account-permissions.ts, company-context/resolve.ts,
--    office-global/authorized-companies.ts, own-organization/adapters.ts
--    e 3 rotas admin (modelo de sub-agência/white-label real, só ainda
--    sem tenant populado em Production). Unicidade GLOBAL quebraria
--    esse modelo assim que uma 2ª agência existir (duas agências
--    nunca poderiam atender duas empresas diferentes com o mesmo
--    e-mail de contato). Por isso o índice é
--    (COALESCE(agency_id, '00000000-0000-0000-0000-000000000000'::uuid), email/phone normalizado)
--    -- hoje, com agency_id sempre NULL, isso se comporta IGUAL a um
--    índice global (mesmo resultado prático), mas não quebra quando o
--    multi-tenant virar real.
--
-- 3. Verificação ANTES de propor (reexecutada com a expressão NORMALIZADA
--    e ESCOPADA de cima, não só a ingênua da v1): zero duplicatas reais
--    hoje, confirmado via execute_sql em 2026-11-21.
--
-- 4. LIMITAÇÃO AINDA NÃO RESOLVIDA (documentada, não escondida):
--    normalização de telefone aqui NÃO remove um prefixo de país ("55")
--    inconsistente -- se um dia existirem registros como "5589994217181"
--    e "89994217181" pro mesmo número real, o índice não os unifica.
--    Resolver isso exige decidir um formato canônico de telefone pro
--    sistema inteiro (fora do escopo desta correção pontual).
--
-- Rollback: DROP FUNCTION IF EXISTS public.convert_lead_to_client(uuid);
--           DROP INDEX IF EXISTS uq_clients_email_norm;
--           DROP INDEX IF EXISTS uq_clients_phone_norm;
-- ============================================================

DO $$
BEGIN
  IF to_regclass('public.clients') IS NULL THEN
    RAISE EXCEPTION 'public.clients não existe.';
  END IF;
  IF to_regclass('public.commercial_leads') IS NULL THEN
    RAISE EXCEPTION 'public.commercial_leads não existe.';
  END IF;
END $$;

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS uq_clients_email_norm
  ON public.clients (COALESCE(agency_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(email)))
  WHERE email IS NOT NULL AND btrim(email) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_clients_phone_norm
  ON public.clients (COALESCE(agency_id, '00000000-0000-0000-0000-000000000000'::uuid), regexp_replace(phone, '\D', '', 'g'))
  WHERE phone IS NOT NULL AND regexp_replace(phone, '\D', '', 'g') <> '';

COMMENT ON INDEX public.uq_clients_email_norm IS
  'SQL 102 -- unicidade real de e-mail por agência (COALESCE trata NULL como uma única "agência padrão" -- comportamento global enquanto multi-tenant não está em uso real). Normalizado (lower+btrim) -- nunca compara string crua.';
COMMENT ON INDEX public.uq_clients_phone_norm IS
  'SQL 102 -- mesma regra do e-mail, telefone normalizado por dígitos puros. NÃO remove prefixo de país inconsistente (limitação documentada, ver cabeçalho do arquivo).';

-- ─────────────────────────────────────────────────────────────
-- Conversão ATÔMICA lead -> cliente (seção 5, PROMPT 04): toda a
-- lógica de dedup+criação+vínculo roda dentro de UMA função, com
-- advisory lock por identificador normalizado -- fecha de verdade a
-- janela de corrida que a versão em JS (duas chamadas separadas de
-- Supabase, sem transação única) nunca conseguiria fechar sozinha.
-- SECURITY INVOKER: roda com a MESMA RLS de quem chama -- nunca bypass,
-- mesmo princípio já usado em company_supersede_decision (SQL 99).
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.convert_lead_to_client(p_lead_id UUID)
RETURNS TABLE (client_id UUID, was_created BOOLEAN)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_lead        public.commercial_leads%ROWTYPE;
  v_email_norm  TEXT;
  v_phone_norm  TEXT;
  v_agency      UUID := '00000000-0000-0000-0000-000000000000'::uuid;
  v_match_count INT;
  v_client_id   UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_lead FROM public.commercial_leads WHERE id = p_lead_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'lead_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Idempotente: já convertido, retorna o mesmo cliente, nunca cria outro.
  IF v_lead.client_id IS NOT NULL THEN
    RETURN QUERY SELECT v_lead.client_id, false;
    RETURN;
  END IF;

  v_email_norm := NULLIF(lower(btrim(v_lead.contact_email)), '');
  v_phone_norm := NULLIF(regexp_replace(coalesce(v_lead.contact_phone, ''), '\D', '', 'g'), '');

  IF v_email_norm IS NULL AND v_phone_norm IS NULL THEN
    RAISE EXCEPTION 'no_identifier' USING ERRCODE = '22023';
  END IF;

  -- Lock por identificador normalizado -- serializa qualquer outra
  -- chamada concorrente pro MESMO e-mail/telefone (de QUALQUER lead),
  -- liberando imediatamente ao fim da transação (xact-scoped).
  PERFORM pg_advisory_xact_lock(hashtext(coalesce(v_email_norm, '') || '|' || coalesce(v_phone_norm, '')));

  -- Dedup DENTRO do lock -- nenhuma outra sessão pode ter inserido
  -- entre esta checagem e o insert abaixo (diferente da versão em JS).
  SELECT count(DISTINCT id) INTO v_match_count
  FROM public.clients
  WHERE coalesce(agency_id, v_agency) = v_agency
    AND (
      (v_email_norm IS NOT NULL AND lower(btrim(email)) = v_email_norm)
      OR (v_phone_norm IS NOT NULL AND regexp_replace(coalesce(phone, ''), '\D', '', 'g') = v_phone_norm)
    );

  IF v_match_count > 1 THEN
    RAISE EXCEPTION 'ambiguous_match' USING ERRCODE = '22023',
      DETAIL = 'Mais de um cliente corresponde a este lead -- revise manualmente, a conversão nunca escolhe sozinha.';
  END IF;

  IF v_match_count = 1 THEN
    SELECT id INTO v_client_id
    FROM public.clients
    WHERE coalesce(agency_id, v_agency) = v_agency
      AND (
        (v_email_norm IS NOT NULL AND lower(btrim(email)) = v_email_norm)
        OR (v_phone_norm IS NOT NULL AND regexp_replace(coalesce(phone, ''), '\D', '', 'g') = v_phone_norm)
      );

    UPDATE public.commercial_leads
    SET client_id = v_client_id, converted_at = now(), pipeline_stage = 'fechado', updated_at = now()
    WHERE id = p_lead_id;

    RETURN QUERY SELECT v_client_id, false;
    RETURN;
  END IF;

  -- Nenhum encontrado -- cria. Ainda sob o advisory lock: uma 2ª chamada
  -- concorrente pro MESMO identificador só começa DEPOIS que esta
  -- transação inteira terminar (lock liberado só no fim), então nunca
  -- chega a tentar criar um duplicado -- ela refaz o dedup já vendo
  -- este cliente recém-commitado.
  INSERT INTO public.clients (company_name, responsible_name, email, phone, owner_id, created_by)
  VALUES (v_lead.company_name, v_lead.contact_name, v_lead.contact_email, v_lead.contact_phone, auth.uid(), auth.uid())
  RETURNING id INTO v_client_id;

  UPDATE public.commercial_leads
  SET client_id = v_client_id, converted_at = now(), pipeline_stage = 'fechado', updated_at = now()
  WHERE id = p_lead_id;

  RETURN QUERY SELECT v_client_id, true;
END;
$$;
REVOKE ALL ON FUNCTION public.convert_lead_to_client(UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.convert_lead_to_client(UUID) TO authenticated;

COMMENT ON FUNCTION public.convert_lead_to_client(UUID) IS
  'SQL 102 -- substitui a versão em JS (convertLeadToClient em src/lib/commercial-leads/convert-to-client.ts) quando esta migration for aplicada: a versão em JS faz dedup+insert+update em 3 chamadas SEPARADAS (nunca atômico -- confirmado por teste real que 2 chamadas simultâneas criam 2 clientes); esta função faz tudo numa única transação com advisory lock, fechando a janela de corrida de verdade. RLS de quem chama continua valendo (SECURITY INVOKER) -- ainda depende da correção de SQL 103/104 pras roles que hoje não conseguem escrever em commercial_leads/clients.';

COMMIT;
