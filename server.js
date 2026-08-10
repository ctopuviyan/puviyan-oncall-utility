import express from 'express';
import {
  FieldValue,
  Firestore,
  GeoPoint,
  Timestamp,
} from '@google-cloud/firestore';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || '127.0.0.1';

app.use(express.json({ limit: '1mb' }));

function createFirestore() {
  const projectId = process.env.FIREBASE_PROJECT_ID || undefined;
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

  if (serviceAccountJson) {
    const serviceAccount = JSON.parse(serviceAccountJson);
    return new Firestore({
      projectId: projectId || serviceAccount.project_id,
      credentials: {
        client_email: serviceAccount.client_email,
        private_key: serviceAccount.private_key,
      },
    });
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return new Firestore({
      projectId,
      keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    });
  }

  return new Firestore({ projectId });
}

const db = createFirestore();

function requireAuth(req, res, next) {
  const expectedUser = process.env.ONCALL_USERNAME;
  const expectedPassword = process.env.ONCALL_PASSWORD;

  if (!expectedUser || !expectedPassword) {
    if (req.hostname === 'localhost' || req.hostname === '127.0.0.1') {
      req.oncallUser = 'local-dev';
      return next();
    }
    return res.status(500).json({
      error: 'ONCALL_USERNAME and ONCALL_PASSWORD must be set',
    });
  }

  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme !== 'Basic' || !encoded) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Puviyan On-Call"');
    return res.status(401).json({ error: 'Authentication required' });
  }

  const decoded = Buffer.from(encoded, 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  const username = decoded.slice(0, separator);
  const password = decoded.slice(separator + 1);

  if (username !== expectedUser || password !== expectedPassword) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Puviyan On-Call"');
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  req.oncallUser = username;
  next();
}

app.use(requireAuth);
app.use(express.static(path.join(__dirname, 'public')));

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function toJsonValue(value) {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }
  if (value instanceof GeoPoint) {
    return { latitude: value.latitude, longitude: value.longitude };
  }
  if (Array.isArray(value)) {
    return value.map(toJsonValue);
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, toJsonValue(nested)]),
    );
  }
  return value;
}

function snapshotToDoc(snapshot) {
  return {
    id: snapshot.id,
    path: snapshot.ref.path,
    exists: snapshot.exists,
    data: snapshot.exists ? toJsonValue(snapshot.data()) : null,
  };
}

function dateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateRange(from, to) {
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error('Invalid date range');
  }
  if (start > end) {
    throw new Error('From date must be before to date');
  }
  const dates = [];
  for (let cursor = start; cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    dates.push(dateKey(cursor));
  }
  if (dates.length > 45) {
    throw new Error('Date range is limited to 45 days');
  }
  return dates;
}

function sanitizeSearchTerm(value) {
  return String(value || '').trim();
}

function userSummary(snapshot) {
  const data = snapshot.data() || {};
  return {
    id: snapshot.id,
    uid: data.uid || snapshot.id,
    name: data.name || data.fullName || data.displayName || '',
    email: data.email || '',
    phone: data.phone || data.phoneNumber || '',
    profileRef: data.profileRef || data.publicProfileRef || '',
    raw: toJsonValue(data),
  };
}

async function addUserCandidate(map, querySnapshot) {
  for (const doc of querySnapshot.docs) {
    map.set(doc.id, userSummary(doc));
  }
}

async function findUsers(q) {
  const term = sanitizeSearchTerm(q);
  if (!term) return [];

  const users = new Map();
  const info = db.collection('informations');

  const direct = await info.doc(term).get();
  if (direct.exists) users.set(direct.id, userSummary(direct));

  const queries = [
    info.where('uid', '==', term).limit(10).get(),
    info.where('email', '==', term).limit(10).get(),
    info.where('phone', '==', term).limit(10).get(),
    info.where('profileRef', '==', term).limit(10).get(),
    info.orderBy('name').startAt(term).endAt(`${term}\uf8ff`).limit(10).get(),
  ];

  const results = await Promise.allSettled(queries);
  for (const result of results) {
    if (result.status === 'fulfilled') {
      await addUserCandidate(users, result.value);
    }
  }

  return [...users.values()].slice(0, 25);
}

async function getDocsByDate(userId, collectionName, dates) {
  const docs = [];
  for (const date of dates) {
    const ref = db
      .collection('informations')
      .doc(userId)
      .collection(collectionName)
      .doc(date);
    const snapshot = await ref.get();
    const doc = snapshotToDoc(snapshot);

    if (snapshot.exists) {
      const sessions = await ref.collection('sessions').limit(50).get();
      if (!sessions.empty) {
        doc.sessions = sessions.docs.map(snapshotToDoc);
      }
    }

    docs.push(doc);
  }
  return docs;
}

