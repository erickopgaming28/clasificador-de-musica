const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const state = {
  estado: null,
  plan: null,
  tab: "todas",
  min: 5,
  buscar: "",
  seleccion: new Set(),
  nombres: {}, // key -> nombre editado
  quitadas: {}, // key -> Set(trackId)
  abierta: null,
};
let polling = null;

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: opts.body ? { "Content-Type": "application/json" } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Error ${res.status}`);
  return json;
}

// ---------- Estado general ----------

async function refrescarEstado() {
  const e = (state.estado = await api("/api/estado"));
  $("#user").innerHTML = e.loggedIn
    ? `<span>${esc(e.usuario?.nombre || "Conectado")}</span> <span title="Clasificación">${e.ia ? "🤖 IA activada" : "📏 Reglas locales"}</span> <button class="btn ghost" id="logout">Salir</button>`
    : "";
  $("#logout")?.addEventListener("click", async () => {
    await api("/api/logout", { method: "POST" });
    location.reload();
  });

  const setup = $("#setup");
  if (!e.configurado || !e.loggedIn) {
    setup.classList.remove("hidden");
    $("#setup-body").innerHTML = e.configurado
      ? `<p class="muted">Inicia sesión para que la app pueda leer tus canciones y crear las playlists nuevas.</p>
         <p style="margin-top:14px"><a class="btn primary" href="/login">Iniciar sesión con Spotify</a></p>`
      : `<ol>
           <li>Entra a <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noopener">developer.spotify.com/dashboard</a> y crea una app.</li>
           <li>En <b>Redirect URIs</b> añade exactamente: <code>${esc(e.redirectUri)}</code> y marca <b>Web API</b>.</li>
           <li>Copia el <b>Client ID</b> en el archivo <code>.env</code> (ver <code>.env.example</code>).</li>
           <li>Reinicia la app con <code>npm start</code> y recarga esta página.</li>
         </ol>`;
  } else setup.classList.add("hidden");

  $("#scan").classList.toggle("hidden", !e.loggedIn);
  $("#scan-info").textContent = e.biblioteca
    ? `Último análisis: ${new Date(e.biblioteca.creado).toLocaleString()} · ${e.biblioteca.canciones} canciones. Puedes volver a escanear cuando añadas música.`
    : "Lee tus canciones, busca el género de cada artista y clasifica cada tema por estilo, ánimo y ocasión.";

  mostrarJob(e.job);
  if (e.job && !e.job.terminado) iniciarPolling();
  return e;
}

function mostrarJob(job) {
  const box = $("#progress");
  if (!job) return box.classList.add("hidden");
  box.classList.remove("hidden");
  $("#progress-fase").textContent = job.error ? `❌ ${job.error}` : job.fase;
  $("#progress-num").textContent = job.total ? `${job.hecho} / ${job.total}` : "";
  $("#progress-bar").style.width = job.terminado && !job.error ? "100%" : job.total ? `${Math.round((job.hecho / job.total) * 100)}%` : "5%";
  const logEl = $("#progress-log");
  logEl.textContent = job.log.join("\n");
  logEl.scrollTop = logEl.scrollHeight;
  $("#btn-scan").disabled = !job.terminado;
  $("#btn-crear").disabled = !job.terminado;

  if (job.tipo === "creacion" && job.terminado && job.resultado?.length) {
    logEl.innerHTML =
      `<b>Playlists creadas:</b><div class="done-list">` +
      job.resultado.map((p) => `<div>✅ <a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.nombre)}</a> · ${p.canciones} canciones</div>`).join("") +
      `</div>` +
      (job.error ? `<p style="color:var(--danger)">Se detuvo por un error: ${esc(job.error)}</p>` : "");
  }
}

function iniciarPolling() {
  if (polling) return;
  polling = setInterval(async () => {
    const e = await api("/api/estado");
    state.estado = e;
    mostrarJob(e.job);
    if (e.job?.terminado) {
      clearInterval(polling);
      polling = null;
      if (e.job.tipo === "escaneo" && !e.job.error) {
        state.seleccion.clear();
        await refrescarEstado();
        await cargarPlan(true);
      }
      if (e.job.tipo === "creacion") $("#progress").scrollIntoView({ behavior: "smooth" });
    }
  }, 900);
}

// ---------- Plan ----------

async function cargarPlan(seleccionarTodo = false) {
  try {
    state.plan = await api(`/api/plan?min=${state.min}`);
  } catch {
    return;
  }
  if (seleccionarTodo || !state.seleccion.size) state.plan.playlists.forEach((p) => state.seleccion.add(p.key));
  $("#results").classList.remove("hidden");
  $("#bar").classList.remove("hidden");
  pintarTabs();
  pintar();
}

function tracksDe(p) {
  const fuera = state.quitadas[p.key];
  return fuera ? p.tracks.filter((id) => !fuera.has(id)) : p.tracks;
}
const nombreDe = (p) => state.nombres[p.key] ?? p.nombre;

function pintarTabs() {
  const cats = state.plan.categorias;
  const tabs = [["todas", "Todas"], ...Object.entries(cats).map(([k, c]) => [k, `${c.emoji} ${c.titulo}`])];
  $("#tabs").innerHTML = tabs
    .map(([k, t]) => `<button class="tab" data-tab="${k}" aria-pressed="${state.tab === k}">${esc(t)}</button>`)
    .join("");
}

function visibles() {
  const q = state.buscar.toLowerCase();
  return state.plan.playlists.filter(
    (p) => (state.tab === "todas" || p.categoria === state.tab) && (!q || nombreDe(p).toLowerCase().includes(q)),
  );
}

function portada(p) {
  const imgs = [];
  const vistos = new Set();
  for (const id of tracksDe(p)) {
    const img = state.plan.tracks[id]?.image;
    if (img && !vistos.has(img)) {
      vistos.add(img);
      imgs.push(img);
    }
    if (imgs.length === 4) break;
  }
  if (imgs.length < 4) return `<div class="cover single">${imgs[0] ? `<img src="${esc(imgs[0])}" alt="" loading="lazy">` : ""}</div>`;
  return `<div class="cover">${imgs.map((i) => `<img src="${esc(i)}" alt="" loading="lazy">`).join("")}</div>`;
}

function pintar() {
  const { plan } = state;
  const total = Object.keys(plan.tracks).length;
  const sel = plan.playlists.filter((p) => state.seleccion.has(p.key));
  const iaCount = Object.values(plan.tracks).filter((t) => t.fuente === "ia").length;
  $("#stats").innerHTML = [
    [total, "canciones analizadas"],
    [plan.playlists.length, "playlists propuestas"],
    [sel.length, "seleccionadas"],
    [iaCount ? `${Math.round((iaCount / total) * 100)}%` : "0%", "clasificadas con IA"],
  ]
    .map(([b, s]) => `<div class="stat"><b>${b}</b><span>${s}</span></div>`)
    .join("");

  const lista = visibles();
  let html = "";
  let catActual = null;
  for (const p of lista) {
    if (p.categoria !== catActual) {
      catActual = p.categoria;
      const c = plan.categorias[catActual];
      html += `<h3 class="cat-title">${c.emoji} ${esc(c.titulo)}</h3>`;
    }
    const on = state.seleccion.has(p.key);
    html += `<article class="pl ${on ? "on" : "off"}" data-key="${esc(p.key)}">
      ${portada(p)}
      <button class="pl-toggle" data-toggle="${esc(p.key)}" aria-label="${on ? "Quitar" : "Seleccionar"}">${on ? "✓" : ""}</button>
      <div><div class="pl-name">${esc(nombreDe(p))}</div><div class="pl-meta">${tracksDe(p).length} canciones</div></div>
    </article>`;
  }
  $("#grid").innerHTML = html || `<p class="muted">No hay playlists con este filtro.</p>`;

  const canciones = sel.reduce((n, p) => n + tracksDe(p).length, 0);
  $("#bar-info").textContent = `${sel.length} playlists · ${canciones} canciones en total (las canciones se repiten entre playlists)`;
  $("#btn-crear").textContent = `Crear ${sel.length} playlists en Spotify`;
  $("#btn-crear").disabled = !sel.length || (state.estado?.job && !state.estado.job.terminado);
}

// ---------- Modal de detalle ----------

function abrir(key) {
  const p = state.plan.playlists.find((x) => x.key === key);
  state.abierta = p;
  $("#modal-nombre").value = nombreDe(p);
  pintarModal();
  $("#modal").showModal();
}

function pintarModal() {
  const p = state.abierta;
  const fuera = state.quitadas[p.key] || new Set();
  $("#modal-info").textContent = `${p.tracks.length - fuera.size} de ${p.tracks.length} canciones · pulsa ✕ para quitar una canción de esta playlist`;
  $("#modal-lista").innerHTML = p.tracks
    .map((id) => {
      const t = state.plan.tracks[id];
      const tags = [t.genero, ...(t.animos || []), ...(t.ocasiones || [])].join(" · ");
      return `<li class="${fuera.has(id) ? "removed" : ""}">
        <img src="${esc(t.image || "")}" alt="" loading="lazy">
        <div><div class="t">${esc(t.name)}</div><div class="a">${esc(t.artists.map((a) => a.name).join(", "))}${t.year ? ` · ${t.year}` : ""}</div><div class="tags">${esc(tags)}</div></div>
        <button class="x" data-quitar="${esc(id)}" title="${fuera.has(id) ? "Volver a añadir" : "Quitar"}">${fuera.has(id) ? "↺" : "✕"}</button>
      </li>`;
    })
    .join("");
}

// ---------- Eventos ----------

$("#btn-scan").addEventListener("click", async () => {
  try {
    await api("/api/escanear", {
      method: "POST",
      body: { incluirPlaylists: $("#opt-playlists").checked, reclasificar: $("#opt-reclasificar").checked },
    });
    $("#progress").classList.remove("hidden");
    iniciarPolling();
  } catch (err) {
    alert(err.message);
  }
});

$("#tabs").addEventListener("click", (e) => {
  const b = e.target.closest("[data-tab]");
  if (!b) return;
  state.tab = b.dataset.tab;
  pintarTabs();
  pintar();
});

let minTimer;
$("#min").addEventListener("input", (e) => {
  state.min = Number(e.target.value);
  $("#min-val").textContent = state.min;
  clearTimeout(minTimer);
  minTimer = setTimeout(() => cargarPlan(), 200);
});

$("#buscar").addEventListener("input", (e) => {
  state.buscar = e.target.value;
  pintar();
});

$("#sel-todo").addEventListener("click", () => {
  visibles().forEach((p) => state.seleccion.add(p.key));
  pintar();
});
$("#sel-nada").addEventListener("click", () => {
  visibles().forEach((p) => state.seleccion.delete(p.key));
  pintar();
});

$("#grid").addEventListener("click", (e) => {
  const t = e.target.closest("[data-toggle]");
  if (t) {
    const k = t.dataset.toggle;
    state.seleccion.has(k) ? state.seleccion.delete(k) : state.seleccion.add(k);
    return pintar();
  }
  const card = e.target.closest(".pl");
  if (card) abrir(card.dataset.key);
});

$("#modal-lista").addEventListener("click", (e) => {
  const b = e.target.closest("[data-quitar]");
  if (!b) return;
  const key = state.abierta.key;
  const set = (state.quitadas[key] ||= new Set());
  set.has(b.dataset.quitar) ? set.delete(b.dataset.quitar) : set.add(b.dataset.quitar);
  pintarModal();
});
$("#modal-nombre").addEventListener("input", (e) => {
  state.nombres[state.abierta.key] = e.target.value;
});
$("#modal-cerrar").addEventListener("click", () => $("#modal").close());
$("#modal").addEventListener("close", () => pintar());

$("#btn-crear").addEventListener("click", async () => {
  const sel = state.plan.playlists.filter((p) => state.seleccion.has(p.key) && tracksDe(p).length);
  if (!sel.length) return;
  const ok = confirm(
    `Se van a crear ${sel.length} playlists nuevas (privadas) en tu cuenta de Spotify.\n\nTus playlists actuales NO se tocan.\n\n¿Continuar?`,
  );
  if (!ok) return;
  try {
    await api("/api/crear", {
      method: "POST",
      body: {
        playlists: sel.map((p) => ({
          nombre: nombreDe(p),
          descripcion: p.descripcion,
          uris: tracksDe(p).map((id) => state.plan.tracks[id].uri),
        })),
      },
    });
    $("#progress").classList.remove("hidden");
    $("#scan").scrollIntoView({ behavior: "smooth" });
    iniciarPolling();
  } catch (err) {
    alert(err.message);
  }
});

// ---------- Inicio ----------
const e = await refrescarEstado();
if (e.biblioteca) cargarPlan();
