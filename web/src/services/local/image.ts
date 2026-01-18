/**
 * 图片生成本地存储 API
 * 根据 Go image_generation_service.go 业务逻辑实现
 */

import type {
  GenerateImageRequest,
  ImageGeneration,
  ImageGenerationListParams
} from '../../types/image'
import type { Drama, Scene, Storyboard, Character } from '../../types/drama'
import {
  STORAGE_KEYS,
  StorageCollection,
  generateNumericId,
  now,
  paginate,
  getItem,
  setItem
} from '../storage'
import { generateImage as aiGenerateImage } from './aiClient'

const imageCollection = new StorageCollection<ImageGeneration>(STORAGE_KEYS.IMAGES)

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
 * 更新 drama 中的 storyboard composed_image
 */
function updateStoryboardComposedImage(storyboardId: number, imageUrl: string): void {
  const dramas = getAllDramas()
  const sbId = String(storyboardId)
  
  for (const drama of dramas) {
    if (!drama.episodes) continue
    
    for (const episode of drama.episodes) {
      const sbIndex = episode.storyboards?.findIndex(sb => String(sb.id) === sbId)
      if (sbIndex !== undefined && sbIndex !== -1 && episode.storyboards) {
        episode.storyboards[sbIndex].composed_image = imageUrl
        saveDramas(dramas)
        console.log('[Image] Updated storyboard composed_image', { storyboard_id: storyboardId })
        return
      }
    }
  }
}

/**
 * 更新 drama 中的 scene image_url 和 status
 */
function updateSceneImage(sceneId: number | string, imageUrl: string, status: string): void {
  const dramas = getAllDramas()
  const sId = String(sceneId)
  
  for (const drama of dramas) {
    const sceneIndex = drama.scenes?.findIndex(s => String(s.id) === sId)
    if (sceneIndex !== undefined && sceneIndex !== -1 && drama.scenes) {
      drama.scenes[sceneIndex].image_url = imageUrl
      drama.scenes[sceneIndex].status = status
      
      // 同步到 episodes.scenes
      if (drama.episodes) {
        for (const ep of drama.episodes) {
          const epSceneIndex = ep.scenes?.findIndex(s => String(s.id) === sId)
          if (epSceneIndex !== undefined && epSceneIndex !== -1 && ep.scenes) {
            ep.scenes[epSceneIndex].image_url = imageUrl
            ep.scenes[epSceneIndex].status = status
          }
        }
      }
      
      saveDramas(dramas)
      console.log('[Image] Updated scene image', { scene_id: sceneId, status })
      return
    }
  }
}

/**
 * 更新 drama 中的 character image_url
 */
