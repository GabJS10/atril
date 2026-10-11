import { useMemo } from "react";
import { create } from "zustand";
import type { Settings } from "../api/types";
import { en } from "./en";
import { es, type TranslationKey } from "./es";

export type Locale = "es" | "en";
export type Translate = (key: TranslationKey, vars?: Record<string, string>) => string;

const dictionaries: Record<Locale, Record<TranslationKey, string>> = { es, en };

/** "system" follows the OS language: Spanish if it starts with "es", English otherwise. */
export function resolveLocale(
  language: Settings["language"],
  systemLanguage: string = navigator.language,
): Locale {
  if (language === "es" || language === "en") return language;
  return systemLanguage.toLowerCase().startsWith("es") ? "es" : "en";
}

function translate(locale: Locale, key: TranslationKey, vars?: Record<string, string>): string {
  const template = dictionaries[locale][key];
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => vars[name] ?? match);
}

type LocaleState = {
  language: Settings["language"];
  locale: Locale;
  setLanguage: (language: Settings["language"]) => void;
};

// Set from the settings query (Settings.language). Components read it through useT().
export const useLocaleStore = create<LocaleState>()((set) => ({
  language: "system",
  locale: resolveLocale("system"),
  setLanguage: (language) => set({ language, locale: resolveLocale(language) }),
}));

/** Translator for React components; re-renders when the locale changes. */
export function useT(): Translate {
  const locale = useLocaleStore((state) => state.locale);
  return useMemo((): Translate => (key, vars) => translate(locale, key, vars), [locale]);
}

/** Translator for code outside React, using the locale current at call time. */
export function getT(): Translate {
  const { locale } = useLocaleStore.getState();
  return (key, vars) => translate(locale, key, vars);
}
