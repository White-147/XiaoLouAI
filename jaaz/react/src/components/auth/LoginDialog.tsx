import React, { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog'
import { startDeviceAuth, pollDeviceAuth, saveAuthData } from '../../api/auth'
import { updateJaazApiKey } from '../../api/config'
import { useAuth } from '../../contexts/AuthContext'
import { useConfigs, useRefreshModels } from '../../contexts/configs'

export function LoginDialog() {
  const [authMessage, setAuthMessage] = useState('')
  const { authStatus, refreshAuth } = useAuth()
  const { showLoginDialog: open, setShowLoginDialog } = useConfigs()
  const refreshModels = useRefreshModels()
  const { t } = useTranslation()
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null)

  // Clean up polling when dialog closes
  useEffect(() => {
    setAuthMessage('')

    if (!open) {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current)
        pollingIntervalRef.current = null
      }
    }
  }, [open])

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current)
      }
    }
  }, [])

  const startPolling = (code: string) => {
    console.log('Starting polling for device code:', code)

    const poll = async () => {
      try {
        const result = await pollDeviceAuth(code)
        console.log('Poll result:', result)

        if (result.status === 'authorized') {
          // Login successful - save auth data to local storage
          if (result.token && result.user_info) {
            saveAuthData(result.token, result.user_info)

            // Update jaaz provider api_key with the access token
            await updateJaazApiKey(result.token)
          }

          setAuthMessage(t('common:auth.loginSuccessMessage'))
          if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current)
            pollingIntervalRef.current = null
          }

          try {
            await refreshAuth()
            console.log('Auth status refreshed successfully')
            // Refresh models list after successful login and config update
            refreshModels()
          } catch (error) {
            console.error('Failed to refresh auth status:', error)
          }

          setTimeout(() => setShowLoginDialog(false), 1500)

        } else if (result.status === 'expired') {
          // Authorization expired
          setAuthMessage(t('common:auth.authExpiredMessage'))
          if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current)
            pollingIntervalRef.current = null
          }

        } else if (result.status === 'error') {
          // Error occurred
          setAuthMessage(result.message || t('common:auth.authErrorMessage'))
          if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current)
            pollingIntervalRef.current = null
          }

        } else {
          // Still pending, continue polling
          setAuthMessage(t('common:auth.waitingForBrowser'))
        }
      } catch (error) {
        console.error('Polling error:', error)
        setAuthMessage(t('common:auth.pollErrorMessage'))
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current)
          pollingIntervalRef.current = null
        }
      }
    }

    // Start polling immediately, then every 1 seconds
    poll()
    pollingIntervalRef.current = setInterval(poll, 1000)
  }

  const handleLogin = async () => {
    try {
      setAuthMessage(t('common:auth.preparingLoginMessage'))

      const result = await startDeviceAuth()
      setAuthMessage(result.message)

      // Start polling for authorization status
      startPolling(result.code)

    } catch (error) {
      console.error('登录请求失败:', error)
      setAuthMessage(t('common:auth.loginRequestFailed'))
    }
  }

  const handleCancel = () => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current)
      pollingIntervalRef.current = null
    }
    setAuthMessage('')
    setShowLoginDialog(false)
  }

  if (authStatus.auth_source === 'xiaolou') {
    return null
  }

  return (
    <Dialog open={open} onOpenChange={setShowLoginDialog}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('common:auth.loginToJaaz')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t('common:auth.loginDescription')}
          </p>

          <div className="flex gap-2">
            <Button
              onClick={handleLogin}
              disabled={!!authMessage}
              className="flex-1"
            >
              {authMessage || t('common:auth.startLogin')}
            </Button>

          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
