import { BASE_API_URL } from '../constants'
import { authenticatedFetch } from './auth'

export interface BalanceResponse {
  balance: string
}

export async function getBalance(): Promise<BalanceResponse> {
  const response = await authenticatedFetch(
    `${BASE_API_URL}/api/billing/getBalance`
  )

  if (!response.ok) {
    throw new Error(`Failed to fetch balance: ${response.status}`)
  }

  return await response.json()
}
