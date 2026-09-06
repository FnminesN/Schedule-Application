'use strict';

import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { LocalNotifications } from '@capacitor/local-notifications';

const DAY_MS = 24 * 60 * 60 * 1000;
const CHANNEL_ID = 'schedule-reminders';
let channelCreated = false;

function eventIdHash(id) {
  let h = 0;
  const s = String(id || '');
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return (h & 0x7fffffff) || 1;
}

function localTime(dateStr, timeStr) {
  return new Date(`${dateStr}T${timeStr}:00`);
}

async function ensureChannel() {
  if (channelCreated || !Capacitor.isNativePlatform()) return;
  try {
    await LocalNotifications.createChannel({
      id: CHANNEL_ID,
      name: '日程提醒',
      description: '日程到达提醒时间时发送通知',
      importance: 5,
      visibility: 1,
    });
    channelCreated = true;
  } catch (e) {
    console.warn('创建通知渠道失败', e);
  }
}

async function cancelAllScheduled() {
  try {
    const pending = await LocalNotifications.getPending();
    if (pending && pending.notifications && pending.notifications.length) {
      await LocalNotifications.cancel({
        notifications: pending.notifications.map(n => ({ id: n.id })),
      });
    }
  } catch (e) {
    console.warn('取消通知失败', e);
  }
}

/**
 * 由网页端调用：扫描未来 30 天内带提醒的日程并重排原生通知。
 * @param {{events: Array, enabled: boolean, now: number}} payload
 */
async function sync({ events = [], enabled = false, now = Date.now() } = {}) {
  if (!Capacitor.isNativePlatform()) return;
  await ensureChannel();
  await cancelAllScheduled();
  if (!enabled) return;

  const horizon = now + 30 * DAY_MS;
  const notifications = [];
  for (const ev of events || []) {
    if (!ev || !ev.startTime || ev.remindMinutes == null) continue;
    try {
      const start = localTime(ev.date, ev.startTime).getTime();
      const at = start - (Number(ev.remindMinutes) || 0) * 60000;
      if (at <= now + 2000 || at > horizon) continue;
      const bodyParts = [];
      if (ev.endTime) bodyParts.push(`${ev.startTime}–${ev.endTime}`);
      if (ev.notes) bodyParts.push(ev.notes);
      notifications.push({
        id: eventIdHash(ev.id),
        title: ev.title,
        body: bodyParts.join(' · ') || ev.startTime,
        schedule: { at: new Date(at), allowWhileIdle: true },
        channelId: CHANNEL_ID,
        extra: { eventId: ev.id },
      });
    } catch (e) {
      console.warn('跳过无法调度的日程', ev.id, e);
    }
  }
  if (notifications.length) {
    await LocalNotifications.schedule({ notifications });
  }
}

async function requestPermission() {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const check = await LocalNotifications.checkPermissions();
    if (check.display === 'granted') return true;
    if (check.display === 'denied') return false;
    const req = await LocalNotifications.requestPermissions();
    return req.display === 'granted';
  } catch (e) {
    console.warn('请求通知权限失败', e);
    return false;
  }
}

async function notifyNow(title, body) {
  if (!Capacitor.isNativePlatform()) return;
  await ensureChannel();
  try {
    await LocalNotifications.schedule({
      notifications: [{
        id: 999999,
        title: title || '日程提醒测试',
        body: body || '',
        schedule: { at: new Date(Date.now() + 1500), allowWhileIdle: true },
        channelId: CHANNEL_ID,
      }],
    });
  } catch (e) {
    console.warn('发送测试通知失败', e);
  }
}

function registerBackHandler(handler) {
  if (!Capacitor.isNativePlatform()) return;
  App.addListener('backButton', () => {
    let consumed = false;
    try {
      if (typeof handler === 'function') consumed = !!handler();
    } catch (e) {
      console.warn('返回键处理失败', e);
    }
    if (!consumed) {
      App.exitApp();
    }
  });
}

if (Capacitor.isNativePlatform()) {
  window.ScheduleNative = {
    isNative: true,
    sync,
    requestPermission,
    notifyNow,
    registerBackHandler,
    cancelAll: cancelAllScheduled,
  };
}
