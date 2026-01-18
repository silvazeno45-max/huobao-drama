/**
 * 角色库本地存储 API
 */

import type { Character, Drama } from '../../types/drama'
import {
  STORAGE_KEYS,
  StorageCollection,
  generateId,
  generateNumericId,
  now,
  paginate,
  getItem,
  setItem
} from '../storage'
import { generateImage } from './aiClient'

export interface CharacterLibraryItem {
  id: string
  name: string
  category?: string
  image_url: string
  description?: string
  tags?: string
  source_type: string
  created_at: string
  updated_at: string
}

export interface CreateLibraryItemRequest {
  name: string
  category?: string
  image_url: string
  description?: string
  tags?: string
  source_type?: string
}

export interface CharacterLibraryQuery {
  page?: number
  page_size?: number
  category?: string
  source_type?: string
  keyword?: string
}

const libraryCollection = new StorageCollection<CharacterLibraryItem>(STORAGE_KEYS.CHARACTER_LIBRARY)

// 辅助函数：获取所有 dramas
function getAllDramas(): Drama[] {
  return getItem<Drama[]>(STORAGE_KEYS.DRAMAS) || []
}

// 辅助函数：保存所有 dramas
function saveDramas(dramas: Drama[]): void {
  setItem(STORAGE_KEYS.DRAMAS, dramas)
}

// 辅助函数：在所有 dramas 中查找角色
function findCharacterById(characterId: number): { drama: Drama; character: Character; characterIndex: number } | undefined {
  const dramas = getAllDramas()
  for (const drama of dramas) {
    if (!drama.characters) continue
    const index = drama.characters.findIndex(c => c.id === characterId)
    if (index !== -1) {
      return { drama, character: drama.characters[index], characterIndex: index }
    }
  }
  return undefined
}

// 辅助函数：更新角色
function updateCharacterInDrama(characterId: number, updates: Partial<Character>): Character | undefined {
  const dramas = getAllDramas()
  for (const drama of dramas) {
    if (!drama.characters) continue
    const index = drama.characters.findIndex(c => c.id === characterId)
    if (index !== -1) {
      drama.characters[index] = {
        ...drama.characters[index],
        ...updates,
        updated_at: now()
      }
      // 同步更新到所有 episodes 的 characters
      if (drama.episodes) {
        drama.episodes.forEach(ep => {
          ep.characters = drama.characters
        })
      }
      drama.updated_at = now()
      saveDramas(dramas)
      return drama.characters[index]
    }
  }
  return undefined
}

