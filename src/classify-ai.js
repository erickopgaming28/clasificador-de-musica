// Clasificador con Claude: recibe lotes de canciones (título, artista, álbum, año,
// géneros del artista) y devuelve género, estilos, ánimos y ocasiones.

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { GENEROS, ESTILOS, ANIMOS, OCASIONES } from "./taxonomy.js";

const MODEL = "claude-opus-5";
const BATCH_SIZE = 40;

const Resultado = z.object({
  canciones: z.array(
    z.object({
      i: z.number().int(),
      genero: z.string(),
      estilos: z.array(z.string()),
      animos: z.array(z.string()),
      ocasiones: z.array(z.string()),
    }),
  ),
});

const SYSTEM = `Eres un curador musical experto en música latina y anglo. Clasificas canciones para armar playlists.
Para cada canción decide:
- genero: exactamente uno, el que mejor la describe.
- estilos: 1 a 3 que describan cómo suena.
- animos: 1 a 3 que describan la emoción que transmite (piensa en la letra y el tono, no solo en el género).
- ocasiones: 1 a 4 momentos en los que encaja de verdad. Sé generoso pero realista: una canción puede servir para varias ocasiones.
Usa tu conocimiento de la canción real si la conoces; si no, infiere a partir del artista, el título y los géneros.
Devuelve una entrada por cada canción, usando su índice "i".
Usa SOLO estos valores, escritos exactamente igual:
- genero: ${GENEROS.join(" | ")}
- estilos: ${ESTILOS.join(" | ")}
- animos: ${ANIMOS.join(" | ")}
- ocasiones: ${OCASIONES.join(" | ")}`;

// Acepta solo valores válidos (ignorando mayúsculas/acentos) y descarta el resto.
const norm = (s) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
function filtrar(valores, permitidos, max) {
  const mapa = new Map(permitidos.map((v) => [norm(v), v]));
  return [...new Set(valores.map((v) => mapa.get(norm(v))).filter(Boolean))].slice(0, max);
}

export function aiDisponible() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export async function clasificarConIA(tracks, { onProgress, concurrency = 3 } = {}) {
  const client = new Anthropic();
  const lotes = [];
  for (let i = 0; i < tracks.length; i += BATCH_SIZE) lotes.push(tracks.slice(i, i + BATCH_SIZE));

  const resultados = new Map();
  let hechos = 0;

  async function procesar(lote) {
    const payload = lote.map((t, i) => ({
      i,
      titulo: t.name,
      artistas: t.artists.map((a) => a.name).join(", "),
      album: t.album,
      año: t.year,
      generos_artista: t.genres.slice(0, 6),
    }));
    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: "low", format: zodOutputFormat(Resultado) },
      system: SYSTEM,
      messages: [{ role: "user", content: JSON.stringify(payload) }],
    });
    if (response.stop_reason === "refusal" || !response.parsed_output) {
      throw new Error(`Claude no devolvió una clasificación válida (stop_reason: ${response.stop_reason})`);
    }
    for (const c of response.parsed_output.canciones) {
      const t = lote[c.i];
      if (!t) continue;
      resultados.set(t.id, {
        genero: filtrar([c.genero], GENEROS, 1)[0] || "Otros",
        estilos: filtrar(c.estilos, ESTILOS, 3),
        animos: filtrar(c.animos, ANIMOS, 3),
        ocasiones: filtrar(c.ocasiones, OCASIONES, 4),
        fuente: "ia",
      });
    }
    hechos += lote.length;
    onProgress?.(hechos, tracks.length);
  }

  // Cola simple con concurrencia limitada. Si un lote falla, lo dejamos sin
  // clasificar y el llamador aplicará reglas locales a esas canciones.
  const errores = [];
  const cola = [...lotes];
  await Promise.all(
    Array.from({ length: Math.min(concurrency, cola.length) }, async () => {
      while (cola.length) {
        const lote = cola.shift();
        try {
          await procesar(lote);
        } catch (err) {
          errores.push(err);
          hechos += lote.length;
          onProgress?.(hechos, tracks.length);
          if (err instanceof Anthropic.AuthenticationError) throw err;
        }
      }
    }),
  );
  return { resultados, errores };
}
