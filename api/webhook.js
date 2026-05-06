const TELEGRAM_API_BASE = "https://api.telegram.org";

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

async function handleStart(chatId) {
  await telegramApi("sendMessage", {
    chat_id: chatId,
    text: buildStartMessage(),
    reply_markup: {
      inline_keyboard: [[{ text: "Получить доступ", callback_data: "get_access" }]],
    },
  });
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

export default async function handler(req, res) {
  if (!process.env.BOT_TOKEN || !process.env.ISSUE_ACCESS_URL) {
    return res.status(500).json({ error: "Missing BOT_TOKEN or ISSUE_ACCESS_URL" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const update = req.body || {};

  try {
    if (update.message?.text === "/start") {
      await handleStart(update.message.chat.id);
      return res.status(200).json({ ok: true });
    }

    if (update.callback_query?.data === "get_access") {
      await handleAccess(update.callback_query);
      return res.status(200).json({ ok: true });
    }

    return res.status(200).json({ ok: true, ignored: true });
  } catch (error) {
    console.error("Webhook handler error:", error);
    return res.status(200).json({ ok: false });
  }
}
