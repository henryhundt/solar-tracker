import crypto from "crypto";
import { load } from "cheerio";
import type { EGaugeRegisterInspection } from "@shared/egauge";

interface EGaugeAuthChallenge {
  rlm: string;
  nnc: string;
  error?: string;
}

interface EGaugeLoginResponse {
  jwt: string;
}

interface EGaugeRegisterDescriptor {
  idx?: number | string;
  name?: string;
  type?: string;
  did?: number | string;
}

interface EGaugeRegisterSnapshotResponse {
  registers?: EGaugeRegisterDescriptor[];
  ranges?: Array<{
    ts?: number | string;
    delta?: number | string;
    rows?: Array<Array<number | string | null>>;
  }>;
}

export interface EGaugeAccessInput {
  url?: string | null;
  username?: string | null;
  password?: string | null;
  credentialKey?: string | null;
}

export interface ResolvedEGaugeAccess {
  baseUrl: string;
  username?: string;
  password?: string;
}

export interface EGaugeRegisterHistoryResponse extends EGaugeRegisterSnapshotResponse {}

interface EGaugeXmlSnapshotResponse {
  timeStamp: number;
  timeDelta: number;
  registers: Array<{
    idx: number;
    name: string;
    type: string;
  }>;
  rows: Array<Array<number | null>>;
}

interface EGaugeXmlDataSection {
  timeStamp: number;
  timeDelta: number;
  rows: Array<Array<number | null>>;
}

interface ParsedEGaugeXmlDocument {
  registers: Array<{
    idx: number;
    name: string;
    type: string;
  }>;
  sections: EGaugeXmlDataSection[];
}

const DEFAULT_TIMEOUT_MS = 10_000;
const XML_INSPECTION_ROWS = 2;
const XML_HISTORY_BUFFER_HOURS = 24;
const XML_T_TIMESTAMP_BATCH_SIZE = 168;
const SOLAR_NAME_PATTERN = /solar|generation|pv|photovoltaic|production|inverter|array|gen\b/i;

export function validateEGaugeUrl(rawUrl: string): { ok: true; baseUrl: string } | { ok: false; error: string } {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, error: "Invalid URL format. Must be a valid http:// or https:// URL." };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "URL must use http:// or https:// protocol." };
  }

  const hostname = parsed.hostname.toLowerCase();
  const blockedHostnames = ["localhost", "0.0.0.0", "::1", "[::]", "[::1]"];
  if (blockedHostnames.includes(hostname)) {
    return { ok: false, error: "Invalid device URL. Loopback addresses are not allowed." };
  }

  if (/^(127\.|169\.254\.)/.test(hostname)) {
    return { ok: false, error: "Invalid device URL. Loopback and link-local addresses are not allowed." };
  }

  const normalizedPath = normalizeEGaugeApiPath(parsed.pathname);

  return {
    ok: true,
    baseUrl: `${parsed.protocol}//${parsed.host}${normalizedPath}`,
  };
}

export function resolveEGaugeAccess(input: EGaugeAccessInput): ResolvedEGaugeAccess {
  const credentialKey = input.credentialKey?.trim() ?? "";

  let url = input.url?.trim() ?? "";
  let username = input.username?.trim() ?? "";
  let password = input.password?.trim() ?? "";

  if (credentialKey) {
    url = process.env[`${credentialKey}_URL`] || url;
    username = process.env[`${credentialKey}_USERNAME`] || username;
    password = process.env[`${credentialKey}_PASSWORD`] || password;
  }

  if (!url) {
    throw new Error("Device URL is required");
  }

  const urlCheck = validateEGaugeUrl(url);
  if (!urlCheck.ok) {
    throw new Error(urlCheck.error);
  }

  return {
    baseUrl: urlCheck.baseUrl,
    username,
    password,
  };
}

export async function authenticateEGauge(access: ResolvedEGaugeAccess): Promise<string> {
  const username = access.username?.trim();
  const password = access.password?.trim();
  if (!username || !password) {
    throw new Error("eGauge JSON WebAPI requires a username and password");
  }

  const authChallenge = await fetchAuthChallenge(access.baseUrl);

  const cnnc = crypto.randomBytes(64).toString("hex");
  const ha1 = crypto
    .createHash("md5")
    .update(`${username}:${authChallenge.rlm}:${password}`)
    .digest("hex");
  const hash = crypto
    .createHash("md5")
    .update(`${ha1}:${authChallenge.nnc}:${cnnc}`)
    .digest("hex");

  const loginData = await timedJsonFetch<EGaugeLoginResponse>(`${access.baseUrl}/api/auth/login`, {
    method: "POST",
    redirect: "error",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      rlm: authChallenge.rlm,
      usr: username,
      nnc: authChallenge.nnc,
      cnnc,
      hash,
    }),
  });

  if (!loginData.jwt) {
    throw new Error("eGauge login did not return a JWT");
  }

  return loginData.jwt;
}

