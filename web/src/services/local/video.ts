/**
 * 视频生成本地存储 API
 * 根据 Go video_generation_service.go 业务逻辑实现
 */

import type {
  GenerateVideoRequest,
  VideoGeneration,
  VideoGenerationListParams
} from '../../types/video'
import type { Drama, Storyboard } from '../../types/drama'
import {
  STORAGE_KEYS,
  StorageCollection,
  generateNumericId,
  now,
  paginate,
  getItem,
  setItem
} from '../storage'
import { generateVideo as aiGenerateVideo, pollVideoTaskStatus } from './aiClient'

const videoCollection = new StorageCollection<VideoGeneration>(STORAGE_KEYS.VIDEOS)

// ========== 辅助函数 ==========

/**
 * 获取所有 dramas
 */
function getAllDramas(): Drama[] {
  return getItem<Drama[]>(STORAGE_KEYS.DRAMAS) || []
}

/**
 * 保存所有 dramas
 */
function saveDramas(dramas: Drama[]): void {
  setItem(STORAGE_KEYS.DRAMAS, dramas)
}

/**
 * 更新 storyboard 的 video_url
 */
function updateStoryboardVideoUrl(storyboardId: number, videoUrl: string): void {
  const dramas = getAllDramas()
  const sbId = String(storyboardId)
  
  for (const drama of dramas) {
    if (!drama.episodes) continue
    
    for (const episode of drama.episodes) {
      const sbIndex = episode.storyboards?.findIndex(sb => String(sb.id) === sbId)
      if (sbIndex !== undefined && sbIndex !== -1 && episode.storyboards) {
        episode.storyboards[sbIndex].video_url = videoUrl
        saveDramas(dramas)
        console.log('[Video] Updated storyboard video_url', { storyboard_id: storyboardId })
        return
      }
    }
  }
}

/**
 * 根据 episodeId 查找 episode 及 drama
 */
function findEpisodeWithDrama(episodeId: string | number): { drama: Drama; episode: any } | null {
  const dramas = getAllDramas()
  const epId = String(episodeId)
  
  for (const drama of dramas) {
    const episode = drama.episodes?.find(e => String(e.id) === epId)
    if (episode) {
      return { drama, episode }
    }
  }
  return null
}

// ========== 视频生成处理 ==========

/**
 * 异步处理视频生成（对应 Go ProcessVideoGeneration）
 */
async function processVideoGeneration(videoGenId: number): Promise<void> {
  const videoGen = videoCollection.getById(videoGenId)
  if (!videoGen) {
    console.error('[Video] Video generation not found', { id: videoGenId })
    return
  }
  
  // 更新状态为处理中
  videoCollection.update(videoGenId, {
    status: 'processing',
    updated_at: now()
  })
  
  console.log('[Video] Starting video generation', {
    id: videoGenId,
    prompt: videoGen.prompt,
    provider: videoGen.provider,
    model: videoGen.model
  })
  
  try {
    // 构建选项
    const options: any = {
      model: videoGen.model
    }
    
    if (videoGen.duration) options.duration = videoGen.duration
    if (videoGen.fps) options.fps = videoGen.fps
    if (videoGen.aspect_ratio) options.aspect_ratio = videoGen.aspect_ratio
    if (videoGen.style) options.style = videoGen.style
    if (videoGen.motion_level) options.motion_level = videoGen.motion_level
    if (videoGen.camera_motion) options.camera_motion = videoGen.camera_motion
    if (videoGen.seed) options.seed = videoGen.seed
    
    // 根据参考图模式添加相应的选项
    if (videoGen.reference_mode) {
      options.reference_mode = videoGen.reference_mode
      
      if (videoGen.reference_mode === 'first_last') {
        if (videoGen.first_frame_url) options.first_frame_url = videoGen.first_frame_url
        if (videoGen.last_frame_url) options.last_frame_url = videoGen.last_frame_url
      } else if (videoGen.reference_mode === 'multiple') {
        if (videoGen.reference_image_urls) {
          options.reference_image_urls = videoGen.reference_image_urls
        }
      }
    }
    
    // 调用 AI 视频生成
    const imageUrl = videoGen.image_url || ''
    const result = await aiGenerateVideo(imageUrl, videoGen.prompt, options)
    
    console.log('[Video] AI generation response', { 
      id: videoGenId, 
      hasUrl: !!result.video_url,
      hasTaskId: !!result.task_id
    })
    
    // 如果返回 task_id，启动轮询
    if (result.task_id && !result.video_url) {
      videoCollection.update(videoGenId, {
        task_id: result.task_id,
        status: 'processing',
        updated_at: now()
      })
      
      // 启动轮询
      pollTaskStatusLoop(videoGenId, result.task_id, videoGen.provider, videoGen.model)
      return
    }
    
    // 如果直接返回 video_url，完成生成
    if (result.video_url) {
      completeVideoGeneration(videoGenId, result.video_url, result.duration, result.width, result.height)
      return
    }
    
    // 没有返回 task_id 或 video_url
    updateVideoGenError(videoGenId, 'no task ID or video URL returned')
    
  } catch (error: any) {
    console.error('[Video] Generation failed:', error)
    updateVideoGenError(videoGenId, error.message || '视频生成失败')
  }
}

