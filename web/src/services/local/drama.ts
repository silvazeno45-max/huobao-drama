/**
 * Drama 本地存储 API
 * 实现与后端 API 相同的接口，使用 localStorage 存储数据
 * 
 * 存储结构：完整的 drama 对象，包含嵌套的 episodes、characters、scenes
 * drama: {
 *   id, title, description, ...
 *   episodes: [{ id, storyboards: [...], scenes: [...], characters: [...] }]
 *   characters: [...]
 *   scenes: [...]
 * }
 */

import type {
  CreateDramaRequest,
  Drama,
  DramaListQuery,
  DramaStats,
  UpdateDramaRequest,
  Character,
  Episode,
  Storyboard,
  Scene
} from '../../types/drama'
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
import { generateText, parseAIJSON, generateImage } from './aiClient'

// 使用完整嵌套结构的 drama collection
const dramaCollection = new StorageCollection<Drama>(STORAGE_KEYS.DRAMAS)

/**
 * 生成视频提示词（对应 Go generateVideoPrompt）
 * 专门用于视频生成的提示词，包含运镜和动态元素
 */
function generateVideoPrompt(sb: Storyboard): string {
  const parts: string[] = []

  // 1. 人物动作
  if (sb.action) {
    parts.push(`Action: ${sb.action}`)
  }

  // 2. 对话
  if (sb.dialogue) {
    parts.push(`Dialogue: ${sb.dialogue}`)
  }

  // 3. 镜头运动（视频特有）
  if (sb.movement) {
    parts.push(`Camera movement: ${sb.movement}`)
  }

  // 4. 镜头类型和角度
  if (sb.shot_type) {
    parts.push(`Shot type: ${sb.shot_type}`)
  }
  if (sb.angle) {
    parts.push(`Camera angle: ${sb.angle}`)
  }

  // 5. 场景环境
  if (sb.location) {
    let locationDesc = sb.location
    if (sb.time) {
      locationDesc += ', ' + sb.time
    }
    parts.push(`Scene: ${locationDesc}`)
  }

  // 6. 环境氛围
  if (sb.atmosphere) {
    parts.push(`Atmosphere: ${sb.atmosphere}`)
  }

  // 7. 情绪和结果
  if (sb.emotion) {
    parts.push(`Mood: ${sb.emotion}`)
  }
  if (sb.result) {
    parts.push(`Result: ${sb.result}`)
  }

  // 8. 描述
  if (sb.description) {
    parts.push(`Description: ${sb.description}`)
  }

  // 8. 音频元素
  if (sb.bgm_prompt) {
    parts.push(`BGM: ${sb.bgm_prompt}`)
  }
  if (sb.sound_effect) {
    parts.push(`Sound effects: ${sb.sound_effect}`)
  }

  // 9. 视频风格要求
  parts.push('Style: cinematic anime style, smooth camera motion, natural character movement')

  if (parts.length > 0) {
    return parts.join('. ')
  }
  return 'Anime style video scene'
}

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
 * 根据 ID 获取 drama
 */
function getDramaById(id: string): Drama | undefined {
  return getAllDramas().find(d => d.id === id)
}

/**
 * 更新单个 drama
 */
function updateDrama(id: string, updater: (drama: Drama) => Drama): Drama | undefined {
  const dramas = getAllDramas()
  const index = dramas.findIndex(d => d.id === id)
  if (index === -1) return undefined
  
  dramas[index] = updater(dramas[index])
  saveDramas(dramas)
  return dramas[index]
}

/**
 * 在 drama 中查找 episode
 */
function findEpisodeInDrama(drama: Drama, episodeId: string): Episode | undefined {
  return drama.episodes?.find(e => e.id === episodeId)
}

/**
 * 在所有 dramas 中查找 episode 并返回 drama
 */
function findEpisodeWithDrama(episodeId: string): { drama: Drama; episode: Episode } | undefined {
  const dramas = getAllDramas()
  for (const drama of dramas) {
    const episode = findEpisodeInDrama(drama, episodeId)
    if (episode) {
      return { drama, episode }
    }
  }
  return undefined
}