export async function inspectEGaugeRegisters(access: ResolvedEGaugeAccess): Promise<EGaugeRegisterInspection[]> {
  let webApiError: Error | null = null;

  if (hasWebApiCredentials(access)) {
    try {
      const jwt = await authenticateEGauge(access);
      const snapshot = await fetchEGaugeRegisterSnapshot(access.baseUrl, jwt);
      return parseWebApiRegisters(snapshot);
    } catch (error) {
      webApiError = toError(error);
    }
  }

  try {
    const snapshot = await fetchEGaugeXmlSnapshot(access, `?m&n=${XML_INSPECTION_ROWS}`);
    return parseXmlRegisters(snapshot);
  } catch (xmlError) {
    throw buildFallbackError(
      "Unable to inspect eGauge registers.",
      webApiError,
      toError(xmlError),
      hasWebApiCredentials(access)
    );
  }
}

export async function fetchEGaugeRegisterHistory(
  access: ResolvedEGaugeAccess,
  registerIds: number[],
  startTs: number,
  deltaSeconds: number,
  endTs: number
): Promise<EGaugeRegisterHistoryResponse> {
  if (registerIds.length === 0) {
    throw new Error("At least one eGauge register must be selected");
  }

  const params = new URLSearchParams();
  params.set("reg", registerIds.join("+"));
  params.set("time", `${startTs}:${deltaSeconds}:${endTs}`);

  let webApiError: Error | null = null;

  if (hasWebApiCredentials(access)) {
    try {
      const jwt = await authenticateEGauge(access);
      return timedJsonFetch<EGaugeRegisterHistoryResponse>(`${access.baseUrl}/api/register?${params.toString()}`, {
        redirect: "error",
        headers: {
          Authorization: `Bearer ${jwt}`,
        },
      });
    } catch (error) {
      webApiError = toError(error);
    }
  }

  try {
    return await fetchEGaugeXmlHistory(access, registerIds, startTs, deltaSeconds, endTs);
  } catch (xmlError) {
    throw buildFallbackError(
      "Unable to fetch eGauge history.",
      webApiError,
      toError(xmlError),
      hasWebApiCredentials(access)
    );
  }
}

async function fetchEGaugeRegisterSnapshot(
  baseUrl: string,
  jwt: string
): Promise<EGaugeRegisterSnapshotResponse> {
  return timedJsonFetch<EGaugeRegisterSnapshotResponse>(`${baseUrl}/api/register?rate`, {
    redirect: "error",
    headers: {
      Authorization: `Bearer ${jwt}`,
    },
  });
}

function readRegisterRate(
  response: EGaugeRegisterSnapshotResponse,
  registerIndex: number
): number | null {
  const range = response.ranges?.[0];
  const row = range?.rows?.[0];
  if (!row) {
    return null;
  }

  return toFiniteNumber(row[registerIndex]);
}

function parseWebApiRegisters(snapshot: EGaugeRegisterSnapshotResponse): EGaugeRegisterInspection[] {
  const parsedRegisters: EGaugeRegisterInspection[] = [];
  const snapshotRegisters = snapshot.registers ?? [];
  for (let index = 0; index < snapshotRegisters.length; index += 1) {
    const register = snapshotRegisters[index];
    const idx = toFiniteNumber(register.idx);
    if (idx === null || !register.name || !register.type) {
      continue;
    }

    const currentRate = readRegisterRate(snapshot, index);
    parsedRegisters.push({
      idx,
      did: toFiniteNumber(register.did) ?? undefined,
      name: register.name,
      type: register.type,
      rate: currentRate ?? undefined,
      isRecommendedSolar:
        register.type === "P" && SOLAR_NAME_PATTERN.test(register.name),
    });
  }

  return sortInspectedRegisters(parsedRegisters);
}

