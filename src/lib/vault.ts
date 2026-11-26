import { base64ToBytes, bytesToBase64 } from './crypto';

const DB_NAME = 'kapsul-encrypted-vault';
const DB_VERSION = 1;
const STORE_META = 'meta';
const STORE_RECORDS = 'records';

const META_PIN_CONFIG = 'pin-config';
const META_DEVICE_KEY = 'device-wrap-key';

let activeVaultKey: CryptoKey | null = null;
let writeQueue: Promise<unknown> = Promise.resolve();
const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder();

export type VaultStateStatus = 'empty' | 'locked' | 'unlocked';

interface PinConfigRecord {
  id: string;
  saltBase64: string;
  verifierBase64: string;
}

interface DeviceKeyRecord {
  id: string;
  key: CryptoKey;
}

interface EncryptedRecord {
  key: string;
  ivBase64: string;
  dataBase64: string;
}

function enqueueDbOp<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(fn, fn);
  writeQueue = next.catch(() => {});
  return next;
}

function openVaultDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_RECORDS)) {
        db.createObjectStore(STORE_RECORDS, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(storeName: string, key: string): Promise<T | undefined> {
  const db = await openVaultDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.get(key);
    let result: T | undefined;
    req.onsuccess = () => {
      result = req.result as T | undefined;
    };
    tx.oncomplete = () => {
      db.close();
      resolve(result);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error ?? new Error('IndexedDB okuma iptal edildi'));
    };
  });
}

async function idbPut<T>(storeName: string, value: T): Promise<void> {
  const db = await openVaultDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    store.put(value);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error ?? new Error('IndexedDB yazma iptal edildi'));
    };
  });
}

async function idbDelete(storeName: string, key: string): Promise<void> {
  const db = await openVaultDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    store.delete(key);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error ?? new Error('IndexedDB silme iptal edildi'));
    };
  });
}

async function derivePinKey(pin: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    utf8Encoder.encode(pin),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: 350_000,
      hash: 'SHA-256',
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function hashPinVerifier(pin: string, salt: Uint8Array): Promise<string> {
  const material = await crypto.subtle.importKey(
    'raw',
    utf8Encoder.encode(pin),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: 350_000,
      hash: 'SHA-256',
    },
    material,
    256
  );
  const digest = await crypto.subtle.digest('SHA-256', bits);
  return bytesToBase64(new Uint8Array(digest));
}

export async function initVaultStatus(): Promise<{ status: VaultStateStatus; hasPin: boolean }> {
  const pinCfg = await idbGet<PinConfigRecord>(STORE_META, META_PIN_CONFIG);
  const identityRecord = await idbGet<EncryptedRecord>(STORE_RECORDS, 'identity');

  if (!identityRecord) {
    return { status: 'empty', hasPin: Boolean(pinCfg) };
  }

  if (pinCfg) {
    if (activeVaultKey) {
      return { status: 'unlocked', hasPin: true };
    }
    return { status: 'locked', hasPin: true };
  }

  const deviceKeyRec = await idbGet<DeviceKeyRecord>(STORE_META, META_DEVICE_KEY);
  if (deviceKeyRec?.key) {
    activeVaultKey = deviceKeyRec.key;
    return { status: 'unlocked', hasPin: false };
  }

  return { status: 'empty', hasPin: false };
}

export async function initializeNewVault(pin?: string): Promise<void> {
  return enqueueDbOp(async () => {
    const cleanPin = pin?.trim();
    if (cleanPin && cleanPin.length >= 4) {
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const verifierBase64 = await hashPinVerifier(cleanPin, salt);
      await idbPut<PinConfigRecord>(STORE_META, {
        id: META_PIN_CONFIG,
        saltBase64: bytesToBase64(salt),
        verifierBase64,
      });
      await idbDelete(STORE_META, META_DEVICE_KEY);
      activeVaultKey = await derivePinKey(cleanPin, salt);
    } else {
      const key = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      );
      await idbPut<DeviceKeyRecord>(STORE_META, { id: META_DEVICE_KEY, key });
      await idbDelete(STORE_META, META_PIN_CONFIG);
      activeVaultKey = key;
    }
  });
}

export async function unlockVaultWithPin(pin: string): Promise<boolean> {
  const pinCfg = await idbGet<PinConfigRecord>(STORE_META, META_PIN_CONFIG);
  if (!pinCfg) return false;
  const salt = base64ToBytes(pinCfg.saltBase64);
  const verifier = await hashPinVerifier(pin, salt);
  if (verifier !== pinCfg.verifierBase64) {
    return false;
  }
  activeVaultKey = await derivePinKey(pin, salt);
  return true;
}

export function lockVaultMemory(): void {
  activeVaultKey = null;
}

export async function saveEncryptedItem<T>(key: string, value: T): Promise<void> {
  return enqueueDbOp(async () => {
    if (!activeVaultKey) {
      throw new Error('Kasa kilitli, veri yazılamadı.');
    }
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = utf8Encoder.encode(JSON.stringify(value));
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      activeVaultKey,
      plaintext
    );
    await idbPut<EncryptedRecord>(STORE_RECORDS, {
      key,
      ivBase64: bytesToBase64(iv),
      dataBase64: bytesToBase64(new Uint8Array(encrypted)),
    });
  });
}

export async function loadEncryptedItem<T>(key: string): Promise<T | null> {
  await writeQueue;
  if (!activeVaultKey) return null;
  const record = await idbGet<EncryptedRecord>(STORE_RECORDS, key);
  if (!record) return null;
  try {
    const iv = base64ToBytes(record.ivBase64);
    const data = base64ToBytes(record.dataBase64);
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      activeVaultKey,
      data as BufferSource
    );
    return JSON.parse(utf8Decoder.decode(decrypted)) as T;
  } catch {
    return null;
  }
}

export async function rekeyVaultWithPin(newPin: string | null, snapshot: Record<string, unknown>): Promise<void> {
  await initializeNewVault(newPin || undefined);
  for (const [k, v] of Object.entries(snapshot)) {
    if (v !== undefined) {
      await saveEncryptedItem(k, v);
    }
  }
}

export async function wipeEntireVault(): Promise<void> {
  return enqueueDbOp(async () => {
    activeVaultKey = null;
    return new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
  });
}
