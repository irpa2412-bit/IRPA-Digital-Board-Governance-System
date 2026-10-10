/**
 * IRPA Maa (Maasai) dictionary starter.
 *
 * This is a deliberately small, provisional glossary—not a complete dictionary
 * or a claim of dialect-neutral translation. Validate and extend it with
 * Kisonko/Ilkisonko Maa speakers in Longido before using it for official records.
 *
 * Reference resources:
 * - University of Oregon Maa Language Project: https://darkwing.uoregon.edu/~maasai/
 * - University of Dar es Salaam, Languages of Tanzania Project, Maa–Swahili–English
 *   Dictionary (Payne, Ole-Kotikash & Ole-Mapena, 2014). Check permissions before
 *   importing published entries in bulk.
 */
export const MAA_DICTIONARY_SOURCES = [
  { label: "University of Oregon Maa Language Project", url: "https://darkwing.uoregon.edu/~maasai/" },
  { label: "UDSM Languages of Tanzania Project dictionary reference", url: "https://api.leco.or.tz/storage/dictionary/F5STj5nrBfdtyp1v4A0V1ZsFeUbr3dMX895MZ8ks.pdf" }
];

export const MAA_DICTIONARY = [
  { maa: "ashe", english: "thank you / thanks", swahili: "asante", category: "Courtesy", dialect: "verify locally", note: "Commonly reported; confirm spelling and usage with local speakers." },
  { maa: "enkare", english: "water", swahili: "maji", category: "Environment", dialect: "verify locally", note: "Check noun form and context with local speakers." },
  { maa: "Enkai", english: "God / the divine", swahili: "Mungu", category: "Culture", dialect: "verify locally", note: "Cultural and religious use is context-sensitive." },
  { maa: "oleng", english: "very / much", swahili: "sana / mno", category: "Modifier", dialect: "verify locally", note: "Meaning depends on sentence context." },
  { maa: "sidai", english: "good / beautiful / well", swahili: "nzuri / vizuri", category: "Description", dialect: "verify locally", note: "Agreement and grammatical form may vary by context." },
  { maa: "supa", english: "greeting used for a man (context-specific)", swahili: "salamu kwa mwanaume (hutegemea muktadha)", category: "Greeting", dialect: "verify locally", note: "Greeting conventions can vary by age, gender, and community." },
  { maa: "tash", english: "greeting used for a woman (context-specific)", swahili: "salamu kwa mwanamke (hutegemea muktadha)", category: "Greeting", dialect: "verify locally", note: "Greeting conventions can vary by age, gender, and community." }
];

export function searchMaaDictionary(query) {
  const q = String(query || "").trim().toLocaleLowerCase();
  if (!q) return MAA_DICTIONARY;
  return MAA_DICTIONARY.filter(entry =>
    [entry.maa, entry.english, entry.swahili, entry.category, entry.note]
      .some(value => String(value || "").toLocaleLowerCase().includes(q))
  );
}