function parseXmlRegisters(snapshot: EGaugeXmlSnapshotResponse): EGaugeRegisterInspection[] {
  const parsedRegisters = snapshot.registers.map((register) => ({
    idx: register.idx,
    name: register.name,
    type: register.type,
    rate: register.type === "P" ? readXmlRegisterRate(snapshot, register.idx) ?? undefined : undefined,
    isRecommendedSolar:
      register.type === "P" && SOLAR_NAME_PATTERN.test(register.name),
  }));

  return sortInspectedRegisters(parsedRegisters);
}

function sortInspectedRegisters(registers: EGaugeRegisterInspection[]): EGaugeRegisterInspection[] {
  return registers.sort((left, right) => {
    if (left.isRecommendedSolar !== right.isRecommendedSolar) {
      return left.isRecommendedSolar ? -1 : 1;
    }
    return left.name.localeCompare(right.name);
  });
}

function readXmlRegisterRate(
  response: EGaugeXmlSnapshotResponse,
  registerIndex: number
): number | null {
  const newerRow = response.rows[0];
  const olderRow = response.rows[1];
  if (!newerRow || !olderRow || response.timeDelta <= 0) {
    return null;
  }

  const newerValue = newerRow[registerIndex];
  const olderValue = olderRow[registerIndex];
  if (newerValue === null || olderValue === null) {
    return null;
  }

  return Math.abs(newerValue - olderValue) / response.timeDelta;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function hasWebApiCredentials(access: ResolvedEGaugeAccess): boolean {
  return Boolean(access.username?.trim() && access.password?.trim());
}

function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(typeof error === "string" ? error : "Unknown eGauge error");
}

function buildFallbackError(
  context: string,
  webApiError: Error | null,
  xmlError: Error,
  attemptedWebApi: boolean
): Error {
  if (!attemptedWebApi) {
    return new Error(
      `${context} Legacy XML fallback failed: ${xmlError.message}`
    );
  }

  return new Error(
    `${context} WebAPI failed: ${webApiError?.message ?? "Unknown WebAPI error"} Legacy XML fallback failed: ${xmlError.message}`
  );
}

async function fetchEGaugeXmlSnapshot(
  access: ResolvedEGaugeAccess,
  query: string
): Promise<EGaugeXmlSnapshotResponse> {
  const resourcePath = `/cgi-bin/egauge-show${query}`;
  const response = await fetchWithOptionalDigest(access, resourcePath);
  const rawBody = await response.text();

  if (!response.ok) {
    throw new Error(rawBody || `Legacy eGauge XML request failed with HTTP ${response.status}`);
  }

  return parseEGaugeXmlSnapshot(rawBody);
}

function parseEGaugeXmlSnapshot(rawXml: string): EGaugeXmlSnapshotResponse {
  const parsed = parseEGaugeXmlDocument(rawXml);
  const firstSection = parsed.sections[0];
  if (!firstSection) {
    throw new Error("Legacy eGauge XML response did not contain any data rows");
  }

  return {
    timeStamp: firstSection.timeStamp,
    timeDelta: firstSection.timeDelta,
    registers: parsed.registers,
    rows: firstSection.rows,
  };
}

function parseEGaugeXmlDocument(rawXml: string): ParsedEGaugeXmlDocument {
  const document = load(rawXml, { xmlMode: true });
  const dataNodes = document("group > data").toArray();
  if (dataNodes.length === 0) {
    throw new Error("Legacy eGauge XML response did not contain a <data> section");
  }

  const firstDataNode = document(dataNodes[0]);
  const registers = firstDataNode
    .children("cname")
    .toArray()
    .map((element, idx) => ({
      idx,
      name: document(element).text().trim(),
      type: document(element).attr("t")?.trim() ?? "",
    }))
    .filter((register) => register.name && register.type);

  if (registers.length === 0) {
    throw new Error("Legacy eGauge XML response did not contain any registers");
  }

  const sections = dataNodes.map((node) => {
    const dataNode = document(node);
    const timeStamp = toFiniteNumber(dataNode.attr("time_stamp"));
    const timeDelta = toFiniteNumber(dataNode.attr("time_delta"));
    if (timeStamp === null || timeDelta === null || timeDelta <= 0) {
      throw new Error("Legacy eGauge XML response did not contain valid timestamps");
    }

    const rows = dataNode
      .children("r")
      .toArray()
      .map((row) =>
        document(row)
          .children("c")
          .toArray()
          .map((cell) => toFiniteNumber(document(cell).text()))
      )
      .filter((row) => row.length > 0);

    if (rows.length === 0) {
      throw new Error("Legacy eGauge XML response did not contain any register rows");
    }

    return {
      timeStamp,
      timeDelta,
      rows,
    };
  });

  return {
    registers,
    sections,
  };
}

