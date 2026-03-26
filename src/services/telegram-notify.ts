import { logger } from '../shared/logger.js';

export async function notifyTelegram(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000) }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    logger.error(
      { status: res.status, body: body.slice(0, 500) },
      'Telegram sendMessage failed',
    );
  }
}
