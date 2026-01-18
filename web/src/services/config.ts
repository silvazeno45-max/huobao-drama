/**
 * 服务配置
 * 控制使用本地存储还是远程 API
 */

// 存储模式
export type StorageMode = 'local' | 'api'

// 配置 key
const STORAGE_MODE_KEY = 'drama_storage_mode'

/**
 * 获取当前存储模式
 */
export function getStorageMode(): StorageMode {
  const saved = localStorage.getItem(STORAGE_MODE_KEY)
  // 默认使用本地模式
  return (saved as StorageMode) || 'local'
}

/**
 * 设置存储模式
 */
export function setStorageMode(mode: StorageMode): void {
  localStorage.setItem(STORAGE_MODE_KEY, mode)
  // 刷新页面以应用新模式
  window.location.reload()
}

/**
 * 检查是否为本地模式
 */
export function isLocalMode(): boolean {
  return getStorageMode() === 'local'
}

/**
 * 检查是否为 API 模式
 */
export function isApiMode(): boolean {
  return getStorageMode() === 'api'
}

/**
 * API 配置
 */
export const apiConfig = {
  baseUrl: '/api/v1',
  timeout: 600000
}
