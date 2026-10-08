/*
  Match IA · intenção comercial e handoff.

  Decisão local, antes de estoque e OpenAI.
  Não abre lead. O lead continua no clique do botão, no formulário
  e na confirmação de /api/lead.
*/

(function (root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.AiCommercialIntent = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const SAFE_HANDOFF_REPLY =
    "Posso encaminhar isso ao Rafael. Toque em Falar com Rafael para confirmar seus dados.";

  function aiCommercialNormalize(value) {
    return String(value ?? "")
      .replace(/[?!.,;:()"“”]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  }

  function detectCommercialIntent(message) {
    const text = aiCommercialNormalize(message);
    if (!text) return "";

    if (/\b(?:whatsapp|zap|wpp)\b/.test(text)) {
      return "whatsapp";
    }

    if (
      /\bfalar com (?:o |a |um |uma )?(?:alguem|pessoa|corretor|rafael|especialista|atendente|humano)\b/.test(text) ||
      /\batendimento humano\b/.test(text) ||
      /\b(?:quero|preciso|gostaria de) falar com\b/.test(text)
    ) {
      return "human";
    }

    if (/\b(?:agendar|marcar)\b/.test(text) && /\bvisita\b/.test(text)) {
      return "schedule";
    }

    if (
      /\b(?:quero visitar|posso visitar|gostaria de visitar|visitar o imovel|ver o imovel pessoalmente|visitar)\b/.test(text)
    ) {
      return "visit";
    }

    if (/\b(?:desconto|condicao comercial)\b/.test(text)) {
      return "discount";
    }

    if (
      /\b(?:negociar|negociacao|fazer proposta|aceita proposta|melhor preco|valor negociavel)\b/.test(text)
    ) {
      return "negotiation";
    }

    if (
      /\b(?:tem disponibilidade|ha disponibilidade|confirmar disponibilidade|esta disponivel|ainda esta disponivel|tem unidade disponivel|ainda tem essa unidade|essa unidade existe|disponibilidade)\b/.test(text)
    ) {
      return "availability";
    }

    if (
      /\b(?:tenho interesse|me interessei|estou interessado|estou interessada|quero esse imovel|quero esse|quero esta unidade|curti esse|gostei desse)\b/.test(text)
    ) {
      return "interest";
    }

    if (
      /\b(?:como faco para comprar|como comprar|como eu compro|como funciona a compra|como funciona compra)\b/.test(text)
    ) {
      return "purchase";
    }

    return "";
  }

  function hasCommercialTarget(context) {
    const count = Number(context?.resultCount) || 0;
    return Boolean(context?.hasProperty) || count === 1;
  }

  function asksForChoice(intent, context) {
    const count = Number(context?.resultCount) || 0;
    const target = hasCommercialTarget(context);
    const multiple = !target && count > 1;

    if (intent === "availability" && multiple) return true;
    if (intent === "interest" && !target) return true;
    if (intent === "purchase" && !target) return true;
    return false;
  }

  function choiceReply(intent, context) {
    const count = Number(context?.resultCount) || 0;

    if (intent === "availability") {
      return "Há mais de um imóvel na lista. Diga qual deles você quer consultar a disponibilidade, pelo nome ou pela posição.";
    }

    if (intent === "purchase") {
      return count > 1
        ? "Há mais de um imóvel na lista. Diga qual deles você quer comprar, pelo nome ou pela posição."
        : "Ainda não há um imóvel selecionado. Diga qual imóvel você quer comprar.";
    }

    return count > 1
      ? "Há mais de um imóvel na lista. Diga qual deles você quer, pelo nome ou pela posição."
      : "Ainda não há um imóvel selecionado. Diga qual imóvel você quer.";
  }

  function handoffReply(intent) {
    if (intent === "visit") {
      return "Posso encaminhar seu pedido de visita ao Rafael. Toque em Falar com Rafael para confirmar seus dados.";
    }

    if (intent === "schedule") {
      return "Posso encaminhar seu pedido de agendamento ao Rafael. Toque em Falar com Rafael para confirmar seus dados.";
    }

    if (intent === "availability") {
      return "A disponibilidade precisa ser confirmada pelo Rafael. Posso encaminhar isso ao Rafael. Toque em Falar com Rafael para confirmar seus dados.";
    }

    if (intent === "negotiation") {
      return "A negociação é feita com o Rafael. Posso encaminhar isso ao Rafael. Toque em Falar com Rafael para confirmar seus dados.";
    }

    if (intent === "discount") {
      return "Condições de desconto são confirmadas pelo Rafael. Posso encaminhar isso ao Rafael. Toque em Falar com Rafael para confirmar seus dados.";
    }

    if (intent === "interest") {
      return "Posso encaminhar seu interesse neste imóvel ao Rafael. Toque em Falar com Rafael para confirmar seus dados.";
    }

    if (intent === "purchase") {
      return "A compra é acompanhada pelo Rafael. Posso encaminhar isso ao Rafael. Toque em Falar com Rafael para confirmar seus dados.";
    }

    return SAFE_HANDOFF_REPLY;
  }

  function emptyDecision() {
    return {
      handled: false,
      intent: "",
      shouldSearchInventory: false,
      shouldCallOpenAI: false,
      shouldOpenLead: false,
      showHandoff: false,
      needsPropertyChoice: false,
      reply: ""
    };
  }

  function aiResolveCommercialTurn(message, context) {
    const intent = detectCommercialIntent(message);
    if (!intent) return emptyDecision();

    const base = {
      handled: true,
      intent,
      shouldSearchInventory: false,
      shouldCallOpenAI: false,
      shouldOpenLead: false,
      showHandoff: false,
      needsPropertyChoice: false,
      reply: ""
    };

    if (asksForChoice(intent, context)) {
      return {
        ...base,
        needsPropertyChoice: true,
        showHandoff: false,
        reply: choiceReply(intent, context)
      };
    }

    return {
      ...base,
      showHandoff: true,
      reply: handoffReply(intent)
    };
  }

  function aiSanitizeHandoffPromise(value) {
    const text = String(value ?? "").trim();
    if (!text) return text;

    const normalized = aiCommercialNormalize(text);
    const claimsCompletedAction = [
      /\bencaminhei\b/,
      /\bencaminhado\b/,
      /\bencaminhamos\b/,
      /\bencaminho\b/,
      /\bavisei\b/,
      /\bavisamos\b/,
      /\bavisado\b/,
      /\bregistrei\b/,
      /\bregistramos\b/,
      /\bregistrado\b/,
      /\benviei\b/,
      /\benviamos\b/,
      /\benviad[oa]\b/,
      /\bpassei\b/,
      /\bpassamos\b/,
      /\bvisita foi agendada\b/,
      /\bvisita agendada\b/,
      /\bsolicitacao foi enviada\b/,
      /\bsolicitacao enviada\b/,
      /\bpedido enviado\b/,
      /\bja (?:encaminhei|avisei|registrei|enviei|passei)\b/,
      /\b(?:vou|irei|vamos) (?:encaminhar|enviar|passar|avisar|registrar)\b/
    ];

    if (claimsCompletedAction.some(pattern => pattern.test(normalized))) {
      return SAFE_HANDOFF_REPLY;
    }

    return text;
  }

  return {
    SAFE_HANDOFF_REPLY,
    aiCommercialNormalize,
    detectCommercialIntent,
    aiResolveCommercialTurn,
    aiSanitizeHandoffPromise
  };
});
