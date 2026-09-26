// Clasificador local (sin IA): usa los géneros que Spotify asigna al artista
// y palabras clave del título. Es la alternativa gratuita cuando no hay clave de Claude.

// Orden importa: la primera regla que coincide gana.
const GENERO_RULES = [
  ["K-Pop y J-Pop", ["k-pop", "kpop", "j-pop", "jpop", "anime", "j-rock", "k-rap"]],
  ["Regional Mexicano", ["regional mexican", "corrido", "banda", "norteño", "norteno", "mariachi", "ranchera", "sierreño", "sierreno", "grupero", "tumbado"]],
  ["Cumbia", ["cumbia"]],
  ["Salsa, Bachata y Tropical", ["salsa", "bachata", "merengue", "tropical", "vallenato", "son cubano", "timba", "kizomba"]],
  ["Reggaetón y Urbano", ["reggaeton", "reggaetón", "urbano", "latin trap", "trap latino", "dembow", "perreo", "moombahton", "dancehall", "neoperreo"]],
  ["Metal", ["metal", "metalcore", "deathcore", "djent", "hardcore"]],
  ["Rock en Español", ["rock en español", "rock en espanol", "latin rock", "rock argentino", "rock mexicano", "rock chileno", "rock colombiano", "rock uruguayo", "rock nacional"]],
  ["Trap y Hip-Hop", ["hip hop", "hip-hop", "rap", "trap", "drill", "grime", "boom bap"]],
  ["R&B y Soul", ["r&b", "rnb", "soul", "neo soul", "funk", "motown", "quiet storm"]],
  ["Electrónica", ["edm", "house", "techno", "trance", "electro", "dubstep", "drum and bass", "dnb", "future bass", "big room", "electronic", "electrónica", "synthwave", "lo-fi", "lofi", "phonk", "hardstyle"]],
  ["Jazz y Blues", ["jazz", "blues", "bossa nova", "swing"]],
  ["Country y Folk", ["country", "folk", "bluegrass", "americana", "cantautor", "singer-songwriter"]],
  ["Clásica e Instrumental", ["classical", "clásica", "orchestra", "soundtrack", "score", "piano", "instrumental", "ambient", "neoclassical"]],
  ["Baladas", ["balada", "bolero", "latin ballad", "romantic"]],
  ["Indie y Alternativo", ["indie", "alternative", "alternativo", "shoegaze", "dream pop", "bedroom pop", "post-punk", "emo"]],
  ["Rock", ["rock", "punk", "grunge", "britpop"]],
  ["Pop Latino", ["latin pop", "pop latino", "latin", "pop argentino", "pop mexicano", "pop colombiano", "pop chileno", "pop peruano", "pop venezolano", "spanish pop"]],
  ["Pop", ["pop", "dance pop", "boy band", "girl group"]],
];

// género -> [estilos, ánimos, ocasiones] por defecto
const PERFIL_GENERO = {
  "Reggaetón y Urbano": [["Bailable"], ["Fiestero", "Sensual"], ["Fiesta y Previa", "Con Amigos"]],
  "Trap y Hip-Hop": [["Intenso"], ["Enérgico", "Motivado"], ["Gym", "Manejar"]],
  Pop: [["Para cantar a gritos"], ["Feliz"], ["Ducha y Karaoke", "Caminar"]],
  "Pop Latino": [["Bailable", "Para cantar a gritos"], ["Feliz"], ["Ducha y Karaoke", "Con Amigos"]],
  Rock: [["Intenso", "Para cantar a gritos"], ["Enérgico"], ["Manejar", "Gym"]],
  "Rock en Español": [["Para cantar a gritos"], ["Nostálgico", "Enérgico"], ["Con Amigos", "Manejar"]],
  "Indie y Alternativo": [["Suave"], ["Nostálgico", "Tranquilo"], ["Caminar", "Trabajar"]],
  Metal: [["Intenso"], ["Rabia", "Enérgico"], ["Gym"]],
  Electrónica: [["Bailable"], ["Enérgico"], ["Fiesta y Previa", "Gym", "Trabajar"]],
  "R&B y Soul": [["Suave"], ["Sensual", "Romántico"], ["Cita y Cena", "Relajarse"]],
  "Salsa, Bachata y Tropical": [["Bailable"], ["Feliz", "Romántico"], ["Fiesta y Previa", "Con Amigos"]],
  Cumbia: [["Bailable"], ["Fiestero", "Feliz"], ["Fiesta y Previa", "Con Amigos"]],
  "Regional Mexicano": [["Para cantar a gritos"], ["Desamor", "Fiestero"], ["Con Amigos", "Manejar"]],
  Baladas: [["Suave", "Para cantar a gritos"], ["Romántico", "Nostálgico"], ["Cita y Cena", "Ducha y Karaoke"]],
  "Jazz y Blues": [["Suave"], ["Tranquilo"], ["Cita y Cena", "Relajarse", "Estudiar y Concentrarse"]],
  "Country y Folk": [["Acústico"], ["Nostálgico", "Tranquilo"], ["Manejar", "Caminar"]],
  "K-Pop y J-Pop": [["Bailable"], ["Feliz", "Enérgico"], ["Caminar", "Gym"]],
  "Clásica e Instrumental": [["Instrumental", "Épico"], ["Tranquilo"], ["Estudiar y Concentrarse", "Dormir"]],
  Otros: [[], [], []],
};

