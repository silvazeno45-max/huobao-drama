/**
 * Drama API 适配器
 * 根据配置自动切换本地存储或远程 API
 */

import { dramaAPI } from '../../api/drama'
import { localDramaAPI, localStoryboardAPI, localSceneAPI } from '../local/drama'
import { isLocalMode } from '../config'

/**
 * 创建代理对象，自动根据模式选择 API 实现
 */
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

// 导出适配后的 API
export const dramaService = createProxy(localDramaAPI, dramaAPI)
export const storyboardService = localStoryboardAPI
export const sceneService = localSceneAPI
