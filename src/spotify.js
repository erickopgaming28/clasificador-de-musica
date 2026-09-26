// Cliente mínimo de la Web API de Spotify (Authorization Code + PKCE).
// Adaptado a los cambios de febrero 2026: playlists con /items, creación con
// POST /me/playlists y artistas pedidos de uno en uno (no hay endpoint por lotes).

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const API = "https://api.spotify.com/v1";
const ACCOUNTS = "https://accounts.spotify.com";
const TOKEN_FILE = path.resolve("data", "token.json");

export const SCOPES = [
  "user-library-read",
  "playlist-read-private",
  "playlist-read-collaborative",
  "playlist-modify-private",
  "playlist-modify-public",
].join(" ");

const b64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export class Spotify {
  constructor({ clientId, redirectUri }) {
    this.clientId = clientId;
    this.redirectUri = redirectUri;
    this.pending = new Map(); // state -> code_verifier
    this.token = null;
    try {
      this.token = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8"));
    } catch {}
  }

  get loggedIn() {
    return Boolean(this.token?.refresh_token);
  }

  authUrl() {
    const verifier = b64url(crypto.randomBytes(64));
    const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
    const state = b64url(crypto.randomBytes(16));
    this.pending.set(state, verifier);
    const params = new URLSearchParams({
      client_id: this.clientId,
      response_type: "code",
      redirect_uri: this.redirectUri,
      code_challenge_method: "S256",
      code_challenge: challenge,
      scope: SCOPES,
      state,
    });
    return `${ACCOUNTS}/authorize?${params}`;
  }

  async handleCallback(code, state) {
    const verifier = this.pending.get(state);
    if (!verifier) throw new Error("Estado OAuth inválido o caducado. Vuelve a iniciar sesión.");
    this.pending.delete(state);
    await this.#tokenRequest({
      grant_type: "authorization_code",
      code,
      redirect_uri: this.redirectUri,
      code_verifier: verifier,
    });
  }

  logout() {
    this.token = null;
    fs.rmSync(TOKEN_FILE, { force: true });
  }

  async #tokenRequest(body) {
    const res = await fetch(`${ACCOUNTS}/api/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: this.clientId, ...body }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(`Error de token de Spotify: ${json.error_description || json.error}`);
    this.token = {
      access_token: json.access_token,
      refresh_token: json.refresh_token || this.token?.refresh_token,
      expires_at: Date.now() + (json.expires_in - 60) * 1000,
    };
    fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(this.token));
  }

  async #accessToken() {
    if (!this.token) throw new Error("No has iniciado sesión en Spotify.");
    if (Date.now() >= this.token.expires_at) {
      await this.#tokenRequest({ grant_type: "refresh_token", refresh_token: this.token.refresh_token });
    }
    return this.token.access_token;
  }

  // Petición con reintentos para 429 (Retry-After) y errores 5xx.
  async request(method, urlOrPath, body) {
    const url = urlOrPath.startsWith("http") ? urlOrPath : `${API}${urlOrPath}`;
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${await this.#accessToken()}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.status === 429 && attempt < 6) {
        const wait = Number(res.headers.get("retry-after") || 2);
        await new Promise((r) => setTimeout(r, (wait + 0.5) * 1000));
        continue;
      }
      if (res.status >= 500 && attempt < 3) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      if (res.status === 204) return null;
      const text = await res.text();
      const json = text ? JSON.parse(text) : null;
      if (!res.ok) {
        const err = new Error(`Spotify ${res.status} en ${method} ${url}: ${json?.error?.message || text}`);
        err.status = res.status;
        throw err;
      }
      return json;
    }
  }

  async *paginate(pathWithQuery) {
    let next = pathWithQuery;
    while (next) {
      const page = await this.request("GET", next);
      yield page;
      next = page.next;
    }
  }

  me() {
    return this.request("GET", "/me");
  }

  async savedTracks(onProgress) {
    const out = [];
    for await (const page of this.paginate("/me/tracks?limit=50")) {
      for (const it of page.items) if (it.track?.id) out.push(it.track);
      onProgress?.(out.length, page.total);
    }
    return out;
  }

  async myPlaylists() {
    const out = [];
    for await (const page of this.paginate("/me/playlists?limit=50")) out.push(...page.items.filter(Boolean));
    return out;
  }

  async playlistTracks(playlistId) {
    const out = [];
    for await (const page of this.paginate(`/playlists/${playlistId}/items?limit=50`)) {
      for (const it of page.items) {
        const t = it.item ?? it.track; // "track" -> "item" en la API de 2026
        if (t?.type === "track" && t.id) out.push(t);
      }
    }
    return out;
  }

  artist(id) {
    return this.request("GET", `/artists/${id}`);
  }

  createPlaylist(name, description) {
    return this.request("POST", "/me/playlists", { name, description, public: false });
  }

  async addToPlaylist(playlistId, uris) {
    for (let i = 0; i < uris.length; i += 100) {
      await this.request("POST", `/playlists/${playlistId}/items`, { uris: uris.slice(i, i + 100) });
    }
  }
}
