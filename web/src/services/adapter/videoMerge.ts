/**
 * Video Merge API 适配器
 */

import { videoMergeAPI } from '../../api/videoMerge'
import { localVideoMergeAPI } from '../local/videoMerge'
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

export const videoMergeService = createProxy(localVideoMergeAPI, videoMergeAPI)

// 本地模式专用方法
export const localVideoMergeService = localVideoMergeAPI
