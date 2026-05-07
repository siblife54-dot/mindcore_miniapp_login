import crypto from "node:crypto";
const TELEGRAM_API_BASE = "https://api.telegram.org";
const PAYMENT_FALLBACK_URL = "https://t.me/igornbk";
const YOOKASSA_API_URL = "https://api.yookassa.ru/v3/payments";

async function telegramApi(method, payload) {
  const token = process.env.BOT_TOKEN;

  if (!token) {
    throw new Error("BOT_TOKEN is not set");
  }

  const res = await fetch(`${TELEGRAM_API_BASE}/bot${token}/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload || {}),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Telegram API error: ${res.status} ${text}`);
  }

  return res.json();
}

function buildStartMessage() {
  return [
    "Привет 👋",
    "",
    "Здесь можно получить кабинет Mindcore MiniApp - сервис для создания курса внутри Telegram Mini App.",
    "",
    "Нажмите кнопку ниже, чтобы получить доступ.",
  ].join("\n");
}

function buildAccessMessage(data) {
  const header = data?.already_issued
    ? "Вы уже получали доступ. Вот ваши данные:"
    : "🚀 Ваш кабинет готов";

  return [
    header,
    "",
    "Ссылка:",
    data?.admin_url || "-",
    "",
    "Логин:",
    data?.login || "-",
    "",
    "Пароль:",
    data?.password || "-",
  ].join("\n");
}

function buildTariffChoiceMessage(login) {
  return [
    "Выберите тариф для активации кабинета:",
    "",
    "Ваш ID кабинета:",
    login || "-",
    "",
    "Basic:",
    "— до 2 курсов",
    "— до 30 уроков в каждом курсе",
    "",
    "Pro:",
    "— до 5 курсов",
    "— до 100 уроков в каждом курсе",
  ].join("\n");
}

function buildBasicMessage(login) {
  return [
    "Тариф Basic",
    "",
    "Ваш кабинет:",
    login || "-",
    "",
    "После оплаты нажмите “Я оплатил Basic”.",
  ].join("\n");
}

function buildProMessage(login) {
  return [
    "Тариф Pro",
    "",
    "Ваш кабинет:",
    login || "-",
    "",
    "После оплаты нажмите “Я оплатил Pro”.",
  ].join("\n");
}

async function issueAccess(telegram_id, username) {
  const issueAccessUrl = process.env.ISSUE_ACCESS_URL;

  if (!issueAccessUrl) {
    throw new Error("ISSUE_ACCESS_URL is not set");
  }

  const res = await fetch(issueAccessUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      telegram_id,
      username,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`issue-access error: ${res.status} ${text}`);
  }

  return res.json();
}


function getPriceByTariff(tariff) {
  if (tariff === "basic") return process.env.BASIC_PRICE_RUB;
  if (tariff === "pro") return process.env.PRO_PRICE_RUB;
  return null;
}

async function createPayment({ telegram_id, username, login, tariff }) {
  const shopId = process.env.YOOKASSA_SHOP_ID;
  const secretKey = process.env.YOOKASSA_SECRET_KEY;

  if (!shopId || !secretKey) {
    throw new Error("YOOKASSA_SHOP_ID or YOOKASSA_SECRET_KEY is not set");
  }

  const price = getPriceByTariff(tariff);
  if (!price) {
    throw new Error(`Price is not configured for tariff: ${tariff}`);
  }

  const auth = Buffer.from(`${shopId}:${secretKey}`).toString("base64");
  const tariffTitle = tariff === "basic" ? "Basic" : "Pro";
  const returnUrl = process.env.RETURN_URL || "https://t.me/mindcore_miniapp_bot";

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

  if (!data?.confirmation?.confirmation_url) {
    throw new Error("YooKassa did not return confirmation_url");
  }

  return data;
}

async function notifyAdmin(text) {
  const adminChatId = process.env.ADMIN_CHAT_ID;

  if (!adminChatId) {
    console.warn("ADMIN_CHAT_ID is not set");
    return;
  }

  await telegramApi("sendMessage", {
    chat_id: adminChatId,
    text,
  });
}

async function handleStart(chatId) {
  await telegramApi("sendMessage", {
    chat_id: chatId,
    text: buildStartMessage(),
    reply_markup: {
      inline_keyboard: [[{ text: "Получить доступ", callback_data: "get_access" }]],
    },
  });
}

async function handleActivateStart(message) {
  const from = message.from || {};
  const chatId = message.chat?.id;

  try {
    const accessData = await issueAccess(from.id, from.username || null);

    await telegramApi("sendMessage", {
      chat_id: chatId,
      text: buildTariffChoiceMessage(accessData?.login),
      reply_markup: {
        inline_keyboard: [[
          { text: "Basic", callback_data: "choose_basic" },
          { text: "Pro", callback_data: "choose_pro" },
        ]],
      },
    });
  } catch (error) {
    console.error("Failed to start activation flow:", error);

    await telegramApi("sendMessage", {
      chat_id: chatId,
      text: "Не удалось открыть активацию. Напишите нам, мы поможем. https://t.me/igornbk",
    });
  }
}

