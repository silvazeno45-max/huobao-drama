/**
 * AI 配置本地存储 API
 */

import type {
  AIServiceConfig,
  AIServiceType,
  CreateAIConfigRequest,
  UpdateAIConfigRequest
} from '../../types/ai'
import {
  STORAGE_KEYS,
  StorageCollection,
  generateNumericId,
  now
} from '../storage'

const aiConfigCollection = new StorageCollection<AIServiceConfig>(STORAGE_KEYS.AI_CONFIGS)

export const localAiAPI = {
  async list(serviceType?: AIServiceType): Promise<AIServiceConfig[]> {
    let items = aiConfigCollection.getAll()
    
    if (serviceType) {
      items = items.filter(i => i.service_type === serviceType)
    }
    
    return items
  },

  async create(data: CreateAIConfigRequest): Promise<AIServiceConfig> {
    // 根据 provider 和 service_type 自动设置 endpoint（与 Go ai_service.go 逻辑一致）
    let endpoint = data.endpoint || ''
    let queryEndpoint = data.query_endpoint || ''

    if (!endpoint) {
      const provider = data.provider
      const serviceType = data.service_type

      switch (provider) {
        case 'gemini':
        case 'google':
          if (serviceType === 'text') {
            endpoint = '/v1beta/models/{model}:generateContent'
          } else if (serviceType === 'image') {
            endpoint = '/v1beta/models/{model}:generateContent'
          }
          break
        case 'openai':
          if (serviceType === 'text') {
            endpoint = '/chat/completions'
          } else if (serviceType === 'image') {
            endpoint = '/images/generations'
          } else if (serviceType === 'video') {
            endpoint = '/videos'
            if (!queryEndpoint) {
              queryEndpoint = '/videos/{taskId}'
            }
          }
          break
        case 'chatfire':
          if (serviceType === 'text') {
            endpoint = '/chat/completions'
          } else if (serviceType === 'image') {
            endpoint = '/images/generations'
          } else if (serviceType === 'video') {
            endpoint = '/video/generations'
            if (!queryEndpoint) {
              queryEndpoint = '/video/task/{taskId}'
            }
          }
          break
        case 'doubao':
        case 'volcengine':
        case 'volces':
          if (serviceType === 'video') {
            endpoint = '/contents/generations/tasks'
            if (!queryEndpoint) {
              queryEndpoint = '/generations/tasks/{taskId}'
            }
          }
          break
        default:
          // 默认使用 OpenAI 格式
          if (serviceType === 'text') {
            endpoint = '/chat/completions'
          } else if (serviceType === 'image') {
            endpoint = '/images/generations'
          }
      }
    }

    const config: AIServiceConfig = {
      id: generateNumericId('ai_config'),
      name: data.name,
      service_type: data.service_type,
      provider: data.provider,
      api_key: data.api_key,
      base_url: data.base_url,
      model: data.model,
      endpoint: endpoint,
      query_endpoint: queryEndpoint,
      priority: data.priority || 0,
      is_active: true,
      settings: data.settings,
      created_at: now(),
      updated_at: now()
    }
    
    return aiConfigCollection.add(config)
  },

  async get(id: number): Promise<AIServiceConfig> {
    const config = aiConfigCollection.getById(id)
    if (!config) {
      throw new Error('AI 配置不存在')
    }
    return config
  },

  async update(id: number, data: UpdateAIConfigRequest): Promise<AIServiceConfig> {
    const updated = aiConfigCollection.update(id, {
      ...data,
      updated_at: now()
    } as Partial<AIServiceConfig>)
    
    if (!updated) {
      throw new Error('AI 配置不存在')
    }
    return updated
  },

  async delete(id: number): Promise<void> {
    aiConfigCollection.delete(id)
  },

  async testConnection(data: any): Promise<{ success: boolean; message: string }> {
    // 本地模式下模拟测试连接
    return {
      success: true,
      message: '本地模式：连接测试跳过'
    }
  }
}