function updateCharacterImage(characterId: number, imageUrl: string): void {
  const dramas = getAllDramas()
  const charId = String(characterId)
  
  for (const drama of dramas) {
    const charIndex = drama.characters?.findIndex(c => String(c.id) === charId)
    if (charIndex !== undefined && charIndex !== -1 && drama.characters) {
      drama.characters[charIndex].image_url = imageUrl
      
      // 同步到 episodes.characters
      if (drama.episodes) {
        for (const ep of drama.episodes) {
          const epCharIndex = ep.characters?.findIndex(c => String(c.id) === charId)
          if (epCharIndex !== undefined && epCharIndex !== -1 && ep.characters) {
            ep.characters[epCharIndex].image_url = imageUrl
          }
        }
      }
      
      saveDramas(dramas)
      console.log('[Image] Updated character image', { character_id: characterId })
      return
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

/**
 * 根据 sceneId 查找 scene 及 drama
 */
function findSceneWithDrama(sceneId: string | number): { drama: Drama; scene: Scene } | null {
  const dramas = getAllDramas()
  const sId = String(sceneId)
  
  for (const drama of dramas) {
    const scene = drama.scenes?.find(s => String(s.id) === sId)
    if (scene) {
      return { drama, scene }
    }
  }
  return null
}

// ========== 图片生成处理 ==========

/**
 * 异步处理图片生成（对应 Go ProcessImageGeneration）
 */
async function processImageGeneration(imageGenId: number): Promise<void> {
  const imageGen = imageCollection.getById(imageGenId)
  if (!imageGen) {
    console.error('[Image] Image generation not found', { id: imageGenId })
    return
  }
  
  // 更新状态为处理中
  imageCollection.update(imageGenId, {
    status: 'processing',
    updated_at: now()
  })
  
  console.log('[Image] Starting image generation', {
    id: imageGenId,
    prompt: imageGen.prompt,
    provider: imageGen.provider,
    model: imageGen.model
  })
  
  try {
    // 调用 AI 图片生成
    const result = await aiGenerateImage(imageGen.prompt, {
      model: imageGen.model,
      size: imageGen.size,
      quality: imageGen.quality
    })
    
    console.log('[Image] AI generation completed', { id: imageGenId, hasUrl: !!result.image_url })
    
    // 完成图片生成
    completeImageGeneration(imageGenId, result.image_url)
    
  } catch (error: any) {
    console.error('[Image] Generation failed:', error)
    updateImageGenError(imageGenId, error.message || '图片生成失败')
  }
}

/**
 * 完成图片生成（对应 Go completeImageGeneration）
 */
function completeImageGeneration(imageGenId: number, imageUrl: string): void {
  const imageGen = imageCollection.getById(imageGenId)
  if (!imageGen) {
    console.error('[Image] Image generation not found', { id: imageGenId })
    return
  }
  
  // 更新 image_generation 记录
  imageCollection.update(imageGenId, {
    status: 'completed',
    image_url: imageUrl,
    completed_at: now(),
    updated_at: now()
  })
  
  console.log('[Image] Image generation completed', { id: imageGenId })
  
  // 如果关联了 storyboard，同步更新 storyboard 的 composed_image
  if (imageGen.storyboard_id) {
    updateStoryboardComposedImage(imageGen.storyboard_id, imageUrl)
  }
  
  // 如果关联了 scene 且 image_type 是 scene，同步更新 scene
  if (imageGen.scene_id && imageGen.image_type === 'scene') {
    updateSceneImage(imageGen.scene_id, imageUrl, 'generated')
  }
  
  // 如果关联了 character，同步更新 character 的 image_url
  if (imageGen.character_id) {
    updateCharacterImage(imageGen.character_id, imageUrl)
  }
}

/**
 * 更新图片生成错误（对应 Go updateImageGenError）
 */
function updateImageGenError(imageGenId: number, errorMsg: string): void {
  const imageGen = imageCollection.getById(imageGenId)
  if (!imageGen) return
  
  // 更新 image_generation 状态
  imageCollection.update(imageGenId, {
    status: 'failed',
    error_msg: errorMsg,
    updated_at: now()
  })
  
  console.error('[Image] Image generation failed', { id: imageGenId, error: errorMsg })
  
  // 如果关联了 scene，同步更新 scene 为失败状态
  if (imageGen.scene_id) {
    updateSceneImage(imageGen.scene_id, '', 'failed')
  }
}

// ========== 导出 API ==========

export const localImageAPI = {
  /**
   * 生成图片（对应 Go GenerateImage）
   */
  async generateImage(data: GenerateImageRequest): Promise<ImageGeneration> {
    // 验证 drama 存在
    const dramas = getAllDramas()
    const drama = dramas.find(d => String(d.id) === String(data.drama_id))
    if (!drama) {
      throw new Error('Drama not found')
    }
    
    // 设置默认值
    const provider = data.provider || 'openai'
    const imageType = data.image_type || 'storyboard'
    
    // 创建 image_generation 记录
    const image: ImageGeneration = {
      id: generateNumericId('image'),
      drama_id: data.drama_id,
      storyboard_id: data.storyboard_id,
      scene_id: data.scene_id?.toString(),
      character_id: (data as any).character_id,
      image_type: imageType,
      frame_type: data.frame_type,
      prompt: data.prompt,
      negative_prompt: data.negative_prompt,
      provider: provider,
      model: data.model || '',
      size: data.size,
      quality: data.quality,
      style: data.style,
      steps: data.steps,
      cfg_scale: data.cfg_scale,
      seed: data.seed,
      width: data.width,
      height: data.height,
      status: 'pending',
      created_at: now(),
      updated_at: now()
    }
    
    const savedImage = imageCollection.add(image)
    
    // 异步处理图片生成（模拟 Go 的 goroutine）
    setTimeout(() => {
      processImageGeneration(savedImage.id)
    }, 0)
    
    return savedImage
  },

  /**
   * 为场景生成图片（对应 Go GenerateImagesForScene）
   */
  async generateForScene(sceneId: number): Promise<ImageGeneration[]> {
    const found = findSceneWithDrama(sceneId)
    if (!found) {
      throw new Error('Scene not found')
    }
    
    const { drama, scene } = found
    
    // 构建场景图片生成提示词
    let prompt = scene.prompt || ''
    if (!prompt) {
      prompt = `${scene.location}场景，${scene.time}`
    }
    
    const imageGen = await this.generateImage({
      scene_id: sceneId,
      drama_id: String(drama.id),
      image_type: 'scene',
      prompt: prompt
    })
    
    return [imageGen]
  },

  /**
   * 批量为剧集生成图片（对应 Go BatchGenerateImagesForEpisode）
   */
  async batchGenerateForEpisode(episodeId: number | string): Promise<ImageGeneration[]> {
    const found = findEpisodeWithDrama(episodeId)
    if (!found) {
      throw new Error('Episode not found')
    }
    
    const { drama, episode } = found
    const storyboards = episode.storyboards || []
    const results: ImageGeneration[] = []
    
    console.log('[Image] Batch generating for episode', {
      episode_id: episodeId,
      storyboard_count: storyboards.length
    })
    
    for (const sb of storyboards) {
      // 检查是否有 image_prompt
      if (!sb.image_prompt) {
        console.warn('[Image] Storyboard has no image_prompt, skipping', { storyboard_id: sb.id })
        continue
      }
      
      try {
        const imageGen = await this.generateImage({
          storyboard_id: sb.id,
          drama_id: String(drama.id),
          image_type: 'storyboard',
          prompt: sb.image_prompt
        })
        
        console.log('[Image] Storyboard image generation started', {
          storyboard_id: sb.id,
          image_gen_id: imageGen.id
        })
        
        results.push(imageGen)
      } catch (error) {
        console.error('[Image] Failed to generate image for storyboard', {
          storyboard_id: sb.id,
          error
        })
      }
    }
    
    return results
  },

  /**
   * 获取图片生成记录（对应 Go GetImageGeneration）
   */
  async getImage(id: number): Promise<ImageGeneration> {
    const image = imageCollection.getById(id)
    if (!image) {
      throw new Error('图片不存在')
    }
    return image
  },

  /**
   * 列出图片生成记录（对应 Go ListImageGenerations）
   */
  async listImages(params: ImageGenerationListParams) {
    let items = imageCollection.getAll()
    
    if (params.drama_id) {
      items = items.filter(i => String(i.drama_id) === String(params.drama_id))
    }
    if (params.scene_id) {
      items = items.filter(i => String(i.scene_id) === String(params.scene_id))
    }
    if (params.storyboard_id) {
      items = items.filter(i => i.storyboard_id === params.storyboard_id)
    }
    if (params.frame_type) {
      items = items.filter(i => i.frame_type === params.frame_type)
    }
    if (params.status) {
      items = items.filter(i => i.status === params.status)
    }
    
    // 按创建时间倒序
    items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    
    return paginate(items, params.page || 1, params.page_size || 20)
  },

  /**
   * 删除图片生成记录（对应 Go DeleteImageGeneration）
   */
  async deleteImage(id: number): Promise<void> {
    const image = imageCollection.getById(id)
    if (!image) {
      throw new Error('Image generation not found')
    }
    imageCollection.delete(id)
  },

  /**
   * 本地上传图片
   */
  async uploadImage(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        resolve(reader.result as string)
      }
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  },

  /**
   * 为角色生成图片
   */
  async generateForCharacter(characterId: number, dramaId: string, prompt: string): Promise<ImageGeneration> {
    return this.generateImage({
      drama_id: dramaId,
      image_type: 'character',
      prompt: prompt,
      ...(characterId && { character_id: characterId } as any)
    })
  }
}
