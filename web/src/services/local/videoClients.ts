/**
 * 视频生成客户端
 * 根据 Go video_generation_service.go 中 getVideoClient 逻辑实现
 * 支持不同厂商的请求格式差异
 */

import type { AIServiceConfig } from '../../types/ai'

// ========== 接口定义 ==========

export interface VideoGenerateRequest {
  prompt: string
  model?: string
  image_url?: string
  first_frame_url?: string
  last_frame_url?: string
  reference_image_urls?: string[]
  duration?: number
  fps?: number
  aspect_ratio?: string
  style?: string
  motion_level?: number
  camera_motion?: string
  seed?: number
  reference_mode?: string
}

export interface VideoGenerateResponse {
  video_url: string
  task_id?: string
  duration?: number
  width?: number
  height?: number
  status?: string
}

export interface VideoClient {
  generate(request: VideoGenerateRequest): Promise<VideoGenerateResponse>
  pollTaskStatus(taskId: string): Promise<VideoGenerateResponse>
}

// ========== Chatfire 客户端 ==========
// 对应 Go chatfire_client.go，支持 3 种请求格式：doubao/seedance, sora, default

export class ChatfireVideoClient implements VideoClient {
  constructor(
    private baseUrl: string,
    private apiKey: string,
    private model: string,
    private endpoint: string = '/video/generations',
    private queryEndpoint: string = '/video/task/{taskId}'
  ) {}

