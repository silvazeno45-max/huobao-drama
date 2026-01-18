/**
 * Generation API 适配器
 */

import { generationAPI } from '../../api/generation'
import { localGenerationAPI } from '../local/generation'
import { isLocalMode } from '../config'

function createProxy<T extends object>(localApi: T, remoteApi: T): T {
  return new Proxy({} as T, {
    get(_target, prop: string) {
      const api = isLocalMode() ? localApi : remoteApi
      const value = (api as any)[prop]
      if (typeof value === 'function') {
        return value.bind(api)
      }
      return value
    }
  })
}

export const generationService = createProxy(localGenerationAPI, generationAPI)
