const controller = new AbortController();

const timeout = setTimeout(
  () => controller.abort(),
  25000
);

let response;

try {
  response = await fetch(
    "https://api.openai.com/v1/responses",
    {
      method: "POST",
      signal: controller.signal,

      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },

      body: JSON.stringify({
        model: "gpt-5.6-luna",

        instructions: systemPrompt,

        input: [
          ...history
            .filter(
              item =>
                item &&
                ["user", "assistant"].includes(item.role)
            )
            .map(item => ({
              role: item.role,
              content: String(item.content || "").slice(0, 2000)
            })),

          {
            role: "user",
            content: message
          }
        ],

        reasoning: {
          effort: "none"
        },

        text: {
          verbosity: "low"
        },

        max_output_tokens: 900
      })
    }
  );

} finally {
  clearTimeout(timeout);
}

const data = await response
  .json()
  .catch(() => ({}));

if (!response.ok) {
  console.error(
    "OPENAI_ASSISTANT_ERROR",
    response.status,
    JSON.stringify(data)
  );

  return res.status(502).json({
    success: false,
    error:
      data?.error?.message ||
      `OpenAI HTTP ${response.status}`
  });
}

let reply = "";

if (typeof data.output_text === "string") {
  reply = data.output_text;
}

if (!reply && Array.isArray(data.output)) {
  for (const item of data.output) {
    if (!Array.isArray(item?.content)) continue;

    for (const part of item.content) {
      if (typeof part?.text === "string") {
        reply += part.text;
      }
    }
  }
}

reply = String(reply || "").trim();

const handoff =
  reply.includes("[[HANDOFF]]");

reply = reply
  .replace(/\[\[HANDOFF\]\]/g, "")
  .trim();

if (!reply) {
  console.error(
    "MATCH_IA_EMPTY_REPLY",
    JSON.stringify(data)
  );

  return res.status(502).json({
    success: false,
    error: "A IA não retornou texto"
  });
}

return res.status(200).json({
  success: true,
  reply,
  handoff
});
