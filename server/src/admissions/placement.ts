/**
 * Free online placement test: question banks per language (CEFR A1–C1) and scoring.
 *
 * Each question: [level, question, options, index of the correct option]. Options are shown in a
 * fixed shuffled order per question (the same for everyone), so the scoring key always matches.
 * The recommended starting level: passing a band (60 % or more, with every lower band also
 * passed) means the candidate is ready for the next one — passed A1 → start A2.
 */
import { createHash } from "crypto";

export const PLACEMENT_LEVELS = ["A1", "A2", "B1", "B2", "C1"] as const;
const PASS_RATIO = 0.6;
const NEXT_LEVEL: Record<string, string> = { A1: "A2", A2: "B1", B1: "B2", B2: "C1", C1: "C2" };

type Question = [level: string, question: string, options: string[], correct: number];

export const BANKS: Record<string, Question[]> = {
  "German": [
    ["A1", "Wie ___ du? — Ich heiße Anna.", ["heißt", "heiße", "heißen", "heißt ihr"], 0],
    ["A1", "Ich komme ___ Malawi.", ["aus", "von", "nach", "in"], 0],
    ["A1", "Das ist ___ Buch.", ["ein", "eine", "einen", "einem"], 0],
    ["A1", "Wir ___ heute Deutsch.", ["lernen", "lernt", "lernst", "lerne"], 0],
    ["A1", "Wie spät ist es? — Es ist ___ Uhr.", ["drei", "dritte", "dreimal", "dreier"], 0],
    ["A2", "Gestern ___ ich ins Kino gegangen.", ["bin", "habe", "war", "hatte"], 0],
    ["A2", "Ich gebe ___ Mann das Buch.", ["dem", "den", "der", "des"], 0],
    ["A2", "Kannst du mir ___? (help)", ["helfen", "hilfst", "geholfen", "hilft"], 0],
    ["A2", "Ich trinke lieber Tee ___ Kaffee.", ["als", "wie", "dann", "so"], 0],
    ["A2", "Er wohnt ___ seiner Schwester.", ["bei", "mit", "zu", "an"], 0],
    ["B1", "Ich weiß nicht, ___ er morgen kommt.", ["ob", "wenn", "dass", "als"], 0],
    ["B1", "Das ist der Lehrer, ___ ich gestern gesprochen habe.", ["mit dem", "den", "der", "dem"], 0],
    ["B1", "Wenn ich Zeit ___, würde ich mehr reisen.", ["hätte", "habe", "hatte", "haben"], 0],
    ["B1", "Ich interessiere mich ___ Politik.", ["für", "an", "über", "auf"], 0],
    ["B1", "Nachdem er gegessen ___, ging er spazieren.", ["hatte", "hat", "habe", "hätte"], 0],
    ["B2", "Das Haus ___ letztes Jahr renoviert.", ["wurde", "wird", "würde", "worden"], 0],
    ["B2", "___ des schlechten Wetters fand das Spiel statt.", ["Trotz", "Wegen", "Während", "Statt"], 0],
    ["B2", "Er tut so, ___ er alles wüsste.", ["als ob", "ob", "wie wenn", "damit"], 0],
    ["B2", "Die Aufgabe ist ___ schwer, dass niemand sie lösen kann.", ["so", "zu", "sehr", "genug"], 0],
    ["B2", "Er behauptet, er ___ krank gewesen.", ["sei", "ist", "wäre gewesen", "war"], 0],
    ["C1", "Die Maßnahmen ___ sich als wirkungslos.", ["erwiesen", "bewiesen", "verwiesen", "gewiesen"], 0],
    ["C1", "Das Projekt steht und fällt ___ der Finanzierung.", ["mit", "an", "bei", "von"], 0],
    ["C1", "___ man es auch betrachtet, das Ergebnis bleibt gleich.", ["Wie", "Was", "Ob", "Wo"], 0],
    ["C1", "Er hat die Entscheidung ___ Kenntnis genommen.", ["zur", "zu", "in", "mit"], 0],
  ],
  "English": [
    ["A1", "She ___ a teacher.", ["is", "are", "am", "be"], 0],
    ["A1", "I ___ football every Saturday.", ["play", "plays", "playing", "am play"], 0],
    ["A1", "There ___ two books on the table.", ["are", "is", "be", "has"], 0],
    ["A1", "___ you like coffee?", ["Do", "Does", "Are", "Is"], 0],
    ["A2", "Yesterday I ___ to the market.", ["went", "go", "gone", "have gone"], 0],
    ["A2", "This is the ___ film I have ever seen.", ["best", "better", "good", "most good"], 0],
    ["A2", "I have lived here ___ 2019.", ["since", "for", "from", "during"], 0],
    ["A2", "We're going ___ visit our grandparents.", ["to", "for", "at", "-"], 0],
    ["B1", "If it rains, we ___ at home.", ["will stay", "would stay", "stayed", "stay would"], 0],
    ["B1", "The letter ___ by the manager yesterday.", ["was signed", "signed", "is signed", "has signed"], 0],
    ["B1", "I'm used to ___ early.", ["getting up", "get up", "got up", "have got up"], 0],
    ["B1", "She asked me where I ___.", ["lived", "live", "do live", "am living"], 0],
    ["B2", "If I had known, I ___ you.", ["would have told", "would tell", "had told", "will have told"], 0],
    ["B2", "Hardly ___ arrived when the meeting started.", ["had we", "we had", "did we", "we did"], 0],
    ["B2", "He denied ___ the window.", ["breaking", "to break", "break", "to have broke"], 0],
    ["B2", "You ___ have seen him; he was abroad.", ["can't", "mustn't", "shouldn't", "needn't"], 0],
    ["C1", "Not only ___ late, but he also forgot the documents.", ["was he", "he was", "he is", "is he being"], 0],
    ["C1", "The proposal was met with ___ scepticism.", ["considerable", "considerate", "considering", "consideration"], 0],
    ["C1", "She is ___ to succeed given her determination.", ["bound", "bond", "bounded", "binding"], 0],
    ["C1", "Were it not for your help, I ___ .", ["would have failed", "had failed", "will fail", "failed"], 0],
  ],
  "French": [
    ["A1", "Je ___ étudiant.", ["suis", "es", "est", "sommes"], 0],
    ["A1", "Nous ___ à Karonga.", ["habitons", "habitez", "habitent", "habite"], 0],
    ["A1", "C'est ___ maison.", ["une", "un", "des", "le"], 0],
    ["A1", "Tu as quel âge ? — J'___ vingt ans.", ["ai", "suis", "as", "a"], 0],
    ["A2", "Hier, je ___ allé au marché.", ["suis", "ai", "étais", "avais"], 0],
    ["A2", "Il y a ___ pommes dans le panier.", ["des", "du", "de la", "un"], 0],
    ["A2", "Je vais ___ parler demain.", ["lui", "le", "la", "leur"], 0],
    ["A2", "Elle est plus grande ___ sa sœur.", ["que", "de", "comme", "qui"], 0],
    ["B1", "Quand j'étais petit, je ___ souvent à la plage.", ["allais", "suis allé", "irai", "vais"], 0],
    ["B1", "Si j'avais de l'argent, j'___ une voiture.", ["achèterais", "achète", "achetais", "achèterai"], 0],
    ["B1", "Le livre ___ je parle est intéressant.", ["dont", "que", "qui", "où"], 0],
    ["B1", "Il faut que tu ___ tes devoirs.", ["fasses", "fais", "feras", "faisais"], 0],
    ["B2", "Bien qu'il ___ malade, il est venu.", ["soit", "est", "était", "sera"], 0],
    ["B2", "Si j'avais su, je ___ venu.", ["serais", "suis", "étais", "serai"], 0],
    ["B2", "Il est parti sans que je le ___.", ["sache", "sais", "savais", "saurai"], 0],
    ["B2", "C'est la raison pour ___ je suis ici.", ["laquelle", "lequel", "quoi", "que"], 0],
    ["C1", "___ soit la décision, nous l'accepterons.", ["Quelle que", "Quel que", "Quoi que", "Quelque"], 0],
    ["C1", "Il aurait fallu qu'il ___ plus tôt.", ["partît", "part", "partait", "partira"], 0],
    ["C1", "Cette mesure a ___ de nombreuses critiques.", ["suscité", "ressuscité", "sucité", "suscitée"], 0],
    ["C1", "Il ne se passe pas un jour ___ il ne pleuve.", ["sans qu'", "que", "où", "qu'"], 0],
  ],
  "Spanish": [
    ["A1", "Yo ___ de Malawi.", ["soy", "estoy", "es", "está"], 0],
    ["A1", "¿Cómo te ___? — Me llamo Ana.", ["llamas", "llamo", "llama", "llaman"], 0],
    ["A1", "Nosotros ___ español.", ["hablamos", "hablan", "habláis", "hablo"], 0],
    ["A1", "La casa ___ grande.", ["es", "son", "está", "eres"], 0],
    ["A2", "Ayer ___ al cine.", ["fui", "voy", "iba", "iré"], 0],
    ["A2", "Me ___ el chocolate.", ["gusta", "gustan", "gusto", "gustas"], 0],
    ["A2", "Estoy ___ un libro.", ["leyendo", "leer", "leído", "leo"], 0],
    ["A2", "Ella es más alta ___ yo.", ["que", "de", "como", "a"], 0],
    ["B1", "Cuando era niño, ___ mucho.", ["jugaba", "jugué", "juego", "jugaré"], 0],
    ["B1", "Espero que ___ bien.", ["estés", "estás", "estar", "estarás"], 0],
    ["B1", "Si tengo tiempo, te ___.", ["llamaré", "llamaría", "llamara", "llamé"], 0],
    ["B1", "El libro ___ me diste es genial.", ["que", "quien", "cual", "cuyo"], 0],
    ["B2", "Si hubiera sabido, te lo ___ dicho.", ["habría", "había", "he", "haya"], 0],
    ["B2", "Aunque ___ cansado, fue a trabajar.", ["estuviera", "está", "estará", "esté"], 0],
    ["B2", "No creo que ___ razón.", ["tengas", "tienes", "tendrás", "tenías"], 0],
    ["B2", "Lo hizo sin que nadie se ___ cuenta.", ["diera", "da", "dio", "daba"], 0],
    ["C1", "___ lo que digas, no cambiaré de opinión.", ["Digas", "Dices", "Dirás", "Dijeras"], 0],
    ["C1", "De ___ sabido, no habría venido.", ["haberlo", "haber", "habiendo", "había"], 0],
    ["C1", "La propuesta fue objeto de ___ críticas.", ["duras", "duros", "dureza", "duramente"], 0],
    ["C1", "Por mucho que ___, no lo conseguirás.", ["insistas", "insistes", "insistirás", "insistías"], 0],
  ],
};