/**
 * 轮询任务状态（对应 Go pollTaskStatus）
 */
async function pollTaskStatusLoop(
  videoGenId: number, 
  taskId: string, 
  provider: string, 
  model?: string
): Promise<void> {
  const maxAttempts = 60  // 最大轮询次数
  const pollInterval = 5000  // 轮询间隔（毫秒）
  
  console.log('[Video] Starting task polling', { videoGenId, taskId })
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // 等待一段时间
    await new Promise(resolve => setTimeout(resolve, pollInterval))
    
    try {
      const result = await pollVideoTaskStatus(taskId, model)
      
      if (result.video_url) {
        console.log('[Video] Task completed', { videoGenId, taskId })
        completeVideoGeneration(videoGenId, result.video_url, result.duration, result.width, result.height)
        return
      }
      
      console.log('[Video] Task still processing', { videoGenId, taskId, attempt: attempt + 1 })
      
    } catch (error: any) {
      console.error('[Video] Poll error:', error)
      // 继续轮询，除非是严重错误
      if (error.message?.includes('not found') || error.message?.includes('failed')) {
        updateVideoGenError(videoGenId, error.message)
        return
      }
    }
  }
  
  // 超时
  updateVideoGenError(videoGenId, '视频生成超时')
}

/**
 * 完成视频生成（对应 Go completeVideoGeneration）
 */
function completeVideoGeneration(
  videoGenId: number, 
  videoUrl: string,
  duration?: number,
  width?: number,
  height?: number
): void {
  const videoGen = videoCollection.getById(videoGenId)
  if (!videoGen) {
    console.error('[Video] Video generation not found', { id: videoGenId })
    return
  }
  
  // 更新 video_generation 记录
  videoCollection.update(videoGenId, {
    status: 'completed',
    video_url: videoUrl,
    duration: duration,
    width: width,
    height: height,
    completed_at: now(),
    updated_at: now()
  })
  
  console.log('[Video] Video generation completed', { id: videoGenId })
  
  // 如果关联了 storyboard，同步更新 storyboard 的 video_url
  if (videoGen.storyboard_id) {
    updateStoryboardVideoUrl(videoGen.storyboard_id, videoUrl)
  }
}

/**
 * 更新视频生成错误（对应 Go updateVideoGenError）
 */
function updateVideoGenError(videoGenId: number, errorMsg: string): void {
  videoCollection.update(videoGenId, {
    status: 'failed',
    error_msg: errorMsg,
    updated_at: now()
  })
  
  console.error('[Video] Video generation failed', { id: videoGenId, error: errorMsg })
}

// ========== 导出 API ==========

