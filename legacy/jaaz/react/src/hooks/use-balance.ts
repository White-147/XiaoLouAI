import { useQuery } from '@tanstack/react-query'
import { getBalance } from '@/api/billing'
import { useAuth } from '@/contexts/AuthContext'

export function useBalance() {
  const { authStatus } = useAuth()

  const {
    data,
    error,
    refetch,
  } = useQuery({
    queryKey: ['balance'],
    queryFn: getBalance,
    enabled: authStatus.is_logged_in, // 只有登录时才获取余额
    staleTime: 30000, // 30秒内不重新获取
    gcTime: 5 * 60 * 1000, // 5分钟后清理缓存
    refetchOnWindowFocus: true, // 窗口聚焦时重新获取
    refetchOnMount: true, // 组件挂载时重新获取
  })

  return {
    balance: data?.balance || '0.00',
    error,
    refreshBalance: refetch,
  }
}