async function getCollectionDocs(ref, limit = 50) {
  const snapshot = await ref.limit(limit).get();
  return snapshot.docs.map(snapshotToDoc);
}

async function getUserReview(userId, from, to) {
  const dates = dateRange(from, to);
  const infoRef = db.collection('informations').doc(userId);
  const uidRef = db.collection('users').doc(userId);

  const [
    user,
    appUser,
    walking,
    cycling,
    impactLifetime,
    mobilityLifetime,
    badgeProgress,
    redeemedRewards,
  ] = await Promise.all([
    infoRef.get(),
    uidRef.get(),
    getDocsByDate(userId, 'walking', dates),
    getDocsByDate(userId, 'cycling', dates),
    infoRef.collection('impact').doc('lifetime').get(),
    infoRef.collection('mobility').doc('lifetime').get(),
    getCollectionDocs(uidRef.collection('badgeProgress'), 100),
    getCollectionDocs(uidRef.collection('redeemedRewards'), 100),
  ]);

  return {
    userId,
    range: { from, to, dates },
    user: snapshotToDoc(user),
    appUser: snapshotToDoc(appUser),
    walking,
    cycling,
    lifetime: {
      impact: snapshotToDoc(impactLifetime),
      mobility: snapshotToDoc(mobilityLifetime),
    },
    rewards: {
      badgeProgress,
      redeemedRewards,
    },
  };
}

function normalizePath(input) {
  if (Array.isArray(input)) return input.join('/');
  return String(input || '').replace(/^\/+|\/+$/g, '');
}

function assertAllowedCorrectionPath(rawPath) {
  const docPath = normalizePath(rawPath);
  const parts = docPath.split('/').filter(Boolean);

  const isTopLevelUserPath =
    parts.length === 2 && ['informations', 'users'].includes(parts[0]);

  const isInformationUserPath =
    parts[0] === 'informations' &&
    parts.length >= 4 &&
    ['walking', 'cycling', 'impact', 'mobility'].includes(parts[2]);

  const isRewardUserPath =
    parts[0] === 'users' &&
    parts.length >= 4 &&
    ['badgeProgress', 'redeemedRewards'].includes(parts[2]);

  if (!isTopLevelUserPath && !isInformationUserPath && !isRewardUserPath) {
    throw new Error(`Path is not allowed for correction: ${docPath}`);
  }
  if (parts.length % 2 !== 0) {
    throw new Error(`Path must point to a document: ${docPath}`);
  }
  return docPath;
}

async function writeAuditLog({
  oncallUser,
  docPath,
  reason,
  merge,
  before,
  after,
  requestData,
}) {
  await db.collection('oncallAuditLogs').add({
    oncallUser,
    docPath,
    reason,
    merge,
    before: before.exists ? toJsonValue(before.data()) : null,
    after: after.exists ? toJsonValue(after.data()) : null,
    requestData: toJsonValue(requestData),
    createdAt: FieldValue.serverTimestamp(),
  });
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    projectId:
      process.env.FIREBASE_PROJECT_ID ||
      (process.env.GOOGLE_APPLICATION_CREDENTIALS ? 'from-key-file' : null) ||
      (process.env.FIREBASE_SERVICE_ACCOUNT_JSON ? 'from-service-account-json' : null),
  });
});

app.get('/api/users/search', async (req, res, next) => {
  try {
    res.json({ users: await findUsers(req.query.q) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/users/:userId/review', async (req, res, next) => {
  try {
    const today = dateKey();
    const from = sanitizeSearchTerm(req.query.from) || today;
    const to = sanitizeSearchTerm(req.query.to) || today;
    res.json(await getUserReview(req.params.userId, from, to));
  } catch (error) {
    next(error);
  }
});

app.patch('/api/document', async (req, res, next) => {
  try {
    const docPath = assertAllowedCorrectionPath(req.body.path);
    const reason = sanitizeSearchTerm(req.body.reason);
    const merge = req.body.merge !== false;
    const data = req.body.data;

    if (!reason) {
      return res.status(400).json({ error: 'Correction reason is required' });
    }
    if (!isPlainObject(data)) {
      return res.status(400).json({ error: 'data must be a JSON object' });
    }

    const ref = db.doc(docPath);
    const before = await ref.get();
    await ref.set(
      {
        ...data,
        oncallCorrectionUpdatedAt: FieldValue.serverTimestamp(),
        oncallCorrectionUpdatedBy: req.oncallUser,
        oncallCorrectionReason: reason,
      },
      { merge },
    );
    const after = await ref.get();

    await writeAuditLog({
      oncallUser: req.oncallUser,
      docPath,
      reason,
      merge,
      before,
      after,
      requestData: data,
    });

    res.json({ ok: true, document: snapshotToDoc(after) });
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: error.message || 'Unexpected error' });
});

app.listen(port, host, () => {
  console.log(`Puviyan on-call utility listening on http://${host}:${port}`);
});