async function handleAccess(callbackQuery) {
  const callbackId = callbackQuery.id;
  const from = callbackQuery.from || {};
  const message = callbackQuery.message || {};
  const chatId = message.chat?.id;

  try {
    const accessData = await issueAccess(from.id, from.username || null);

    await telegramApi("sendMessage", {
      chat_id: chatId,
      text: buildAccessMessage(accessData),
    });

    if (accessData?.already_issued === false) {
      await notifyAdmin([
        "Новый пользователь Mindcore",
        "",
        `Telegram: @${from.username || "-"}`,
        `Telegram ID: ${from.id || "-"}`,
        `Логин: ${accessData?.login || "-"}`,
        `Пароль: ${accessData?.password || "-"}`,
      ].join("\n"));
    }
  } catch (error) {
    console.error("Failed to issue access:", error);

    await telegramApi("sendMessage", {
      chat_id: chatId,
      text: "Не удалось выдать доступ. Напишите нам, мы поможем. https://t.me/igornbk",
    });
  } finally {
    try {
      await telegramApi("answerCallbackQuery", {
        callback_query_id: callbackId,
      });
    } catch (error) {
      console.error("Failed to answer callback query:", error);
    }
  }
}

async function handleChooseTariff(callbackQuery, tariff) {
  const callbackId = callbackQuery.id;
  const from = callbackQuery.from || {};
  const message = callbackQuery.message || {};
  const chatId = message.chat?.id;
  const isBasic = tariff === "basic";
  
  try {
    const accessData = await issueAccess(from.id, from.username || null);

    const payment = await createPayment({
      telegram_id: from.id,
      username: from.username || null,
      login: accessData?.login,
      tariff,
    });

    await telegramApi("sendMessage", {
      chat_id: chatId,
      text: isBasic ? buildBasicMessage(accessData?.login) : buildProMessage(accessData?.login),
      reply_markup: {
        inline_keyboard: [
          [{ text: isBasic ? "Оплатить Basic" : "Оплатить Pro", url: payment.confirmation.confirmation_url || PAYMENT_FALLBACK_URL }],
          [{ text: isBasic ? "Я оплатил Basic" : "Я оплатил Pro", callback_data: isBasic ? "payment_done_basic" : "payment_done_pro" }],
        ],
      },
    });
  } catch (error) {
    console.error("Failed to prepare tariff payment:", error);

    await telegramApi("sendMessage", {
      chat_id: chatId,
      text:
        "Ошибка оплаты:

" +
        String(error?.message || error),
    });
  } finally {
    try {
      await telegramApi("answerCallbackQuery", {
        callback_query_id: callbackId,
      });
    } catch (error) {
      console.error("Failed to answer callback query:", error);
    }
  }
}

async function handlePaymentDone(callbackQuery, tariff) {
  const callbackId = callbackQuery.id;
  const from = callbackQuery.from || {};
  const message = callbackQuery.message || {};
  const chatId = message.chat?.id;
  const isBasic = tariff === "basic";

  try {
    const accessData = await issueAccess(from.id, from.username || null);

    await telegramApi("sendMessage", {
      chat_id: chatId,
      text: [
        `Спасибо! Заявка на активацию тарифа ${isBasic ? "Basic" : "Pro"} отправлена.`,
        "Мы проверим оплату и включим тариф для кабинета:",
        accessData?.login || "-",
      ].join("\n"),
    });

    await notifyAdmin([
      "Заявка на оплату Mindcore",
      "",
      `Тариф: ${isBasic ? "Basic" : "Pro"}`,
      `Telegram: @${from.username || "-"}`,
      `Telegram ID: ${from.id || "-"}`,
      `Логин: ${accessData?.login || "-"}`,
      `Пароль: ${accessData?.password || "-"}`,
    ].join("\n"));
  } catch (error) {
    console.error("Failed to confirm payment request:", error);

    await telegramApi("sendMessage", {
      chat_id: chatId,
      text: "Не удалось отправить заявку на активацию. Напишите нам, мы поможем. https://t.me/igornbk",
    });
  } finally {
    try {
      await telegramApi("answerCallbackQuery", {
        callback_query_id: callbackId,
      });
    } catch (error) {
      console.error("Failed to answer callback query:", error);
    }
  }
}

export default async function handler(req, res) {
  console.log("UPDATE:", JSON.stringify(req.body));

  if (!process.env.BOT_TOKEN || !process.env.ISSUE_ACCESS_URL) {
    return res.status(500).json({ error: "Missing BOT_TOKEN or ISSUE_ACCESS_URL" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const update = req.body || {};

  try {
    const messageText = update.message?.text;

    if (messageText === "/start") {
      await handleStart(update.message.chat.id);
      return res.status(200).json({ ok: true });
    }

    if (messageText === "/start activate") {
      await handleActivateStart(update.message);
      return res.status(200).json({ ok: true });
    }

    if (update.callback_query?.data === "get_access") {
      await handleAccess(update.callback_query);
      return res.status(200).json({ ok: true });
    }

    if (update.callback_query?.data === "choose_basic") {
      await handleChooseTariff(update.callback_query, "basic");
      return res.status(200).json({ ok: true });
    }

    if (update.callback_query?.data === "choose_pro") {
      await handleChooseTariff(update.callback_query, "pro");
      return res.status(200).json({ ok: true });
    }

    if (update.callback_query?.data === "payment_done_basic") {
      await handlePaymentDone(update.callback_query, "basic");
      return res.status(200).json({ ok: true });
    }

    if (update.callback_query?.data === "payment_done_pro") {
      await handlePaymentDone(update.callback_query, "pro");
      return res.status(200).json({ ok: true });
    }

    return res.status(200).json({ ok: true, ignored: true });
  } catch (error) {
    console.error("Webhook handler error:", error);
    return res.status(200).json({ ok: false });
  }
}