// 背景提取的 AI 提示词 (从 Go 迁移)
const BACKGROUND_EXTRACTION_PROMPT = `【任务】分析以下剧本内容，提取出所有需要的场景背景信息。

【要求】
1. 识别剧本中所有不同的场景（地点+时间组合）
2. 为每个场景生成详细的**中文**图片生成提示词（Prompt）
3. **重要**：场景描述必须是**纯背景**，不能包含人物、角色、动作等元素
4. Prompt要求：
   - **必须使用中文**，不能包含英文字符
   - 详细描述场景环境、建筑、物品、光线、氛围等
   - **禁止描述人物、角色、动作、对话等**
   - 适合AI图片生成模型使用
   - 风格统一为：电影感、细节丰富、动漫风格、高质量
5. location、time、atmosphere和prompt字段都使用中文
6. 提取场景的氛围描述（atmosphere）

【输出JSON格式】
{
  "backgrounds": [
    {
      "location": "地点名称（中文）",
      "time": "时间描述（中文）",
      "atmosphere": "氛围描述（中文）",
      "prompt": "一个电影感的动漫风格纯背景场景，展现[地点描述]在[时间]的环境。画面呈现[环境细节、建筑、物品、光线等，不包含人物]。风格：细节丰富，高质量，氛围光照。情绪：[环境情绪描述]。"
    }
  ]
}

【示例】
正确示例（注意：不包含人物）：
{
  "backgrounds": [
    {
      "location": "维修店内部",
      "time": "深夜",
      "atmosphere": "昏暗、孤独、工业感",
      "prompt": "一个电影感的动漫风格纯背景场景，展现凌乱的维修店内部在深夜的环境。昏暗的日光灯照射下，工作台上散落着各种扳手、螺丝刀和机械零件，墙上挂着油污斑斑的工具挂板和褪色海报，地面有油渍痕迹，角落堆放着废旧轮胎。风格：细节丰富，高质量，昏暗氛围。情绪：孤独、工业感。"
    }
  ]
}

【错误示例（包含人物，禁止）】：
❌ "展现主角站在街道上的场景" - 包含人物
❌ "人们匆匆而过" - 包含人物
❌ "角色在房间里活动" - 包含人物

请严格按照JSON格式输出，确保所有字段都使用中文。`

/**
 * 更新任务状态
 */
function updateTaskStatus(taskId: string, status: string, message?: string, result?: any) {
  const tasks = JSON.parse(localStorage.getItem(STORAGE_KEYS.TASKS) || '[]')
  const taskIndex = tasks.findIndex((t: any) => t.id === taskId)
  if (taskIndex !== -1) {
    tasks[taskIndex] = {
      ...tasks[taskIndex],
      status,
      message: message || tasks[taskIndex].message,
      result: result ? JSON.stringify(result) : tasks[taskIndex].result,
      progress: status === 'completed' ? 100 : status === 'failed' ? 0 : tasks[taskIndex].progress,
      updated_at: now(),
      completed_at: status === 'completed' ? now() : undefined
    }
    localStorage.setItem(STORAGE_KEYS.TASKS, JSON.stringify(tasks))
  }
}

/**
 * 后台处理背景提取
 */
