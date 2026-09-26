import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { Spotify } from "./spotify.js";
import { clasificarConReglas } from "./classify-rules.js";
import { aiDisponible, clasificarConIA } from "./classify-ai.js";
import { CATEGORIAS, epocaDe } from "./taxonomy.js";

const PORT = Number(process.env.PORT || 8888);
const REDIRECT_URI = `http://127.0.0.1:${PORT}/callback`;
const DATA_DIR = path.resolve("data");
const CACHE_FILE = path.join(DATA_DIR, "cache.json");
const LIB_FILE = path.join(DATA_DIR, "biblioteca.json");
const PUBLIC_DIR = path.resolve("public");
// Marca que ponemos en la descripción de las playlists creadas por la app,
// para no volver a leerlas como fuente al re-escanear.
const MARCA = "· hecha con Clasificador de Música";

const spotify = new Spotify({ clientId: process.env.SPOTIFY_CLIENT_ID, redirectUri: REDIRECT_URI });

fs.mkdirSync(DATA_DIR, { recursive: true });
const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
};
const cache = readJson(CACHE_FILE, { artistas: {}, clasif: {} });
const saveCache = () => fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
let biblioteca = readJson(LIB_FILE, null);
let usuario = null;

// ---------- Trabajos en segundo plano (escaneo y creación) ----------

let job = null;
function nuevoJob(tipo) {
  job = { tipo, fase: "Empezando…", hecho: 0, total: 0, log: [], error: null, terminado: false, resultado: null };
  return job;
}
const log = (msg) => {
  job.log.push(msg);
  console.log(msg);
};

async function mapLimit(items, limit, fn) {
  const cola = [...items];
  await Promise.all(
    Array.from({ length: Math.min(limit, cola.length) }, async () => {
      while (cola.length) await fn(cola.shift());
    }),
  );
}

async function escanear({ incluirPlaylists, reclasificar }) {
  const j = nuevoJob("escaneo");
  try {
    usuario = await spotify.me();

    j.fase = "Leyendo tus canciones que te gustan";
    const guardadas = await spotify.savedTracks((n, total) => {
      j.hecho = n;
      j.total = total;
    });
    log(`❤️  ${guardadas.length} canciones en "Tus me gusta"`);

    const porId = new Map();
    const agregar = (t, fuente) => {
      if (!porId.has(t.id)) porId.set(t.id, { raw: t, fuentes: [] });
      const e = porId.get(t.id);
      if (!e.fuentes.includes(fuente)) e.fuentes.push(fuente);
    };
    guardadas.forEach((t) => agregar(t, "Tus me gusta"));

    if (incluirPlaylists) {
      j.fase = "Leyendo tus playlists";
      const pls = (await spotify.myPlaylists()).filter(
        (p) => p.owner?.id === usuario.id && !/(Clasificador de Música|Ordenador de Spotify)/.test(p.description || ""),
      );
      j.hecho = 0;
      j.total = pls.length;
      for (const p of pls) {
        try {
          const ts = await spotify.playlistTracks(p.id);
          ts.forEach((t) => agregar(t, p.name));
          log(`📁 ${p.name}: ${ts.length} canciones`);
        } catch (err) {
          log(`⚠️  No pude leer "${p.name}" (${err.status || err.message})`);
        }
        j.hecho++;
      }
    }

    // Géneros de cada artista (uno a uno: la API ya no permite pedirlos por lotes).
    const artistIds = [...new Set([...porId.values()].flatMap((e) => e.raw.artists.map((a) => a.id)).filter(Boolean))];
    const faltan = artistIds.filter((id) => !(id in cache.artistas));
    j.fase = "Buscando los géneros de cada artista";
    j.hecho = 0;
    j.total = faltan.length;
    await mapLimit(faltan, 4, async (id) => {
      try {
        const a = await spotify.artist(id);
        cache.artistas[id] = a.genres || [];
      } catch {
        cache.artistas[id] = [];
      }
      if (++j.hecho % 25 === 0) saveCache();
    });
    saveCache();

    const tracks = [...porId.values()].map(({ raw, fuentes }) => ({
      id: raw.id,
      uri: raw.uri,
      name: raw.name,
      artists: raw.artists.map((a) => ({ id: a.id, name: a.name })),
      album: raw.album?.name || "",
      year: parseInt(String(raw.album?.release_date || "").slice(0, 4), 10) || null,
      image: raw.album?.images?.at(-1)?.url || raw.album?.images?.[0]?.url || null,
      genres: [...new Set(raw.artists.flatMap((a) => cache.artistas[a.id] || []))],
      epoca: epocaDe(raw.album?.release_date),
      fuentes,
    }));
    log(`🎵 ${tracks.length} canciones únicas en total`);

    // Clasificación: reutiliza caché; con IA disponible, reclasifica lo que antes se hizo con reglas.
    const ia = aiDisponible();
    const pendientes = tracks.filter((t) => {
      const c = cache.clasif[t.id];
      if (!c || reclasificar) return true;
      return ia && c.fuente !== "ia";
    });
    if (pendientes.length) {
      if (ia) {
        j.fase = "Clasificando con IA (Claude)";
        j.hecho = 0;
        j.total = pendientes.length;
        const { resultados, errores } = await clasificarConIA(pendientes, {
          onProgress: (n) => {
            j.hecho = n;
          },
        });
        for (const [id, c] of resultados) cache.clasif[id] = c;
        if (errores.length) log(`⚠️  ${errores.length} lote(s) fallaron con IA, se usan reglas locales: ${errores[0].message}`);
      } else {
        log("ℹ️  Sin ANTHROPIC_API_KEY: clasificando con reglas locales");
      }
      for (const t of pendientes) if (!cache.clasif[t.id] || (reclasificar && !ia)) cache.clasif[t.id] = clasificarConReglas(t);
      saveCache();
    }

    for (const t of tracks) Object.assign(t, cache.clasif[t.id]);
    biblioteca = { creado: new Date().toISOString(), usuario: usuario.display_name || usuario.id, tracks };
    fs.writeFileSync(LIB_FILE, JSON.stringify(biblioteca));
    j.fase = "¡Listo!";
    log("✅ Biblioteca clasificada");
  } catch (err) {
    j.error = err.message;
    console.error(err);
  } finally {
    j.terminado = true;
  }
}

