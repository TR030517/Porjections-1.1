import { Injectable } from '@nestjs/common';
import * as en from './translations/en.json';
import * as zh from './translations/zh.json';
import * as glossary from './glossary.json';

type TranslationKeys = typeof en;
type GlossaryType = typeof glossary;

@Injectable()
export class I18nService {
  private readonly translations: Record<string, TranslationKeys> = {
    en: en as TranslationKeys,
    zh: zh as TranslationKeys,
  };

  private readonly glossary = glossary as GlossaryType;

  /**
   * Get translation for a dot-notation key (e.g. "auth.otpSent")
   * Falls back to English if key not found in requested locale
   * Falls back to the key itself if not found in any locale
   */
  t(lang: string, key: string): string {
    const locale = this.resolveLocale(lang);
    const value = this.getValue(this.translations[locale], key)
      ?? this.getValue(this.translations.en, key)
      ?? key;
    return value;
  }

  /**
   * Translate a term using the glossary
   */
  glossaryTerm(lang: string, category: string, term: string): string {
    const locale = this.resolveLocale(lang);
    const cat = (this.glossary as any)[category];
    if (!cat) return term;
    const entry = cat[term];
    if (!entry) return term;
    return entry[locale] || entry.en || term;
  }

  /**
   * Get all glossary entries for a category
   */
  getGlossaryCategory(lang: string, category: string): Record<string, string> {
    const locale = this.resolveLocale(lang);
    const cat = (this.glossary as any)[category];
    if (!cat) return {};
    const result: Record<string, string> = {};
    for (const [key, entry] of Object.entries(cat)) {
      result[key] = (entry as any)[locale] || (entry as any).en || key;
    }
    return result;
  }

  /**
   * Resolve locale from Accept-Language header value
   */
  resolveLocale(acceptLanguage: string): string {
    if (!acceptLanguage) return 'en';
    // Parse first language from Accept-Language header
    const langs = acceptLanguage.split(',');
    const primary = langs[0]?.trim().split(';')[0]?.split('-')[0]?.toLowerCase();
    if (primary === 'zh') return 'zh';
    return 'en';
  }

  private getValue(obj: any, path: string): string | undefined {
    return path.split('.').reduce((acc, part) => acc?.[part], obj) as string | undefined;
  }
}