async function processBackgroundExtraction(taskId: string, episodeId: string) {
  console.log('[LocalDrama] Starting background extraction', { taskId, episodeId })
  
  // 获取剧集信息（从嵌套结构中查找）
  const found = findEpisodeWithDrama(episodeId)
  if (!found) {
    throw new Error('剧集不存在')
  }
  
  const { drama, episode } = found
  
  // 检查是否有剧本内容
  const scriptContent = episode.script_content || episode.content || episode.description
  if (!scriptContent) {
    throw new Error('剧本内容为空，无法提取场景')
  }
  
  // 更新任务状态
  updateTaskStatus(taskId, 'processing', '正在分析剧本内容...')
  
  const userPrompt = `【剧本内容】
${scriptContent}

请从以上剧本中提取所有场景背景信息。`

  try {
    // 调用 AI API
    const response = await generateText(userPrompt, {
      systemPrompt: BACKGROUND_EXTRACTION_PROMPT,
      temperature: 0.7,
      maxTokens: 8000
    })
    
    console.log('[LocalDrama] AI response received', { length: response.length })
    
    // 解析 JSON 响应
    const result = parseAIJSON<{ backgrounds: Array<{
      location: string
      time: string
      atmosphere: string
      prompt: string
    }> }>(response)
    
    // 创建新场景
    const newScenes: Scene[] = result.backgrounds.map(bg => ({
      id: generateId('scene'),
      drama_id: drama.id,
      episode_id: episodeId,
      location: bg.location,
      time: bg.time,
      atmosphere: bg.atmosphere,
      prompt: bg.prompt,
      status: 'pending',
      created_at: now(),
      updated_at: now()
    }))
    
    // 更新 drama 中的场景（嵌套结构）
    updateDrama(drama.id, d => {
      // 删除该 episode 的旧场景
      const oldScenesCount = d.scenes?.filter(s => s.episode_id === episodeId).length || 0
      d.scenes = (d.scenes || []).filter(s => s.episode_id !== episodeId)
      // 添加新场景
      d.scenes.push(...newScenes)
      
      // 同时更新 episode 中的 scenes
      const epIndex = d.episodes?.findIndex(e => e.id === episodeId) ?? -1
      if (epIndex !== -1 && d.episodes) {
        d.episodes[epIndex].scenes = newScenes
      }
      
      d.total_scenes = d.scenes.length
      d.updated_at = now()
      
      console.log('[LocalDrama] Deleted old scenes', { count: oldScenesCount })
      newScenes.forEach(s => console.log('[LocalDrama] Created scene', { location: s.location, time: s.time }))
      
      return d
    })
    
    // 更新任务完成
    updateTaskStatus(taskId, 'completed', `成功提取 ${newScenes.length} 个场景`, { backgrounds: newScenes, total: newScenes.length })
    
    console.log('[LocalDrama] Background extraction completed', { total: newScenes.length })
  } catch (error: any) {
    console.error('[LocalDrama] Background extraction failed:', error)
    updateTaskStatus(taskId, 'failed', error.message || '场景提取失败')
    throw error
  }
}

