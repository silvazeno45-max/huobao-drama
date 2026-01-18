/**
 * AI 生成本地存储 API
 * 本地模式下使用 AI API 进行真实生成
 */

import type { Character, Episode, Drama } from '../../types/drama'
import type {
  GenerateCharactersRequest,
  GenerateEpisodesRequest,
  GenerateOutlineRequest,
  OutlineResult
} from '../../types/generation'
import {
  STORAGE_KEYS,
  StorageCollection,
  generateId,
  generateNumericId,
  now,
  getItem,
  setItem
} from '../storage'
import { generateText, parseAIJSON } from './aiClient'

interface Task {
  id: string
  type: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  progress: number
  message?: string
  error?: string
  result?: string
  created_at: string
  updated_at: string
  completed_at?: string
}

const taskCollection = new StorageCollection<Task>(STORAGE_KEYS.TASKS)

/**
 * 提取初始静态姿态（去除动作过程）- 对应 Go extractInitialPose
 */
function extractInitialPose(action: string): string {
  const processWords = [
    '然后', '接着', '接下来', '随后', '紧接着',
    '向下', '向上', '向前', '向后', '向左', '向右',
    '开始', '继续', '逐渐', '慢慢', '快速', '突然', '猛然'
  ]
  
  let result = action
  for (const word of processWords) {
    const idx = result.indexOf(word)
    if (idx > 0) {
      result = result.substring(0, idx)
      break
    }
  }
  
  // 清理末尾标点
  return result.replace(/[，。,.\s]+$/, '').trim()
}

/**
 * 生成图片提示词（对应 Go generateImagePrompt）
 * 专用于图片生成的提示词（首帧静态画面）
 */
function generateImagePrompt(sb: any): string {
  const parts: string[] = []
  
  // 1. 完整的场景背景描述
  if (sb.location) {
    let locationDesc = sb.location
    if (sb.time) {
      locationDesc += ', ' + sb.time
    }
    parts.push(locationDesc)
  }
  
  // 2. 角色初始静态姿态（去除动作过程，只保留起始状态）
  if (sb.action) {
    const initialPose = extractInitialPose(sb.action)
    if (initialPose) {
      parts.push(initialPose)
    }
  }
  
  // 3. 情绪氛围
  if (sb.emotion) {
    parts.push(sb.emotion)
  }
  
  // 4. 动漫风格
  parts.push('anime style, first frame')
  
  if (parts.length > 0) {
    return parts.join(', ')
  }
  return 'anime scene'
}

/**
 * 生成视频提示词（对应 Go generateVideoPrompt）
 * 专用于视频生成的提示词，包含运镜和动态元素
 */
function generateVideoPrompt(sb: any): string {
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

  // 9. 音频元素
  if (sb.bgm_prompt) {
    parts.push(`BGM: ${sb.bgm_prompt}`)
  }
  if (sb.sound_effect) {
    parts.push(`Sound effects: ${sb.sound_effect}`)
  }

  // 10. 视频风格要求
  parts.push('Style: cinematic anime style, smooth camera motion, natural character movement')

  if (parts.length > 0) {
    return parts.join('. ')
  }
  return 'Anime style video scene'
}

// 辅助函数：获取所有 dramas
function getAllDramas(): Drama[] {
  return getItem<Drama[]>(STORAGE_KEYS.DRAMAS) || []
}

// 辅助函数：保存所有 dramas
function saveDramas(dramas: Drama[]): void {
  setItem(STORAGE_KEYS.DRAMAS, dramas)
}

// 辅助函数：更新单个 drama
function updateDramaById(id: string, updater: (drama: Drama) => Drama): Drama | undefined {
  const dramas = getAllDramas()
  const index = dramas.findIndex(d => d.id === id)
  if (index === -1) return undefined
  
  dramas[index] = updater(dramas[index])
  saveDramas(dramas)
  return dramas[index]
}