// ---------- Construcción del plan de playlists ----------

function construirPlan(min) {
  if (!biblioteca) return null;
  const grupos = new Map();
  const meter = (cat, valor, t) => {
    if (!valor) return;
    const key = `${cat}:${valor}`;
    if (!grupos.has(key)) grupos.set(key, { key, categoria: cat, valor, tracks: [] });
    grupos.get(key).tracks.push(t.id);
  };
  for (const t of biblioteca.tracks) {
    meter("genero", t.genero, t);
    t.estilos?.forEach((v) => meter("estilo", v, t));
    t.animos?.forEach((v) => meter("animo", v, t));
    t.ocasiones?.forEach((v) => meter("ocasion", v, t));
    meter("epoca", t.epoca, t);
  }

  // Mezclas: ánimo + ocasión que aparecen juntos muchas veces (p. ej. "Triste · Manejar").
  const mezclas = new Map();
  for (const t of biblioteca.tracks) {
    for (const a of t.animos || [])
      for (const o of t.ocasiones || []) {
        const k = `${a} · ${o}`;
        if (!mezclas.has(k)) mezclas.set(k, []);
        mezclas.get(k).push(t.id);
      }
  }
  [...mezclas.entries()]
    .filter(([, ids]) => ids.length >= Math.max(min * 2, 12))
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 12)
    .forEach(([valor, ids]) => grupos.set(`mezcla:${valor}`, { key: `mezcla:${valor}`, categoria: "mezcla", valor, tracks: ids }));

  const cats = { ...CATEGORIAS, mezcla: { titulo: "Mezclas", emoji: "✨" } };
  const playlists = [...grupos.values()]
    .filter((g) => g.tracks.length >= min)
    .map((g) => ({
      ...g,
      nombre: `${cats[g.categoria].emoji} ${g.valor}`,
      descripcion: `${cats[g.categoria].titulo}: ${g.valor} ${MARCA}`,
    }));
  const orden = Object.keys(cats);
  playlists.sort((a, b) => orden.indexOf(a.categoria) - orden.indexOf(b.categoria) || b.tracks.length - a.tracks.length);

  const tracksById = Object.fromEntries(biblioteca.tracks.map((t) => [t.id, t]));
  return { creado: biblioteca.creado, usuario: biblioteca.usuario, categorias: cats, playlists, tracks: tracksById };
}