export function placementLanguages(): string[] {
  return Object.keys(BANKS).sort();
}

/** A fixed shuffle of option positions for one question (seeded by language and question number). */
export function optionOrder(language: string, index: number, count: number): number[] {
  const order = Array.from({ length: count }, (_, i) => i);
  const seed = createHash("sha256").update(`${language}:${index}`).digest();
  for (let i = count - 1; i > 0; i--) {
    const j = seed[i % seed.length] % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

export function publicQuestions(language: string) {
  const bank = BANKS[language];
  if (!bank) return [];
  return bank.map(([level, q, options], n) => ({ n, level, q, options: optionOrder(language, n, options.length).map((i) => options[i]) }));
}

export interface PlacementScore {
  score: number;
  total: number;
  recommendedLevel: string;
  breakdown: Record<string, { correct: number; total: number }>;
}

/** answers: { "<question number>": <index of the chosen option as shown> }. */
export function scorePlacement(language: string, answers: Record<string, unknown>): PlacementScore {
  const bank = BANKS[language];
  const perLevel: Record<string, { correct: number; total: number }> = Object.fromEntries(PLACEMENT_LEVELS.map((level) => [level, { correct: 0, total: 0 }]));
  let correct = 0;
  bank.forEach(([level, , options, right], n) => {
    const shownRight = optionOrder(language, n, options.length).indexOf(right);
    perLevel[level].total++;
    const given = Number(answers[String(n)]);
    if (Number.isInteger(given) && given === shownRight) {
      perLevel[level].correct++;
      correct++;
    }
  });
  let result = "A1";
  for (const level of PLACEMENT_LEVELS) {
    const { correct: got, total } = perLevel[level];
    if (total && got / total >= PASS_RATIO) result = NEXT_LEVEL[level];
    else break;
  }
  return { score: correct, total: bank.length, recommendedLevel: result, breakdown: perLevel };
}
