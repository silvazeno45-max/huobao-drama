/**
 * 本地 AI 客户端服务
 * 调用 OpenAI 兼容的 API 进行文本生成
 */

import type { AIServiceConfig } from '../../types/ai'
import { STORAGE_KEYS, StorageCollection } from '../storage'
import { createVideoClient, type VideoGenerateRequest, type VideoClient } from './videoClients'

const aiConfigCollection = new StorageCollection<AIServiceConfig>(STORAGE_KEYS.AI_CONFIGS)

export interface AIGenerateOptions {
  temperature?: number
  maxTokens?: number
  systemPrompt?: string
}

export interface AIResponse {
  content: string
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}

/**
 * 获取可用的文本生成 AI 配置
 */
function getTextAIConfig(): AIServiceConfig | null {
  const configs = aiConfigCollection.getAll()
  const textConfigs = configs
    .filter(c => c.service_type === 'text' && c.is_active)
    .sort((a, b) => (b.priority || 0) - (a.priority || 0))
  
  return textConfigs[0] || null
}

/**
 * 解析 AI JSON 响应
 * 处理可能的 markdown 代码块包装
 */
export function parseAIJSON<T>(text: string): T {
  // 移除可能的 markdown 代码块
  let jsonStr = text.trim()
  
  // 移除 ```json ... ``` 或 ``` ... ```
  if (jsonStr.startsWith('```')) {
    const lines = jsonStr.split('\n')
    // 移除第一行 (```json 或 ```)
    lines.shift()
    // 移除最后一行 (```)
    if (lines[lines.length - 1]?.trim() === '```') {
      lines.pop()
    }
    jsonStr = lines.join('\n')
  }
  
  // 尝试找到 JSON 对象的开始和结束
  const jsonStart = jsonStr.indexOf('{')
  const jsonEnd = jsonStr.lastIndexOf('}')
  
  if (jsonStart !== -1 && jsonEnd !== -1) {
    jsonStr = jsonStr.slice(jsonStart, jsonEnd + 1)
  }
  
  return JSON.parse(jsonStr)
}

/**
 * 调用 AI API 生成文本
 */
export async function generateText(
  prompt: string,
  options: AIGenerateOptions = {}
): Promise<string> {
  const config = getTextAIConfig()
  
  if (!config) {
    throw new Error('未配置文本生成 AI 服务，请先在设置中添加 AI 配置')
  }
  
  const {
    temperature = 0.7,
    maxTokens = 4000,
    systemPrompt = ''
  } = options
  
  const messages: Array<{ role: string; content: string }> = []
  
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt })
  }
  messages.push({ role: 'user', content: prompt })
  
  // 构建请求体 (OpenAI 兼容格式)
  const model = Array.isArray(config.model) ? config.model[0] : config.model
  const requestBody = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens
  }
  
  // 构建请求 URL
  let url = config.base_url
  if (!url.endsWith('/')) {
    url += '/'
  }
  // 支持自定义 endpoint 或使用默认的 chat/completions
  const endpoint = config.endpoint || 'chat/completions'
  url += endpoint.startsWith('/') ? endpoint.slice(1) : endpoint
  
  console.log('[AIClient] Calling AI API:', { url, model, temperature, maxTokens })
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.api_key}`
      },
      body: JSON.stringify(requestBody)
    })
    if (!response.ok) {
      const errorText = await response.text()
      console.error('[AIClient] API error:', response.status, errorText)
      throw new Error(`AI API 调用失败: ${response.status} - ${errorText}`)
    }
    
    const data = await response.json()
    
    // 提取响应内容 (OpenAI 格式)
    const content = data.choices?.[0]?.message?.content || ''
    
    console.log('[AIClient] Response received, length:', content.length)
    
    return content
  } catch (error: any) {
    console.error('[AIClient] Request failed:', error)
    throw new Error(`AI 请求失败: ${error.message}`)
  }
}

/**
 * 生成文本并解析为 JSON
 */
export async function generateJSON<T>(
  prompt: string,
  options: AIGenerateOptions = {}
): Promise<T> {
  const text = await generateText(prompt, options)
  return parseAIJSON<T>(text)
}

/**
 * 获取可用的图片生成 AI 配置
 */
function getImageAIConfig(modelName?: string): AIServiceConfig | null {
  const configs = aiConfigCollection.getAll()
  let imageConfigs = configs
    .filter(c => c.service_type === 'image' && c.is_active)
    .sort((a, b) => (b.priority || 0) - (a.priority || 0))
  
  // 如果指定了模型名称，尝试找到匹配的配置
  if (modelName) {
    const matchedConfig = imageConfigs.find(c => {
      const models = Array.isArray(c.model) ? c.model : [c.model]
      return models.includes(modelName)
    })
    if (matchedConfig) return matchedConfig
  }
  
  return imageConfigs[0] || null
}

export interface ImageGenerateOptions {
  model?: string
  size?: string
  quality?: string
  n?: number
}

export interface ImageGenerateResult {
  image_url: string
  revised_prompt?: string
}

/**
 * 调用 AI API 生成图片
 */
export async function generateImage(
  prompt: string,
  options: ImageGenerateOptions = {}
): Promise<ImageGenerateResult> {
  const config = getImageAIConfig(options.model)
  
  if (!config) {
    throw new Error('未配置图片生成 AI 服务，请先在设置中添加 AI 配置')
  }
  
  const model = options.model || (Array.isArray(config.model) ? config.model[0] : config.model)
  const size = options.size || '2048x2048'
  const quality = options.quality || 'standard'
  const n = options.n || 1
  
  // 构建请求体 (OpenAI Images API 格式)
  const requestBody = {
    model,
    prompt,
    size,
    quality,
    n
  }
  
  // 构建请求 URL
  let url = config.base_url
  if (!url.endsWith('/')) {
    url += '/'
  }
  // 支持自定义 endpoint 或使用默认的 images/generations
  const endpoint = config.endpoint || 'images/generations'
  url += endpoint.startsWith('/') ? endpoint.slice(1) : endpoint
  
  console.log('[AIClient] Calling Image AI API:', { url, model, size, quality })
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.api_key}`
      },
      body: JSON.stringify(requestBody)
    })
    
    if (!response.ok) {
      const errorText = await response.text()
      console.error('[AIClient] Image API error:', response.status, errorText)
      throw new Error(`图片生成 API 调用失败: ${response.status} - ${errorText}`)
    }
    
    const data = await response.json()
    
    // 提取响应内容 (OpenAI Images 格式)
    const imageData = data.data?.[0]
    const imageUrl = imageData?.url || imageData?.b64_json || ''
    
    console.log('[AIClient] Image generated:', { hasUrl: !!imageUrl })
    
    return {
      image_url: imageUrl,
      revised_prompt: imageData?.revised_prompt
    }
  } catch (error: any) {
    console.error('[AIClient] Image request failed:', error)
    throw new Error(`图片生成请求失败: ${error.message}`)
  }
}