// 角色生成的 AI 提示词 (从 Go 迁移)
const CHARACTER_SYSTEM_PROMPT = `你是一个专业的角色分析师，擅长从剧本中提取和分析角色信息。

你的任务是根据提供的剧本内容，提取并整理剧中出现的所有角色的详细设定。

要求：
1. 仔细阅读剧本，识别所有出现的角色
2. 根据剧本中的对话、行为和描述，总结角色的性格特点
3. 提取角色在剧本中的关键信息：背景、动机、目标、关系等
4. 角色之间的关系必须基于剧本中的实际描述
5. 外貌描述必须极其详细，如果剧本中有描述则使用，如果没有则根据角色设定合理推断，便于AI绘画生成角色形象
6. 优先提取主要角色和重要配角，次要角色可以简略

请严格按照以下 JSON 格式输出，不要添加任何其他文字：

{
  "characters": [
    {
      "name": "角色名",
      "role": "主角/重要配角/配角",
      "description": "角色背景和简介（200-300字，包括：出身背景、成长经历、核心动机、与其他角色的关系、在故事中的作用）",
      "personality": "性格特点（详细描述，100-150字，包括：主要性格特征、行为习惯、价值观、优点缺点、情绪表达方式、对待他人的态度等）",
      "appearance": "外貌描述（极其详细，150-200字，必须包括：确切年龄、精确身高、体型身材、肤色质感、发型发色发长、眼睛颜色形状、面部特征（如眉毛、鼻子、嘴唇）、着装风格、服装颜色材质、配饰细节、标志性特征、整体气质风格等，描述要具体到可以直接用于AI绘画）",
      "voice_style": "说话风格和语气特点（详细描述，50-80字，包括：语速语调、用词习惯、口头禅、说话时的情绪特征等）"
    }
  ]
}

注意：
- 必须基于剧本内容提取角色，不要凭空创作
- 优先提取主要角色和重要配角，数量根据剧本实际情况确定
- description、personality、appearance、voice_style都必须详细描述，字数要充足
- appearance外貌描述是重中之重，必须极其详细具体，要能让AI准确生成角色形象
- 如果剧本中角色信息不完整，可以根据角色设定合理补充，但要符合剧本整体风格`

/**
 * 后台处理角色生成
 */
async function processCharacterGeneration(taskId: string, data: GenerateCharactersRequest) {
  console.log('[LocalGeneration] Starting character generation', { taskId, dramaId: data.drama_id })
  
  // 更新任务状态
  taskCollection.update(taskId, {
    status: 'processing',
    progress: 20,
    message: '正在分析剧本内容...',
    updated_at: now()
  })
  
  const count = data.count || 5
  const outlineText = data.outline || '请根据剧本主题创作角色'
  
  const userPrompt = `剧本内容：
${outlineText}

请从剧本中提取并整理最多 ${count} 个主要角色的详细设定。`

  try {
    // 调用 AI API
    const response = await generateText(userPrompt, {
      systemPrompt: CHARACTER_SYSTEM_PROMPT,
      temperature: data.temperature || 0.7,
      maxTokens: 3000
    })
    
    console.log('[LocalGeneration] AI response received', { length: response.length })
    
    // 解析 JSON 响应
    const result = parseAIJSON<{ characters: Array<{
      name: string
      role: string
      description: string
      personality: string
      appearance: string
      voice_style: string
    }> }>(response)
    
    // 保存角色到 drama 的嵌套结构中
    const drama = getAllDramas().find(d => d.id === data.drama_id)
    const existingCharacters = drama?.characters || []
    
    const characters: Character[] = []
    for (const char of result.characters) {
      // 检查是否已存在
      const existing = existingCharacters.find(c => c.name === char.name)
      if (existing) {
        console.log('[LocalGeneration] Character already exists, skipping', { name: char.name })
        characters.push(existing)
        continue
      }
      
      const character: Character = {
        id: generateNumericId('character'),
        drama_id: data.drama_id,
        name: char.name,
        role: char.role,
        description: char.description,
        personality: char.personality,
        appearance: char.appearance,
        voice_style: char.voice_style,
        created_at: now(),
        updated_at: now()
      }
      characters.push(character)
    }
    
    // 更新 drama 中的角色列表，同时同步到所有 episodes
    updateDramaById(data.drama_id, d => {
      const newCharacters = [...(d.characters || []).filter(c => !characters.find(nc => nc.name === c.name)), ...characters]
      // 同步角色到所有 episodes
      if (d.episodes) {
        d.episodes.forEach(ep => {
          ep.characters = newCharacters
        })
      }
      return {
        ...d,
        characters: newCharacters,
        updated_at: now()
      }
    })
    
    // 更新任务完成
    taskCollection.update(taskId, {
      status: 'completed',
      progress: 100,
      message: `成功生成 ${characters.length} 个角色`,
      result: JSON.stringify({ characters, total: characters.length }),
      completed_at: now(),
      updated_at: now()
    })
    
    console.log('[LocalGeneration] Character generation completed', { total: characters.length })
  } catch (error: any) {
    console.error('[LocalGeneration] Character generation failed:', error)
    taskCollection.update(taskId, {
      status: 'failed',
      error: error.message || '角色生成失败',
      updated_at: now()
    })
    throw error
  }
}