// Palabras en el título que suman ánimo/ocasión/estilo.
const KEYWORDS = [
  [/\b(acoustic|acústic[oa]|unplugged|desenchufado)\b/i, { estilo: ["Acústico", "Suave"] }],
  [/\b(remix|club mix|extended mix|edit)\b/i, { estilo: ["Bailable"], ocasion: ["Fiesta y Previa"] }],
  [/\b(live|en vivo|directo)\b/i, { estilo: ["Para cantar a gritos"] }],
  [/\b(instrumental)\b/i, { estilo: ["Instrumental"], ocasion: ["Estudiar y Concentrarse"] }],
  [/\b(sleep|dormir|lullaby|nana|night|noche)\b/i, { animo: ["Tranquilo"], ocasion: ["Dormir"] }],
  [/\b(love|amor|te quiero|te amo|corazón|corazon|besos?|kiss|beso|enamorad[oa])\b/i, { animo: ["Romántico"], ocasion: ["Cita y Cena"] }],
  [/\b(sad|triste|llorar|lágrimas|lagrimas|cry|tears|dolor|pain|soledad|lonely|alone|solo)\b/i, { animo: ["Triste"], ocasion: ["Relajarse"] }],
  [/\b(sin ti|without you|olvidarte|olvidar|adiós|adios|goodbye|ex|traición|traicion|mentiras?|perdón|perdon|te fuiste|volver)\b/i, { animo: ["Desamor"] }],
  [/\b(party|fiesta|baila|bailar|dance|perreo|rumba|disco|club|noche loca|borracho|drunk|shots?|tequila|copas?)\b/i, { animo: ["Fiestero"], estilo: ["Bailable"], ocasion: ["Fiesta y Previa"] }],
  [/\b(happy|feliz|alegr[ií]a|sunshine|sol|summer|verano|good vibes)\b/i, { animo: ["Feliz"], ocasion: ["Mañana y Despertar"] }],
  [/\b(fight|power|stronger|champion|campe[oó]n|run|fuego|fire|warrior|guerrero|never give up|rise|levántate|levantate)\b/i, { animo: ["Motivado"], ocasion: ["Gym"] }],
  [/\b(drive|driving|road|highway|carretera|ruta|car|carro|coche)\b/i, { ocasion: ["Manejar"] }],
  [/\b(morning|mañana|wake|despertar|sunrise|amanecer)\b/i, { ocasion: ["Mañana y Despertar"] }],
  [/\b(memories|recuerdos|remember|nostalgia|ayer|yesterday|old|antes)\b/i, { animo: ["Nostálgico"] }],
  [/\b(hate|odio|rage|rabia|angry|kill|mad)\b/i, { animo: ["Rabia"], estilo: ["Intenso"], ocasion: ["Gym"] }],
  [/\b(body|cuerpo|sexy|piel|cama|bed|desire|deseo)\b/i, { animo: ["Sensual"] }],
];

export function generoDesdeTags(tags) {
  const joined = tags.map((t) => t.toLowerCase());
  for (const [genero, needles] of GENERO_RULES) {
    if (joined.some((tag) => needles.some((n) => tag.includes(n)))) return genero;
  }
  return "Otros";
}

export function clasificarConReglas(track) {
  const genero = generoDesdeTags(track.genres);
  const [estilos, animos, ocasiones] = PERFIL_GENERO[genero].map((a) => [...a]);
  const add = (arr, vals) => vals?.forEach((v) => !arr.includes(v) && arr.push(v));
  const text = `${track.name} ${track.album}`;
  for (const [re, tags] of KEYWORDS) {
    if (re.test(text)) {
      add(estilos, tags.estilo);
      add(animos, tags.animo);
      add(ocasiones, tags.ocasion);
    }
  }
  // Canciones largas y suaves -> relajarse; cortas con energía -> gym
  if (animos.includes("Tranquilo") || animos.includes("Triste")) add(ocasiones, ["Relajarse"]);
  if (animos.includes("Enérgico") || animos.includes("Motivado")) add(ocasiones, ["Gym"]);
  return { genero, estilos, animos, ocasiones, fuente: "reglas" };
}
