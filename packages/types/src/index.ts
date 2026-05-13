export interface HealthStatus {
  status: 'ok' | 'error'
  service: string
  timestamp?: string
}

export interface SeasonConfig {
  seasonId: number
  name: string
  startBlock?: number
  endBlock?: number
}

export interface ResourceToken {
  id: string
  name: string
  symbol: string
  decimals: number
  contractAddress?: `0x${string}`
}
