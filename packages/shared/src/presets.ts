export type FunctionPreset = {
  id: 'small' | 'medium' | 'continental';
  name: { sv: string; en: string };
  functions: string[]; // default function names, editable per incident
};

// Function presets seeded when an incident is created. Names follow the MSB
// handbook and are editable defaults — the owner should confirm the continental
// set (recorded in QUESTIONS.md).
export const FUNCTION_PRESETS: FunctionPreset[] = [
  {
    id: 'small',
    name: { sv: 'Liten (4 funktioner)', en: 'Small (4 functions)' },
    functions: [
      'Analys & lägesbild',
      'Genomförande',
      'Kriskommunikation',
      'Stöd (personal, ekonomi, juridik)',
    ],
  },
  {
    id: 'medium',
    name: { sv: 'Medium (6 funktioner)', en: 'Medium (6 functions)' },
    functions: [
      'Lägesbild & analys',
      'Säkerhet',
      'Genomförande',
      'Samverkan',
      'Kriskommunikation',
      'Personal',
    ],
  },
  {
    id: 'continental',
    name: { sv: 'Kontinental (9 funktioner)', en: 'Continental (9 functions)' },
    functions: [
      'Personal',
      'Lägesbild & analys',
      'Genomförande/operation',
      'Logistik',
      'Planering',
      'Samband & IT',
      'Utbildning',
      'Ekonomi & juridik',
      'Samverkan & kommunikation',
    ],
  },
];

export function getPreset(id: string): FunctionPreset | undefined {
  return FUNCTION_PRESETS.find((p) => p.id === id);
}

export type TemplateText = {
  id:
    | 'first_gathering_agenda'
    | 'first_staff_briefing_agenda'
    | 'recurring_briefing_agenda'
    | 'report_preparation_questions'
    | 'aar_questions';
  sv: string[];
  en: string[];
};

// Template agenda / question texts, Swedish and English. Used to initialise
// incident-specific templates when an incident is created.
export const TEMPLATE_TEXTS: TemplateText[] = [
  {
    id: 'first_gathering_agenda',
    sv: [
      'Vad har hänt?',
      'Vad har gjorts och vad görs just nu?',
      'Stabens uppdrag och arbetets inriktning',
      'Vad innebär det för oss?',
      'Vad måste vi göra direkt?',
      'Nu startar vi upp ett stabsarbete',
      'Uppdrag (omedelbara åtgärder / iordningställa stabsutrymme)',
      'Återsamling kl. xx.xx.',
    ],
    en: [
      'What has happened?',
      'What has been done and what is being done right now?',
      "The staff's mission and direction of work",
      'What does it mean for us?',
      'What must we do immediately?',
      'We are now starting the staff work',
      'Mission (immediate measures / preparing the staff premises)',
      'Reconvene at xx.xx.',
    ],
  },
  {
    id: 'first_staff_briefing_agenda',
    sv: [
      'Uppdrag från beslutsfattare',
      'Vad vet vi nu?',
      'Vilka arbetsuppgifter måste genomföras (nu / längre sikt)?',
      'Hur ska vi arbeta?',
      'Presentera stabsarbetsplanen',
      'Alla dokumenterar (kan bli allmän handling)',
      'Nästa möte kl. xx.xx.',
    ],
    en: [
      'Mission from the decision-maker',
      'What do we know now?',
      'What work tasks must be carried out (now / longer term)?',
      'How shall we work?',
      'Present the staff work plan',
      'Everyone documents (may become a public document)',
      'Next meeting at xx.xx.',
    ],
  },
  {
    id: 'recurring_briefing_agenda',
    sv: [
      'Stabschefen ger nulägesbeskrivning',
      'Funktionerna redovisar (gjort / planerat / utmaningar och begränsningar)',
      'Samverkansbehov',
      'Följ upp och justera arbetsfördelning',
      'Förtydliga eller ge nya uppgifter',
    ],
    en: [
      'Chief of staff gives situation description',
      'Functions report (done / planned / challenges and limitations)',
      'Need for cooperation',
      'Follow up and adjust division of work',
      'Clarify or give new tasks',
    ],
  },
  {
    id: 'report_preparation_questions',
    sv: [
      'Vad har jag gjort?',
      'Vad planerar jag att göra?',
      'Vilka utmaningar och begränsningar har jag?',
      'Vem behöver jag samarbeta med?',
    ],
    en: [
      'What have I done?',
      'What do I plan to do?',
      'What challenges and limitations do I have?',
      'Who do I need to cooperate with?',
    ],
  },
  {
    id: 'aar_questions',
    sv: [
      'Varför ska vi utvärdera?',
      'Vad ska utvärderas?',
      'Vilka är berörda?',
      'Hur ska utvärderingen gå till?',
      'Hur ska vi använda resultatet?',
    ],
    en: [
      'Why should we evaluate?',
      'What should be evaluated?',
      'Who is affected?',
      'How shall the evaluation be carried out?',
      'How shall we use the result?',
    ],
  },
];

export function getTemplate(id: string): TemplateText | undefined {
  return TEMPLATE_TEXTS.find((t) => t.id === id);
}
