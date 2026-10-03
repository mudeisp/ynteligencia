if (
  req.method === "GET" &&
  req.query?.action === "envcheck"
) {
  return res.status(200).json({
    ok: true,
    has_api_token:
      Boolean(process.env.NONSTOP_API_TOKEN),

    has_webhook_token:
      Boolean(process.env.NONSTOP_WEBHOOK_TOKEN)
  });
}