async function fetchEGaugeXmlHistory(
  access: ResolvedEGaugeAccess,
  registerIds: number[],
  startTs: number,
  deltaSeconds: number,
  endTs: number
): Promise<EGaugeRegisterHistoryResponse> {
  try {
    return await fetchEGaugeXmlHistoryByTimestamps(access, registerIds, startTs, deltaSeconds, endTs);
  } catch (timestampError) {
    console.warn(
      `[eGauge] XML timestamp history fetch failed, falling back to rolling history: ${toError(timestampError).message}`
    );
    return fetchEGaugeXmlHistoryRolling(access, registerIds, startTs, endTs);
  }
}

async function fetchEGaugeXmlHistoryByTimestamps(
  access: ResolvedEGaugeAccess,
  registerIds: number[],
  startTs: number,
  deltaSeconds: number,
  endTs: number
): Promise<EGaugeRegisterHistoryResponse> {
  const timestamps = buildTimestampSeries(startTs, endTs, deltaSeconds);
  if (timestamps.length < 2) {
    throw new Error("At least two timestamps are required to build hourly history");
  }

  const snapshots = new Map<number, Array<number | null>>();

  for (const timestampBatch of chunkArray(timestamps, XML_T_TIMESTAMP_BATCH_SIZE)) {
    const query = `?T=${timestampBatch.slice().reverse().join(",")}`;
    const resourcePath = `/cgi-bin/egauge-show${query}`;
    const response = await fetchWithOptionalDigest(access, resourcePath);
    const rawBody = await response.text();

    if (!response.ok) {
      throw new Error(rawBody || `Legacy eGauge XML request failed with HTTP ${response.status}`);
    }

    const parsed = parseEGaugeXmlDocument(rawBody);

    for (const section of parsed.sections) {
      const firstRow = section.rows[0];
      if (!firstRow) {
        continue;
      }

      const selectedRow = registerIds.map((registerId) => {
        if (registerId < 0 || registerId >= firstRow.length) {
          throw new Error(`Legacy XML register index ${registerId} was not found on the meter`);
        }
        return firstRow[registerId];
      });

      snapshots.set(section.timeStamp, selectedRow);
    }
  }

  const orderedSnapshots = Array.from(snapshots.entries())
    .sort((left, right) => right[0] - left[0]);

  if (orderedSnapshots.length < 2) {
    throw new Error("Legacy eGauge XML timestamp history did not return enough rows");
  }

  return {
    ranges: orderedSnapshots
      .slice(0, -1)
      .map(([newerTs, newerRow], index) => {
        const [olderTs, olderRow] = orderedSnapshots[index + 1]!;
        const delta = newerTs - olderTs;
        if (delta <= 0) {
          return null;
        }

        return {
          ts: newerTs,
          delta,
          rows: [newerRow, olderRow],
        };
      })
      .filter((range): range is NonNullable<typeof range> => range !== null),
  };
}

async function fetchEGaugeXmlHistoryRolling(
  access: ResolvedEGaugeAccess,
  registerIds: number[],
  startTs: number,
  endTs: number
): Promise<EGaugeRegisterHistoryResponse> {
  const hoursRequested = Math.max(
    48,
    Math.ceil((endTs - startTs) / 3600) + XML_HISTORY_BUFFER_HOURS
  );
  const snapshot = await fetchEGaugeXmlSnapshot(access, `?h&n=${hoursRequested}`);

  const selectedRows = snapshot.rows.map((row) =>
    registerIds.map((registerId) => {
      if (registerId < 0 || registerId >= row.length) {
        throw new Error(`Legacy XML register index ${registerId} was not found on the meter`);
      }
      return row[registerId];
    })
  );

  return {
    ranges: [
      {
        ts: snapshot.timeStamp,
        delta: snapshot.timeDelta,
        rows: selectedRows,
      },
    ],
  };
}