/**
 * 获取可用的视频生成 AI 配置
 */
function getVideoAIConfig(modelName?: string): AIServiceConfig | null {
  const configs = aiConfigCollection.getAll()
  let videoConfigs = configs
    .filter(c => c.service_type === 'video' && c.is_active)
    .sort((a, b) => (b.priority || 0) - (a.priority || 0))
  
  // 如果指定了模型名称，尝试找到匹配的配置
  if (modelName) {
    const matchedConfig = videoConfigs.find(c => {
      const models = Array.isArray(c.model) ? c.model : [c.model]
      return models.includes(modelName)
    })
    if (matchedConfig) return matchedConfig
  }
  
  return videoConfigs[0] || null
}

export interface VideoGenerateOptions {
  model?: string
  duration?: number
  fps?: number
  aspect_ratio?: string
  style?: string
  motion_level?: number
  camera_motion?: string
  seed?: number
  reference_mode?: string
  first_frame_url?: string
  last_frame_url?: string
  reference_image_urls?: string[]
}

export interface VideoGenerateResult {
  video_url: string
  task_id?: string
  duration?: number
  width?: number
  height?: number
}

// 缓存视频客户端实例
let cachedVideoClient: { config: AIServiceConfig; client: VideoClient } | null = null

/**
 * 获取或创建视频客户端
 */
function getOrCreateVideoClient(config: AIServiceConfig, modelName?: string): VideoClient {
  // 如果配置相同，复用缓存的客户端
  if (cachedVideoClient && cachedVideoClient.config.id === config.id) {
    return cachedVideoClient.client
  }
  
  // 创建新的客户端
  const client = createVideoClient(config, modelName)
  cachedVideoClient = { config, client }
  return client
}

/**
 * 调用 AI API 生成视频
 * 使用 provider 特定的客户端实现（对应 Go getVideoClient 逻辑）
 */
export async function generateVideo(
  imageUrl: string,
  prompt: string,
  options: VideoGenerateOptions = {}
): Promise<VideoGenerateResult> {
  const config = getVideoAIConfig(options.model)
  
  if (!config) {
    throw new Error('未配置视频生成 AI 服务，请先在设置中添加 AI 配置')
  }
  
  const model = options.model || (Array.isArray(config.model) ? config.model[0] : config.model)
  
  console.log('[AIClient] Creating video client for provider:', config.provider)
  
  // 使用工厂函数创建对应 provider 的客户端
  const client = getOrCreateVideoClient(config, model)
  
  // 构建请求
  const request: VideoGenerateRequest = {
    prompt,
    model,
    image_url: imageUrl || undefined,
    reference_mode: options.reference_mode,
    first_frame_url: options.first_frame_url,
    last_frame_url: options.last_frame_url,
    reference_image_urls: options.reference_image_urls,
    duration: options.duration,
    fps: options.fps,
    aspect_ratio: options.aspect_ratio,
    style: options.style,
    motion_level: options.motion_level,
    camera_motion: options.camera_motion,
    seed: options.seed
  }
  
  try {
    const result = await client.generate(request)
    
    console.log('[AIClient] Video generation result:', {
      hasVideoUrl: !!result.video_url,
      hasTaskId: !!result.task_id,
      provider: config.provider
    })
    
    return {
      video_url: result.video_url,
      task_id: result.task_id,
      duration: result.duration,
      width: result.width,
      height: result.height
    }
  } catch (error: any) {
    console.error('[AIClient] Video request failed:', error)
    throw new Error(`视频生成请求失败: ${error.message}`)
  }
}

/**
 * 轮询视频生成任务状态
 * 使用 provider 特定的客户端实现
 */
export async function pollVideoTaskStatus(
  taskId: string,
  modelName?: string
): Promise<VideoGenerateResult> {
  const config = getVideoAIConfig(modelName)
  
  if (!config) {
    throw new Error('未配置视频生成 AI 服务')
  }
  
  console.log('[AIClient] Polling video task with provider:', config.provider)
  
  // 使用工厂函数创建对应 provider 的客户端
  const client = getOrCreateVideoClient(config, modelName)
  
  try {
    const result = await client.pollTaskStatus(taskId)
    
    return {
      video_url: result.video_url,
      task_id: taskId,
      duration: result.duration,
      width: result.width,
      height: result.height
    }
  } catch (error: any) {
    console.error('[AIClient] Poll task failed:', error)
    throw new Error(`任务状态查询失败: ${error.message}`)
  }
}