  async generate(request: VideoGenerateRequest): Promise<VideoGenerateResponse> {
    const url = this.buildUrl(this.endpoint)
    const model = request.model || this.model
    
    let body: any

    // 根据模型名称选择请求格式（与 Go chatfire_client.go 一致）
    if (model.includes('doubao') || model.includes('seedance')) {
      // 豆包/火山格式 - ChatfireDoubaoRequest
      body = this.buildDoubaoRequest(model, request)
    } else if (model.includes('sora')) {
      // Sora 格式 - ChatfireSoraRequest
      body = this.buildSoraRequest(model, request)
    } else {
      // 默认格式 - ChatfireRequest
      body = this.buildDefaultRequest(model, request)
    }

    console.log('[ChatfireVideoClient] Generate request:', { url, model, format: model.includes('doubao') ? 'doubao' : model.includes('sora') ? 'sora' : 'default' })

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Chatfire video API error: ${response.status} - ${errorText}`)
    }

    const data = await response.json()
    console.log('[ChatfireVideoClient] Response:', data)

    // 解析响应（与 Go 一致：优先 id，其次 task_id，再看 data 嵌套）
    let taskId = data.id || data.task_id || ''
    if (data.data?.id) taskId = data.data.id

    let status = data.status || ''
    if (!status && data.data?.status) status = data.data.status

    return {
      video_url: data.video_url || data.data?.video_url || '',
      task_id: taskId,
      status: status,
      duration: data.duration || data.data?.duration,
      width: data.width || data.data?.width,
      height: data.height || data.data?.height
    }
  }

  // 豆包/火山格式请求体
  private buildDoubaoRequest(model: string, request: VideoGenerateRequest): any {
    const content: any[] = []

    // 构建 prompt 文本（包含 duration 和 ratio 参数）
    let promptText = request.prompt
    if (request.aspect_ratio) {
      promptText += `  --ratio ${request.aspect_ratio}`
    }
    if (request.duration) {
      promptText += `  --dur ${request.duration}`
    }

    // 添加文本内容
    content.push({ type: 'text', text: promptText })

    // 处理不同的图片模式
    if (request.reference_image_urls && request.reference_image_urls.length > 0) {
      // 1. 组图模式（多个 reference_image）
      for (const refUrl of request.reference_image_urls) {
        content.push({
          type: 'image_url',
          image_url: { url: refUrl },
          role: 'reference_image'
        })
      }
    } else if (request.first_frame_url && request.last_frame_url) {
      // 2. 首尾帧模式
      content.push({
        type: 'image_url',
        image_url: { url: request.first_frame_url },
        role: 'first_frame'
      })
      content.push({
        type: 'image_url',
        image_url: { url: request.last_frame_url },
        role: 'last_frame'
      })
    } else if (request.image_url) {
      // 3. 单图模式（默认）
      content.push({
        type: 'image_url',
        image_url: { url: request.image_url }
        // 单图模式不需要 role
      })
    } else if (request.first_frame_url) {
      // 4. 只有首帧
      content.push({
        type: 'image_url',
        image_url: { url: request.first_frame_url },
        role: 'first_frame'
      })
    }

    return { model, content }
  }

  // Sora 格式请求体
  private buildSoraRequest(model: string, request: VideoGenerateRequest): any {
    const seconds = request.duration ? String(request.duration) : '5'
    let size = request.aspect_ratio || '16:9'
    
    // 转换 aspect_ratio 为 size
    if (size === '16:9') size = '1280x720'
    else if (size === '9:16') size = '720x1280'

    return {
      model,
      prompt: request.prompt,
      seconds,
      size,
      input_reference: request.image_url || ''
    }
  }

  // 默认格式请求体
  private buildDefaultRequest(model: string, request: VideoGenerateRequest): any {
    return {
      model,
      prompt: request.prompt,
      image_url: request.image_url || '',
      duration: request.duration || 5,
      size: request.aspect_ratio || '16:9'
    }
  }

  async pollTaskStatus(taskId: string): Promise<VideoGenerateResponse> {
    // 替换路径中的占位符（与 Go 一致）
    let queryPath = this.queryEndpoint
    if (queryPath.includes('{taskId}')) {
      queryPath = queryPath.replace('{taskId}', taskId)
    } else if (queryPath.includes('{task_id}')) {
      queryPath = queryPath.replace('{task_id}', taskId)
    } else {
      queryPath = queryPath + '/' + taskId
    }

    const url = this.buildUrl(queryPath)
    console.log('[ChatfireVideoClient] Poll task:', { url, taskId })

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`
      }
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Task status query failed: ${response.status} - ${errorText}`)
    }

    const data = await response.json()
    console.log('[ChatfireVideoClient] Poll response:', data)

    // 解析响应（与 Go ChatfireTaskResponse 一致）
    let responseTaskId = data.id || data.task_id || ''
    if (data.data?.id) responseTaskId = data.data.id

    let status = data.status || ''
    if (!status && data.data?.status) status = data.data.status

    // 按优先级获取 video_url：VideoURL -> Data.VideoURL -> Content.VideoURL
    let videoUrl = data.video_url || ''
    if (!videoUrl && data.data?.video_url) videoUrl = data.data.video_url
    if (!videoUrl && data.content?.video_url) videoUrl = data.content.video_url

    return {
      video_url: videoUrl,
      task_id: responseTaskId || taskId,
      status: status,
      duration: data.duration || data.data?.duration,
      width: data.width || data.data?.width,
      height: data.height || data.data?.height
    }
  }

  private buildUrl(endpoint: string): string {
    let url = this.baseUrl
    if (url.endsWith('/')) url = url.slice(0, -1)
    if (!endpoint.startsWith('/')) endpoint = '/' + endpoint
    return url + endpoint
  }
}

// ========== 火山引擎/豆包 客户端 ==========

export class VolcesArkVideoClient implements VideoClient {
  constructor(
    private baseUrl: string,
    private apiKey: string,
    private model: string,
    private endpoint: string = '/contents/generations/tasks',
    private queryEndpoint: string = '/contents/generations/tasks/{taskId}'
  ) {}

  async generate(request: VideoGenerateRequest): Promise<VideoGenerateResponse> {
    const url = this.buildUrl(this.endpoint)
    
    // 火山引擎格式的请求体
    const body: any = {
      model: request.model || this.model,
      content: [{
        type: 'text',
        text: request.prompt
      }]
    }

    // 添加参考图（火山引擎使用 content 数组格式）
    if (request.image_url) {
      body.content.unshift({
        type: 'image_url',
        image_url: { url: request.image_url }
      })
    } else if (request.first_frame_url) {
      body.content.unshift({
        type: 'image_url',
        image_url: { url: request.first_frame_url }
      })
    }

    // 火山引擎特有参数
    if (request.duration) body.duration = request.duration
    if (request.aspect_ratio) body.aspect_ratio = request.aspect_ratio
    if (request.seed) body.seed = request.seed

    console.log('[VolcesArkVideoClient] Generate request:', { url, model: body.model })

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Volcengine video API error: ${response.status} - ${errorText}`)
    }

    const data = await response.json()
    
    // 火山引擎返回格式
    return {
      video_url: data.data?.video_url || data.video_url || '',
      task_id: data.data?.task_id || data.task_id || data.id || '',
      duration: data.data?.duration || data.duration,
      width: data.data?.width || data.width,
      height: data.data?.height || data.height,
      status: data.data?.status || data.status
    }
  }

  async pollTaskStatus(taskId: string): Promise<VideoGenerateResponse> {
    const endpoint = this.queryEndpoint.replace('{taskId}', taskId)
    const url = this.buildUrl(endpoint)

    console.log('[VolcesArkVideoClient] Poll task:', { url, taskId })

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`
      }
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Task status query failed: ${response.status} - ${errorText}`)
    }

    const data = await response.json()
    
    // 火山引擎返回格式
    const videoData = data.data || data
    return {
      video_url: videoData.video_url || videoData.output?.video_url || '',
      task_id: taskId,
      duration: videoData.duration || videoData.output?.duration,
      width: videoData.width || videoData.output?.width,
      height: videoData.height || videoData.output?.height,
      status: videoData.status || videoData.task_status
    }
  }

  private buildUrl(endpoint: string): string {
    let url = this.baseUrl
    if (!url.endsWith('/')) url += '/'
    return url + (endpoint.startsWith('/') ? endpoint.slice(1) : endpoint)
  }
}

