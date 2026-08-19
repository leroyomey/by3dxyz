import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const TOKEN_URL = "https://api.etsy.com/v3/public/oauth/token";
const SCOPE = "listings_r";

export function redirectUri() {
  const raw = (process.env.ETSY_REDIRECT_URI || "https://by3dxyz.com/callback").trim().replace(/\/$/, "");
  return raw.endsWith("/callback") ? raw : `${raw}/callback`;
}

function envPath() {
  return join(root, ".env");
}

function clientId() {
  const key = (process.env.ETSY_API_KEY || "").trim();
  return key.includes(":") ? key.split(":")[0] : key;
}

function upsertEnv(updates) {
  const path = envPath();
  let text = existsSync(path) ? readFileSync(path, "utf8") : "";
  if (text.length && !text.endsWith("\n")) text += "\n";
  for (const [key, value] of Object.entries(updates)) {
    const line = `${key}=${value}`;
    const re = new RegExp(`^${key}=.*$`, "m");
    if (re.test(text)) text = text.replace(re, line);
    else text += `${line}\n`;
    process.env[key] = value;
  }
  writeFileSync(path, text);
}

function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

function openBrowser(url) {
  if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
  } else {
    spawn(process.platform === "darwin" ? "open" : "xdg-open", [url], {
      detached: true,
      stdio: "ignore",
    }).unref();
  }
}

function waitForCode(expectedState) {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url || "/", "http://127.0.0.1:3456");
      if (url.pathname !== "/callback") {
        res.writeHead(404);
        res.end();
        return;
      }
      const code = url.searchParams.get("code") || "";
      const state = url.searchParams.get("state") || "";
      const error = url.searchParams.get("error") || "";
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      if (error || !code || state !== expectedState) {
        res.end("<p>Etsy login did not finish. You can close this tab.</p>");
        server.close();
        reject(new Error(error || "Etsy did not return an authorization code."));
        return;
      }
      res.end("<p>by3DXYZ is linked. You can close this tab and go back to the terminal.</p>");
      server.close();
      resolve(code);
    });
    server.listen(3456, "127.0.0.1");
    server.on("error", reject);
  });
}

async function requestToken(body) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-api-key": clientId(),
    },
    body: new URLSearchParams(body).toString(),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Etsy token failed: ${res.status} ${json.error || json.error_description || ""}`.trim());
  }
  return json;
}

function saveTokens(json) {
  const expires = Date.now() + Number(json.expires_in || 3600) * 1000;
  const updates = {
    ETSY_ACCESS_TOKEN: json.access_token,
    ETSY_TOKEN_EXPIRES: String(expires),
  };
  if (json.refresh_token) updates.ETSY_REFRESH_TOKEN = json.refresh_token;
  for (const [key, value] of Object.entries(updates)) {
    process.env[key] = value;
  }
  if (process.env.CI) return;
  upsertEnv(updates);
}

export async function getAccessToken() {
  const access = (process.env.ETSY_ACCESS_TOKEN || "").trim();
  const refresh = (process.env.ETSY_REFRESH_TOKEN || "").trim();
  const expires = Number(process.env.ETSY_TOKEN_EXPIRES || 0);
  if (access && expires - 60_000 > Date.now()) return access;
  if (!refresh || !clientId()) return "";
  const json = await requestToken({
    grant_type: "refresh_token",
    client_id: clientId(),
    refresh_token: refresh,
  });
  saveTokens(json);
  return json.access_token || "";
}

export function stockKey(values) {
  return values
    .map((value) =>
      String(value || "")
        .toLowerCase()
        .replace(/inch(?:es)?/g, "in")
        .replace(/\s+/g, ""),
    )
    .filter(Boolean)
    .join("|");
}

export function inventoryToStock(inventory) {
  const stock = {};
  for (const product of inventory.products || []) {
    const offering =
      (product.offerings || []).find((row) => row.is_enabled !== false && row.is_deleted !== true) ||
      product.offerings?.[0];
    if (!offering) continue;
    const slots = { color: "", size: "", extra: [] };
    for (const pv of product.property_values || []) {
      const name = String(pv.property_name || "").toLowerCase();
      const value = String(pv.values?.[0] || "");
      if (/colou?r/.test(name)) slots.color = value;
      else if (/size/.test(name)) slots.size = value;
      else if (value) slots.extra.push(value);
    }
    const parts = [slots.color, slots.size, ...slots.extra].filter(Boolean);
    if (!parts.length) continue;
    stock[stockKey(parts)] = Number(offering.quantity) || 0;
  }
  return stock;
}

export async function fetchListingInventory(listingId, accessToken, apiKeyHeader) {
  const res = await fetch(`https://openapi.etsy.com/v3/application/listings/${listingId}/inventory`, {
    headers: {
      "x-api-key": apiKeyHeader,
      authorization: `Bearer ${accessToken}`,
    },
  });
  if (!res.ok) return null;
  return res.json();
}

export async function cmdEtsyAuth() {
  const id = clientId();
  if (!id) {
    console.error("Set ETSY_API_KEY in .env first.");
    process.exitCode = 1;
    return;
  }
  const callback = redirectUri();
  const state = randomBytes(16).toString("hex");
  const { verifier, challenge } = pkce();
  const connect = new URL("https://www.etsy.com/oauth/connect");
  connect.searchParams.set("response_type", "code");
  connect.searchParams.set("client_id", id);
  connect.searchParams.set("redirect_uri", callback);
  connect.searchParams.set("scope", SCOPE);
  connect.searchParams.set("state", state);
  connect.searchParams.set("code_challenge", challenge);
  connect.searchParams.set("code_challenge_method", "S256");

  console.log("1. Open the Open API app (not Etsy Ads) at https://www.etsy.com/developers/your-apps");
  console.log("2. Callback URL, exact, then Save:");
  console.log(`   ${callback}`);
  console.log("3. A browser window will open. Log in as the by3DXYZ shop and allow listings access.");
  console.log("   Keep this terminal open. Etsy sends you to by3dxyz.com, which hands the login back to this PC.");
  openBrowser(connect.toString());
  const code = await waitForCode(state);
  const json = await requestToken({
    grant_type: "authorization_code",
    client_id: id,
    redirect_uri: callback,
    code,
    code_verifier: verifier,
  });
  saveTokens(json);
  console.log("Shop linked. Tokens stayed in .env (not committed). Next: npm run catalog:sync");
}
