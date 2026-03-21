export function findTelegramChatIdFromUpdates(payload) {
  const updates = payload?.result || [];

  for (let index = updates.length - 1; index >= 0; index -= 1) {
    const message = updates[index]?.message;
    if (!message?.chat?.id) {
      continue;
    }

    if (message.chat.type === 'private' || String(message.text || '').includes('/start')) {
      return String(message.chat.id);
    }
  }

  return null;
}

export async function resolveTelegramChatId(botToken) {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates?limit=25`);
  if (!response.ok) {
    throw new Error(`Telegram getUpdates failed with ${response.status}`);
  }

  const payload = await response.json();
  return findTelegramChatIdFromUpdates(payload);
}