async function crearPlaylists(lista) {
  const j = nuevoJob("creacion");
  j.total = lista.length;
  j.fase = "Creando playlists en Spotify";
  const creadas = [];
  try {
    for (const p of lista) {
      const descripcion = p.descripcion.includes(MARCA) ? p.descripcion : `${p.descripcion} ${MARCA}`;
      const pl = await spotify.createPlaylist(p.nombre.slice(0, 100), descripcion.slice(0, 300));
      await spotify.addToPlaylist(pl.id, p.uris);
      creadas.push({ nombre: p.nombre, url: pl.external_urls?.spotify, canciones: p.uris.length });
      log(`➕ ${p.nombre} (${p.uris.length})`);
      j.hecho++;
    }
    j.fase = "¡Listo!";
  } catch (err) {
    j.error = err.message;
    console.error(err);
  } finally {
    j.resultado = creadas;
    j.terminado = true;
  }
}

// ---------- HTTP ----------

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };

function send(res, status, body, headers = {}) {
  const isJson = typeof body !== "string" && !Buffer.isBuffer(body);
  res.writeHead(status, { "Content-Type": isJson ? "application/json; charset=utf-8" : "text/plain; charset=utf-8", ...headers });
  res.end(isJson ? JSON.stringify(body) : body);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  try {
    if (url.pathname === "/login") {
      if (!process.env.SPOTIFY_CLIENT_ID) return send(res, 400, "Falta SPOTIFY_CLIENT_ID en el archivo .env");
      res.writeHead(302, { Location: spotify.authUrl() });
      return res.end();
    }
    if (url.pathname === "/callback") {
      if (url.searchParams.get("error")) return send(res, 400, `Spotify rechazó el acceso: ${url.searchParams.get("error")}`);
      await spotify.handleCallback(url.searchParams.get("code"), url.searchParams.get("state"));
      res.writeHead(302, { Location: "/" });
      return res.end();
    }
    if (url.pathname === "/api/estado") {
      if (spotify.loggedIn && !usuario) usuario = await spotify.me().catch(() => null);
      return send(res, 200, {
        configurado: Boolean(process.env.SPOTIFY_CLIENT_ID),
        redirectUri: REDIRECT_URI,
        loggedIn: spotify.loggedIn,
        usuario: usuario && { nombre: usuario.display_name || usuario.id },
        ia: aiDisponible(),
        biblioteca: biblioteca && { creado: biblioteca.creado, canciones: biblioteca.tracks.length },
        job,
      });
    }
    if (url.pathname === "/api/logout" && req.method === "POST") {
      spotify.logout();
      usuario = null;
      return send(res, 200, { ok: true });
    }
    if (url.pathname === "/api/escanear" && req.method === "POST") {
      if (job && !job.terminado) return send(res, 409, { error: "Ya hay un proceso en marcha" });
      const body = await readBody(req);
      escanear({ incluirPlaylists: body.incluirPlaylists !== false, reclasificar: Boolean(body.reclasificar) });
      return send(res, 202, { ok: true });
    }
    if (url.pathname === "/api/plan") {
      const plan = construirPlan(Math.max(1, Number(url.searchParams.get("min") || 5)));
      return plan ? send(res, 200, plan) : send(res, 404, { error: "Aún no has escaneado tu biblioteca" });
    }
    if (url.pathname === "/api/crear" && req.method === "POST") {
      if (job && !job.terminado) return send(res, 409, { error: "Ya hay un proceso en marcha" });
      const { playlists } = await readBody(req);
      if (!Array.isArray(playlists) || !playlists.length) return send(res, 400, { error: "No hay playlists seleccionadas" });
      crearPlaylists(playlists);
      return send(res, 202, { ok: true });
    }

    // Archivos estáticos
    const file = path.join(PUBLIC_DIR, url.pathname === "/" ? "index.html" : url.pathname);
    if (file.startsWith(PUBLIC_DIR) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      return send(res, 200, fs.readFileSync(file), { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    }
    send(res, 404, "No encontrado");
  } catch (err) {
    console.error(err);
    send(res, 500, { error: err.message });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`\n🎧 Clasificador de Música listo en http://127.0.0.1:${PORT}\n`);
  if (!process.env.SPOTIFY_CLIENT_ID) console.log("⚠️  Falta SPOTIFY_CLIENT_ID: copia .env.example a .env y rellénalo.");
  console.log(aiDisponible() ? "🤖 Clasificación con IA activada" : "ℹ️  Sin ANTHROPIC_API_KEY: se usarán reglas locales");
});
