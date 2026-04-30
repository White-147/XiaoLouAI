import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { PROVIDER_NAME_MAPPING } from '@/constants'
import { LLMConfig } from '@/types/types'
import { useTranslation } from 'react-i18next'
import AddModelsList from './AddModelsList'
import { Trash2 } from 'lucide-react'

interface CommonSettingProps {
  providerKey: string
  config: LLMConfig
  onConfigChange: (key: string, newConfig: LLMConfig) => void
  onDeleteProvider?: (providerKey: string) => void
}

export default function CommonSetting({
  providerKey,
  config,
  onConfigChange,
  onDeleteProvider,
}: CommonSettingProps) {
  const { t } = useTranslation()
  // jaaz is official provider, so we don't need to show it here
  if (providerKey === 'jaaz') {
    return null
  }

  const provider = PROVIDER_NAME_MAPPING[providerKey] || {
    name:
      providerKey.charAt(0).toUpperCase() +
      providerKey.slice(1).replace(/_/g, ' '),
    // TODO: replace icon
    icon: 'https://openai.com/favicon.ico',
  }

  // Check if this is a custom provider (not in PROVIDER_NAME_MAPPING)
  const isCustomProvider = config.is_custom

  const handleChange = (field: keyof LLMConfig, value: string | number) => {
    onConfigChange(providerKey, {
      ...config,
      [field]: value,
    })
  }

  const handleModelsChange = (
    models: Record<string, { type?: 'text' | 'image' | 'video' }>
  ) => {
    onConfigChange(providerKey, {
      ...config,
      models,
    })
  }

  const handleDelete = () => {
    if (onDeleteProvider && isCustomProvider) {
      onDeleteProvider(providerKey)
    }
  }

  const isImageProvider =
    providerKey === 'replicate' || providerKey === 'huggingface'
  const hasMaxTokens = !isImageProvider

  return (
    <div className="space-y-4">
      {/* Provider Header */}
      <div className="flex items-center gap-2">
        <img
          src={provider.icon}
          alt={provider.name}
          className="w-10 h-10 rounded-full"
        />
        <p className="font-bold text-2xl w-fit">{provider.name}</p>
        {isCustomProvider && <span>✨ Custom Provider</span>}
        {isImageProvider && <span>🎨 Image Generation</span>}

        {/* Delete Button - only for custom providers */}
        {isCustomProvider && onDeleteProvider && (
          <div className="ml-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={handleDelete}
              className="text-red-600 hover:text-red-700 hover:bg-red-50"
            >
              <Trash2 className="h-4 w-4 mr-1" />
              {t('settings:provider.delete')}
            </Button>
          </div>
        )}
      </div>

      {/* API URL Input */}
      <div className="space-y-2">
        <Label htmlFor={`${providerKey}-url`}>
          {t('settings:provider.apiUrl')}
        </Label>
        <Input
          id={`${providerKey}-url`}
          placeholder={t('settings:provider.apiUrlPlaceholder')}
          value={config.url ?? ''}
          onChange={(e) => handleChange('url', e.target.value)}
          className="w-full"
        />
      </div>

      {/* API Key Input */}
      <div className="space-y-2">
        <Label htmlFor={`${providerKey}-apiKey`}>
          {t('settings:provider.apiKey')}
        </Label>
        <Input
          id={`${providerKey}-apiKey`}
          type="password"
          placeholder={t('settings:provider.apiKeyPlaceholder')}
          value={config.api_key ?? ''}
          onChange={(e) => handleChange('api_key', e.target.value)}
          className="w-full"
        />
        <p className="text-xs text-gray-500">
          {t('settings:provider.apiKeyDescription')}
        </p>
      </div>

      {/* Models Configuration - only for custom providers */}
      {providerKey !== 'ollama' && (
        <div className="space-y-2">
          <AddModelsList
            models={config.models || {}}
            onChange={handleModelsChange}
            label={t('settings:models.title')}
          />
        </div>
      )}

      {/* Max Tokens Input - only for text providers */}
      {hasMaxTokens && (
        <div className="space-y-2">
          <Label htmlFor={`${providerKey}-maxTokens`}>
            {t('settings:provider.maxTokens')}
          </Label>
          <Input
            id={`${providerKey}-maxTokens`}
            type="number"
            placeholder={t('settings:provider.maxTokensPlaceholder')}
            value={config.max_tokens ?? 8192}
            onChange={(e) =>
              handleChange('max_tokens', parseInt(e.target.value))
            }
            className="w-full"
          />
          <p className="text-xs text-gray-500">
            {t('settings:provider.maxTokensDescription')}
          </p>
        </div>
      )}
    </div>
  )
}