export const localCharacterLibraryAPI = {
  async list(params?: CharacterLibraryQuery) {
    let items = libraryCollection.getAll()
    
    if (params?.category) {
      items = items.filter(i => i.category === params.category)
    }
    if (params?.source_type) {
      items = items.filter(i => i.source_type === params.source_type)
    }
    if (params?.keyword) {
      const keyword = params.keyword.toLowerCase()
      items = items.filter(i =>
        i.name.toLowerCase().includes(keyword) ||
        i.description?.toLowerCase().includes(keyword)
      )
    }
    
    items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    
    return paginate(items, params?.page || 1, params?.page_size || 20)
  },

  async create(data: CreateLibraryItemRequest): Promise<CharacterLibraryItem> {
    const item: CharacterLibraryItem = {
      id: generateId('lib'),
      name: data.name,
      category: data.category,
      image_url: data.image_url,
      description: data.description,
      tags: data.tags,
      source_type: data.source_type || 'manual',
      created_at: now(),
      updated_at: now()
    }
    
    return libraryCollection.add(item)
  },

  async get(id: string): Promise<CharacterLibraryItem> {
    const item = libraryCollection.getById(id)
    if (!item) {
      throw new Error('角色库项不存在')
    }
    return item
  },

  async delete(id: string): Promise<void> {
    libraryCollection.delete(id)
  },

  async uploadCharacterImage(characterId: string, imageUrl: string) {
    const updated = updateCharacterInDrama(Number(characterId), {
      image_url: imageUrl
    })
    return updated
  },

  async applyFromLibrary(characterId: string, libraryItemId: string) {
    const libraryItem = libraryCollection.getById(libraryItemId)
    if (!libraryItem) {
      throw new Error('角色库项不存在')
    }
    
    const updated = updateCharacterInDrama(Number(characterId), {
      image_url: libraryItem.image_url
    })
    return updated
  },

  async addCharacterToLibrary(characterId: string, category?: string): Promise<CharacterLibraryItem> {
    const found = findCharacterById(Number(characterId))
    if (!found) {
      throw new Error('角色不存在')
    }
    
    const { character } = found
    const item: CharacterLibraryItem = {
      id: generateId('lib'),
      name: character.name,
      category: category,
      image_url: character.image_url || '',
      description: character.description,
      source_type: 'character',
      created_at: now(),
      updated_at: now()
    }
    
    return libraryCollection.add(item)
  },

  async generateCharacterImage(characterId: string, model?: string) {
    // 查找角色
    const found = findCharacterById(Number(characterId))
    if (!found) {
      throw new Error('角色不存在')
    }
    
    const { character } = found
    
    // 构建生成提示词 - 使用详细的外貌描述，添加干净背景要求
    let prompt = ''
    
    // 优先使用 appearance 字段，它包含了最详细的外貌描述
    if (character.appearance) {
      prompt = character.appearance
    } else if (character.description) {
      prompt = character.description
    } else {
      prompt = character.name
    }
    
    // 添加角色画像和风格要求
    prompt += ', character portrait, full body or upper body shot'
    // 添加干净背景要求 - 确保背景简洁不干扰主体
    prompt += ', simple clean background, plain solid color background, white or light gray background'
    prompt += ', studio lighting, professional photography'
    // 添加质量和风格要求
    prompt += ', high quality, detailed, anime style, character design'
    prompt += ', no complex background, no scenery, focus on character'
    
    console.log('[CharacterLibrary] Generating character image:', { characterId, prompt: prompt.substring(0, 100) + '...' })
    
    try {
      // 调用图片生成 API
      const result = await generateImage(prompt, {
        model,
        size: '2048x2048',
        quality: 'standard'
      })
      // 更新角色的 image_url
      if (result.image_url) {
        updateCharacterInDrama(Number(characterId), {
          image_url: result.image_url,
          image_generation_status: 'completed'
        })
        
        console.log('[CharacterLibrary] Character image updated:', { characterId, hasUrl: true })
      }
      
      return {
        image_url: result.image_url,
        message: '图片生成成功'
      }
    } catch (error: any) {
      console.error('[CharacterLibrary] Failed to generate character image:', error)
      
      // 更新状态为失败
      updateCharacterInDrama(Number(characterId), {
        image_generation_status: 'failed',
        image_generation_error: error.message
      })
      
      throw error
    }
  },

  async batchGenerateCharacterImages(
    characterIds: string[], 
    model?: string,
    onProgress?: (characterId: string, success: boolean, current: number, total: number) => void
  ) {
    // 限制批量生成数量
    if (characterIds.length > 10) {
      throw new Error('单次最多生成10个角色')
    }
    
    const total = characterIds.length
    let completed = 0
    
    console.log('[CharacterLibrary] Starting batch character image generation:', { 
      count: total, 
      model 
    })
    
    // 异步并发生成所有角色图片
    characterIds.forEach(characterId => {
      localCharacterLibraryAPI.generateCharacterImage(characterId, model)
        .then(() => {
          completed++
          console.log('[CharacterLibrary] Character image generated:', { characterId, completed, total })
          onProgress?.(characterId, true, completed, total)
        })
        .catch(err => {
          completed++
          console.error('[CharacterLibrary] Failed to generate character image in batch:', {
            characterId,
            error: err.message
          })
          onProgress?.(characterId, false, completed, total)
        })
    })
    
    console.log('[CharacterLibrary] Batch character image generation tasks submitted:', {
      total
    })
    
    return {
      message: '批量生成任务已提交',
      count: total
    }
  },

  async updateCharacter(characterId: number, data: {
    name?: string
    appearance?: string
    personality?: string
    description?: string
  }) {
    const updated = updateCharacterInDrama(characterId, data)
    if (!updated) {
      throw new Error('角色不存在')
    }
    return updated
  },

  async deleteCharacter(characterId: number) {
    const dramas = getAllDramas()
    for (const drama of dramas) {
      if (!drama.characters) continue
      const index = drama.characters.findIndex(c => c.id === characterId)
      if (index !== -1) {
        drama.characters.splice(index, 1)
        drama.updated_at = now()
        saveDramas(dramas)
        return
      }
    }
  }
}