function buildTimestampSeries(
  startTs: number,
  endTs: number,
  deltaSeconds: number
): number[] {
  const timestamps: number[] = [];
  let cursor = startTs;

  while (cursor <= endTs) {
    timestamps.push(cursor);
    cursor += deltaSeconds;
  }

  if (timestamps[timestamps.length - 1] !== endTs) {
    timestamps.push(endTs);
  }

  return timestamps;
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

async function fetchWithOptionalDigest(
  access: ResolvedEGaugeAccess,
  resourcePath: string
): Promise<Response> {
  const initialResponse = await timedFetch(`${access.baseUrl}${resourcePath}`, {
    redirect: "error",
  });

  if (initialResponse.status !== 401) {
    return initialResponse;
  }

  const username = access.username?.trim();
  const password = access.password?.trim();
  const challenge = initialResponse.headers.get("www-authenticate");
  if (!username || !password || !challenge?.startsWith("Digest ")) {
    return initialResponse;
  }

  const digestHeader = buildDigestAuthHeader({
    challenge,
    username,
    password,
    method: "GET",
    uri: resourcePath,
  });

  return timedFetch(`${access.baseUrl}${resourcePath}`, {
    redirect: "error",
    headers: {
      Authorization: digestHeader,
    },
  });
}

function buildDigestAuthHeader(input: {
  challenge: string;
  username: string;
  password: string;
  method: string;
  uri: string;
}): string {
  const params = parseDigestChallenge(input.challenge);
  const realm = params.realm;
  const nonce = params.nonce;
  const qop = params.qop ?? "auth";
  if (!realm || !nonce) {
    throw new Error("Legacy eGauge XML API returned an incomplete digest challenge");
  }

  const cnonce = crypto.randomBytes(16).toString("hex");
  const nc = "00000001";
  const ha1 = crypto
    .createHash("md5")
    .update(`${input.username}:${realm}:${input.password}`)
    .digest("hex");
  const ha2 = crypto
    .createHash("md5")
    .update(`${input.method}:${input.uri}`)
    .digest("hex");
  const response = crypto
    .createHash("md5")
    .update(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    .digest("hex");

  const headerParts = [
    `Digest username="${escapeDigestValue(input.username)}"`,
    `realm="${escapeDigestValue(realm)}"`,
    `nonce="${escapeDigestValue(nonce)}"`,
    `uri="${escapeDigestValue(input.uri)}"`,
    `response="${response}"`,
    `qop=${qop}`,
    `nc=${nc}`,
    `cnonce="${cnonce}"`,
  ];

  if (params.opaque) {
    headerParts.push(`opaque="${escapeDigestValue(params.opaque)}"`);
  }
  if (params.algorithm) {
    headerParts.push(`algorithm=${params.algorithm}`);
  }

  return headerParts.join(", ");
}

function parseDigestChallenge(header: string): Record<string, string> {
  const digestValue = header.replace(/^Digest\s+/i, "");
  const params: Record<string, string> = {};
  const pattern = /([a-z0-9_-]+)=("([^"]*)"|[^,]+)/gi;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(digestValue)) !== null) {
    const key = match[1]?.toLowerCase();
    const rawValue = match[3] ?? match[2] ?? "";
    if (key) {
      params[key] = rawValue.replace(/^"|"$/g, "");
    }
  }

  return params;
}

function escapeDigestValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

async function timedJsonFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await timedFetch(input, init);
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `eGauge request failed with HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

async function timedFetch(input: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchAuthChallenge(baseUrl: string): Promise<EGaugeAuthChallenge> {
  const response = await timedFetch(`${baseUrl}/api/auth/unauthorized`, {
    redirect: "error",
  });

  const rawBody = await response.text();
  let parsedBody: EGaugeAuthChallenge;

  try {
    parsedBody = JSON.parse(rawBody) as EGaugeAuthChallenge;
  } catch {
    throw new Error(rawBody || `eGauge auth challenge failed with HTTP ${response.status}`);
  }

  if (response.status !== 401 || !parsedBody.rlm || !parsedBody.nnc) {
    throw new Error(parsedBody.error || rawBody || `eGauge auth challenge failed with HTTP ${response.status}`);
  }

  return parsedBody;
}

function normalizeEGaugeApiPath(pathname: string): string {
  const trimmedPath = pathname.replace(/\/+$/, "");
  if (!trimmedPath || trimmedPath === "/") {
    return "";
  }

  const segments = trimmedPath.split("/").filter(Boolean);
  if (segments.length === 0) {
    return "";
  }

  const leaf = segments[segments.length - 1].toLowerCase();
  if (leaf === "classic.html" || leaf === "index.html" || leaf === "lan.html" || leaf === "ng") {
    segments.pop();
  }

  if (segments.length === 0) {
    return "";
  }

  return `/${segments.join("/")}`;
}
