/**
 * LocalStorage 存储服务
 * 封装所有本地存储操作，提供类型安全的 CRUD 接口
 */

// 存储 key 前缀
const STORAGE_PREFIX = 'drama_'

// 存储 key 定义
// 使用完整 drama 结构存储，不再分散存储 characters、episodes 等
export const STORAGE_KEYS = {
  DRAMAS: `${STORAGE_PREFIX}dramas`,  // 完整 drama 结构，包含嵌套的 episodes、characters、scenes
  CHARACTER_LIBRARY: `${STORAGE_PREFIX}character_library`,
  AI_CONFIGS: `${STORAGE_PREFIX}ai_configs`,
  ASSETS: `${STORAGE_PREFIX}assets`,
  IMAGES: `${STORAGE_PREFIX}images`,
  VIDEOS: `${STORAGE_PREFIX}videos`,
  VIDEO_MERGES: `${STORAGE_PREFIX}video_merges`,
  TASKS: `${STORAGE_PREFIX}tasks`,
  FRAME_PROMPTS: `${STORAGE_PREFIX}frame_prompts`,
  ID_COUNTERS: `${STORAGE_PREFIX}id_counters`,
} as const

export type StorageKey = typeof STORAGE_KEYS[keyof typeof STORAGE_KEYS]

/**
 * 生成唯一 ID
 */
export function generateId(prefix: string = ''): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 8)
  return prefix ? `${prefix}_${timestamp}${random}` : `${timestamp}${random}`
}

/**
 * 生成自增数字 ID
 */
export function generateNumericId(key: string): number {
  const counters = getItem<Record<string, number>>(STORAGE_KEYS.ID_COUNTERS) || {}
  const currentId = (counters[key] || 0) + 1
  counters[key] = currentId
  setItem(STORAGE_KEYS.ID_COUNTERS, counters)
  return currentId
}

/**
 * 获取存储项
 */
export function getItem<T>(key: StorageKey | string): T | null {
  try {
    const item = localStorage.getItem(key)
    return item ? JSON.parse(item) : null
  } catch (error) {
    console.error(`Error reading from localStorage [${key}]:`, error)
    return null
  }
}

/**
 * 设置存储项
 */
export function setItem<T>(key: StorageKey | string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch (error) {
    console.error(`Error writing to localStorage [${key}]:`, error)
    throw new Error('存储空间不足或数据格式错误')
  }
}

/**
 * 删除存储项
 */
export function removeItem(key: StorageKey | string): void {
  try {
    localStorage.removeItem(key)
  } catch (error) {
    console.error(`Error removing from localStorage [${key}]:`, error)
  }
}

/**
 * 清空所有应用数据
 */
export function clearAllData(): void {
  Object.values(STORAGE_KEYS).forEach(key => {
    removeItem(key)
  })
}

/**
 * 获取当前时间的 ISO 字符串
 */
export function now(): string {
  return new Date().toISOString()
}

/**
 * 通用列表操作
 */
export class StorageCollection<T extends { id: string | number }> {
  constructor(private key: StorageKey) {}

  getAll(): T[] {
    return getItem<T[]>(this.key) || []
  }

  getById(id: string | number): T | undefined {
    return this.getAll().find(item => item.id === id)
  }

  add(item: T): T {
    const items = this.getAll()
    items.push(item)
    setItem(this.key, items)
    return item
  }

  update(id: string | number, updates: Partial<T>): T | undefined {
    const items = this.getAll()
    const index = items.findIndex(item => item.id === id)
    if (index === -1) return undefined
    
    items[index] = { ...items[index], ...updates }
    setItem(this.key, items)
    return items[index]
  }

  delete(id: string | number): boolean {
    const items = this.getAll()
    const index = items.findIndex(item => item.id === id)
    if (index === -1) return false
    
    items.splice(index, 1)
    setItem(this.key, items)
    return true
  }

  filter(predicate: (item: T) => boolean): T[] {
    return this.getAll().filter(predicate)
  }

  count(): number {
    return this.getAll().length
  }

  clear(): void {
    setItem(this.key, [])
  }
}

/**
 * 分页帮助函数
 */
export function paginate<T>(
  items: T[],
  page: number = 1,
  pageSize: number = 20
): {
  items: T[]
  pagination: {
    page: number
    page_size: number
    total: number
    total_pages: number
  }
} {
  const total = items.length
  const totalPages = Math.ceil(total / pageSize)
  const start = (page - 1) * pageSize
  const end = start + pageSize

  return {
    items: items.slice(start, end),
    pagination: {
      page,
      page_size: pageSize,
      total,
      total_pages: totalPages
    }
  }
}

/**
 * 导出所有数据（用于备份）
 */
export function exportAllData(): Record<string, any> {
  const data: Record<string, any> = {}
  Object.entries(STORAGE_KEYS).forEach(([name, key]) => {
    data[name] = getItem(key)
  })
  return data
}

/**
 * 导入数据（用于恢复）
 */
export function importData(data: Record<string, any>): void {
  Object.entries(STORAGE_KEYS).forEach(([name, key]) => {
    if (data[name] !== undefined) {
      setItem(key, data[name])
    }
  })
}