export const localDramaAPI = {
  async list(params?: DramaListQuery) {
    let items = dramaCollection.getAll()
    
    // 筛选
    if (params?.status) {
      items = items.filter(d => d.status === params.status)
    }
    if (params?.genre) {
      items = items.filter(d => d.genre === params.genre)
    }
    if (params?.keyword) {
      const keyword = params.keyword.toLowerCase()
      items = items.filter(d => 
        d.title.toLowerCase().includes(keyword) ||
        d.description?.toLowerCase().includes(keyword)
      )
    }
    
    // 按更新时间倒序
    items.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    
    return paginate(items, params?.page || 1, params?.page_size || 20)
  },

  async create(data: CreateDramaRequest): Promise<Drama> {
    const drama: Drama = {
      id: generateId('drama'),
      title: data.title,
      description: data.description,
      genre: data.genre,
      tags: data.tags ? data.tags.split(',').map(t => t.trim()) : [],
      status: 'draft',
      total_episodes: 0,
      total_duration: 0,
      total_scenes: 0,
      created_at: now(),
      updated_at: now(),
      characters: [],
      episodes: [],
      scenes: []
    }
    
    return dramaCollection.add(drama)
  },

  async get(id: string): Promise<Drama> {
    const drama = getDramaById(id)
    if (!drama) {
      throw new Error('剧本不存在')
    }
    
    // 数据已经是嵌套结构，直接返回
    // 确保 episodes 按 episode_number 排序
    if (drama.episodes) {
      drama.episodes.sort((a, b) => a.episode_number - b.episode_number)
      // 确保每个 episode 的 storyboards 也排序
      drama.episodes.forEach(ep => {
        if (ep.storyboards) {
          ep.storyboards.sort((a, b) => a.storyboard_number - b.storyboard_number)
        }
        // 为每个 episode 填充 characters（drama 级别的角色）
        ep.characters = drama.characters
      })
    }
    
    // 更新统计数据
    drama.total_episodes = drama.episodes?.length || 0
    drama.total_scenes = drama.scenes?.length || 0
    
    return drama
  },

  async update(id: string, data: UpdateDramaRequest): Promise<Drama> {
    const updated = dramaCollection.update(id, {
      ...data,
      updated_at: now()
    })
    if (!updated) {
      throw new Error('剧本不存在')
    }
    return updated
  },

  async delete(id: string): Promise<void> {
    // 嵌套结构中，直接删除整个 drama 即可
    const dramas = getAllDramas()
    const index = dramas.findIndex(d => d.id === id)
    if (index !== -1) {
      dramas.splice(index, 1)
      saveDramas(dramas)
    }
  },

  async getStats(): Promise<DramaStats> {
    const dramas = getAllDramas()
    const byStatus = new Map<string, number>()
    
    dramas.forEach(d => {
      const count = byStatus.get(d.status) || 0
      byStatus.set(d.status, count + 1)
    })
    
    return {
      total: dramas.length,
      by_status: Array.from(byStatus.entries()).map(([status, count]) => ({
        status,
        count
      }))
    }
  },

  async saveOutline(id: string, data: { title: string; summary: string; genre?: string; tags?: string[] }) {
    const updated = updateDrama(id, d => ({
      ...d,
      title: data.title,
      description: data.summary,
      genre: data.genre,
      tags: data.tags,
      updated_at: now()
    }))
    if (!updated) {
      throw new Error('剧本不存在')
    }
    return updated
  },

  async getCharacters(dramaId: string) {
    const drama = getDramaById(dramaId)
    return drama?.characters || []
  },

  async saveCharacters(id: string, data: any[], episodeId?: string) {
    // 创建新角色列表
    const characters: Character[] = data.map((char, index) => ({
      id: char.id || generateNumericId('character'),
      drama_id: id,
      name: char.name,
      role: char.role,
      description: char.description,
      appearance: char.appearance,
      personality: char.personality,
      voice_style: char.voice_style,
      background: char.background,
      reference_images: char.reference_images,
      seed_value: char.seed_value,
      sort_order: index,
      image_url: char.image_url,
      created_at: char.created_at || now(),
      updated_at: now()
    }))
    
    // 更新 drama 中的角色，同时同步到所有 episodes
    updateDrama(id, d => {
      // 同步角色到所有 episodes
      if (d.episodes) {
        d.episodes.forEach(ep => {
          ep.characters = characters
        })
      }
      return {
        ...d,
        characters,
        updated_at: now()
      }
    })
    
    return { characters }
  },

  async saveEpisodes(id: string, data: any[]) {
    // 创建新集数列表
    const episodes: Episode[] = data.map((ep, index) => ({
      id: generateId('ep'),
      drama_id: id,
      episode_number: ep.episode_number || index + 1,
      title: ep.title,
      content: ep.content || ep.description || '',
      description: ep.description,
      script_content: ep.script_content,
      duration: ep.duration || 0,
      status: 'draft',
      storyboards: [],
      scenes: [],
      created_at: now(),
      updated_at: now()
    }))
    
    // 更新 drama 中的集数
    updateDrama(id, d => ({
      ...d,
      episodes,
      total_episodes: episodes.length,
      updated_at: now()
    }))
    
    return { episodes }
  },

  async saveProgress(id: string, data: { current_step: string; step_data?: any }) {
    const drama = getDramaById(id)
    if (!drama) {
      throw new Error('剧本不存在')
    }
    
    const metadata = drama.metadata || {}
    metadata.current_step = data.current_step
    metadata.step_data = data.step_data
    
    updateDrama(id, d => ({
      ...d,
      metadata,
      updated_at: now()
    }))
    
    return { success: true }
  },

  async generateStoryboard(episodeId: string) {
    // 本地模式下返回模拟的任务状态
    return {
      task_id: generateId('task'),
      status: 'pending',
      message: '本地模式：请手动添加分镜'
    }
  },

  async getBackgrounds(episodeId: string) {
    const found = findEpisodeWithDrama(episodeId)
    if (!found) return []
    // 返回该 drama 的所有场景
    return found.drama.scenes || []
  },

  async extractBackgrounds(episodeId: string) {
    const taskId = generateId('task')
    
    // 创建任务
    const task = {
      id: taskId,
      type: 'background_extraction',
      status: 'processing' as const,
      progress: 10,
      message: '正在提取场景...',
      created_at: now(),
      updated_at: now()
    }
    
    // 存储任务状态
    const tasks = JSON.parse(localStorage.getItem(STORAGE_KEYS.TASKS) || '[]')
    tasks.push(task)
    localStorage.setItem(STORAGE_KEYS.TASKS, JSON.stringify(tasks))
    
    // 异步执行提取
    processBackgroundExtraction(taskId, episodeId).catch(err => {
      console.error('[LocalDrama] Background extraction failed:', err)
      updateTaskStatus(taskId, 'failed', err.message)
    })
    
    return {
      task_id: taskId,
      status: 'pending',
      message: '场景提取任务已创建，正在后台处理...'
    }
  },

  async batchGenerateBackgrounds(episodeId: string) {
    return { message: '本地模式：请手动添加背景' }
  },

  async generateSingleBackground(backgroundId: number, dramaId: string, prompt: string) {
    return { message: '本地模式：请手动添加背景' }
  },

  async getStoryboards(episodeId: string) {
    const found = findEpisodeWithDrama(episodeId)
    if (!found) return { storyboards: [] }
    
    // 构建 scene_id 到 scene 的映射
    const sceneMap = new Map<number | string, any>()
    if (found.drama.scenes) {
      for (const scene of found.drama.scenes) {
        sceneMap.set(scene.id, scene)
      }
    }
    
    // 构建 character_id 到 character 的映射
    const characterMap = new Map<number | string, any>()
    if (found.drama.characters) {
      for (const char of found.drama.characters) {
        characterMap.set(char.id, char)
      }
    }
    
    // 为每个 storyboard 填充 background 和 characters 对象
    const storyboards = (found.episode.storyboards || [])
      .sort((a, b) => a.storyboard_number - b.storyboard_number)
      .map(sb => {
        const result: any = { ...sb }
        
        // 填充 background 对象（基于 scene_id）
        if (sb.scene_id) {
          const scene = sceneMap.get(sb.scene_id)
          if (scene) {
            result.background = {
              id: scene.id,
              location: scene.location || '',
              time: scene.time || '',
              image_url: scene.image_url || null,
              status: scene.status || 'pending'
            }
          }
        }
        
        // 填充 characters 对象数组（基于 characters ID 数组）
        if (sb.characters && Array.isArray(sb.characters)) {
          result.characters = sb.characters
            .map((charId: number | string) => {
              const char = characterMap.get(charId)
              if (char) {
                return {
                  id: char.id,
                  name: char.name,
                  image_url: char.image_url || null
                }
              }
              return null
            })
            .filter(Boolean)
        }
        
        return result
      })
    
    return { storyboards }
  },

  async updateStoryboard(storyboardId: string, data: any) {
    // 在所有 dramas 中查找并更新 storyboard
    const dramas = getAllDramas()
    for (const drama of dramas) {
      if (!drama.episodes) continue
      for (const episode of drama.episodes) {
        if (!episode.storyboards) continue
        const sbIndex = episode.storyboards.findIndex(s => s.id === storyboardId)
        if (sbIndex !== -1) {
          const currentSb = episode.storyboards[sbIndex]
          
          // 合并更新数据
          const updatedSb: Storyboard = {
            ...currentSb,
            ...data,
            updated_at: now()
          }
          
          // 重新生成 video_prompt（对应 Go UpdateStoryboard 逻辑）
          // image_prompt 不自动更新，因为可能对应多张已生成的帧图片
          updatedSb.video_prompt = generateVideoPrompt(updatedSb)
          
          episode.storyboards[sbIndex] = updatedSb
          drama.updated_at = now()
          saveDramas(dramas)
          return updatedSb
        }
      }
    }
    throw new Error('分镜不存在')
  },

  async updateScene(sceneId: string, data: any) {
    // 在所有 dramas 中查找并更新 scene
    const dramas = getAllDramas()
    for (const drama of dramas) {
      if (!drama.scenes) continue
      const sceneIndex = drama.scenes.findIndex(s => s.id === sceneId)
      if (sceneIndex !== -1) {
        const updatedScene = {
          ...drama.scenes[sceneIndex],
          ...data,
          updated_at: now()
        }
        drama.scenes[sceneIndex] = updatedScene
        
        // 同步更新到对应 episode 的 scenes
        if (drama.episodes && updatedScene.episode_id) {
          const episode = drama.episodes.find(ep => ep.id === updatedScene.episode_id)
          if (episode && episode.scenes) {
            const epSceneIndex = episode.scenes.findIndex(s => s.id === sceneId)
            if (epSceneIndex !== -1) {
              episode.scenes[epSceneIndex] = updatedScene
            }
          }
        }
        
        drama.updated_at = now()
        saveDramas(dramas)
        return updatedScene
      }
    }
    throw new Error('场景不存在')
  },

  async generateSceneImage(data: { scene_id: string; prompt?: string; model?: string }) {
    // 在所有 dramas 中查找场景
    const dramas = getAllDramas()
    let foundScene: Scene | undefined
    let foundDrama: Drama | undefined
    
    for (const drama of dramas) {
      if (!drama.scenes) continue
      const scene = drama.scenes.find(s => String(s.id) === String(data.scene_id))
      if (scene) {
        foundScene = scene
        foundDrama = drama
        break
      }
    }
    
    if (!foundScene || !foundDrama) {
      throw new Error('场景不存在')
    }
    
    // 构建场景图片生成提示词
    let prompt = data.prompt
    if (!prompt) {
      prompt = foundScene.prompt
      if (!prompt) {
        prompt = `${foundScene.location || ''}场景，${foundScene.time || ''}`
      }
    }
    
    prompt += ', cinematic scene, wide shot, detailed environment'
    prompt += ', high quality, professional photography, film still'
    
    console.log('[Drama] Generating scene image:', { scene_id: data.scene_id, prompt: prompt.substring(0, 100) + '...' })
    
    try {
      const result = await generateImage(prompt, {
        model: data.model,
        size: '2560x1440',
        quality: 'standard'
      })
      
      if (result.image_url) {
        // 更新场景
        const sceneIndex = foundDrama.scenes!.findIndex(s => String(s.id) === String(data.scene_id))
        if (sceneIndex !== -1) {
          foundDrama.scenes![sceneIndex].image_url = result.image_url
          foundDrama.scenes![sceneIndex].status = 'generated'
          foundDrama.scenes![sceneIndex].updated_at = now()
          
          // 同步更新到所有 episode 的 scenes
          const updatedScene = foundDrama.scenes![sceneIndex]
          if (foundDrama.episodes) {
            for (const episode of foundDrama.episodes) {
              if (!episode.scenes) continue
              const epSceneIndex = episode.scenes.findIndex(s => String(s.id) === String(data.scene_id))
              if (epSceneIndex !== -1) {
                episode.scenes[epSceneIndex] = { ...updatedScene }
                console.log('[Drama] Synced scene to episode:', { episode_id: episode.id, scene_id: data.scene_id })
              }
            }
          }
          
          foundDrama.updated_at = now()
          saveDramas(dramas)
        }
        
        console.log('[Drama] Scene image updated:', { scene_id: data.scene_id, hasUrl: true })
      }
      
      return {
        message: 'Scene image generation started',
        image_generation: {
          id: generateNumericId('img'),
          image_url: result.image_url,
          status: 'completed',
          prompt: prompt
        }
      }
    } catch (error: any) {
      console.error('[Drama] Failed to generate scene image:', error)
      
      const sceneIndex = foundDrama.scenes!.findIndex(s => String(s.id) === String(data.scene_id))
      if (sceneIndex !== -1) {
        foundDrama.scenes![sceneIndex].status = 'failed'
        foundDrama.scenes![sceneIndex].updated_at = now()
        saveDramas(dramas)
      }
      
      throw error
    }
  },

  async finalizeEpisode(episodeId: string, timelineData?: any) {
    const dramas = getAllDramas()
    for (const drama of dramas) {
      if (!drama.episodes) continue
      const epIndex = drama.episodes.findIndex(e => e.id === episodeId)
      if (epIndex !== -1) {
        drama.episodes[epIndex].status = 'completed'
        drama.episodes[epIndex].timeline_status = 'completed'
        drama.episodes[epIndex].updated_at = now()
        drama.updated_at = now()
        saveDramas(dramas)
        return { success: true }
      }
    }
    return { success: false }
  }
}

