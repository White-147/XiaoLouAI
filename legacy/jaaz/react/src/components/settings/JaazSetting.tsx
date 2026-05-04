import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { LOGO_URL } from '@/constants'
import { LLMConfig } from '@/types/types'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/contexts/AuthContext'
import { useConfigs } from '@/contexts/configs'

interface JaazSettingProps {
  config: LLMConfig
  onConfigChange: (key: string, newConfig: LLMConfig) => void
}

export default function JaazSetting({
  config,
  onConfigChange,
}: JaazSettingProps) {
  const { t } = useTranslation()
  const { authStatus } = useAuth()
  const { setShowLoginDialog } = useConfigs()

  // Get available models from constants
  const availableModels = config.models || {}

  const handleModelToggle = (modelName: string, enabled: boolean) => {
    const currentModels = config.models || {}
    const updatedModels = { ...currentModels }

    if (enabled) {
      // Add model with its type from available models
      updatedModels[modelName] = {
        ...availableModels[modelName],
        is_disabled: false,
      }
    } else {
      // Remove model
      updatedModels[modelName] = {
        ...updatedModels[modelName],
        is_disabled: true,
      }
    }

    // Filter out any models that don't exist in availableModels
    const validModels: Record<string, { type?: 'text' | 'image' | 'video' }> =
      {}
    Object.keys(updatedModels).forEach((key) => {
      if (availableModels[key]) {
        validModels[key] = updatedModels[key]
      }
    })

    onConfigChange('jaaz', {
      ...config,
      models: validModels,
    })
  }

  const handleChange = (field: keyof LLMConfig, value: string | number) => {
    onConfigChange('jaaz', {
      ...config,
      [field]: value,
    })
  }

  const ModelsList = () => (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>{t('settings:models.title')}</Label>
      </div>

      <div className="space-y-2">
        {Object.entries(availableModels).map(([modelName, modelConfig]) => {
          return (
            <div key={modelName} className="flex items-center justify-between">
              <p className="w-[50%]">{modelName}</p>
              <div className="flex items-center gap-6">
                <p>{modelConfig.type || 'text'}</p>
                {/* TODO: re-enable this switch */}
                {/* <Switch
                  checked={!modelConfig.is_disabled}
                  onCheckedChange={(checked) =>
                    handleModelToggle(modelName, checked)
                  }
                /> */}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )

  return (
    <div className="space-y-4">
      {/* Provider Header */}
      <div className="flex items-center gap-2 justify-between">
        <div className="flex items-center gap-2">
          <img src={LOGO_URL} alt="Jaaz" className="w-10 h-10 rounded-full" />
          <p className="font-bold text-2xl w-fit">Jaaz</p>
          {/* <span>✨ Custom Provider</span> */}
        </div>

        {/* Show login button if not logged in */}
        {!authStatus.is_logged_in && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowLoginDialog(true)}
          >
            {t('common:auth.login')}
          </Button>
        )}
      </div>

      {/* Only show configuration when logged in */}
      {authStatus.is_logged_in && (
        <>
          {/* Models Configuration */}
          <div className="space-y-2">
            <ModelsList />
          </div>

          {/* Max Tokens Input */}
          <div className="space-y-2">
            <Label htmlFor="jaaz-maxTokens">
              {t('settings:provider.maxTokens')}
            </Label>
            <Input
              id="jaaz-maxTokens"
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
        </>
      )}
    </div>
  )
}
