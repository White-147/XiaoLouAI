import React from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/contexts/AuthContext'
import { useConfigs, useRefreshModels } from '@/contexts/configs'
import { BASE_API_URL } from '@/constants'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { logout } from '@/api/auth'
import { PointsDisplay } from './PointsDisplay'

export function UserMenu() {
  const { authStatus, refreshAuth } = useAuth()
  const { setShowLoginDialog } = useConfigs()
  const refreshModels = useRefreshModels()
  const { t } = useTranslation()

  const handleLogout = async () => {
    await logout()
    await refreshAuth()
    refreshModels()
  }

  if (
    authStatus.is_logged_in &&
    authStatus.user_info &&
    authStatus.auth_source === 'xiaolou'
  ) {
    const { username, image_url } = authStatus.user_info
    const initials = username ? username.substring(0, 2).toUpperCase() : 'XL'

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="relative p-0 h-auto">
            <Avatar className="h-7 w-7">
              <AvatarImage src={image_url} alt={username} />
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>小楼账号</DropdownMenuLabel>
          <DropdownMenuItem disabled>{username}</DropdownMenuItem>
          {authStatus.platform_role ? (
            <DropdownMenuItem disabled>{authStatus.platform_role}</DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled>已由小楼登录同步</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  if (authStatus.is_logged_in && authStatus.user_info) {
    const { username, image_url } = authStatus.user_info
    const initials = username ? username.substring(0, 2).toUpperCase() : 'U'

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="relative p-0 h-auto">
            <PointsDisplay>
              <Avatar className="h-6 w-6">
                <AvatarImage src={image_url} alt={username} />
                <AvatarFallback>{initials}</AvatarFallback>
              </Avatar>
            </PointsDisplay>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>{t('common:auth.myAccount')}</DropdownMenuLabel>
          <DropdownMenuItem disabled>{username}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => {
              const billingUrl = `${BASE_API_URL}/billing`
              if (window.electronAPI?.openBrowserUrl) {
                window.electronAPI.openBrowserUrl(billingUrl)
              } else {
                window.open(billingUrl, '_blank')
              }
            }}
          >
            {t('common:auth.recharge')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleLogout}>
            {t('common:auth.logout')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  return (
    <Button variant="outline" onClick={() => setShowLoginDialog(true)}>
      {t('common:auth.login')}
    </Button>
  )
}