// ========== OpenAI Sora 客户端 ==========
// 对应 Go openai_sora_client.go，使用 multipart/form-data 格式

export class OpenAISoraVideoClient implements VideoClient {
  constructor(
    private baseUrl: string,
    private apiKey: string,
    private model: string,
    private endpoint: string = '/videos',
    private queryEndpoint: string = '/videos/{taskId}'
  ) {}

  async generate(request: VideoGenerateRequest): Promise<VideoGenerateResponse> {
    const url = this.buildUrl(this.endpoint)
    const model = request.model || this.model

    // 使用 FormData（对应 Go 的 multipart.Writer）
    const formData = new FormData()
    formData.append('model', model)
    formData.append('prompt', request.prompt)

    // input_reference 对应图片 URL
    if (request.image_url) {
      formData.append('input_reference', request.image_url)
    }

    // seconds 对应时长
    if (request.duration) {
      formData.append('seconds', String(request.duration))
    }

    // size 对应分辨率
    if (request.aspect_ratio) {
      let size = request.aspect_ratio
      if (size === '16:9') size = '1280x720'
      else if (size === '9:16') size = '720x1280'
      formData.append('size', size)
    }

    console.log('[OpenAISoraVideoClient] Generate request:', { url, model })

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`
        // 不设置 Content-Type，让浏览器自动设置 multipart/form-data 和 boundary
      },
      body: formData
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`OpenAI Sora API error: ${response.status} - ${errorText}`)
    }

    const data = await response.json()
    console.log('[OpenAISoraVideoClient] Response:', data)

    // 检查错误
    if (data.error?.message) {
      throw new Error(`OpenAI error: ${data.error.message}`)
    }

    // 优先使用 video_url 字段，兼容 video.url 嵌套结构
    let videoUrl = data.video_url || ''
    if (!videoUrl && data.video?.url) videoUrl = data.video.url

    return {
      video_url: videoUrl,
      task_id: data.id || '',
      status: data.status || '',
      duration: data.duration,
      width: data.width,
      height: data.height
    }
  }

  async pollTaskStatus(taskId: string): Promise<VideoGenerateResponse> {
    const url = this.buildUrl(`/videos/${taskId}`)

    console.log('[OpenAISoraVideoClient] Poll task:', { url, taskId })

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`
      }
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Task status query failed: ${response.status} - ${errorText}`)
    }

    const data = await response.json()
    console.log('[OpenAISoraVideoClient] Poll response:', data)

    // 优先使用 video_url 字段，兼容 video.url 嵌套结构
    let videoUrl = data.video_url || ''
    if (!videoUrl && data.video?.url) videoUrl = data.video.url

    return {
      video_url: videoUrl,
      task_id: data.id || taskId,
      status: data.status || '',
      duration: data.duration,
      width: data.width,
      height: data.height
    }
  }

  private buildUrl(endpoint: string): string {
    let url = this.baseUrl
    if (url.endsWith('/')) url = url.slice(0, -1)
    if (!endpoint.startsWith('/')) endpoint = '/' + endpoint
    return url + endpoint
  }
}

// ========== Runway 客户端 ==========

export class RunwayVideoClient implements VideoClient {
  constructor(
    private baseUrl: string,
    private apiKey: string,
    private model: string
  ) {}

  async generate(request: VideoGenerateRequest): Promise<VideoGenerateResponse> {
    const url = this.buildUrl('/generations')
    
    const body: any = {
      model: request.model || this.model,
      text_prompt: request.prompt
    }

    if (request.image_url) body.init_image = request.image_url
    if (request.duration) body.seconds = request.duration
    if (request.seed) body.seed = request.seed

    console.log('[RunwayVideoClient] Generate request:', { url, model: body.model })

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Runway API error: ${response.status} - ${errorText}`)
    }

    const data = await response.json()
    return {
      video_url: data.output?.[0] || data.video_url || '',
      task_id: data.id || '',
      status: data.status
    }
  }

  async pollTaskStatus(taskId: string): Promise<VideoGenerateResponse> {
    const url = this.buildUrl(`/generations/${taskId}`)

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`
      }
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Task status query failed: ${response.status} - ${errorText}`)
    }

    const data = await response.json()
    return {
      video_url: data.output?.[0] || data.video_url || '',
      task_id: taskId,
      status: data.status
    }
  }

  private buildUrl(endpoint: string): string {
    let url = this.baseUrl
    if (!url.endsWith('/')) url += '/'
    return url + (endpoint.startsWith('/') ? endpoint.slice(1) : endpoint)
  }
}