// 额外的分镜操作
export const localStoryboardAPI = {
  async create(episodeId: string, data: Partial<Storyboard>): Promise<Storyboard> {
    const found = findEpisodeWithDrama(episodeId)
    if (!found) {
      throw new Error('集数不存在')
    }
    
    const { drama, episode } = found
    const existing = episode.storyboards || []
    const maxNumber = Math.max(0, ...existing.map(s => s.storyboard_number))
    
    const storyboard: Storyboard = {
      id: generateId('sb'),
      episode_id: episodeId,
      storyboard_number: data.storyboard_number || maxNumber + 1,
      title: data.title,
      description: data.description,
      location: data.location,
      time: data.time,
      duration: data.duration || 5,
      dialogue: data.dialogue,
      action: data.action,
      atmosphere: data.atmosphere,
      image_prompt: data.image_prompt,
      video_prompt: data.video_prompt,
      characters: data.characters,
      created_at: now(),
      updated_at: now()
    }
    
    // 更新 drama 中的 episode
    updateDrama(drama.id, d => {
      const epIndex = d.episodes?.findIndex(e => e.id === episodeId) ?? -1
      if (epIndex !== -1 && d.episodes) {
        if (!d.episodes[epIndex].storyboards) {
          d.episodes[epIndex].storyboards = []
        }
        d.episodes[epIndex].storyboards!.push(storyboard)
        d.episodes[epIndex].storyboard_count = d.episodes[epIndex].storyboards!.length
        d.episodes[epIndex].updated_at = now()
      }
      d.updated_at = now()
      return d
    })
    
    return storyboard
  },

  async delete(storyboardId: string): Promise<void> {
    const dramas = getAllDramas()
    for (const drama of dramas) {
      if (!drama.episodes) continue
      for (const episode of drama.episodes) {
        if (!episode.storyboards) continue
        const sbIndex = episode.storyboards.findIndex(s => s.id === storyboardId)
        if (sbIndex !== -1) {
          episode.storyboards.splice(sbIndex, 1)
          episode.storyboard_count = episode.storyboards.length
          episode.updated_at = now()
          drama.updated_at = now()
          saveDramas(dramas)
          return
        }
      }
    }
  }
}

