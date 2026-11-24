import type { KupiDbSnapshot, KupiIntent } from "../contracts";
import { embedPassages, embedQueries } from "./embedder";

export const EMBEDDING_SUGGESTION_THRESHOLD = 0.86;
const CACHE_DB = "kupit-kupi-embeddings";
const CACHE_STORE = "vectors";
const MODEL_VERSION = "multilingual-e5-small-q8-v1";

const INTENT_REFERENCES: Array<{ intent: KupiIntent; text: string }> = [
  { intent: "LOG_EXPENSE", text: "log an expense, record spending, bumili, gumastos, nagbayad" },
  { intent: "LOG_INCOME", text: "record income, received money, sahod, sweldo, may dumating na pera" },
  { intent: "TRANSFER", text: "move money between accounts, transfer funds, lipat pera" },
  { intent: "EDIT_TXN", text: "change or correct a saved transaction, palitan ang amount" },
  { intent: "DELETE_TXN", text: "remove a transaction, delete an expense, burahin ito" },
  { intent: "QUERY_STATS", text: "ask how much I spent or earned, budget status, magkano ang nagastos" },
];

export interface SemanticSuggestion {
  kind: "intent" | "category" | "account" | "merchant";
  label: string;
  intent?: KupiIntent;
  score: number;
}

interface CachedVectors { key: string; vectors: number[][] }
let referenceCache: CachedVectors | undefined;
const profileVectorCache = new Map<string, CachedVectors>();

function openCache(): Promise<IDBDatabase | undefined> {
  if (typeof indexedDB === "undefined") return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const request = indexedDB.open(CACHE_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(CACHE_STORE, { keyPath: "key" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(undefined);
  });
}

async function readCache(key: string): Promise<number[][] | undefined> {
  const db = await openCache();
  if (!db) return undefined;
  return new Promise((resolve) => {
    const request = db.transaction(CACHE_STORE).objectStore(CACHE_STORE).get(key);
    request.onsuccess = () => { const value = request.result?.vectors as number[][] | undefined; db.close(); resolve(value); };
    request.onerror = () => { db.close(); resolve(undefined); };
  });
}

async function writeCache(key: string, vectors: number[][]): Promise<void> {
  const db = await openCache();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const request = db.transaction(CACHE_STORE, "readwrite").objectStore(CACHE_STORE).put({ key, vectors });
    request.onsuccess = request.onerror = () => resolve();
  });
  db.close();
}

async function references(onProgress?: (progress: number, status: string) => void): Promise<CachedVectors> {
  if (referenceCache) return referenceCache;
  const key = `${MODEL_VERSION}:static-intents`;
  const cached = await readCache(key);
  const vectors = cached ?? await embedPassages(INTENT_REFERENCES.map(({ text }) => text), onProgress);
  if (!cached) await writeCache(key, vectors);
  referenceCache = { key, vectors };
  return referenceCache;
}

function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  for (let index = 0; index < Math.min(a.length, b.length); index++) dot += a[index] * b[index];
  return dot;
}

function profileItems(snapshot: KupiDbSnapshot): Array<{ kind: "category" | "account" | "merchant"; label: string }> {
  return [
    ...(snapshot.categories ?? []).map(({ name }) => ({ kind: "category" as const, label: name })),
    ...(snapshot.accounts ?? []).flatMap(({ name, aliases = [] }) => [name, ...aliases].map((label) => ({ kind: "account" as const, label }))),
    ...(snapshot.merchantRules ?? []).filter(({ kind }) => kind === "merchant_category").map(({ source }) => ({ kind: "merchant" as const, label: source })),
  ];
}

async function profileVectors(snapshot: KupiDbSnapshot, onProgress?: (progress: number, status: string) => void): Promise<CachedVectors> {
  const items = profileItems(snapshot);
  const key = `${MODEL_VERSION}:${items.map(({ kind, label }) => `${kind}:${label.toLocaleLowerCase()}`).join("|")}`;
  const memory = profileVectorCache.get(key);
  if (memory) return memory;
  const vectors = items.length ? await embedPassages(items.map(({ kind, label }) => `${kind}: ${label}`), onProgress) : [];
  const value = { key, vectors };
  profileVectorCache.clear(); // Never retain another profile's aliases or vectors.
  profileVectorCache.set(key, value);
  return value;
}

export async function suggestSemanticMatch(
  text: string,
  snapshot: KupiDbSnapshot,
  onProgress?: (progress: number, status: string) => void,
): Promise<SemanticSuggestion | undefined> {
  const [query] = await embedQueries([text], onProgress);
  const [intentRefs, profileRefs] = await Promise.all([references(onProgress), profileVectors(snapshot, onProgress)]);
  let best: SemanticSuggestion | undefined;
  INTENT_REFERENCES.forEach((reference, index) => {
    const score = cosine(query, intentRefs.vectors[index] ?? []);
    if (!best || score > best.score) best = { kind: "intent", label: reference.intent.replaceAll("_", " ").toLowerCase(), intent: reference.intent, score };
  });
  const items = profileItems(snapshot);
  items.forEach((item, index) => {
    const score = cosine(query, profileRefs.vectors[index] ?? []);
    if (!best || score > best.score) best = { ...item, score };
  });
  return best && best.score >= EMBEDDING_SUGGESTION_THRESHOLD ? best : undefined;
}

export function clearProfileEmbeddingIndex(): void {
  profileVectorCache.clear();
  referenceCache = undefined;
}