// 分镜生成提示词模板（从 Go 迁移）
const STORYBOARD_PROMPT_TEMPLATE = `【角色】你是一位资深影视分镜师，精通罗伯特·麦基的镜头拆解理论，擅长构建情绪节奏。

【任务】将小说剧本按**独立动作单元**拆解为分镜头方案。

【本剧可用角色列表】
{CHARACTER_LIST}

**重要**：在characters字段中，只能使用上述角色列表中的角色ID（数字），不得自创角色或使用其他ID。

【本剧已提取的场景背景列表】
{SCENE_LIST}

**重要**：在scene_id字段中，必须从上述背景列表中选择最匹配的背景ID（数字）。如果没有合适的背景，则填null。

【剧本原文】
{SCRIPT_CONTENT}

【分镜要素】每个镜头聚焦单一动作，描述要详尽具体：
1. **镜头标题(title)**：用3-5个字概括该镜头的核心内容或情绪
2. **时间**：[清晨/午后/深夜/具体时分+详细光线描述]
3. **地点**：[场景完整描述+空间布局+环境细节]
4. **镜头设计**：
   - **景别(shot_type)**：[远景/全景/中景/近景/特写]
   - **镜头角度(angle)**：[平视/仰视/俯视/侧面/背面]
   - **运镜方式(movement)**：[固定镜头/推镜/拉镜/摇镜/跟镜/移镜]
5. **人物行为**：**详细动作描述**，包含[谁+具体怎么做+肢体细节+表情状态]
6. **对话/独白**：提取该镜头中的完整对话或独白内容（如无对话则为空字符串）
7. **画面结果**：动作的即时后果+视觉细节+氛围变化
8. **环境氛围**：光线质感+色调+声音环境+整体氛围
9. **配乐提示(bgm_prompt)**：描述该镜头配乐的氛围、节奏、情绪
10. **音效描述(sound_effect)**：描述该镜头的关键音效
11. **观众情绪**：[情绪类型]（[强度：↑↑↑/↑↑/↑/→/↓] + [落点：悬置/释放/反转]）

【输出格式】请以JSON格式输出：
{
  "storyboards": [
    {
      "shot_number": 1,
      "title": "镜头标题",
      "shot_type": "景别",
      "angle": "镜头角度",
      "time": "详细时间描述",
      "location": "详细地点描述",
      "scene_id": 1,
      "movement": "运镜方式",
      "action": "详细动作描述",
      "dialogue": "对话内容",
      "result": "画面结果",
      "atmosphere": "环境氛围",
      "emotion": "情绪描述",
      "duration": 6,
      "bgm_prompt": "配乐提示",
      "sound_effect": "音效描述",
      "characters": [1, 2],
      "is_primary": true
    }
  ]
}

**duration时长估算规则（秒）**：
- 所有镜头时长必须在4-12秒范围内
- 纯对话场景基础4秒，纯动作场景基础5秒，混合场景基础6秒
- 根据对话字数和动作复杂度增加时长

**特别要求**：
- 必须100%完整拆解整个剧本，不得省略任何剧情
- 每个镜头只描述一个主要动作
- 严格按照JSON格式输出`

