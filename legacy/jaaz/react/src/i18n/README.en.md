# Internationalization (i18n) Guide

Language: [简体中文](README.md) | [English](README.en.md)

## Overview

This project uses `react-i18next` for internationalization and supports Chinese
and English switching. Translation files are organized by feature module to make
maintenance and expansion easier.

## File Structure

```text
src/i18n/
├── index.ts                 # i18n configuration
├── locales/
│   ├── en/                  # English translations
│   │   ├── common.json      # Shared translations
│   │   ├── home.json        # Home page translations
│   │   ├── canvas.json      # Canvas page translations
│   │   ├── chat.json        # Chat translations
│   │   └── settings.json    # Settings translations
│   └── zh/                  # Chinese translations
│       ├── common.json
│       ├── home.json
│       ├── canvas.json
│       ├── chat.json
│       └── settings.json
└── README.md                # This guide
```

## Basic Usage

### 1. Use translations in components

```tsx
import { useTranslation } from 'react-i18next'

function MyComponent() {
  const { t } = useTranslation()

  return (
    <div>
      <h1>{t('title')}</h1>
    </div>
  )
}
```

### 2. Use nested keys

```tsx
// In translation files:
// {
//   "buttons": {
//     "save": "Save",
//     "cancel": "Cancel"
//   }
// }

const { t } = useTranslation()
return <button>{t('common:buttons.save')}</button>
```

### 3. Use interpolation

```tsx
// In translation files:
// {
//   "welcome": "Welcome, {{name}}!"
// }

const { t } = useTranslation()
return <div>{t('common:welcome', { name: 'Jaaz' })}</div>
```

### 4. Switch languages

```tsx
import { useLanguage } from '@/hooks/use-language'

function LanguageButton() {
  const { changeLanguage, currentLanguage } = useLanguage()

  return (
    <button
      onClick={() => changeLanguage(currentLanguage === 'zh-CN' ? 'en' : 'zh-CN')}
    >
      {currentLanguage === 'zh-CN' ? 'English' : '中文'}
    </button>
  )
}
```

## Namespaces

- **common**: Shared translations, including buttons, messages, and navigation.
- **home**: Home page translations.
- **canvas**: Canvas feature translations.
- **chat**: Chat feature translations.
- **settings**: Settings page translations.

## Translation Key Naming Rules

1. Use lower camel case, for example `newCanvas`.
2. Use dot-separated nested keys, for example `buttons.save`.
3. Action keys: `create`, `edit`, `delete`, `save`.
4. State keys: `loading`, `success`, `error`.
5. Message keys: `messages.success`, `messages.error`.

## Add New Translations

1. Add the new key to the matching English JSON file.
2. Add the corresponding Chinese translation to the matching Chinese JSON file.
3. Use `t('newKey')` in the component.

## Component Examples

### Language switcher component

```tsx
import { LanguageSwitcher } from '@/components/common/LanguageSwitcher'

function Header() {
  return (
    <div className="header">
      <LanguageSwitcher />
    </div>
  )
}
```

### Custom hook

```tsx
import { useLanguage } from '@/hooks/use-language'

function MyComponent() {
  const { currentLanguage, changeLanguage, isEnglish, isChinese } = useLanguage()

  if (isEnglish) {
    // English-specific logic
  }

  if (isChinese) {
    // Chinese-specific logic
  }
}
```

## Notes

1. Restart the development server after editing translation files.
2. Keep keys consistent between Chinese and English translation files.
3. Use meaningful key names and avoid names such as `text1` or `label2`.
4. Split long text into sections for easier maintenance.
5. Consider i18next pluralization support when plural forms are involved.

## README Language Policy

Keep this README and `README.md` in sync. Any future README change should update
both language versions.
