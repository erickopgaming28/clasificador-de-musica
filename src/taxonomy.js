// Categorías fijas. Una canción tiene 1 género, pero puede tener varios estilos,
// ánimos y ocasiones: por eso una misma canción aparece en varias playlists.

export const GENEROS = [
  "Reggaetón y Urbano",
  "Trap y Hip-Hop",
  "Pop",
  "Pop Latino",
  "Rock",
  "Rock en Español",
  "Indie y Alternativo",
  "Metal",
  "Electrónica",
  "R&B y Soul",
  "Salsa, Bachata y Tropical",
  "Cumbia",
  "Regional Mexicano",
  "Baladas",
  "Jazz y Blues",
  "Country y Folk",
  "K-Pop y J-Pop",
  "Clásica e Instrumental",
  "Otros",
];

export const ESTILOS = [
  "Bailable",
  "Acústico",
  "Intenso",
  "Suave",
  "Para cantar a gritos",
  "Instrumental",
  "Épico",
];

export const ANIMOS = [
  "Feliz",
  "Enérgico",
  "Motivado",
  "Tranquilo",
  "Romántico",
  "Sensual",
  "Triste",
  "Desamor",
  "Nostálgico",
  "Rabia",
  "Fiestero",
];

export const OCASIONES = [
  "Gym",
  "Fiesta y Previa",
  "Estudiar y Concentrarse",
  "Trabajar",
  "Dormir",
  "Manejar",
  "Mañana y Despertar",
  "Cita y Cena",
  "Ducha y Karaoke",
  "Relajarse",
  "Caminar",
  "Con Amigos",
];

export const CATEGORIAS = {
  genero: { titulo: "Género", emoji: "🎸" },
  estilo: { titulo: "Estilo", emoji: "🎚️" },
  animo: { titulo: "Ánimo", emoji: "💭" },
  ocasion: { titulo: "Ocasión", emoji: "📍" },
  epoca: { titulo: "Época", emoji: "📼" },
};

export function epocaDe(releaseDate) {
  const year = parseInt(String(releaseDate || "").slice(0, 4), 10);
  if (!year) return null;
  if (year < 1980) return "Clásicos (antes de los 80)";
  if (year < 1990) return "Los 80";
  if (year < 2000) return "Los 90";
  if (year < 2010) return "Los 2000";
  if (year < 2020) return "Los 2010";
  return "Actuales (2020+)";
}
