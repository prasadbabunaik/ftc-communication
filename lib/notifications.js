// Notifications helper — one source of truth for "who should be told about
// this event." Server actions and APIs call notifyRegion() / notifyAll() with a
// logical event; this module fans the event out into one Notification row per
// recipient user, scoped by role + region.
//
// Recipient rules:
//   - ADMIN     → receives every notification (admin oversight)
//   - NLDC      → receives every notification (national view)
//   - <X>LDC    → receives only notifications targeted at their region code
//
// All functions are best-effort: failures are logged but don't throw, so a
// crash in the notification pipeline never breaks the underlying mutation.

import { prisma } from './prisma';

const ROLE_TO_REGION = {
  SRLDC: 'SR', NRLDC: 'NR', ERLDC: 'ER', WRLDC: 'WR', NERLDC: 'NER',
};
const REGION_TO_ROLE = Object.fromEntries(
  Object.entries(ROLE_TO_REGION).map(([role, code]) => [code, role]),
);
const ALWAYS_NOTIFY_ROLES = ['ADMIN', 'NLDC'];

/**
 * Resolve the list of active user IDs that should be notified for an event
 * scoped to `regionCode` (e.g. 'SR'). If regionCode is null/undefined the
 * event is treated as global — only ADMIN/NLDC are notified.
 *
 * `excludeUserId` skips the actor who triggered the event so they don't get
 * a notification about their own action.
 */
async function resolveRecipientUserIds({ regionCode, excludeUserId } = {}) {
  const roles = new Set(ALWAYS_NOTIFY_ROLES);
  if (regionCode && REGION_TO_ROLE[regionCode]) {
    roles.add(REGION_TO_ROLE[regionCode]);
  }
  const users = await prisma.user.findMany({
    where: {
      role:     { in: Array.from(roles) },
      isActive: true,
      ...(excludeUserId ? { NOT: { id: excludeUserId } } : {}),
    },
    select: { id: true },
  });
  return users.map(u => u.id);
}

/**
 * Create one Notification row per recipient. Safe to call from any server
 * action — never throws. Pass `regionCode` to scope; omit for global events.
 *
 * @param {object} opts
 * @param {string} opts.type            NotificationType enum value
 * @param {string} opts.title           Short headline
 * @param {string} [opts.body]          Optional sub-text
 * @param {string} [opts.link]          Optional in-app deep link
 * @param {string} [opts.severity]      INFO | SUCCESS | WARNING | CRITICAL
 * @param {string} [opts.regionCode]    'SR' | 'NR' | 'ER' | 'WR' | 'NER'
 * @param {object} [opts.metadata]      Free-form JSON for the UI
 * @param {string} [opts.excludeUserId] Don't notify this user
 * @returns {Promise<number>} count of notifications written (0 on failure)
 */
export async function notifyRegion({
  type, title, body = null, link = null, severity = 'INFO',
  regionCode = null, metadata = null, excludeUserId = null,
} = {}) {
  if (!type || !title) {
    console.warn('[notifications] notifyRegion called without type/title');
    return 0;
  }
  try {
    const userIds = await resolveRecipientUserIds({ regionCode, excludeUserId });
    if (userIds.length === 0) return 0;
    const result = await prisma.notification.createMany({
      data: userIds.map(userId => ({
        userId, type, severity, title, body, link, metadata,
      })),
    });
    return result.count;
  } catch (err) {
    console.error('[notifications] notifyRegion failed:', err?.message);
    return 0;
  }
}

/**
 * Global event — notifies only ADMIN + NLDC users. Equivalent to
 * notifyRegion({ regionCode: null, ... }).
 */
export function notifyAll(opts = {}) {
  return notifyRegion({ ...opts, regionCode: null });
}

/**
 * Notify a single user directly. Used for self-targeted events (e.g. someone
 * else replies to a project note the user authored).
 */
export async function notifyUser({
  userId, type, title, body = null, link = null, severity = 'INFO', metadata = null,
} = {}) {
  if (!userId || !type || !title) return 0;
  try {
    await prisma.notification.create({
      data: { userId, type, severity, title, body, link, metadata },
    });
    return 1;
  } catch (err) {
    console.error('[notifications] notifyUser failed:', err?.message);
    return 0;
  }
}

// Convenience builders — keep call-sites short and consistent.

export function notifyProjectCreated({ project, regionCode, actorUserId }) {
  return notifyRegion({
    type: 'PROJECT_CREATED',
    severity: 'SUCCESS',
    title: `New project: ${project.name}`,
    body: `${project.totalCapacityMw} MW · ${regionCode} · ${project.plantType?.label ?? ''}`.trim(),
    link: `/generation/${project.id}`,
    regionCode,
    metadata: { projectId: project.id, regionCode },
    excludeUserId: actorUserId,
  });
}

export function notifyContd4StatusChanged({ project, regionCode, oldStatus, newStatus, actorUserId }) {
  return notifyRegion({
    type: 'CONTD4_STATUS_CHANGED',
    severity: newStatus === 'CLEARED' ? 'SUCCESS' : 'INFO',
    title: `CONTD-4 ${newStatus.toLowerCase()}: ${project.name}`,
    body: `${oldStatus} → ${newStatus}`,
    link: `/generation/${project.id}`,
    regionCode,
    metadata: { projectId: project.id, oldStatus, newStatus },
    excludeUserId: actorUserId,
  });
}

export function notifyMilestoneEvent({ kind, project, regionCode, capacityMw, eventDate, actorUserId }) {
  const VERB = { FTC_EVENT: 'FTC completed', TOC_EVENT: 'TOC issued', COD_EVENT: 'COD declared' };
  return notifyRegion({
    type: kind,
    severity: kind === 'COD_EVENT' ? 'SUCCESS' : 'INFO',
    title: `${VERB[kind] ?? 'Milestone'}: ${project.name}`,
    body: `${capacityMw} MW${eventDate ? ` on ${new Date(eventDate).toLocaleDateString('en-IN')}` : ''}`,
    link: `/generation/${project.id}`,
    regionCode,
    metadata: { projectId: project.id, capacityMw, eventDate },
    excludeUserId: actorUserId,
  });
}

export function notifyTransmissionUpdated({ element, regionCode, action, actorUserId }) {
  return notifyRegion({
    type: 'TRANSMISSION_UPDATED',
    severity: 'INFO',
    title: `Transmission ${action}: ${element.elementName}`,
    body: `${element.elementType}${element.voltageRatingKv ? ` · ${element.voltageRatingKv} kV` : ''}`,
    link: `/transmission`,
    regionCode,
    metadata: { elementId: element.id, action },
    excludeUserId: actorUserId,
  });
}
