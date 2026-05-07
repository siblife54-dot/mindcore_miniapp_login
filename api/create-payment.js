import crypto from "node:crypto";

const YOOKASSA_API_URL = "https://api.yookassa.ru/v3/payments";

function getPrice(tariff) {
  if (tariff === "basic") return process.env.BASIC_PRICE_RUB;
  if (tariff === "pro") return process.env.PRO_PRICE_RUB;
  return null;
}

async function createYookassaPayment({ telegram_id, username, login, tariff }) {
  const shopId = process.env.YOOKASSA_SHOP_ID;
  const secretKey = process.env.YOOKASSA_SECRET_KEY;

  if (!shopId || !secretKey) {
    throw new Error("YOOKASSA_SHOP_ID or YOOKASSA_SECRET_KEY is not set");
  }

  const price = getPrice(tariff);
  if (!price) {
    throw new Error(`Price is not configured for tariff: ${tariff}`);
  }

  const returnUrl = process.env.RETURN_URL || "https://t.me/mindcore_miniapp_bot";
  const auth = Buffer.from(`${shopId}:${secretKey}`).toString("base64");
  const tariffTitle = tariff === "basic" ? "Basic" : "Pro";

  const paymentRes = await fetch(YOOKASSA_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
      "Idempotence-Key": crypto.randomUUID(),
    },
    body: JSON.stringify({
      amount: {
        value: String(price),
        currency: "RUB",
      },
      capture: true,
      confirmation: {
        type: "redirect",
        return_url: returnUrl,
      },
      description: `Mindcore тариф ${tariffTitle} для кабинета ${login}`,
      metadata: {
        login: String(login),
        telegram_id: String(telegram_id),
        username: username ? String(username) : "",
        tariff: String(tariff),
      },
    }),
  });

  const data = await paymentRes.json();

  if (!paymentRes.ok) {
    const errText = data?.description || data?.type || JSON.stringify(data);
    throw new Error(`YooKassa error: ${errText}`);
  }

  return data;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { telegram_id, username = null, login, tariff } = req.body || {};

  if (!telegram_id || !login || !tariff) {
    return res.status(400).json({ ok: false, error: "telegram_id, login and tariff are required" });
  }

  if (tariff !== "basic" && tariff !== "pro") {
    return res.status(400).json({ ok: false, error: "tariff must be basic or pro" });
  }

  try {
    const payment = await createYookassaPayment({ telegram_id, username, login, tariff });

    return res.status(200).json({
      ok: true,
      payment_id: payment.id,
      confirmation_url: payment.confirmation?.confirmation_url,
    });
  } catch (error) {
    console.error("create-payment error:", error);
    const status = String(error.message || "").includes("Price is not configured") ? 500 : 502;
    return res.status(status).json({ ok: false, error: error.message || "Payment creation failed" });
  }
}
