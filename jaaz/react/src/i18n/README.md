# 国际化 (i18n) 使用指南

## 概述

本项目使用 `react-i18next` 进行国际化处理，支持中英文切换。翻译文件按功能模块组织，便于维护和扩展。

## 文件结构

```
src/i18n/
├── index.ts                 # i18n 配置文件
├── locales/
│   ├── en/                 # 英文翻译
│   │   ├── common.json     # 通用翻译
│   │   ├── home.json       # 首页翻译
│   │   ├── canvas.json     # 画布页面翻译
│   │   ├── chat.json       # 聊天功能翻译
│   │   └── settings.json   # 设置页面翻译
│   └── zh/                 # 中文翻译
│       ├── common.json
│       ├── home.json
│       ├── canvas.json
│       ├── chat.json
│       └── settings.json
└── README.md               # 本说明文档
```

## 基本使用

### 1. 在组件中使用翻译

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

### 2. 使用嵌套键值

```tsx
// 翻译文件中：
// {
//   "buttons": {
//     "save": "保存",
//     "cancel": "取消"
//   }
// }

const { t } = useTranslation()
return <button>{t('common:buttons.save')}</button>
```

### 3. 使用插值

```tsx
// 翻译文件中：
// {
//   "welcome": "欢迎, {{name}}!"
// }

const { t } = useTranslation()
return <div>{t('common:welcome', { name: 'Jaaz' })}</div>
```

### 4. 语言切换

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

## 命名空间说明

- **common**: 通用翻译，包括按钮、消息、导航等
- **home**: 首页相关翻译
- **canvas**: 画布功能相关翻译
- **chat**: 聊天功能相关翻译
- **settings**: 设置页面相关翻译

## 翻译键命名规范

1. 使用小驼峰命名法：`newCanvas`
2. 嵌套对象使用点分隔：`buttons.save`
3. 动作相关：`create`, `edit`, `delete`, `save`
4. 状态相关：`loading`, `success`, `error`
5. 消息相关：`messages.success`, `messages.error`

## 添加新翻译

1. 在对应的英文 JSON 文件中添加新的键值对
2. 在对应的中文 JSON 文件中添加对应的翻译
3. 在组件中使用 `t('newKey')` 调用

## 组件使用示例

### 语言切换器组件

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

### 自定义钩子

```tsx
import { useLanguage } from '@/hooks/use-language'

function MyComponent() {
  const { currentLanguage, changeLanguage, isEnglish, isChinese } = useLanguage()

  // 根据当前语言执行不同逻辑
  if (isEnglish) {
    // 英文逻辑
  }

  if (isChinese) {
    // 中文逻辑
  }
}
```

## 注意事项

1. 翻译文件修改后需要重启开发服务器
2. 确保中英文翻译文件的键保持一致
3. 使用有意义的键名，避免使用 `text1`, `label2` 等无意义的命名
4. 长文本建议分段处理，便于维护
5. 涉及复数形式时，考虑使用 i18next 的复数功能