// ========== Pika 客户端 ==========

export class PikaVideoClient implements VideoClient {
  constructor(
    private baseUrl: string,
    private apiKey: string,
    private model: string
  ) {}

  async generate(request: VideoGenerateRequest): Promise<VideoGenerateResponse> {
    const url = this.buildUrl('/generate')
    
    const body: any = {
      model: request.model || this.model,
      promptText: request.prompt
    }

    if (request.image_url) body.image = request.image_url
    if (request.style) body.style = request.style
    if (request.motion_level) body.motion = request.motion_level
    if (request.aspect_ratio) body.aspectRatio = request.aspect_ratio

    console.log('[PikaVideoClient] Generate request:', { url, model: body.model })

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Pika API error: ${response.status} - ${errorText}`)
    }

    const data = await response.json()
    return {
      video_url: data.video?.url || data.video_url || '',
      task_id: data.id || data.task_id || '',
      status: data.status
    }
  }

  async pollTaskStatus(taskId: string): Promise<VideoGenerateResponse> {
    const url = this.buildUrl(`/job/${taskId}`)

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`
      }
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Task status query failed: ${response.status} - ${errorText}`)
    }

    const data = await response.json()
    return {
      video_url: data.video?.url || data.video_url || '',
      task_id: taskId,
      status: data.status
    }
  }

  private buildUrl(endpoint: string): string {
    let url = this.baseUrl
    if (!url.endsWith('/')) url += '/'
    return url + (endpoint.startsWith('/') ? endpoint.slice(1) : endpoint)
  }
}

// ========== Minimax 客户端 ==========

export class MinimaxVideoClient implements VideoClient {
  constructor(
    private baseUrl: string,
    private apiKey: string,
    private model: string
  ) {}

  async generate(request: VideoGenerateRequest): Promise<VideoGenerateResponse> {
    const url = this.buildUrl('/video_generation')
    
    const body: any = {
      model: request.model || this.model,
      prompt: request.prompt
    }

    if (request.image_url) body.first_frame_image = request.image_url

    console.log('[MinimaxVideoClient] Generate request:', { url, model: body.model })

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Minimax API error: ${response.status} - ${errorText}`)
    }

    const data = await response.json()
    return {
      video_url: data.video_url || '',
      task_id: data.task_id || '',
      status: data.status
    }
  }

  async pollTaskStatus(taskId: string): Promise<VideoGenerateResponse> {
    const url = this.buildUrl(`/query/video_generation?task_id=${taskId}`)

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`
      }
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Task status query failed: ${response.status} - ${errorText}`)
    }

    const data = await response.json()
    return {
      video_url: data.file_id ? `${this.baseUrl}/files/retrieve?file_id=${data.file_id}` : '',
      task_id: taskId,
      status: data.status
    }
  }

  private buildUrl(endpoint: string): string {
    let url = this.baseUrl
    if (!url.endsWith('/')) url += '/'
    return url + (endpoint.startsWith('/') ? endpoint.slice(1) : endpoint)
  }
}

