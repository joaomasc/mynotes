import { zReviewSettings } from '@mynotes/shared';
import { all, first, parseJson, run, str } from '../../lib/db';
import { localClock, send, vapid } from '../speech/push';
import { reviewSummary } from './stats';

/**
 * Daily review reminder (Web Push, the same browser subscriptions as the
 * speaking reminder): after the chosen local time, on days with items due
 * and no review yet, once a day per browser.
 */
export async function runReviewReminders(env: Env, nowMs = Date.now()): Promise<number> {
  const keys = await vapid(env);
  if (!keys) return 0;
  const rows = await all(env.DB, "SELECT user_id, value FROM settings WHERE key = 'review'");
  let sent = 0;
  for (const row of rows) {
    const settings = zReviewSettings.safeParse(parseJson(row.value, {}));
    if (!settings.success || !settings.data.reminder.enabled) continue;
    const userId = str(row.user_id);
    const { day, time } = localClock(nowMs, settings.data.reminder.tzOffsetMinutes);
    if (time < settings.data.reminder.time) continue;
    if (await first(env.DB, 'SELECT 1 AS ok FROM review_logs WHERE user_id = ? AND local_day = ? LIMIT 1', userId, day)) continue;
    const subs = await all<{ endpoint: string; p256dh: string; auth: string }>(
      env.DB,
      'SELECT endpoint, p256dh, auth FROM speech_push_subscriptions WHERE user_id = ? AND (review_last_sent_on IS NULL OR review_last_sent_on <> ?)',
      userId,
      day,
    );
    if (subs.length === 0) continue;
    const summary = await reviewSummary(env.DB, userId, day);
    const items = summary.due + summary.newAvailable;
    if (items === 0) continue;
    const message = {
      title: 'MyNotes · Revisar',
      body: `${items} ${items === 1 ? 'item espera' : 'itens esperam'} a sua revisão hoje. Alguns minutos bastam.`,
      url: '/review',
      tag: 'mynotes-review',
    };
    for (const s of subs) {
      try {
        const status = await send(keys, s, message);
        if (status === 404 || status === 410) await run(env.DB, 'DELETE FROM speech_push_subscriptions WHERE endpoint = ?', s.endpoint);
        else {
          await run(env.DB, 'UPDATE speech_push_subscriptions SET review_last_sent_on = ? WHERE endpoint = ?', day, s.endpoint);
          if (status < 300) sent++;
        }
      } catch (err) {
        console.error(JSON.stringify({ level: 'error', msg: 'review push failed', error: String(err).slice(0, 200) }));
      }
    }
  }
  return sent;
}