// 场景操作
export const localSceneAPI = {
  async create(dramaId: string, data: Partial<Scene>): Promise<Scene> {
    const scene: Scene = {
      id: generateId('scene'),
      drama_id: dramaId,
      episode_id: data.episode_id,
      location: data.location || '',
      time: data.time || '',
      prompt: data.prompt || '',
      description: data.description,
      title: data.title,
      status: 'draft',
      created_at: now(),
      updated_at: now()
    }
    
    // 添加到 drama 的 scenes 数组
    updateDrama(dramaId, d => {
      if (!d.scenes) d.scenes = []
      d.scenes.push(scene)
      d.total_scenes = d.scenes.length
      d.updated_at = now()
      return d
    })
    
    return scene
  },

  async list(dramaId: string) {
    const drama = getDramaById(dramaId)
    return drama?.scenes || []
  },

  async delete(sceneId: string): Promise<void> {
    const dramas = getAllDramas()
    for (const drama of dramas) {
      if (!drama.scenes) continue
      const sceneIndex = drama.scenes.findIndex(s => s.id === sceneId)
      if (sceneIndex !== -1) {
        drama.scenes.splice(sceneIndex, 1)
        drama.total_scenes = drama.scenes.length
        drama.updated_at = now()
        saveDramas(dramas)
        return
      }
    }
  }
}
