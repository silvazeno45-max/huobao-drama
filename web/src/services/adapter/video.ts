/**
 * Video API 适配器
 */

import { videoAPI } from '../../api/video'
import { localVideoAPI } from '../local/video'
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

export const videoService = createProxy(localVideoAPI, videoAPI)

// 本地模式专用方法
export const localVideoService = localVideoAPI