// ========== 工厂函数 ==========

/**
 * 根据 AI 配置创建对应的视频客户端
 * 对应 Go getVideoClient 函数逻辑
 */
export function createVideoClient(config: AIServiceConfig, modelName?: string): VideoClient {
  const baseUrl = config.base_url
  const apiKey = config.api_key
  const model = modelName || (Array.isArray(config.model) ? config.model[0] : config.model) || ''
  
  // 从配置中获取 endpoint，如果没有则使用默认值
  const endpoint = config.endpoint || ''
  const queryEndpoint = config.query_endpoint || ''

  switch (config.provider) {
    case 'chatfire':
      return new ChatfireVideoClient(
        baseUrl,
        apiKey,
        model,
        endpoint || '/video/generations',
        queryEndpoint || '/video/task/{taskId}'
      )

    case 'doubao':
    case 'volcengine':
    case 'volces':
      return new VolcesArkVideoClient(
        baseUrl,
        apiKey,
        model,
        endpoint || '/contents/generations/tasks',
        queryEndpoint || '/contents/generations/tasks/{taskId}'
      )

    case 'openai':
      return new OpenAISoraVideoClient(
        baseUrl,
        apiKey,
        model,
        endpoint || '/videos',
        queryEndpoint || '/videos/{taskId}'
      )

    case 'runway':
      return new RunwayVideoClient(baseUrl, apiKey, model)

    case 'pika':
      return new PikaVideoClient(baseUrl, apiKey, model)

    case 'minimax':
      return new MinimaxVideoClient(baseUrl, apiKey, model)

    default:
      // 默认使用 Chatfire 格式
      console.warn(`[VideoClient] Unknown provider: ${config.provider}, using Chatfire format`)
      return new ChatfireVideoClient(
        baseUrl,
        apiKey,
        model,
        endpoint || '/video/generations',
        queryEndpoint || '/video/task/{taskId}'
      )
  }
}