// 后台处理分镜生成（模拟 Go 的 goroutine）
async function processStoryboardGeneration(taskId: string, episodeId: string) {
  console.log('[LocalGeneration] Starting storyboard generation', { task_id: taskId, episode_id: episodeId })
  
  try {
    // 更新任务状态为处理中
    taskCollection.update(taskId, {
      status: 'processing',
      progress: 10,
      message: '开始生成分镜...',
      updated_at: now()
    })
    
    // 查找 episode 和 drama
    const dramas = getAllDramas()
    let foundEpisode: Episode | undefined
    let foundDrama: Drama | undefined
    
    for (const drama of dramas) {
      if (drama.episodes) {
        const episode = drama.episodes.find(ep => ep.id === episodeId)
        if (episode) {
          foundEpisode = episode
          foundDrama = drama
          break
        }
      }
    }
    
    if (!foundEpisode || !foundDrama) {
      throw new Error('剧集不存在')
    }
    
    // 获取剧本内容
    const scriptContent = foundEpisode.script_content || foundEpisode.content || foundEpisode.description
    if (!scriptContent) {
      throw new Error('剧本内容为空，请先生成剧集内容')
    }
    
    // 更新进度
    taskCollection.update(taskId, {
      progress: 20,
      message: '正在分析剧本...',
      updated_at: now()
    })
    
    // 构建角色列表
    let characterList = '无角色'
    if (foundDrama.characters && foundDrama.characters.length > 0) {
      const charInfoList = foundDrama.characters.map(char => 
        `{"id": ${char.id}, "name": "${char.name}"}`
      )
      characterList = `[${charInfoList.join(', ')}]`
    }
    
    // 构建场景列表
    let sceneList = '无场景'
    if (foundDrama.scenes && foundDrama.scenes.length > 0) {
      const sceneInfoList = foundDrama.scenes.map(scene => 
        `{"id": ${scene.id}, "location": "${scene.location || ''}", "time": "${scene.time || ''}"}`
      )
      sceneList = `[${sceneInfoList.join(', ')}]`
    }
    
    console.log('[LocalGeneration] Generating storyboard', {
      episode_id: episodeId,
      drama_id: foundDrama.id,
      script_length: scriptContent.length,
      character_count: foundDrama.characters?.length || 0,
      scene_count: foundDrama.scenes?.length || 0
    })
    
    // 更新进度
    taskCollection.update(taskId, {
      progress: 30,
      message: '正在调用AI生成分镜...',
      updated_at: now()
    })
    
    // 构建提示词
    const prompt = STORYBOARD_PROMPT_TEMPLATE
      .replace('{CHARACTER_LIST}', characterList)
      .replace('{SCENE_LIST}', sceneList)
      .replace('{SCRIPT_CONTENT}', scriptContent)
    
    // 调用 AI 生成
    const text = await generateText(prompt)
    
    // 更新进度
    taskCollection.update(taskId, {
      progress: 70,
      message: '正在解析分镜结果...',
      updated_at: now()
    })
    
    // 解析 JSON 结果
    const result = parseAIJSON<{ storyboards: any[] }>(text)
    if (!result || !result.storyboards) {
      throw new Error('解析分镜结果失败')
    }
    
    const storyboards = result.storyboards
    const total = storyboards.length
    
    // 计算总时长
    let totalDuration = 0
    storyboards.forEach((sb: any) => {
      totalDuration += sb.duration || 6
    })
    
    console.log('[LocalGeneration] Storyboard generated', {
      episode_id: episodeId,
      count: total,
      total_duration_seconds: totalDuration
    })
    
    // 更新进度
    taskCollection.update(taskId, {
      progress: 85,
      message: '正在保存分镜...',
      updated_at: now()
    })
    
    // 保存分镜到 drama
    const storyboardsToSave = storyboards.map((sb: any, index: number) => {
      // 构建描述信息（对应 Go saveStoryboards 逻辑）
      const description = `【镜头类型】${sb.shot_type || ''}\n【运镜】${sb.movement || ''}\n【动作】${sb.action || ''}\n【对话】${sb.dialogue || ''}\n【结果】${sb.result || ''}\n【情绪】${sb.emotion || ''}`
      
      // 生成 image_prompt（专用于图片生成）
      const imagePrompt = generateImagePrompt(sb)
      
      // 生成 video_prompt（专用于视频生成）
      const videoPrompt = generateVideoPrompt(sb)
      
      return {
        id: generateId('sb'),
        episode_id: episodeId,
        storyboard_number: sb.shot_number || index + 1,
        title: sb.title || `分镜 ${index + 1}`,
        description,
        shot_type: sb.shot_type,
        angle: sb.angle,
        time: sb.time,
        location: sb.location,
        scene_id: sb.scene_id,
        movement: sb.movement,
        action: sb.action,
        dialogue: sb.dialogue,
        result: sb.result,
        atmosphere: sb.atmosphere,
        emotion: sb.emotion,
        duration: sb.duration || 6,
        bgm_prompt: sb.bgm_prompt,
        sound_effect: sb.sound_effect,
        characters: sb.characters || [],
        is_primary: sb.is_primary !== false,
        image_prompt: imagePrompt,
        video_prompt: videoPrompt,
        status: 'draft',
        created_at: now(),
        updated_at: now()
      }
    })
    
    // 更新 drama 中对应 episode 的 storyboards
    updateDramaById(foundDrama.id, d => {
      if (d.episodes) {
        const epIndex = d.episodes.findIndex(ep => ep.id === episodeId)
        if (epIndex !== -1) {
          d.episodes[epIndex].storyboards = storyboardsToSave
          // 更新时长（秒转分钟）
          d.episodes[epIndex].duration = Math.ceil(totalDuration / 60)
        }
      }
      d.updated_at = now()
      return d
    })
    
    // 更新任务完成
    taskCollection.update(taskId, {
      status: 'completed',
      progress: 100,
      message: `成功生成 ${total} 个分镜`,
      result: JSON.stringify({ storyboards: storyboardsToSave, total }),
      completed_at: now(),
      updated_at: now()
    })
    
    console.log('[LocalGeneration] Storyboard generation completed', { task_id: taskId, total })
  } catch (error: any) {
    console.error('[LocalGeneration] Storyboard generation failed:', error)
    taskCollection.update(taskId, {
      status: 'failed',
      error: error.message || '分镜生成失败',
      updated_at: now()
    })
  }
}

