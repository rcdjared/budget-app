import templateFile from "./templates/kupi_templates.json";
import type { Intensity, Language, Mood, ResponseIntent, Template } from "../contracts";

function isTemplate(value: unknown): value is Template {
  if (!value || typeof value !== "object") return false;
  const template = value as Record<string, unknown>;
  return typeof template.id === "string"
    && typeof template.intent === "string"
    && typeof template.mood === "string"
    && (template.intensity === 1 || template.intensity === 2 || template.intensity === 3)
    && typeof template.language === "string"
    && Array.isArray(template.vars)
    && template.vars.every((key) => typeof key === "string")
    && typeof template.text === "string"
    && (template.tags === undefined || (Array.isArray(template.tags) && template.tags.every((tag) => typeof tag === "string")))
    && (template.stage === undefined || typeof template.stage === "string")
    && (template.slot === undefined || typeof template.slot === "string");
}

const validMoods = new Set<Mood>(["happy", "worried", "idle"]);
const validIntensities = new Set<Intensity>([1, 2, 3]);
const validIntents = new Set<ResponseIntent>([
  "LOG_EXPENSE", "LOG_INCOME", "TRANSFER", "EDIT_TXN", "DELETE_TXN", "QUERY_STATS",
  "CONFIRM", "CANCEL", "UNDO", "SMALLTALK", "HELP", "CLARIFY", "UNKNOWN",
  "SLOT_FILL", "DISAMBIGUATE", "ERROR", "UNSUPPORTED", "PROACTIVE",
]);
const validStages = new Set(["confirm", "done", "ambiguous", "not_found", "nothing"]);

function validTemplate(template: Template): boolean {
  return validIntents.has(template.intent)
    && validMoods.has(template.mood)
    && validIntensities.has(template.intensity)
    && (template.language === "en" || template.language === "tl" || template.language === "en-tl")
    && (template.stage === undefined || validStages.has(template.stage));
}

const rawTemplates: unknown = templateFile.templates;
if (!Array.isArray(rawTemplates) || !rawTemplates.every(isTemplate) || !rawTemplates.every(validTemplate)) {
  throw new Error("Kupi response template bank does not match the typed response contract.");
}

export const RESPONSE_TEMPLATES: readonly Template[] = rawTemplates;

export interface TemplateFilter {
  intent: ResponseIntent;
  mood: Mood;
  intensity: Intensity;
  language: Language;
  tags?: readonly string[];
  stage?: Template["stage"];
  slot?: string;
}

export function matchesTemplate(template: Template, filter: TemplateFilter): boolean {
  const languageMatches = template.language === filter.language
    || (filter.language === "tl" && template.language === "en-tl");
  return template.intent === filter.intent
    && template.mood === filter.mood
    && template.intensity <= filter.intensity
    && languageMatches
    && (filter.stage === undefined || template.stage === filter.stage)
    && (filter.slot === undefined || template.slot === filter.slot);
}
