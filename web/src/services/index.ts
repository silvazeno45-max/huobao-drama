/**
 * Services 统一导出
 * 
 * 使用方式：
 * import { dramaService, imageService } from '@/services'
 * 
 * 替代原来的：
 * import { dramaAPI } from '@/api/drama'
 */

// 适配器服务（自动切换本地/远程）
export * from './adapter'

// 配置相关
export * from './config'

// 存储工具
export * from './storage'

// 本地 API（直接访问）
export * as localAPI from './local'