export const localGenerationAPI = {
  async generateOutline(data: GenerateOutlineRequest): Promise<OutlineResult> {
    // 本地模式返回模板大纲
    return {
      title: data.theme || '新剧本',
      summary: `基于主题"${data.theme}"的剧本大纲`,
      genre: data.genre || '剧情',
      tags: ['原创', data.genre || '剧情'],
      characters: [
        {
          name: '主角',
          role: '主角',
          description: '故事的主要人物',
          personality: '勇敢、善良',
          appearance: '普通外表'
        }
      ],
      episodes: [
        {
          episode_number: 1,
          title: '第一集',
          summary: '故事的开端',
          scenes: ['开场', '发展', '结尾'],
          duration: 300
        }
      ],
      key_scenes: ['开场场景', '高潮场景', '结局场景']
    }
  },

  async generateCharacters(data: GenerateCharactersRequest) {
    const taskId = generateId('task')
    
    // 创建任务
    const task: Task = {
      id: taskId,
      type: 'generate_characters',
      status: 'processing',
      progress: 10,
      message: '正在生成角色...',
      created_at: now(),
      updated_at: now()
    }
    taskCollection.add(task)
    
    // 异步执行生成
    processCharacterGeneration(taskId, data).catch(err => {
      console.error('[LocalGeneration] Character generation failed:', err)
      taskCollection.update(taskId, {
        status: 'failed',
        error: err.message,
        updated_at: now()
      })
    })
    
    return {
      task_id: taskId,
      status: 'pending',
      message: '角色生成任务已创建，正在后台处理...'
    }
  },

  async generateEpisodes(data: GenerateEpisodesRequest): Promise<Episode[]> {
    const episodes: Episode[] = []
    
    for (let i = 1; i <= data.episode_count; i++) {
      const episode: Episode = {
        id: generateId('ep'),
        drama_id: data.drama_id,
        episode_number: i,
        title: `第${i}集`,
        content: '',
        description: `第${i}集的内容`,
        status: 'draft',
        storyboards: [],
        scenes: [],
        created_at: now(),
        updated_at: now()
      }
      episodes.push(episode)
    }
    
    // 更新 drama 中的 episodes 列表
    updateDramaById(data.drama_id, d => ({
      ...d,
      episodes,
      total_episodes: episodes.length,
      updated_at: now()
    }))
    
    return episodes
  },

  async generateStoryboard(episodeId: string) {
    const taskId = generateId('task')
    
    // 创建异步任务（pending 状态）
    const task: Task = {
      id: taskId,
      type: 'generate_storyboard',
      status: 'pending',
      progress: 0,
      message: '分镜生成任务已创建，正在后台处理...',
      created_at: now(),
      updated_at: now()
    }
    
    taskCollection.add(task)
    
    // 启动后台处理（模拟 Go 的 goroutine）
    setTimeout(() => {
      processStoryboardGeneration(taskId, episodeId)
    }, 0)
    
    // 立即返回任务ID
    return {
      task_id: taskId,
      status: 'pending',
      message: '分镜生成任务已创建，正在后台处理...'
    }
  },

  async getTaskStatus(taskId: string) {
    const task = taskCollection.getById(taskId)
    if (!task) {
      // 返回一个完成的模拟任务
      return {
        id: taskId,
        type: 'unknown',
        status: 'completed' as const,
        progress: 100,
        message: '任务已完成',
        created_at: now(),
        updated_at: now(),
        completed_at: now()
      }
    }
    return task
  }
}