export const localVideoAPI = {
  /**
   * 生成视频（对应 Go GenerateVideo）
   */
  async generateVideo(data: GenerateVideoRequest): Promise<VideoGeneration> {
    // 验证 drama 存在
    const dramas = getAllDramas()
    const drama = dramas.find(d => String(d.id) === String(data.drama_id))
    if (!drama) {
      throw new Error('Drama not found')
    }
    
    // 如果关联 storyboard，验证其存在且属于该 drama
    if (data.storyboard_id) {
      let storyboardFound = false
      const sbId = String(data.storyboard_id)
      for (const ep of drama.episodes || []) {
        if (ep.storyboards?.some(sb => String(sb.id) === sbId)) {
          storyboardFound = true
          break
        }
      }
      if (!storyboardFound) {
        throw new Error('Storyboard not found or does not belong to drama')
      }
    }
    
    // 设置默认值
    const provider = data.provider || 'doubao'
    
    // 创建 video_generation 记录
    const video: VideoGeneration = {
      id: generateNumericId('video'),
      drama_id: data.drama_id,
      storyboard_id: data.storyboard_id,
      scene_id: data.scene_id,
      image_gen_id: data.image_gen_id,
      prompt: data.prompt,
      provider: provider,
      model: data.model,
      duration: data.duration,
      fps: data.fps,
      aspect_ratio: data.aspect_ratio,
      style: data.style,
      motion_level: data.motion_level,
      camera_motion: data.camera_motion,
      seed: data.seed,
      status: 'pending',
      created_at: now(),
      updated_at: now()
    } as VideoGeneration
    
    // 根据参考图模式处理不同的参数
    const referenceMode = data.reference_mode || ''
    if (referenceMode) {
      video.reference_mode = referenceMode
    }
    
    switch (referenceMode) {
      case 'single':
        if (data.image_url) video.image_url = data.image_url
        break
      case 'first_last':
        if (data.first_frame_url) video.first_frame_url = data.first_frame_url
        if (data.last_frame_url) video.last_frame_url = data.last_frame_url
        break
      case 'multiple':
        if (data.reference_image_urls && data.reference_image_urls.length > 0) {
          video.reference_image_urls = data.reference_image_urls
        }
        break
      case 'none':
        // 无参考图，纯文本生成
        break
      default:
        // 向后兼容：根据提供的参数自动判断
        if (data.image_url) {
          video.image_url = data.image_url
          video.reference_mode = 'single'
        } else if (data.first_frame_url || data.last_frame_url) {
          video.first_frame_url = data.first_frame_url
          video.last_frame_url = data.last_frame_url
          video.reference_mode = 'first_last'
        } else if (data.reference_image_urls && data.reference_image_urls.length > 0) {
          video.reference_image_urls = data.reference_image_urls
          video.reference_mode = 'multiple'
        }
    }
    
    const savedVideo = videoCollection.add(video)
    
    // 异步处理视频生成（模拟 Go 的 goroutine）
    setTimeout(() => {
      processVideoGeneration(savedVideo.id)
    }, 0)
    
    return savedVideo
  },

  /**
   * 从图片生成视频
   */
  async generateFromImage(imageGenId: number, dramaId: string, prompt: string): Promise<VideoGeneration> {
    return this.generateVideo({
      drama_id: dramaId,
      image_gen_id: imageGenId,
      prompt: prompt,
      reference_mode: 'single'
    })
  },

  /**
   * 批量为剧集生成视频
   */
  async batchGenerateForEpisode(episodeId: string): Promise<VideoGeneration[]> {
    const found = findEpisodeWithDrama(episodeId)
    if (!found) {
      throw new Error('Episode not found')
    }
    
    const { drama, episode } = found
    const storyboards = episode.storyboards || []
    const results: VideoGeneration[] = []
    
    console.log('[Video] Batch generating for episode', {
      episode_id: episodeId,
      storyboard_count: storyboards.length
    })
    
    for (const sb of storyboards) {
      // 检查是否有 video_prompt 或 image_url
      if (!sb.video_prompt && !sb.composed_image) {
        console.warn('[Video] Storyboard has no video_prompt or composed_image, skipping', { storyboard_id: sb.id })
        continue
      }
      
      try {
        const videoGen = await this.generateVideo({
          storyboard_id: sb.id,
          drama_id: String(drama.id),
          prompt: sb.video_prompt || '',
          image_url: sb.composed_image
        })
        
        console.log('[Video] Storyboard video generation started', {
          storyboard_id: sb.id,
          video_gen_id: videoGen.id
        })
        
        results.push(videoGen)
      } catch (error) {
        console.error('[Video] Failed to generate video for storyboard', {
          storyboard_id: sb.id,
          error
        })
      }
    }
    
    return results
  },

  /**
   * 获取视频生成记录
   */
  async getVideoGeneration(id: number): Promise<VideoGeneration> {
    const video = videoCollection.getById(id)
    if (!video) {
      throw new Error('视频不存在')
    }
    return video
  },

  async getVideo(id: number): Promise<VideoGeneration> {
    return this.getVideoGeneration(id)
  },

  /**
   * 列出视频生成记录
   */
  async listVideos(params: VideoGenerationListParams) {
    let items = videoCollection.getAll()
    
    if (params.drama_id) {
      items = items.filter(i => String(i.drama_id) === String(params.drama_id))
    }
    if (params.storyboard_id) {
      items = items.filter(i => String(i.storyboard_id) === params.storyboard_id)
    }
    if (params.status) {
      // 支持逗号分隔的多状态过滤
      const statuses = params.status.split(',').map(s => s.trim())
      items = items.filter(i => statuses.includes(i.status))
    }
    
    items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    
    return paginate(items, params.page || 1, params.page_size || 20)
  },

  /**
   * 删除视频生成记录
   */
  async deleteVideo(id: number): Promise<void> {
    const video = videoCollection.getById(id)
    if (!video) {
      throw new Error('Video generation not found')
    }
    videoCollection.delete(id)
  },

  /**
   * 本地上传视频
   */
  async uploadVideo(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        resolve(reader.result as string)
      }
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }
}
